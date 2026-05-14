// Kick-Off FM — server entry. Fastify app + Mongo connection + static client.
//
// Boot order:
//   1. Connect to Mongo (fail-fast if unreachable)
//   2. Register plugins (cors, jwt, websocket, static)
//   3. Mount routes (auth, teams, fixtures, ws)
//   4. Listen on PORT
//
// Run with:  npm run server:dev

import Fastify from 'fastify';
import cors from '@fastify/cors';
import jwt from '@fastify/jwt';
import staticPlugin from '@fastify/static';
import websocket from '@fastify/websocket';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { connectDb } from './db/connection.js';
import * as Models from './db/models/index.js';
import authPlugin from './plugins/authPlugin.js';
import authRoutes from './routes/auth.js';
import worldRoutes from './routes/world.js';
import friendlyRoutes from './routes/friendly.js';
import leagueRoutes from './routes/league.js';
import adminRoutes from './routes/admin.js';
import { initTelegramService } from './services/telegram.js';
import { startScheduler } from './services/scheduler.js';
import { executeFixture, executeFriendly } from './services/matchRunner.js';
import { Fixture, Friendly } from './db/models/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');

async function build() {
  // pino-pretty is a devDependency; only use it if it's actually installed in
  // node_modules (i.e. local dev). In production Docker image we omit dev deps,
  // so the conditional check on NODE_ENV alone is not enough — we also probe.
  let transport;
  if (process.env.NODE_ENV !== 'production') {
    try {
      await import('pino-pretty');
      transport = { target: 'pino-pretty', options: { translateTime: 'HH:MM:ss', ignore: 'pid,hostname' } };
    } catch { /* not installed — fall back to plain JSON logs */ }
  }
  const isProd = process.env.NODE_ENV === 'production';

  // S61 hardening: require a real JWT_SECRET in production — fail-fast instead
  // of silently using the dev fallback.
  if (isProd && !process.env.JWT_SECRET) {
    throw new Error('JWT_SECRET must be set in production');
  }

  const app = Fastify({
    logger: {
      level: isProd ? 'info' : 'debug',
      transport,
    },
    // Trust Fly's proxy so rate-limit + req.ip reflect real client IP, not the edge.
    trustProxy: true,
  });

  // ---- Plugins ----
  // S61: helmet for security headers. CSP is disabled for now (our index.html
  // boot uses inline document.write + inline import); we'll re-enable with a
  // nonce-based policy in a follow-up.
  await app.register(helmet, {
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: { policy: 'same-site' },
    referrerPolicy: { policy: 'no-referrer' },
  });
  // S61: rate-limit. Global cap = 300 req/min; auth routes get a stricter
  // override below. trustProxy already set on Fastify so IP is real-client.
  await app.register(rateLimit, {
    global: true,
    max: 300,
    timeWindow: '1 minute',
    skipOnError: true,           // never deny on internal rate-limit-store errors
  });
  await app.register(cors, {
    // Only our prod domain + localhost in dev — reflecting any origin with
    // credentials:true was dangerous if we ever switch to cookie auth.
    origin: isProd ? ['https://kickoff-fm.fly.dev'] : true,
    credentials: true,
  });
  await app.register(jwt, {
    secret: process.env.JWT_SECRET || 'dev-only-insecure-secret-CHANGE-ME',
    sign: { expiresIn: '7d' },
  });
  await app.register(authPlugin);
  await app.register(websocket);

  // Serve client static files (index.html, main.js, etc.) at root.
  // wildcard:false stops the plugin from grabbing every GET — that lets the
  // notFoundHandler below serve index.html for SPA deep links.
  await app.register(staticPlugin, {
    root: ROOT,
    prefix: '/',
    index: 'index.html',
    wildcard: false,
    setHeaders: (res, filePath) => {
      if (filePath.endsWith('.js')) res.setHeader('Content-Type', 'application/javascript');
    },
  });

  // S58: SPA fallback — any non-/api/ path that didn't match a static file should
  // serve index.html so client-side router can pick it up (deep-linking support).
  app.setNotFoundHandler((req, reply) => {
    if (req.url.startsWith('/api/')) return reply.code(404).send({ error: 'not_found' });
    return reply.sendFile('index.html');
  });

  // S61: global error handler — never leak stack traces or internal messages
  // to clients. Rate-limit returns a structured 429 we surface as `rate_limited`.
  app.setErrorHandler((err, req, reply) => {
    req.log.error({ err, url: req.url, method: req.method }, 'unhandled error');
    if (reply.sent) return;
    if (err.statusCode === 429) {
      return reply.code(429).send({ error: 'rate_limited', retryAfter: err.retryAfter });
    }
    const status = err.statusCode && err.statusCode < 600 ? err.statusCode : 500;
    return reply.code(status).send({
      error: status === 500 ? 'internal_error' : (err.code || err.error || 'error'),
    });
  });

  // ---- Routes ----
  await app.register(authRoutes);
  await app.register(worldRoutes);
  await app.register(friendlyRoutes);
  await app.register(leagueRoutes);
  await app.register(adminRoutes);

  app.get('/api/health', async () => {
    return {
      ok: true,
      env: process.env.NODE_ENV || 'development',
      mongo: app.dbReady ? 'up' : 'down',
      modelsLoaded: Object.keys(Models),
      timestamp: new Date().toISOString(),
    };
  });

  // Sanity probe: count records in each collection. Returns 503 if DB not yet ready.
  app.get('/api/_debug/counts', async (req, reply) => {
    if (!app.dbReady) {
      return reply.code(503).send({ error: 'db_not_ready' });
    }
    const out = {};
    for (const [name, M] of Object.entries(Models)) {
      try { out[name] = await M.countDocuments(); }
      catch (e) { out[name] = `error: ${e.message}`; }
    }
    return out;
  });

  // Admin/debug — force-run a specific fixture immediately (bypasses scheduledAt).
  // Useful for friend-test before season starts. Production should require admin auth.
  app.post('/api/_debug/run-fixture/:id', async (req, reply) => {
    if (!app.dbReady) return reply.code(503).send({ error: 'db_not_ready' });
    const f = await Fixture.findById(req.params.id);
    if (!f) return reply.code(404).send({ error: 'fixture_not_found' });
    if (f.state !== 'scheduled') return reply.code(409).send({ error: 'fixture_state', state: f.state });
    const result = await executeFixture(f._id, { log: app.log });
    return result || { error: 'race_lost' };
  });

  // Same for friendly (S49).
  app.post('/api/_debug/run-friendly/:id', async (req, reply) => {
    if (!app.dbReady) return reply.code(503).send({ error: 'db_not_ready' });
    const f = await Friendly.findById(req.params.id);
    if (!f) return reply.code(404).send({ error: 'friendly_not_found' });
    if (f.state !== 'scheduled') return reply.code(409).send({ error: 'friendly_state', state: f.state });
    const result = await executeFriendly(f._id, { log: app.log });
    return result || { error: 'race_lost' };
  });

  return app;
}

