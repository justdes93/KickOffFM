// World / league / team browsing + team claim + dashboard.
//
// Public:
//   GET  /api/worlds                            — list all worlds
//   GET  /api/worlds/:slug                      — single world with leagues
//   GET  /api/worlds/:slug/leagues/:lSlug/teams — list teams in a league (with manager flag)
//   GET  /api/teams/:teamId                     — team detail + roster
//
// Authenticated:
//   POST /api/teams/:teamId/claim               — claim an unmanaged team (atomic)
//   POST /api/teams/release                     — release current team
//   GET  /api/dashboard                         — user's team + upcoming fixtures + recent results

import { World, League, Season, Team, Player, Fixture, MatchResult, User, Cup } from '../db/models/index.js';
import { FORMATIONS, ROLES } from '../../data.js';

const dbReady = (app, reply) => {
  if (!app.dbReady) { reply.code(503).send({ error: 'db_not_ready' }); return false; }
  return true;
};

export default async function worldRoutes(app) {
  // ---- Cups (S54) — public read ----
  app.get('/api/cups', async (req, reply) => {
    if (!dbReady(app, reply)) return;
    const cups = await Cup.find().sort({ createdAt: -1 }).lean();
    return { cups };
  });

  app.get('/api/cups/:id', async (req, reply) => {
    if (!dbReady(app, reply)) return;
    let cup;
    try { cup = await Cup.findById(req.params.id).lean(); }
    catch { return reply.code(400).send({ error: 'invalid_id' }); }
    if (!cup) return reply.code(404).send({ error: 'cup_not_found' });
    // Resolve team names per pairing
    const teamIds = new Set();
    for (const r of cup.rounds) {
      for (const p of r.pairings) {
        if (p.home) teamIds.add(p.home.toString());
        if (p.away) teamIds.add(p.away.toString());
      }
    }
    const teams = await Team.find({ _id: { $in: [...teamIds] } })
      .select('slug name short color emblemUrl').lean();
    const teamMap = Object.fromEntries(teams.map(t => [t._id.toString(), t]));
    return { cup, teams: teamMap };
  });

  // ---- Static catalogs (S47) ----
  // Both are pure data from the shared engine module — public, cacheable.
  app.get('/api/formations', async () => ({ formations: FORMATIONS }));
  app.get('/api/roles', async () => {
    // Group roles by position for UI role pickers.
    const byPosition = {};
    for (const [id, r] of Object.entries(ROLES)) {
      (byPosition[r.position] ||= []).push({
        id, label: r.label, desc: r.desc, defaultDuty: r.defaultDuty,
      });
    }
    return { roles: byPosition };
  });

  // ---- Worlds ----
  app.get('/api/worlds', async (req, reply) => {
    if (!dbReady(app, reply)) return;
    const worlds = await World.find().select('slug name state pace currentSeasonId launchedAt').lean();
    return { worlds };
  });

  app.get('/api/worlds/:slug', async (req, reply) => {
    if (!dbReady(app, reply)) return;
    const world = await World.findOne({ slug: req.params.slug }).lean();
    if (!world) return reply.code(404).send({ error: 'world_not_found' });
    const leagues = await League.find({ worldId: world._id }).lean();
    const seasons = await Season.find({ worldId: world._id, state: { $ne: 'finished' } }).lean();
    return { world, leagues, seasons };
  });

  // ---- League team list with claim status ----
  app.get('/api/worlds/:slug/leagues/:lSlug/teams', async (req, reply) => {
    if (!dbReady(app, reply)) return;
    const world = await World.findOne({ slug: req.params.slug }).select('_id').lean();
    if (!world) return reply.code(404).send({ error: 'world_not_found' });
    const league = await League.findOne({ worldId: world._id, slug: req.params.lSlug }).lean();
    if (!league) return reply.code(404).send({ error: 'league_not_found' });

    const teams = await Team.find({ leagueId: league._id })
      .select('slug name short city color tier managerUserId')
      .lean();
    // Resolve manager usernames in batch
    const managerIds = teams.map(t => t.managerUserId).filter(Boolean);
    const managers = managerIds.length
      ? await User.find({ _id: { $in: managerIds } }).select('username').lean()
      : [];
    const managerMap = Object.fromEntries(managers.map(u => [u._id.toString(), u.username]));
    const enriched = teams.map(t => ({
      ...t,
      managerUsername: t.managerUserId ? managerMap[t.managerUserId.toString()] : null,
      claimed: !!t.managerUserId,
    }));
    return { league, teams: enriched };
  });

  // ---- Team detail ----
  app.get('/api/teams/:teamId', async (req, reply) => {
    if (!dbReady(app, reply)) return;
    let team;
    try { team = await Team.findById(req.params.teamId).lean(); }
    catch { return reply.code(400).send({ error: 'invalid_id' }); }
    if (!team) return reply.code(404).send({ error: 'team_not_found' });
    const roster = await Player.find({ teamId: team._id })
      .select('-state.morale -state.fitness')   // hide live state
      .sort({ num: 1 }).lean();
    let manager = null;
    if (team.managerUserId) {
      manager = await User.findById(team.managerUserId).select('username').lean();
    }
    return { team, roster, manager };
  });

  // ---- Claim ----
  app.post('/api/teams/:teamId/claim', { preHandler: app.authenticate }, async (req, reply) => {
    if (!dbReady(app, reply)) return;
    if (req.user.purpose !== 'session') return reply.code(401).send({ error: 'invalid_token_purpose' });

    const userId = req.user.sub;
    const user = await User.findById(userId);
    if (!user) return reply.code(401).send({ error: 'user_gone' });
    if (user.currentTeamId)
      return reply.code(409).send({ error: 'already_managing', teamId: user.currentTeamId });

    // Atomic claim — only succeeds if managerUserId is currently null.
    let team;
    try {
      team = await Team.findOneAndUpdate(
        { _id: req.params.teamId, managerUserId: null },
        { $set: { managerUserId: user._id } },
        { new: true }
      );
    } catch { return reply.code(400).send({ error: 'invalid_id' }); }
    if (!team) return reply.code(409).send({ error: 'team_already_claimed_or_missing' });

    user.currentTeamId = team._id;
    user.currentWorldId = team.worldId;
    await user.save();
    return { ok: true, team: { id: team._id, slug: team.slug, name: team.name } };
  });

  // ---- Result detail ----
  app.get('/api/results/:fixtureId', async (req, reply) => {
    if (!dbReady(app, reply)) return;
    let fid;
    try { fid = req.params.fixtureId; }
    catch { return reply.code(400).send({ error: 'invalid_id' }); }
    const result = await MatchResult.findOne({ fixtureId: fid }).lean();
    if (!result) return reply.code(404).send({ error: 'result_not_found' });
    const [home, away, fixture] = await Promise.all([
      Team.findById(result.homeTeamId).select('slug name short color').lean(),
      Team.findById(result.awayTeamId).select('slug name short color').lean(),
      Fixture.findById(result.fixtureId).select('round scheduledAt finishedAt').lean(),
    ]);
    return { result, home, away, fixture };
  });

  // ---- Update team tactics (S40 / extended S47) ----
  // Only the current manager (or admin) can edit. Validation is permissive — engine
  // tolerates unknown keys + clamps values internally.
  // Body: { tactics: {...}, lineupOverrides: { slotId: playerId }, playerRoles: { playerId: { role_kind, duty } } }
  // Top-level tactic keys at root level are also accepted for backwards compat.
  app.put('/api/teams/:teamId/tactics', { preHandler: app.authenticate }, async (req, reply) => {
    if (!dbReady(app, reply)) return;
    if (req.user.purpose !== 'session') return reply.code(401).send({ error: 'invalid_token_purpose' });
    const team = await Team.findById(req.params.teamId);
    if (!team) return reply.code(404).send({ error: 'team_not_found' });
    const isManager = team.managerUserId && team.managerUserId.toString() === req.user.sub;
    if (!isManager) {
      const u = await User.findById(req.user.sub).select('isAdmin').lean();
      if (!u?.isAdmin) return reply.code(403).send({ error: 'not_manager' });
    }
    const body = req.body || {};
    if (typeof body !== 'object') return reply.code(400).send({ error: 'invalid_body' });

    // Tactics merge — accept either body.tactics or top-level keys.
    const tacticsBody = (body.tactics && typeof body.tactics === 'object') ? body.tactics : body;
    const allowedKeys = [
      'formation', 'mentality', 'tempo', 'pressHeight', 'pressInt', 'defLine',
      'width', 'passing', 'dribblingFreq', 'crossFreq', 'longShotFreq',
      'cornerRoutine', 'freeKickRoutine', 'timeWasting',
    ];
    const next = { ...team.tactics };
    for (const k of allowedKeys) if (k in tacticsBody) next[k] = String(tacticsBody[k]);
    team.tactics = next;
    team.markModified('tactics');

    // Lineup overrides — { slotId: playerId | null }. Validate that player belongs to team.
    if (body.lineupOverrides && typeof body.lineupOverrides === 'object') {
      const playerIds = new Set(Object.values(body.lineupOverrides).filter(Boolean).map(String));
      if (playerIds.size > 0) {
        const owned = await Player.find({
          _id: { $in: [...playerIds] }, teamId: team._id,
        }).select('_id').lean();
        const ownedSet = new Set(owned.map(p => p._id.toString()));
        const map = {};
        for (const [slotId, pid] of Object.entries(body.lineupOverrides)) {
          if (pid && ownedSet.has(String(pid))) map[slotId] = String(pid);
        }
        team.lineupOverrides = map;
      } else {
        team.lineupOverrides = {};
      }
      team.markModified('lineupOverrides');
    }

    await team.save();

    // Per-player role assignments — write to Player.role_kind + Player.duty.
    if (body.playerRoles && typeof body.playerRoles === 'object') {
      const ops = [];
      for (const [pid, rd] of Object.entries(body.playerRoles)) {
        if (!rd || typeof rd !== 'object') continue;
        const set = {};
        if (typeof rd.role_kind === 'string') set.role_kind = rd.role_kind;
        if (typeof rd.duty === 'string')      set.duty = rd.duty;
        if (Object.keys(set).length === 0) continue;
        ops.push(Player.updateOne({ _id: pid, teamId: team._id }, { $set: set }));
      }
      if (ops.length) await Promise.allSettled(ops);
    }

    return { ok: true, tactics: team.tactics, lineupOverrides: team.lineupOverrides };
  });

  // ---- Release ----
  app.post('/api/teams/release', { preHandler: app.authenticate }, async (req, reply) => {
    if (!dbReady(app, reply)) return;
    if (req.user.purpose !== 'session') return reply.code(401).send({ error: 'invalid_token_purpose' });

    const user = await User.findById(req.user.sub);
    if (!user || !user.currentTeamId) return reply.code(409).send({ error: 'not_managing' });

    await Team.updateOne(
      { _id: user.currentTeamId, managerUserId: user._id },
      { $set: { managerUserId: null } }
    );
    user.currentTeamId = null;
    user.currentWorldId = null;
    await user.save();
    return { ok: true };
  });

  // ---- Dashboard ----
  app.get('/api/dashboard', { preHandler: app.authenticate }, async (req, reply) => {
    if (!dbReady(app, reply)) return;
    if (req.user.purpose !== 'session') return reply.code(401).send({ error: 'invalid_token_purpose' });

    const user = await User.findById(req.user.sub).lean();
    if (!user) return reply.code(401).send({ error: 'user_gone' });

    if (!user.currentTeamId) {
      return { managing: null, suggestions: await suggestionsFor(user) };
    }
    const team = await Team.findById(user.currentTeamId).lean();
    if (!team) return reply.code(409).send({ error: 'managed_team_missing' });

    const league = await League.findById(team.leagueId).lean();
    const season = await Season.findOne({ leagueId: team.leagueId, state: { $ne: 'finished' } }).lean();

    // Upcoming fixtures (next 5)
    const upcoming = await Fixture.find({
      $or: [{ homeTeamId: team._id }, { awayTeamId: team._id }],
      state: { $in: ['scheduled', 'in_progress'] },
    }).sort({ scheduledAt: 1 }).limit(5).lean();
    // Last 5 results
    const recent = await MatchResult.find({
      $or: [{ homeTeamId: team._id }, { awayTeamId: team._id }],
    }).sort({ finishedAt: -1 }).limit(5).lean();

    // Resolve opponent names for fixtures
    const oppIds = new Set();
    for (const f of upcoming) oppIds.add((f.homeTeamId.toString() === team._id.toString() ? f.awayTeamId : f.homeTeamId).toString());
    for (const r of recent)   oppIds.add((r.homeTeamId.toString() === team._id.toString() ? r.awayTeamId : r.homeTeamId).toString());
    const opps = await Team.find({ _id: { $in: [...oppIds] } }).select('slug name short').lean();
    const oppMap = Object.fromEntries(opps.map(t => [t._id.toString(), t]));

    const fixturesView = upcoming.map(f => {
      const isHome = f.homeTeamId.toString() === team._id.toString();
      const oppId = isHome ? f.awayTeamId : f.homeTeamId;
      return {
        id: f._id, round: f.round,
        scheduledAt: f.scheduledAt, state: f.state,
        venue: isHome ? 'home' : 'away',
        opponent: oppMap[oppId.toString()] || null,
      };
    });
    const resultsView = recent.map(r => {
      const isHome = r.homeTeamId.toString() === team._id.toString();
      const oppId = isHome ? r.awayTeamId : r.homeTeamId;
      const myScore = isHome ? r.homeScore : r.awayScore;
      const oppScore = isHome ? r.awayScore : r.homeScore;
      const outcome = myScore > oppScore ? 'W' : myScore < oppScore ? 'L' : 'D';
      return {
        id: r.fixtureId,                 // pass fixtureId so result-detail endpoint resolves
        finishedAt: r.finishedAt,
        venue: isHome ? 'home' : 'away',
        opponent: oppMap[oppId.toString()] || null,
        score: `${myScore}-${oppScore}`, outcome,
      };
    });

    return {
      managing: {
        team: { id: team._id, slug: team.slug, name: team.name, short: team.short, color: team.color, tier: team.tier },
        league: league ? { id: league._id, slug: league.slug, name: league.name } : null,
        season: season ? { id: season._id, seasonNumber: season.seasonNumber, startsAt: season.startsAt, endsAt: season.endsAt } : null,
      },
      upcoming: fixturesView,
      recent: resultsView,
    };
  });
}

// Suggest a league/world to pick from for users without a team yet.
async function suggestionsFor(user) {
  const worlds = await World.find().select('slug name state').lean();
  const out = [];
  for (const w of worlds) {
    const leagues = await League.find({ worldId: w._id }).select('slug name').lean();
    const counts = await Promise.all(leagues.map(l =>
      Team.countDocuments({ leagueId: l._id, managerUserId: null })
        .then(open => ({ ...l, openTeams: open }))
    ));
    out.push({ ...w, leagues: counts });
  }
  return out;
}
