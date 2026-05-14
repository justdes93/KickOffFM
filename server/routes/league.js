// League routes (S48) — standings + top scorers + top assists.
//
//   GET /api/leagues/:slug/standings
//   GET /api/leagues/:slug/top-scorers
//   GET /api/leagues/:slug/top-assists

import { World, League, Season, Team, Player, MatchResult, Fixture } from '../db/models/index.js';

const dbReady = (app, reply) => {
  if (!app.dbReady) { reply.code(503).send({ error: 'db_not_ready' }); return false; }
  return true;
};

async function resolveLeague(slug) {
  // World 'alpha' is MVP-only; multi-world ready later.
  const world = await World.findOne({ slug: 'alpha' }).select('_id').lean();
  if (!world) return null;
  return League.findOne({ worldId: world._id, slug }).lean();
}

export default async function leagueRoutes(app) {
  // ---- Standings (from MatchResult docs) ----
  app.get('/api/leagues/:slug/standings', async (req, reply) => {
    if (!dbReady(app, reply)) return;
    const league = await resolveLeague(req.params.slug);
    if (!league) return reply.code(404).send({ error: 'league_not_found' });
    const teams = await Team.find({ leagueId: league._id })
      .select('slug name short color emblemUrl tier').lean();
    const teamMap = Object.fromEntries(teams.map(t => [t._id.toString(), t]));
    const init = (id) => ({
      teamId: id, team: teamMap[id], P:0, W:0, D:0, L:0, GF:0, GA:0, GD:0, Pts:0,
    });
    const std = Object.fromEntries(teams.map(t => [t._id.toString(), init(t._id.toString())]));

    const results = await MatchResult.find({ leagueId: league._id }).select('homeTeamId awayTeamId homeScore awayScore').lean();
    for (const r of results) {
      const h = std[r.homeTeamId.toString()] || init(r.homeTeamId.toString());
      const a = std[r.awayTeamId.toString()] || init(r.awayTeamId.toString());
      h.P++; a.P++;
      h.GF += r.homeScore; h.GA += r.awayScore;
      a.GF += r.awayScore; a.GA += r.homeScore;
      if (r.homeScore > r.awayScore) { h.W++; h.Pts += 3; a.L++; }
      else if (r.homeScore < r.awayScore) { a.W++; a.Pts += 3; h.L++; }
      else { h.D++; a.D++; h.Pts++; a.Pts++; }
      std[r.homeTeamId.toString()] = h;
      std[r.awayTeamId.toString()] = a;
    }
    const table = Object.values(std);
    for (const row of table) row.GD = row.GF - row.GA;
    table.sort((x, y) => y.Pts - x.Pts || y.GD - x.GD || y.GF - x.GF || x.team.name.localeCompare(y.team.name));
    table.forEach((row, i) => { row.rank = i + 1; });
    return { league, table };
  });

  // ---- Top scorers ----
  app.get('/api/leagues/:slug/top-scorers', async (req, reply) => {
    if (!dbReady(app, reply)) return;
    const league = await resolveLeague(req.params.slug);
    if (!league) return reply.code(404).send({ error: 'league_not_found' });
    const teamIds = (await Team.find({ leagueId: league._id }).select('_id').lean()).map(t => t._id);
    const players = await Player.find({ teamId: { $in: teamIds }, 'state.seasonGoals': { $gt: 0 } })
      .sort({ 'state.seasonGoals': -1, 'state.seasonAssists': -1 })
      .limit(25)
      .select('name num role teamId state.seasonGoals state.seasonAssists state.seasonApps')
      .lean();
    const teams = await Team.find({ _id: { $in: players.map(p => p.teamId) } }).select('slug name short color').lean();
    const teamMap = Object.fromEntries(teams.map(t => [t._id.toString(), t]));
    return {
      league,
      top: players.map((p, i) => ({
        rank: i + 1, player: p, team: teamMap[p.teamId.toString()] || null,
      })),
    };
  });

  // ---- Upcoming fixtures (next 2 rounds) ----
  app.get('/api/leagues/:slug/upcoming', async (req, reply) => {
    if (!dbReady(app, reply)) return;
    const league = await resolveLeague(req.params.slug);
    if (!league) return reply.code(404).send({ error: 'league_not_found' });
    const fxs = await Fixture.find({
      leagueId: league._id,
      state: 'scheduled',
    }).sort({ round: 1, scheduledAt: 1 }).limit(40).lean();
    if (!fxs.length) return { league, rounds: [] };
    // Group by round, take first 2 round buckets.
    const byRound = {};
    for (const f of fxs) {
      const r = f.round ?? 0;
      (byRound[r] = byRound[r] || []).push(f);
    }
    const roundNums = Object.keys(byRound).map(Number).sort((a, b) => a - b).slice(0, 2);
    const teamIds = new Set();
    for (const r of roundNums) for (const f of byRound[r]) {
      teamIds.add(f.homeTeamId.toString()); teamIds.add(f.awayTeamId.toString());
    }
    const teams = await Team.find({ _id: { $in: [...teamIds] } })
      .select('slug name short color emblemUrl').lean();
    const teamMap = Object.fromEntries(teams.map(t => [t._id.toString(), t]));
    return {
      league,
      rounds: roundNums.map(r => ({
        round: r,
        fixtures: byRound[r].map(f => ({
          id: f._id,
          scheduledAt: f.scheduledAt,
          home: teamMap[f.homeTeamId.toString()] || null,
          away: teamMap[f.awayTeamId.toString()] || null,
        })),
      })),
    };
  });

  // ---- Top assists ----
  app.get('/api/leagues/:slug/top-assists', async (req, reply) => {
    if (!dbReady(app, reply)) return;
    const league = await resolveLeague(req.params.slug);
    if (!league) return reply.code(404).send({ error: 'league_not_found' });
    const teamIds = (await Team.find({ leagueId: league._id }).select('_id').lean()).map(t => t._id);
    const players = await Player.find({ teamId: { $in: teamIds }, 'state.seasonAssists': { $gt: 0 } })
      .sort({ 'state.seasonAssists': -1, 'state.seasonGoals': -1 })
      .limit(25)
      .select('name num role teamId state.seasonAssists state.seasonGoals state.seasonApps')
      .lean();
    const teams = await Team.find({ _id: { $in: players.map(p => p.teamId) } }).select('slug name short color').lean();
    const teamMap = Object.fromEntries(teams.map(t => [t._id.toString(), t]));
    return {
      league,
      top: players.map((p, i) => ({
        rank: i + 1, player: p, team: teamMap[p.teamId.toString()] || null,
      })),
    };
  });
}
