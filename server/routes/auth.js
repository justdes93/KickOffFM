// Auth routes — register / login / me / logout.
//
// MVP flow:
//   1. POST /api/auth/register  — creates user (gated by BETA_KEY env). Returns linkToken
//                                  that the user pastes into Telegram bot to enable 2FA.
//   2. POST /api/auth/login     — verifies password.
//                                  - If user has telegramChatId: dispatches 6-digit code via bot,
//                                    returns { needs2fa: true, challengeToken }.
//                                  - Else: returns JWT directly (initial login window — link 2FA from /me).
//   3. POST /api/auth/2fa/verify — exchanges challengeToken+code for JWT.
//   4. GET  /api/auth/me        — returns current user (JWT-protected).
//   5. POST /api/auth/logout    — client discards JWT (we don't keep server-side sessions).
//
// Telegram 2FA logic itself lives in server/services/telegram.js (S35 day 2).
// This file only orchestrates — `tgService` is injected via app.tgService.

import argon2 from 'argon2';
import crypto from 'node:crypto';
import { User } from '../db/models/index.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const USERNAME_RE = /^[a-zA-Z0-9_]{3,24}$/;

const requireDb = (app, reply) => {
  if (!app.dbReady) {
    reply.code(503).send({ error: 'db_not_ready' });
    return false;
  }
  return true;
};

function genCode() {
  // 6-digit numeric, leading-zero friendly.
  return ('' + Math.floor(Math.random() * 1_000_000)).padStart(6, '0');
}

function genToken(bytes = 24) {
  return crypto.randomBytes(bytes).toString('hex');
}

