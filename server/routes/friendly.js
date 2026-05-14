// Friendly match routes (S49 + S55 invitation flow).
//
//   POST /api/friendlies                  — create (challenger). If opponent has a
//                                            manager → state=pending; else scheduled.
//   POST /api/friendlies/:id/accept       — opponent accepts → state=scheduled,
//                                            scheduledAt = now + 10 min.
//   POST /api/friendlies/:id/decline      — opponent declines → state=declined.
//   GET  /api/friendlies/mine             — list friendlies involving user's team.
//   GET  /api/friendlies/invitations      — pending invitations *for* the user.
//   GET  /api/friendlies/active           — single active friendly (in_progress) or
//                                            pending invitation. For top-bar pill.
//   GET  /api/friendlies/:id              — single friendly (incl. result if finished).
//
// Pace: friendlies use halfLenSec=600 (20-min total).

import { Friendly, Team, User, Player, League } from '../db/models/index.js';
import { pickRole, ROLES as ROLE_DEFS, playerOverall } from '../../data.js';
import { resimulateFriendly } from '../services/matchRunner.js';

const INVITE_WINDOW_MS = 5 * 60 * 1000;         // 5 min for opponent to respond (S59)
const PREP_WINDOW_MS   = 5 * 60 * 1000;         // 5 min between accept and kickoff (S59)

// Wall-clock reveal timing for friendlies — mirrors the client RAF loop so the
// score+minute exposed via API/pill matches what users see in the live view.
// Handles 3-min real halftime pause between halves.
function desiredSimSec(elapsedRealSec, halfLenSec, speedFactor, halftimeRealSec) {
  const halfRealSec = halfLenSec / speedFactor;
  if (elapsedRealSec < halfRealSec) return elapsedRealSec * speedFactor;
  if (elapsedRealSec < halfRealSec + halftimeRealSec) return halfLenSec;
  const playingAfterBreak = elapsedRealSec - halfRealSec - halftimeRealSec;
  return Math.min(halfLenSec * 2, halfLenSec + playingAfterBreak * speedFactor);
}

const dbReady = (app, reply) => {
  if (!app.dbReady) { reply.code(503).send({ error: 'db_not_ready' }); return false; }
  return true;
};

// Shape a friendly doc into a list-row view from a user's perspective.
function viewRow(f, myTeamId, teamMap) {
  const myId = myTeamId.toString();
  const isHome = f.homeTeamId.toString() === myId;
  const oppId = isHome ? f.awayTeamId : f.homeTeamId;
  const myScore = isHome ? f.homeScore : f.awayScore;
  const oppScore = isHome ? f.awayScore : f.homeScore;
  return {
    id: f._id, state: f.state,
    scheduledAt: f.scheduledAt, startedAt: f.startedAt, finishedAt: f.finishedAt,
    inviteDeadline: f.inviteDeadline, acceptedAt: f.acceptedAt,
    venue: isHome ? 'home' : 'away',
    opponent: teamMap[oppId.toString()] || null,
    homeScore: f.homeScore, awayScore: f.awayScore,
    myScore, oppScore,
    outcome: f.state === 'finished' ? (myScore > oppScore ? 'W' : myScore < oppScore ? 'L' : 'D') : null,
  };
}

