// Friendly match routes (S49).
//
//   POST /api/friendlies                  — schedule one (auth required, must manage a team)
//   GET  /api/friendlies/mine             — list friendlies involving user's team
//   GET  /api/friendlies/:id              — single friendly (incl. result if finished)
//
// Pace: friendlies use halfLenSec=600 (20-min total). Scheduling: defaults to now,
// scheduler picks it up within ~30s.

import { Friendly, Team, User } from '../db/models/index.js';

const dbReady = (app, reply) => {
  if (!app.dbReady) { reply.code(503).send({ error: 'db_not_ready' }); return false; }
  return true;
};

export default async function friendlyRoutes(app) {
  // ---- Create friendly ----
  app.post('/api/friendlies', { preHandler: app.authenticate }, async (req, reply) => {
    if (!dbReady(app, reply)) return;
    if (req.user.purpose !== 'session') return reply.code(401).send({ error: 'invalid_token_purpose' });

    const { opponentTeamId, asHome = true, kickoffInMin = 1 } = req.body || {};
    if (!opponentTeamId) return reply.code(400).send({ error: 'opponent_required' });

    const user = await User.findById(req.user.sub);
    if (!user) return reply.code(401).send({ error: 'user_gone' });
    if (!user.currentTeamId) return reply.code(403).send({ error: 'no_team' });

    const myTeam = await Team.findById(user.currentTeamId).select('_id worldId').lean();
    if (!myTeam) return reply.code(409).send({ error: 'managed_team_missing' });

    let opp;
    try { opp = await Team.findById(opponentTeamId).select('_id worldId').lean(); }
    catch { return reply.code(400).send({ error: 'invalid_opponent_id' }); }
    if (!opp) return reply.code(404).send({ error: 'opponent_not_found' });
    if (opp._id.equals(myTeam._id)) return reply.code(400).send({ error: 'self_match' });
    if (!opp.worldId.equals(myTeam.worldId)) return reply.code(400).send({ error: 'cross_world' });

    const kickoffMin = Math.max(0, Math.min(60, Number(kickoffInMin) || 1));
    const scheduledAt = new Date(Date.now() + kickoffMin * 60 * 1000);

    const friendly = await Friendly.create({
      worldId: myTeam.worldId,
      createdBy: user._id,
      homeTeamId: asHome ? myTeam._id : opp._id,
      awayTeamId: asHome ? opp._id : myTeam._id,
      scheduledAt,
      halfLenSec: 600,             // 20 min total
      state: 'scheduled',
    });

    return reply.code(201).send({
      ok: true,
      friendly: {
        id: friendly._id,
        homeTeamId: friendly.homeTeamId,
        awayTeamId: friendly.awayTeamId,
        scheduledAt: friendly.scheduledAt,
        kickoffInSec: Math.round(kickoffMin * 60),
      },
    });
  });

  // ---- List my friendlies ----
  app.get('/api/friendlies/mine', { preHandler: app.authenticate }, async (req, reply) => {
    if (!dbReady(app, reply)) return;
    if (req.user.purpose !== 'session') return reply.code(401).send({ error: 'invalid_token_purpose' });

    const user = await User.findById(req.user.sub).select('currentTeamId').lean();
    if (!user?.currentTeamId) return { upcoming: [], recent: [] };

    const teamId = user.currentTeamId;
    const [up, done] = await Promise.all([
      Friendly.find({
        $or: [{ homeTeamId: teamId }, { awayTeamId: teamId }],
        state: { $in: ['scheduled', 'in_progress'] },
      }).sort({ scheduledAt: 1 }).limit(20).lean(),
      Friendly.find({
        $or: [{ homeTeamId: teamId }, { awayTeamId: teamId }],
        state: 'finished',
      }).sort({ finishedAt: -1 }).limit(20).lean(),
    ]);

    // Resolve opponent names
    const teamIds = new Set();
    for (const f of [...up, ...done]) { teamIds.add(f.homeTeamId.toString()); teamIds.add(f.awayTeamId.toString()); }
    const teams = await Team.find({ _id: { $in: [...teamIds] } }).select('slug name short color').lean();
    const teamMap = Object.fromEntries(teams.map(t => [t._id.toString(), t]));

    const view = (f) => {
      const isHome = f.homeTeamId.toString() === teamId.toString();
      const oppId = isHome ? f.awayTeamId : f.homeTeamId;
      const myScore = isHome ? f.homeScore : f.awayScore;
      const oppScore = isHome ? f.awayScore : f.homeScore;
      return {
        id: f._id, scheduledAt: f.scheduledAt, state: f.state,
        venue: isHome ? 'home' : 'away',
        opponent: teamMap[oppId.toString()] || null,
        homeScore: f.homeScore, awayScore: f.awayScore,
        myScore, oppScore,
        outcome: f.state === 'finished' ? (myScore > oppScore ? 'W' : myScore < oppScore ? 'L' : 'D') : null,
        finishedAt: f.finishedAt,
      };
    };
    return { upcoming: up.map(view), recent: done.map(view) };
  });

  // ---- Single friendly detail (incl. inline result) ----
  app.get('/api/friendlies/:id', async (req, reply) => {
    if (!dbReady(app, reply)) return;
    let f;
    try { f = await Friendly.findById(req.params.id).lean(); }
    catch { return reply.code(400).send({ error: 'invalid_id' }); }
    if (!f) return reply.code(404).send({ error: 'friendly_not_found' });
    const [home, away] = await Promise.all([
      Team.findById(f.homeTeamId).select('slug name short color').lean(),
      Team.findById(f.awayTeamId).select('slug name short color').lean(),
    ]);
    return { friendly: f, home, away };
  });
}