export default async function authRoutes(app) {
  // ---- POST /api/auth/register ----
  app.post('/api/auth/register', async (req, reply) => {
    if (!requireDb(app, reply)) return;
    const { email, username, password, betaKey } = req.body || {};
    if (typeof email !== 'string' || !EMAIL_RE.test(email))
      return reply.code(400).send({ error: 'invalid_email' });
    if (typeof username !== 'string' || !USERNAME_RE.test(username))
      return reply.code(400).send({ error: 'invalid_username', hint: '3-24 chars, [a-zA-Z0-9_]' });
    if (typeof password !== 'string' || password.length < 8)
      return reply.code(400).send({ error: 'weak_password', hint: 'at least 8 chars' });
    if (process.env.BETA_KEY && betaKey !== process.env.BETA_KEY)
      return reply.code(403).send({ error: 'invalid_beta_key' });

    const lower = email.toLowerCase().trim();
    const existsEmail = await User.findOne({ email: lower }).select('_id').lean();
    if (existsEmail) return reply.code(409).send({ error: 'email_taken' });
    const existsUser = await User.findOne({ username }).select('_id').lean();
    if (existsUser) return reply.code(409).send({ error: 'username_taken' });

    const hash = await argon2.hash(password, { type: argon2.argon2id });
    const linkToken = genToken(16);
    const user = await User.create({
      email: lower,
      username,
      passwordHash: hash,
      telegramLinkToken: linkToken,
      telegramLinkExpires: new Date(Date.now() + 24 * 60 * 60 * 1000),  // 24h
      betaAccessGranted: true,
    });

    return reply.code(201).send({
      ok: true,
      userId: user._id,
      username: user.username,
      // The user pastes this into Telegram bot to enable 2FA.
      // Bot @<botName>  →  /start <linkToken>
      telegramLinkToken: linkToken,
      botUsername: app.tgService?.botUsername || null,
    });
  });

  // ---- POST /api/auth/login ----
  app.post('/api/auth/login', async (req, reply) => {
    if (!requireDb(app, reply)) return;
    const { email, password } = req.body || {};
    if (typeof email !== 'string' || typeof password !== 'string')
      return reply.code(400).send({ error: 'missing_fields' });

    const lower = email.toLowerCase().trim();
    const user = await User.findOne({ email: lower });
    if (!user) return reply.code(401).send({ error: 'invalid_credentials' });

    const ok = await argon2.verify(user.passwordHash, password);
    if (!ok) return reply.code(401).send({ error: 'invalid_credentials' });

    user.lastLoginAt = new Date();

    // 2FA branch: if user has linked Telegram, dispatch code and require /2fa/verify.
    if (user.telegramChatId && app.tgService?.ready) {
      const code = genCode();
      user.twoFaCode = code;
      user.twoFaCodeExpires = new Date(Date.now() + 5 * 60 * 1000);  // 5 min
      await user.save();
      try {
        await app.tgService.sendCode(user.telegramChatId, code);
      } catch (err) {
        app.log.error({ err: err.message, userId: user._id.toString() }, 'tg send failed');
        return reply.code(502).send({ error: 'telegram_unreachable' });
      }
      // Short-lived JWT bound to a 2fa challenge — must be exchanged via /2fa/verify.
      const challengeToken = app.jwt.sign(
        { sub: user._id.toString(), purpose: '2fa-challenge' },
        { expiresIn: '5m' }
      );
      return { needs2fa: true, challengeToken };
    }

    // No 2FA yet (newly registered, hasn't linked) — issue session JWT directly.
    await user.save();
    const token = app.jwt.sign({ sub: user._id.toString(), purpose: 'session' });
    return {
      needs2fa: false,
      token,
      user: { id: user._id, username: user.username, email: user.email,
              telegramLinked: !!user.telegramChatId,
              currentTeamId: user.currentTeamId, currentWorldId: user.currentWorldId },
    };
  });

  // ---- POST /api/auth/2fa/verify ----
  app.post('/api/auth/2fa/verify', async (req, reply) => {
    if (!requireDb(app, reply)) return;
    const { challengeToken, code } = req.body || {};
    if (typeof challengeToken !== 'string' || typeof code !== 'string')
      return reply.code(400).send({ error: 'missing_fields' });

    let payload;
    try {
      payload = app.jwt.verify(challengeToken);
    } catch {
      return reply.code(401).send({ error: 'invalid_challenge' });
    }
    if (payload.purpose !== '2fa-challenge')
      return reply.code(401).send({ error: 'invalid_challenge' });

    const user = await User.findById(payload.sub);
    if (!user) return reply.code(401).send({ error: 'user_gone' });
    if (!user.twoFaCode || !user.twoFaCodeExpires || user.twoFaCodeExpires < new Date())
      return reply.code(401).send({ error: 'code_expired' });
    if (user.twoFaCode !== code)
      return reply.code(401).send({ error: 'wrong_code' });

    user.twoFaCode = null;
    user.twoFaCodeExpires = null;
    await user.save();

    const token = app.jwt.sign({ sub: user._id.toString(), purpose: 'session' });
    return {
      token,
      user: { id: user._id, username: user.username, email: user.email,
              telegramLinked: true },
    };
  });

  // ---- GET /api/auth/me ----
  app.get('/api/auth/me', { preHandler: app.authenticate }, async (req, reply) => {
    if (!requireDb(app, reply)) return;
    if (req.user.purpose !== 'session')
      return reply.code(401).send({ error: 'invalid_token_purpose' });
    const user = await User.findById(req.user.sub).lean();
    if (!user) return reply.code(401).send({ error: 'user_gone' });
    return {
      id: user._id, username: user.username, email: user.email,
      telegramLinked: !!user.telegramChatId,
      currentTeamId: user.currentTeamId, currentWorldId: user.currentWorldId,
      isAdmin: !!user.isAdmin,
      role: user.isAdmin ? 'admin' : 'coach',                // S45
      coach: user.coach || {},                                // career stats (initially zeros)
    };
  });

  // ---- POST /api/auth/logout ----
  // Stateless JWT — client just discards. Endpoint exists for symmetry / future revoke list.
  app.post('/api/auth/logout', { preHandler: app.authenticate }, async () => ({ ok: true }));
}
