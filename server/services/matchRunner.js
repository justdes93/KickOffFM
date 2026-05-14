// Match runner — converts Mongo Team + Player docs into the shape engine expects,
// runs MatchEngine to completion, persists MatchResult and updates Fixture state.
//
// For MVP: batch mode (engine runs synchronously to full-time within a single Node task).
// Real-time streaming for live spectators arrives in S39.

import { Team, Player, Fixture, MatchResult, Friendly } from '../db/models/index.js';
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

// Run one fixture-like doc to full-time. Accepts optional halfLenSec for friendly mode.
// Returns the MatchResult-shaped payload.
export async function runFixture(fixture, opts = {}) {
  const { log = console, halfLenSec } = opts;
  log.info?.(`[match] running ${fixture._id} ${halfLenSec ? `(friendly, halfLen=${halfLenSec}s)` : `round ${fixture.round}`}`);

  const home = await loadTeamForEngine(fixture.homeTeamId);
  const away = await loadTeamForEngine(fixture.awayTeamId);

  // S57: friendly pre-match tactics overrides take precedence over team defaults.
  const homeTactics = fixture.homeTacticsOverride || home.tactics;
  const awayTactics = fixture.awayTacticsOverride || away.tactics;
  home.tactics = homeTactics;
  away.tactics = awayTactics;
  const formationH = homeTactics?.formation || '4-3-3';
  const formationA = awayTactics?.formation || '4-3-3';

  // S60: keep the seed stable across re-sims so deterministic client playback
  // continues to match after a new liveCommand is appended.
  const seed = (typeof fixture.rngSeed === 'number' && fixture.rngSeed !== null)
    ? fixture.rngSeed
    : ((fixture._id.toString().slice(-8) | 0) ^ Date.now() & 0xfffffff);
  const e = new MatchEngine({
    home, away,
    homeTactics, awayTactics,
    homeLineup: defaultLineup(home, formationH),
    awayLineup: defaultLineup(away, formationA),
    rng: mulberry32(seed),
    halfLenSec,
  });

  // S60: replay mid-match commands at their simTime. Sorted ascending for
  // deterministic application across re-sims and across clients.
  const commands = [...(fixture.liveCommands || [])].sort((a, b) => (a.simTime ?? 0) - (b.simTime ?? 0));
  let cmdIdx = 0;
  let safety = 0;
  while (e.phase !== 'full' && safety++ < 200000) {
    // Apply any pending command whose submission simTime has been reached.
    while (cmdIdx < commands.length && (commands[cmdIdx].simTime ?? 0) <= e.gameTime) {
      const c = commands[cmdIdx++];
      try {
        if (c.type === 'tactics') {
          e.submitTacticalChange(c.side, c.payload || {});
        } else if (c.type === 'sub') {
          e.substitute(c.side, c.payload?.outNum, c.payload?.inNum);
        }
      } catch (err) {
        log.warn?.(`[match] command replay failed: ${err.message}`);
      }
    }
    e.tick();
  }
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
    // S58: persist intermediate state — keep fixture in_progress so the wall-clock
    // playback can reveal goals over time. MatchResult is finalised by the
    // scheduler when wall-clock duration elapses (or here for friendly fixtures
    // that don't go through the wall-clock path).
    fixture.homeScore = out.homeScore;
    fixture.awayScore = out.awayScore;
    fixture.rngSeed = out.seed;
    fixture.goals = out.goalsList;
    fixture.workerId = null;
    // We DO write the MatchResult upfront so existing dashboards keep working,
    // but mark finishedAt as null until wall-clock finalisation.
    await MatchResult.create({
      fixtureId: fixture._id,
      worldId: fixture.worldId,
      leagueId: fixture.leagueId || null,
      seasonId: fixture.seasonId || null,
      cupId:    fixture.cupId    || null,
      homeTeamId: fixture.homeTeamId, awayTeamId: fixture.awayTeamId,
      homeScore: out.homeScore, awayScore: out.awayScore,
      stats: out.stats,
      goals: out.goalsList,
      tacticsHome: out.finalEngine.teams.home.tactics,
      tacticsAway: out.finalEngine.teams.away.tactics,
      finishedAt: new Date(),
    });
    await fixture.save();
    // S48: bump per-player season stats for league fixtures only (skip cup + friendly).
    if (fixture.leagueId && fixture.seasonId) {
      await bumpSeasonStats(out.finalEngine, fixture);
    }
    log.info?.(`[match] ${fixture._id} simulated — final ${out.homeScore}-${out.awayScore} (revealing over wall-clock)`);
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

// S48: Increment Player.state.seasonGoals / seasonAssists / seasonApps after a
// league fixture. Reads per-player engine state via `_dbPlayerId` we set in
// loadTeamForEngine. Skipped for friendlies (those don't count toward standings).
async function bumpSeasonStats(engine, fixture) {
  const ops = [];
  for (const side of ['home', 'away']) {
    const allPlayers = [...engine.teams[side].onPitch, ...engine.teams[side].bench];
    for (const p of allPlayers) {
      const pid = p._dbPlayerId;
      if (!pid) continue;
      const playedThisMatch = (p.state?.goals ?? 0) > 0 || (p.state?.assists ?? 0) > 0 || engine.teams[side].onPitch.includes(p);
      if (!playedThisMatch) continue;
      const inc = {};
      if (p.state?.goals)   inc['state.seasonGoals']   = p.state.goals;
      if (p.state?.assists) inc['state.seasonAssists'] = p.state.assists;
      if (engine.teams[side].onPitch.includes(p)) inc['state.seasonApps'] = 1;
      if (Object.keys(inc).length) ops.push(Player.updateOne({ _id: pid }, { $inc: inc }));
    }
  }
  if (ops.length) await Promise.allSettled(ops);
}

// S60: Re-simulate an in-progress friendly with the current liveCommands.
// Called after a manager submits a mid-match command. Keeps rngSeed stable so
// the simulation through the time of the command is byte-for-byte identical to
// the prior run; only the post-command trajectory differs. Updates goals[] +
// scores so progressive reveal stays correct.
export async function resimulateFriendly(friendlyId, opts = {}) {
  const { log = console } = opts;
  const fr = await Friendly.findById(friendlyId);
  if (!fr || fr.state !== 'in_progress') return null;
  try {
    const out = await runFixture(fr, { log, halfLenSec: fr.halfLenSec || 2700 });
    fr.homeScore = out.homeScore;
    fr.awayScore = out.awayScore;
    fr.stats = out.stats;
    fr.goals = out.goalsList;
    fr.markModified('goals');
    fr.markModified('stats');
    await fr.save();
    log.info?.(`[match] friendly ${fr._id} re-simulated — ${out.homeScore}-${out.awayScore} (${(fr.liveCommands || []).length} commands)`);
    return { ok: true };
  } catch (err) {
    log.error?.(`[match] re-sim ${fr._id} failed: ${err.message}`);
    return null;
  }
}

// S49+S55: Friendly match runner. Engine runs eagerly (synchronously, <1s), but
// the friendly stays in `in_progress` for the full wall-clock duration so the UI
// can reveal goals progressively. Scheduler's finalize pass flips it to `finished`
// once that wall-clock window elapses.
export async function executeFriendly(friendlyId, opts = {}) {
  const { log = console, lockId = `worker-${process.pid}-${Date.now()}` } = opts;

  const fr = await Friendly.findOneAndUpdate(
    { _id: friendlyId, state: 'scheduled' },
    { $set: { state: 'in_progress', startedAt: new Date(), workerId: lockId } },
    { new: true }
  );
  if (!fr) {
    log.warn?.(`[match] friendly ${friendlyId} not claimable`);
    return null;
  }

  try {
    const out = await runFixture(fr, { log, halfLenSec: fr.halfLenSec || 2700 });
    // Store full engine output but keep state=in_progress for wall-clock reveal.
    fr.homeScore = out.homeScore;
    fr.awayScore = out.awayScore;
    fr.stats = out.stats;
    fr.goals = out.goalsList;
    fr.rngSeed = out.seed;
    fr.workerId = null;
    // S62 safety: Mongoose can miss change-detection on Mixed paths when the
    // array reference is replaced. markModified guarantees both fields write.
    fr.markModified('goals');
    fr.markModified('stats');
    await fr.save();
    log.info?.(`[match] friendly ${fr._id} simulated — final ${out.homeScore}-${out.awayScore} (revealing over wall-clock)`);
    return { friendlyId: fr._id, homeScore: out.homeScore, awayScore: out.awayScore };
  } catch (err) {
    log.error?.(`[match] friendly ${fr._id} failed: ${err.message}`);
    fr.state = 'scheduled';
    fr.startedAt = null;
    fr.workerId = null;
    await fr.save();
    throw err;
  }
}
