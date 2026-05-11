// Admin routes (S51) — CRUD on Leagues / Teams / Players.
// All endpoints require `app.requireAdmin` (isAdmin flag in DB).
//
//   GET    /api/admin/overview              — high-level counts
//   GET    /api/admin/teams                 — list (filter by leagueId)
//   POST   /api/admin/teams                 — create
//   PATCH  /api/admin/teams/:id             — update
//   DELETE /api/admin/teams/:id             — delete (cascades players + unassigns manager)
//
//   GET    /api/admin/players?teamId=...    — list
//   POST   /api/admin/players               — create on team
//   PATCH  /api/admin/players/:id           — update
//   DELETE /api/admin/players/:id           — delete
//
//   GET    /api/admin/leagues               — list
//   POST   /api/admin/leagues               — create
//   PATCH  /api/admin/leagues/:id           — update
//   DELETE /api/admin/leagues/:id           — delete (only if no teams)

import { World, League, Season, Team, Player, User } from '../db/models/index.js';

const dbReady = (app, reply) => {
  if (!app.dbReady) { reply.code(503).send({ error: 'db_not_ready' }); return false; }
  return true;
};

export default async function adminRoutes(app) {
  const guard = { preHandler: [app.authenticate, app.requireAdmin] };

  // ---- Overview ----
  app.get('/api/admin/overview', guard, async (req, reply) => {
    if (!dbReady(app, reply)) return;
    const [worlds, leagues, teams, players, users, admins] = await Promise.all([
      World.countDocuments(), League.countDocuments(), Team.countDocuments(),
      Player.countDocuments(), User.countDocuments(), User.countDocuments({ isAdmin: true }),
    ]);
    const managedTeams = await Team.countDocuments({ managerUserId: { $ne: null } });
    return { worlds, leagues, teams, players, users, admins, managedTeams };
  });

  // ============================================================================
  //   Leagues
  // ============================================================================
  app.get('/api/admin/leagues', guard, async (req, reply) => {
    if (!dbReady(app, reply)) return;
    const leagues = await League.find().lean();
    const counts = await Promise.all(leagues.map(l =>
      Team.countDocuments({ leagueId: l._id }).then(c => ({ ...l, teamCount: c }))
    ));
    return { leagues: counts };
  });

  app.post('/api/admin/leagues', guard, async (req, reply) => {
    if (!dbReady(app, reply)) return;
    const { worldSlug = 'alpha', slug, name, country = 'XX', tier = 1, teamCount = 20 } = req.body || {};
    if (!slug || !name) return reply.code(400).send({ error: 'slug_and_name_required' });
    const world = await World.findOne({ slug: worldSlug }).select('_id').lean();
    if (!world) return reply.code(404).send({ error: 'world_not_found' });
    try {
      const lg = await League.create({ worldId: world._id, slug, name, country, tier, teamCount });
      return reply.code(201).send({ ok: true, league: lg });
    } catch (err) {
      return reply.code(409).send({ error: 'duplicate_or_invalid', detail: err.message });
    }
  });

  app.patch('/api/admin/leagues/:id', guard, async (req, reply) => {
    if (!dbReady(app, reply)) return;
    const allowed = ['slug', 'name', 'country', 'tier', 'teamCount'];
    const patch = {};
    for (const k of allowed) if (k in (req.body || {})) patch[k] = req.body[k];
    const lg = await League.findByIdAndUpdate(req.params.id, { $set: patch }, { new: true });
    if (!lg) return reply.code(404).send({ error: 'not_found' });
    return { ok: true, league: lg };
  });

  app.delete('/api/admin/leagues/:id', guard, async (req, reply) => {
    if (!dbReady(app, reply)) return;
    const teamCount = await Team.countDocuments({ leagueId: req.params.id });
    if (teamCount > 0) return reply.code(409).send({ error: 'league_has_teams', teamCount });
    await League.deleteOne({ _id: req.params.id });
    return { ok: true };
  });

  // ============================================================================
  //   Teams
  // ============================================================================
  app.get('/api/admin/teams', guard, async (req, reply) => {
    if (!dbReady(app, reply)) return;
    const q = {};
    if (req.query.leagueId) q.leagueId = req.query.leagueId;
    if (req.query.q) q.name = { $regex: req.query.q, $options: 'i' };
    const teams = await Team.find(q).select('-lineupOverrides').sort({ name: 1 }).limit(200).lean();
    const managerIds = teams.map(t => t.managerUserId).filter(Boolean);
    const mgrs = managerIds.length
      ? await User.find({ _id: { $in: managerIds } }).select('username').lean() : [];
    const mgrMap = Object.fromEntries(mgrs.map(u => [u._id.toString(), u.username]));
    return {
      teams: teams.map(t => ({ ...t, managerUsername: t.managerUserId ? mgrMap[t.managerUserId.toString()] : null })),
    };
  });

  app.post('/api/admin/teams', guard, async (req, reply) => {
    if (!dbReady(app, reply)) return;
    const { leagueId, slug, name, short, city = '', color = '#888888', tier = 3, founded = 2024 } = req.body || {};
    if (!leagueId || !slug || !name || !short) return reply.code(400).send({ error: 'missing_fields' });
    const lg = await League.findById(leagueId).select('worldId').lean();
    if (!lg) return reply.code(404).send({ error: 'league_not_found' });
    try {
      const team = await Team.create({
        worldId: lg.worldId, leagueId,
        slug, name, short: short.slice(0, 4).toUpperCase(),
        city, color, tier: Math.max(1, Math.min(5, Number(tier))),
        founded: Number(founded),
      });
      return reply.code(201).send({ ok: true, team });
    } catch (err) {
      return reply.code(409).send({ error: 'duplicate_or_invalid', detail: err.message });
    }
  });

  app.patch('/api/admin/teams/:id', guard, async (req, reply) => {
    if (!dbReady(app, reply)) return;
    const allowed = ['name', 'short', 'city', 'color', 'tier', 'founded', 'slug'];
    const patch = {};
    for (const k of allowed) if (k in (req.body || {})) patch[k] = req.body[k];
    if (patch.short) patch.short = String(patch.short).slice(0, 4).toUpperCase();
    if ('tier' in patch) patch.tier = Math.max(1, Math.min(5, Number(patch.tier)));
    const team = await Team.findByIdAndUpdate(req.params.id, { $set: patch }, { new: true });
    if (!team) return reply.code(404).send({ error: 'not_found' });
    return { ok: true, team };
  });

  app.delete('/api/admin/teams/:id', guard, async (req, reply) => {
    if (!dbReady(app, reply)) return;
    const team = await Team.findById(req.params.id);
    if (!team) return reply.code(404).send({ error: 'not_found' });
    if (team.managerUserId) {
      await User.updateOne({ _id: team.managerUserId }, { $set: { currentTeamId: null, currentWorldId: null } });
    }
    await Player.deleteMany({ teamId: team._id });
    await Team.deleteOne({ _id: team._id });
    return { ok: true };
  });

  // ============================================================================
  //   Players
  // ============================================================================
  app.get('/api/admin/players', guard, async (req, reply) => {
    if (!dbReady(app, reply)) return;
    if (!req.query.teamId) return reply.code(400).send({ error: 'teamId_required' });
    const players = await Player.find({ teamId: req.query.teamId }).sort({ num: 1 }).lean();
    return { players };
  });

  app.post('/api/admin/players', guard, async (req, reply) => {
    if (!dbReady(app, reply)) return;
    const { teamId, num, name, role, role_kind, duty = 'support', tier = 3, age = 24, attrs } = req.body || {};
    if (!teamId || !num || !name || !role) return reply.code(400).send({ error: 'missing_fields' });
    const team = await Team.findById(teamId).select('worldId').lean();
    if (!team) return reply.code(404).send({ error: 'team_not_found' });
    try {
      const p = await Player.create({
        teamId, worldId: team.worldId,
        num: Number(num), name, role,
        role_kind: role_kind || null, duty,
        tier: Math.max(1, Math.min(5, Number(tier))),
        age: Math.max(15, Math.min(45, Number(age))),
        attrs: attrs && typeof attrs === 'object' ? attrs : { /* defaults will be set on first match if missing */ },
      });
      return reply.code(201).send({ ok: true, player: p });
    } catch (err) {
      return reply.code(409).send({ error: 'duplicate_or_invalid', detail: err.message });
    }
  });

  app.patch('/api/admin/players/:id', guard, async (req, reply) => {
    if (!dbReady(app, reply)) return;
    const allowed = ['num', 'name', 'role', 'role_kind', 'duty', 'tier', 'age', 'attrs', 'nationality', 'preferredFoot'];
    const patch = {};
    for (const k of allowed) if (k in (req.body || {})) patch[k] = req.body[k];
    if ('tier' in patch) patch.tier = Math.max(1, Math.min(5, Number(patch.tier)));
    if ('age' in patch)  patch.age  = Math.max(15, Math.min(45, Number(patch.age)));
    const p = await Player.findByIdAndUpdate(req.params.id, { $set: patch }, { new: true });
    if (!p) return reply.code(404).send({ error: 'not_found' });
    return { ok: true, player: p };
  });

  app.delete('/api/admin/players/:id', guard, async (req, reply) => {
    if (!dbReady(app, reply)) return;
    const r = await Player.deleteOne({ _id: req.params.id });
    if (!r.deletedCount) return reply.code(404).send({ error: 'not_found' });
    return { ok: true };
  });
}
