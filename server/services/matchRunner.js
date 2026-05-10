// Match runner — converts Mongo Team + Player docs into the shape engine expects,
// runs MatchEngine to completion, persists MatchResult and updates Fixture state.
//
// For MVP: batch mode (engine runs synchronously to full-time within a single Node task).
// Real-time streaming for live spectators arrives in S39.

import { Team, Player, Fixture, MatchResult } from '../db/models/index.js';
import { MatchEngine, mulberry32 } from '../../engine.js';
import { defaultLineup, pickRole, ROLES } from '../../data.js';

// Build the team-shape engine expects (mirroring data.js TEAMS[i]).
async function loadTeamForEngine(teamId) {
  const team = await Team.findById(teamId).lean();
  if (!team) throw new Error(`team_not_found: ${teamId}`);
  const roster = await Player.find({ teamId: team._id }).sort({ num: 1 }).lean();
  return {
    id: team.slug,
    name: team.name,
    short: team.short,
    color: team.color,
    _dbTeamId: team._id,
    tactics: team.tactics,
    roster: roster.map(p => {
      // Engine constructor expects players with onPitch/benched flags + state subobject.
      const role_kind = p.role_kind || pickRole({ role: p.role, attrs: p.attrs });
      const duty = p.duty || ROLES[role_kind]?.defaultDuty || 'support';
      return {
        num: p.num,
        name: p.name,
        role: p.role,
        pos: p.role,
        role_kind,
        duty,
        attrs: p.attrs,
        state: { fitness: 100, fatigue: 0, morale: 65, cards: 0 },
        onPitch: false,
        benched: true,
        _dbPlayerId: p._id,
      };
    }),
  };
}

// Run one fixture to full-time. Returns the MatchResult-shaped payload.
export async function runFixture(fixture, opts = {}) {
  const { log = console } = opts;
  log.info?.(`[match] running fixture ${fixture._id} round ${fixture.round}`);

  const home = await loadTeamForEngine(fixture.homeTeamId);
  const away = await loadTeamForEngine(fixture.awayTeamId);

  const formationH = home.tactics?.formation || '4-3-3';
  const formationA = away.tactics?.formation || '4-3-3';

  const seed = (fixture._id.toString().slice(-8) | 0) ^ Date.now() & 0xfffffff;
  const e = new MatchEngine({
    home, away,
    homeTactics: home.tactics, awayTactics: away.tactics,
    homeLineup: defaultLineup(home, formationH),
    awayLineup: defaultLineup(away, formationA),
    rng: mulberry32(seed),
  });

  let safety = 0;
  while (e.phase !== 'full' && safety++ < 200000) e.tick();
  if (safety >= 200000) throw new Error('match_runaway');

  return {
    homeScore: e.score.home,
    awayScore: e.score.away,
    stats: e.stats,
    goalsList: e.goalsList || [],
    finalEngine: e,
    seed,
    formationH, formationA,
  };
}

// Atomically kick off a fixture: lock it in_progress, run, persist result, mark finished.
// `lockId` is unique per worker — used to claim the fixture safely under contention.
export async function executeFixture(fixtureId, opts = {}) {
  const { log = console, lockId = `worker-${process.pid}-${Date.now()}` } = opts;

  // Atomic lock: only one worker grabs a given scheduled fixture.
  const fixture = await Fixture.findOneAndUpdate(
    { _id: fixtureId, state: 'scheduled' },
    { $set: { state: 'in_progress', startedAt: new Date(), workerId: lockId } },
    { new: true }
  );
  if (!fixture) {
    log.warn?.(`[match] fixture ${fixtureId} not claimable (already started or missing)`);
    return null;
  }

  try {
    const out = await runFixture(fixture, { log });
    // Persist result
    await MatchResult.create({
      fixtureId: fixture._id,
      worldId: fixture.worldId,
      leagueId: fixture.leagueId,
      seasonId: fixture.seasonId,
      homeTeamId: fixture.homeTeamId, awayTeamId: fixture.awayTeamId,
      homeScore: out.homeScore, awayScore: out.awayScore,
      stats: out.stats,
      goals: out.goalsList,
      tacticsHome: out.finalEngine.teams.home.tactics,
      tacticsAway: out.finalEngine.teams.away.tactics,
      finishedAt: new Date(),
    });
    fixture.state = 'finished';
    fixture.finishedAt = new Date();
    fixture.homeScore = out.homeScore;
    fixture.awayScore = out.awayScore;
    fixture.workerId = null;
    await fixture.save();
    log.info?.(`[match] ${fixture._id} finished — ${out.homeScore}-${out.awayScore}`);
    return { fixtureId: fixture._id, homeScore: out.homeScore, awayScore: out.awayScore };
  } catch (err) {
    log.error?.(`[match] ${fixture._id} failed: ${err.message}`);
    fixture.state = 'scheduled';        // unlock so it can retry
    fixture.startedAt = null;
    fixture.workerId = null;
    await fixture.save();
    throw err;
  }
}