export default async function friendlyRoutes(app) {
  // ---- Create friendly ----
  app.post('/api/friendlies', { preHandler: app.authenticate }, async (req, reply) => {
    if (!dbReady(app, reply)) return;
    if (req.user.purpose !== 'session') return reply.code(401).send({ error: 'invalid_token_purpose' });

    const { opponentTeamId, asHome = true } = req.body || {};
    if (!opponentTeamId) return reply.code(400).send({ error: 'opponent_required' });

    const user = await User.findById(req.user.sub);
    if (!user) return reply.code(401).send({ error: 'user_gone' });
    if (!user.currentTeamId) return reply.code(403).send({ error: 'no_team' });

    const myTeam = await Team.findById(user.currentTeamId).select('_id worldId').lean();
    if (!myTeam) return reply.code(409).send({ error: 'managed_team_missing' });

    let opp;
    try { opp = await Team.findById(opponentTeamId).select('_id worldId managerUserId').lean(); }
    catch { return reply.code(400).send({ error: 'invalid_opponent_id' }); }
    if (!opp) return reply.code(404).send({ error: 'opponent_not_found' });
    if (opp._id.equals(myTeam._id)) return reply.code(400).send({ error: 'self_match' });
    if (!opp.worldId.equals(myTeam.worldId)) return reply.code(400).send({ error: 'cross_world' });

    const now = new Date();
    const inviteDeadline = new Date(now.getTime() + INVITE_WINDOW_MS);
    const isOppManaged = !!opp.managerUserId;

    const friendly = await Friendly.create({
      worldId: myTeam.worldId,
      createdBy: user._id,
      homeTeamId: asHome ? myTeam._id : opp._id,
      awayTeamId: asHome ? opp._id : myTeam._id,
      opponentManagerId: opp.managerUserId || null,
      inviteDeadline,
      // Unmanaged opponent: skip pending, schedule kickoff at inviteDeadline (= +5 min).
      // Managed opponent: provisional scheduledAt = inviteDeadline (= auto-accept time).
      scheduledAt: inviteDeadline,
      state: isOppManaged ? 'pending' : 'scheduled',
    });

    // S59/S60: ping the opponent on Telegram (best-effort; failures don't break creation).
    app.log.info({
      friendlyId: friendly._id.toString(),
      isOppManaged,
      oppManagerUserId: opp.managerUserId?.toString() || null,
      tgReady: !!app.tgService?.ready,
    }, '[friendly] TG invite path entered');
    if (isOppManaged) {
      try {
        if (!app.tgService?.ready) {
          app.log.warn({ friendlyId: friendly._id.toString() }, '[friendly] TG invite SKIPPED — service not ready');
        } else {
          const oppUser = await User.findById(opp.managerUserId).select('telegramChatId username').lean();
          app.log.info({
            friendlyId: friendly._id.toString(),
            oppUsername: oppUser?.username,
            hasChat: !!oppUser?.telegramChatId,
            chatIdTail: oppUser?.telegramChatId ? String(oppUser.telegramChatId).slice(-4) : null,
          }, '[friendly] TG lookup result');
          if (!oppUser?.telegramChatId) {
            app.log.warn({
              friendlyId: friendly._id.toString(),
              opponent: oppUser?.username || opp.managerUserId.toString(),
            }, '[friendly] TG invite SKIPPED — opponent has no telegramChatId (bot not linked)');
          } else {
            const [myTeamFull, oppTeamFull] = await Promise.all([
              Team.findById(myTeam._id).select('name').lean(),
              Team.findById(opp._id).select('name').lean(),
            ]);
            await app.tgService.sendFriendlyInvite(oppUser.telegramChatId, {
              friendlyId: friendly._id.toString(),
              challenger: user.username,
              myTeam: oppTeamFull?.name || 'Ваша команда',
              oppTeam: myTeamFull?.name || 'Суперник',
            });
            app.log.info({
              friendlyId: friendly._id.toString(),
              to: oppUser.username,
              chatIdTail: String(oppUser.telegramChatId).slice(-4),
            }, '[friendly] TG invite SENT');
          }
        }
      } catch (err) {
        app.log.error({
          err: err.message,
          code: err.code,
          response: err.response?.body || err.response || null,
          stack: err.stack,
          friendlyId: friendly._id.toString(),
        }, '[friendly] TG invite FAILED');
      }
    }

    return reply.code(201).send({
      ok: true,
      friendly: {
        id: friendly._id,
        state: friendly.state,
        scheduledAt: friendly.scheduledAt,
        inviteDeadline: friendly.inviteDeadline,
      },
    });
  });

  // ---- Accept invitation ----
  app.post('/api/friendlies/:id/accept', { preHandler: app.authenticate }, async (req, reply) => {
    if (!dbReady(app, reply)) return;
    const f = await Friendly.findById(req.params.id);
    if (!f) return reply.code(404).send({ error: 'friendly_not_found' });
    if (f.state !== 'pending') return reply.code(409).send({ error: 'not_pending' });
    if (!f.opponentManagerId || f.opponentManagerId.toString() !== req.user.sub) {
      return reply.code(403).send({ error: 'not_invitee' });
    }
    const now = new Date();
    f.state = 'scheduled';
    f.acceptedAt = now;
    f.scheduledAt = new Date(now.getTime() + PREP_WINDOW_MS);
    await f.save();
    return { ok: true, friendly: { id: f._id, state: f.state, scheduledAt: f.scheduledAt } };
  });

  // ---- Save per-match tactics override (managers only) ----
  app.post('/api/friendlies/:id/tactics', { preHandler: app.authenticate }, async (req, reply) => {
    if (!dbReady(app, reply)) return;
    const f = await Friendly.findById(req.params.id);
    if (!f) return reply.code(404).send({ error: 'friendly_not_found' });
    if (!['pending', 'scheduled'].includes(f.state)) return reply.code(409).send({ error: 'too_late' });

    // Identify which side this user manages.
    const user = await User.findById(req.user.sub).select('currentTeamId').lean();
    if (!user?.currentTeamId) return reply.code(403).send({ error: 'no_team' });
    const myTeam = user.currentTeamId.toString();
    const isHome = f.homeTeamId.toString() === myTeam;
    const isAway = f.awayTeamId.toString() === myTeam;
    if (!isHome && !isAway) return reply.code(403).send({ error: 'not_in_match' });

    const { tactics } = req.body || {};
    if (!tactics || typeof tactics !== 'object') return reply.code(400).send({ error: 'tactics_required' });

    // S60 fix: Mongoose doesn't auto-detect changes on Mixed fields after a
    // re-assignment in some versions — markModified guarantees persistence.
    if (isHome) {
      f.homeTacticsOverride = tactics;
      f.markModified('homeTacticsOverride');
    } else {
      f.awayTacticsOverride = tactics;
      f.markModified('awayTacticsOverride');
    }
    await f.save();
    // Round-trip read so client can verify what landed in DB.
    const saved = await Friendly.findById(f._id).select('homeTacticsOverride awayTacticsOverride').lean();
    const persisted = isHome ? saved.homeTacticsOverride : saved.awayTacticsOverride;
    app.log.info({
      friendlyId: f._id.toString(),
      side: isHome ? 'home' : 'away',
      keys: Object.keys(persisted || {}),
    }, '[friendly] tactics override saved');
    return { ok: true, saved: persisted };
  });

  // ---- Decline invitation ----
  app.post('/api/friendlies/:id/decline', { preHandler: app.authenticate }, async (req, reply) => {
    if (!dbReady(app, reply)) return;
    const f = await Friendly.findById(req.params.id);
    if (!f) return reply.code(404).send({ error: 'friendly_not_found' });
    if (f.state !== 'pending') return reply.code(409).send({ error: 'not_pending' });
    if (!f.opponentManagerId || f.opponentManagerId.toString() !== req.user.sub) {
      return reply.code(403).send({ error: 'not_invitee' });
    }
    f.state = 'declined';
    await f.save();
    return { ok: true };
  });

  // ---- List my friendlies ----
  app.get('/api/friendlies/mine', { preHandler: app.authenticate }, async (req, reply) => {
    if (!dbReady(app, reply)) return;

    const user = await User.findById(req.user.sub).select('currentTeamId').lean();
    if (!user?.currentTeamId) return { upcoming: [], recent: [] };
    const teamId = user.currentTeamId;

    const [up, done] = await Promise.all([
      Friendly.find({
        $or: [{ homeTeamId: teamId }, { awayTeamId: teamId }],
        state: { $in: ['pending', 'scheduled', 'in_progress'] },
      }).sort({ scheduledAt: 1 }).limit(20).lean(),
      Friendly.find({
        $or: [{ homeTeamId: teamId }, { awayTeamId: teamId }],
        state: 'finished',
      }).sort({ finishedAt: -1 }).limit(20).lean(),
    ]);

    const teamIds = new Set();
    for (const f of [...up, ...done]) {
      teamIds.add(f.homeTeamId.toString());
      teamIds.add(f.awayTeamId.toString());
    }
    const teams = await Team.find({ _id: { $in: [...teamIds] } }).select('slug name short color emblemUrl').lean();
    const teamMap = Object.fromEntries(teams.map(t => [t._id.toString(), t]));

    return {
      upcoming: up.map(f => viewRow(f, teamId, teamMap)),
      recent:   done.map(f => viewRow(f, teamId, teamMap)),
    };
  });

  // ---- Pending invitations FOR me ----
  app.get('/api/friendlies/invitations', { preHandler: app.authenticate }, async (req, reply) => {
    if (!dbReady(app, reply)) return;
    const invs = await Friendly.find({
      opponentManagerId: req.user.sub,
      state: 'pending',
      inviteDeadline: { $gt: new Date() },
    }).sort({ inviteDeadline: 1 }).limit(20).lean();
    if (!invs.length) return { invitations: [] };

    const teamIds = new Set();
    const userIds = new Set();
    for (const f of invs) {
      teamIds.add(f.homeTeamId.toString());
      teamIds.add(f.awayTeamId.toString());
      userIds.add(f.createdBy.toString());
    }
    const [teams, users] = await Promise.all([
      Team.find({ _id: { $in: [...teamIds] } }).select('slug name short color emblemUrl').lean(),
      User.find({ _id: { $in: [...userIds] } }).select('username').lean(),
    ]);
    const teamMap = Object.fromEntries(teams.map(t => [t._id.toString(), t]));
    const userMap = Object.fromEntries(users.map(u => [u._id.toString(), u.username]));

    return {
      invitations: invs.map(f => ({
        id: f._id,
        challenger: userMap[f.createdBy.toString()] || '?',
        homeTeam: teamMap[f.homeTeamId.toString()] || null,
        awayTeam: teamMap[f.awayTeamId.toString()] || null,
        inviteDeadline: f.inviteDeadline,
      })),
    };
  });

  // ---- Active friendly (for top-bar pill) ----
  // Returns the user's currently-live OR imminent friendly: in_progress > pending invitation.
  app.get('/api/friendlies/active', { preHandler: app.authenticate }, async (req, reply) => {
    if (!dbReady(app, reply)) return;
    const user = await User.findById(req.user.sub).select('currentTeamId').lean();
    if (!user?.currentTeamId) return { active: null };
    const teamId = user.currentTeamId;

    // 1. In-progress match involving the user's team
    const live = await Friendly.findOne({
      state: 'in_progress',
      $or: [{ homeTeamId: teamId }, { awayTeamId: teamId }],
    }).lean();

    if (live) {
      const teams = await Team.find({ _id: { $in: [live.homeTeamId, live.awayTeamId] } })
        .select('slug name short color emblemUrl').lean();
      const teamMap = Object.fromEntries(teams.map(t => [t._id.toString(), t]));
      const elapsedSec = Math.max(0, (Date.now() - new Date(live.startedAt).getTime()) / 1000);
      const halfLen = live.halfLenSec || 2700;
      const revealedSimSec = desiredSimSec(elapsedSec, halfLen, live.simSpeedFactor || 3.0, live.halftimeRealSec || 180);
      const currentMinute = Math.floor(revealedSimSec / 60);
      const revealedGoals = (live.goals || []).filter(g => (g.time || 0) <= revealedSimSec);
      const homeScore = revealedGoals.filter(g => g.side === 'home').length;
      const awayScore = revealedGoals.filter(g => g.side === 'away').length;
      return {
        active: {
          kind: 'live',
          id: live._id,
          home: teamMap[live.homeTeamId.toString()],
          away: teamMap[live.awayTeamId.toString()],
          currentMinute, homeScore, awayScore,
        },
      };
    }

    // 2. Pre-match: user's own friendly is `scheduled` — show countdown pill.
    const prematch = await Friendly.findOne({
      state: 'scheduled',
      $or: [{ homeTeamId: teamId }, { awayTeamId: teamId }],
    }).sort({ scheduledAt: 1 }).lean();
    if (prematch) {
      const teams = await Team.find({ _id: { $in: [prematch.homeTeamId, prematch.awayTeamId] } })
        .select('slug name short color emblemUrl').lean();
      const teamMap = Object.fromEntries(teams.map(t => [t._id.toString(), t]));
      return {
        active: {
          kind: 'prematch',
          id: prematch._id,
          scheduledAt: prematch.scheduledAt,
          home: teamMap[prematch.homeTeamId.toString()],
          away: teamMap[prematch.awayTeamId.toString()],
        },
      };
    }

    // 3. Pending invitation for the user
    const pending = await Friendly.findOne({
      opponentManagerId: req.user.sub,
      state: 'pending',
      inviteDeadline: { $gt: new Date() },
    }).sort({ inviteDeadline: 1 }).lean();
    if (pending) {
      return {
        active: { kind: 'invitation', id: pending._id, inviteDeadline: pending.inviteDeadline },
      };
    }

    return { active: null };
  });

  // ---- Mid-match command (S60): tactics change OR substitution ----
  // Body: { type:'tactics'|'sub', payload, simTime? }
  // simTime defaults to current revealed sim-second. Server appends, then
  // re-runs the engine with all commands so authoritative stats stay in sync.
  app.post('/api/friendlies/:id/live-cmd', { preHandler: app.authenticate }, async (req, reply) => {
    if (!dbReady(app, reply)) return;
    const f = await Friendly.findById(req.params.id);
    if (!f) return reply.code(404).send({ error: 'friendly_not_found' });
    if (f.state !== 'in_progress') return reply.code(409).send({ error: 'not_live' });

    const user = await User.findById(req.user.sub).select('currentTeamId').lean();
    if (!user?.currentTeamId) return reply.code(403).send({ error: 'no_team' });
    const myTeam = user.currentTeamId.toString();
    const isHome = f.homeTeamId.toString() === myTeam;
    const isAway = f.awayTeamId.toString() === myTeam;
    if (!isHome && !isAway) return reply.code(403).send({ error: 'not_in_match' });
    const side = isHome ? 'home' : 'away';

    const { type, payload, simTime } = req.body || {};
    if (!['tactics', 'sub'].includes(type)) return reply.code(400).send({ error: 'bad_type' });

    // Derive simTime from wall-clock if client didn't pass it, so the command
    // applies at "now" in match-time.
    let cmdSimTime = Number(simTime);
    if (!Number.isFinite(cmdSimTime)) {
      const elapsedRealSec = Math.max(0, (Date.now() - new Date(f.startedAt).getTime()) / 1000);
      const halfLen = f.halfLenSec || 2700;
      const speed = f.simSpeedFactor || 3.0;
      const halftime = f.halftimeRealSec || 180;
      const halfRealSec = halfLen / speed;
      if (elapsedRealSec < halfRealSec) cmdSimTime = elapsedRealSec * speed;
      else if (elapsedRealSec < halfRealSec + halftime) cmdSimTime = halfLen;
      else cmdSimTime = Math.min(halfLen * 2, halfLen + (elapsedRealSec - halfRealSec - halftime) * speed);
    }

    f.liveCommands.push({ side, simTime: cmdSimTime, type, payload, submittedAt: new Date() });
    await f.save();

    // Re-run engine asynchronously so the request returns fast.
    resimulateFriendly(f._id, { log: app.log }).catch(err =>
      app.log.warn({ err: err.message }, '[live-cmd] re-sim failed'));

    return { ok: true, commandsCount: f.liveCommands.length };
  });

  // ---- Replay payload: full data for client-side engine reconstruction ----
  // Returns the exact shape the engine consumed on server (minus DB-only refs),
  // so a browser-side MatchEngine seeded with rngSeed reproduces the same match.
  app.get('/api/friendlies/:id/replay', async (req, reply) => {
    if (!dbReady(app, reply)) return;
    let f;
    try { f = await Friendly.findById(req.params.id).lean(); }
    catch { return reply.code(400).send({ error: 'invalid_id' }); }
    if (!f) return reply.code(404).send({ error: 'friendly_not_found' });
    if (!f.rngSeed || !f.startedAt) return reply.code(409).send({ error: 'not_yet_started' });

    // S73: keep server state aligned with current engine code. Between deploys
    // the engine logic shifts (new shoot calibration, cover lanes, etc.) — but
    // the stored goals[] / scores were computed against the engine version at
    // kickoff. A returning user's client runs the *current* engine code from
    // the saved rngSeed and produces different results from the stored ones.
    // Solution: re-run the engine before each replay so server's stored state
    // and the client's deterministic playback always match. Cheap (~50ms) and
    // only happens on view-open.
    if (f.state === 'in_progress') {
      await resimulateFriendly(f._id, { log: app.log }).catch(() => null);
      f = await Friendly.findById(req.params.id).lean();
    }

    const buildTeam = async (teamId) => {
      const team = await Team.findById(teamId).lean();
      if (!team) throw new Error('team_missing');
      const roster = await Player.find({ teamId: team._id }).sort({ num: 1 }).lean();
      return {
        id: team.slug,
        name: team.name,
        short: team.short,
        color: team.color,
        emblemUrl: team.emblemUrl || '',
        tactics: team.tactics,
        roster: roster.map(p => {
          const role_kind = p.role_kind || pickRole({ role: p.role, attrs: p.attrs });
          const duty = p.duty || ROLE_DEFS[role_kind]?.defaultDuty || 'support';
          return {
            num: p.num, name: p.name, role: p.role, pos: p.role,
            role_kind, duty, attrs: p.attrs,
            state: { fitness: 100, fatigue: 0, morale: 65, cards: 0 },
            onPitch: false, benched: true,
          };
        }),
      };
    };

    const [home, away] = await Promise.all([buildTeam(f.homeTeamId), buildTeam(f.awayTeamId)]);
    // S65: apply per-match tactical overrides so the client engine plays the
    // formation/instructions the manager submitted before kickoff, not the
    // team's default. Previously /replay returned team.tactics regardless,
    // so users picking 3-4-3 saw the visual fall back to team default.
    if (f.homeTacticsOverride) home.tactics = { ...home.tactics, ...f.homeTacticsOverride };
    if (f.awayTacticsOverride) away.tactics = { ...away.tactics, ...f.awayTacticsOverride };
    return {
      home, away,
      rngSeed: f.rngSeed,
      startedAt: f.startedAt,
      halfLenSec: f.halfLenSec || 2700,
      simSpeedFactor: f.simSpeedFactor || 3.0,
      halftimeRealSec: f.halftimeRealSec || 180,
      state: f.state,
      homeScore: f.homeScore, awayScore: f.awayScore,
      liveCommands: f.liveCommands || [],
    };
  });

  // ---- Single friendly detail (incl. inline result) ----
  app.get('/api/friendlies/:id', async (req, reply) => {
    if (!dbReady(app, reply)) return;
    let f;
    try { f = await Friendly.findById(req.params.id).lean(); }
    catch { return reply.code(400).send({ error: 'invalid_id' }); }
    if (!f) return reply.code(404).send({ error: 'friendly_not_found' });
    const [home, away] = await Promise.all([
      Team.findById(f.homeTeamId).select('slug name short color emblemUrl').lean(),
      Team.findById(f.awayTeamId).select('slug name short color emblemUrl').lean(),
    ]);

    // Progressive reveal for in_progress friendlies: only return goals that have
    // happened on the wall-clock by now, and a synthetic currentMinute.
    if (f.state === 'in_progress' && f.startedAt) {
      const elapsedSec = Math.max(0, (Date.now() - new Date(f.startedAt).getTime()) / 1000);
      const halfLen = f.halfLenSec || 2700;
      const revealedSimSec = desiredSimSec(elapsedSec, halfLen, f.simSpeedFactor || 3.0, f.halftimeRealSec || 180);
      const goals = (f.goals || []).filter(g => (g.time || 0) <= revealedSimSec);
      f.goals = goals;
      f.homeScore = goals.filter(g => g.side === 'home').length;
      f.awayScore = goals.filter(g => g.side === 'away').length;
      f._currentMinute = Math.floor(revealedSimSec / 60);
    }

    return { friendly: f, home, away };
  });

  // S83: pre-match compare — per-team aggregates of the squad for the
  // friendly-wait page. Returns squad strength, avg overall, avg age,
  // foreigners count, formation, mentality, best player.
  app.get('/api/friendlies/:id/compare', async (req, reply) => {
    if (!dbReady(app, reply)) return;
    let f;
    try { f = await Friendly.findById(req.params.id).lean(); }
    catch { return reply.code(400).send({ error: 'invalid_id' }); }
    if (!f) return reply.code(404).send({ error: 'friendly_not_found' });

    const teamCompare = async (teamId, tacticsOverride) => {
      const team = await Team.findById(teamId).lean();
      if (!team) return null;
      const players = await Player.find({ teamId, transferLocked: { $ne: true } }).lean();
      const league = team.leagueId ? await League.findById(team.leagueId).select('country name slug').lean() : null;
      const country = league?.country || 'EN';
      // Best XI by overall (engine uses a more complex lineup picker, but for
      // a pre-match preview, sum of top 11 overalls is a fair proxy).
      const sorted = [...players].sort((a, b) => playerOverall(b) - playerOverall(a));
      const xi = sorted.slice(0, 11);
      const ovrs = xi.map(playerOverall);
      const squadStrength = ovrs.reduce((s, v) => s + v, 0);
      const avgOverall = Math.round(squadStrength / Math.max(1, ovrs.length));
      const ages = xi.map(p => p.age || 24);
      const avgAge = Math.round(ages.reduce((s, v) => s + v, 0) / Math.max(1, ages.length) * 10) / 10;
      const foreigners = xi.filter(p => p.nationality && p.nationality !== country).length;
      const tactics = tacticsOverride || team.tactics || {};
      const best = sorted[0] ? { name: sorted[0].name, ovr: playerOverall(sorted[0]), role: sorted[0].role } : null;
      let managerName = null;
      if (team.managerUserId) {
        const u = await User.findById(team.managerUserId).select('username').lean();
        managerName = u?.username || null;
      }
      return {
        teamId: team._id,
        name: team.name,
        short: team.short,
        leagueName: league?.name || null,
        squadStrength,
        avgOverall,
        avgAge,
        foreigners,
        squadSize: players.length,
        formation: tactics.formation || '4-3-3',
        mentality: tactics.mentality ?? '0',
        manager: managerName,
        bestPlayer: best,
      };
    };

    const home = await teamCompare(f.homeTeamId, f.homeTacticsOverride);
    const away = await teamCompare(f.awayTeamId, f.awayTacticsOverride);
    return { home, away };
  });
}