async function start() {
  const app = await build();
  app.dbReady = false;

  // Listen first — server is responsive immediately even if DB is slow / down.
  const port = parseInt(process.env.PORT || '3000', 10);
  const host = process.env.HOST || '0.0.0.0';
  try {
    await app.listen({ port, host });
    app.log.info(`Kick-Off FM server listening on ${host}:${port}`);
  } catch (err) {
    app.log.error({ err }, 'Failed to start server');
    process.exit(1);
  }

  // Connect to DB in background — endpoints that need it can check `app.dbReady`.
  connectDb()
    .then(async () => {
      app.dbReady = true;
      app.log.info('DB ready');
      // S76: clean orphan Team.managerUserId refs (left over when users are
      // deleted directly in Mongo without cascade). Runs once per server start.
      try {
        const { Team, User } = Models;
        const teams = await Team.find({ managerUserId: { $ne: null } })
          .select('_id managerUserId').lean();
        if (teams.length) {
          const userIds = [...new Set(teams.map(t => t.managerUserId.toString()))];
          const users = await User.find({ _id: { $in: userIds } }).select('_id').lean();
          const validIds = new Set(users.map(u => u._id.toString()));
          const orphanIds = teams
            .filter(t => !validIds.has(t.managerUserId.toString()))
            .map(t => t._id);
          if (orphanIds.length) {
            await Team.updateMany(
              { _id: { $in: orphanIds } },
              { $set: { managerUserId: null } }
            );
            app.log.info(`[startup] freed ${orphanIds.length} team(s) with deleted-user manager refs`);
          }
        }
      } catch (err) {
        app.log.warn({ err: err.message }, '[startup] orphan-manager cleanup failed');
      }
    })
    .catch((err) => {
      app.log.warn({ err: err.message }, 'Mongo connection failed — endpoints requiring DB will 503 until reconnected.');
    });

  // Telegram bot (S35) — sets app.tgService for /api/auth/* to use.
  initTelegramService(app)
    .then((svc) => { app.tgService = svc; })
    .catch((err) => app.log.error({ err: err.message }, 'tg init failed'));

  // Match scheduler (S38) — start once DB is ready.
  const tryStartScheduler = () => {
    if (app.dbReady) {
      app.stopScheduler = startScheduler(app);
    } else {
      setTimeout(tryStartScheduler, 1000);
    }
  };
  tryStartScheduler();
}

start();
