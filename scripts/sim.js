#!/usr/bin/env node
// Headless match simulation runner — runs matches without browser/UI.
//
// Usage:
//   node scripts/sim.js                       # one match, print summary
//   node scripts/sim.js --benchmark 16        # 16 matches, print averaged stats
//   node scripts/sim.js --json                # one match, dump full JSON state
//   node scripts/sim.js --seed 0xBEEF         # deterministic match
//
// This validates that engine.js runs in Node (no browser globals required).
// S33: foundation for backend match runner.

import { MatchEngine, mulberry32 } from '../engine.js';
import { TEAMS, defaultLineup } from '../data.js';

const args = process.argv.slice(2);
const flag = (name, def = null) => {
  const i = args.indexOf(name);
  if (i < 0) return def;
  return args[i + 1] ?? true;
};

const benchmarkN = parseInt(flag('--benchmark', '0'), 10) || 0;
const jsonDump = args.includes('--json');
const seedArg = flag('--seed');
const baseSeed = seedArg != null ? parseInt(seedArg, 16) || parseInt(seedArg, 10) : 0xBEEF;

const tactics = {
  formation: '4-3-3',
  mentality: '0',
  tempo: 'normal',
  pressHeight: 'mid',
  pressInt: 'mid',
  defLine: 'mid',
  width: 'balanced',
  passing: 'mixed',
  dribblingFreq: 'sometimes',
  crossFreq: 'sometimes',
  longShotFreq: 'sometimes',
  cornerRoutine: 'in_swinger',
  freeKickRoutine: 'auto',
  timeWasting: 'never',
};

function runMatch(seed, homeIdx = 0, awayIdx = 1) {
  const e = new MatchEngine({
    home: TEAMS[homeIdx],
    away: TEAMS[awayIdx],
    homeTactics: tactics,
    awayTactics: tactics,
    homeLineup: defaultLineup(TEAMS[homeIdx], '4-3-3'),
    awayLineup: defaultLineup(TEAMS[awayIdx], '4-3-3'),
    rng: mulberry32(seed),
  });
  while (e.phase !== 'full') e.tick();
  return e;
}

function summary(e) {
  const sH = e.stats.home, sA = e.stats.away;
  return {
    home: e.teams.home.meta.short,
    away: e.teams.away.meta.short,
    score: `${e.score.home}-${e.score.away}`,
    shots: { h: sH.shots, a: sA.shots, total: sH.shots + sA.shots },
    onTarget: { h: sH.onTarget, a: sA.onTarget },
    xG: { h: +sH.xg.toFixed(2), a: +sA.xg.toFixed(2) },
    pass: {
      h: `${sH.passesCompleted}/${sH.passes} (${(sH.passesCompleted / Math.max(1, sH.passes) * 100).toFixed(1)}%)`,
      a: `${sA.passesCompleted}/${sA.passes} (${(sA.passesCompleted / Math.max(1, sA.passes) * 100).toFixed(1)}%)`,
    },
    corners: { h: sH.corners, a: sA.corners },
    fouls: { h: sH.fouls, a: sA.fouls },
    yellows: { h: sH.yellows, a: sA.yellows },
    reds: { h: sH.reds, a: sA.reds },
    offsides: { h: sH.offsides, a: sA.offsides },
    tickCount: e.tickCount,
    goalsList: e.goalsList,
  };
}

if (benchmarkN > 0) {
  let T = { shots: 0, goals: 0, OT: 0, xg: 0, passOK: 0, passAtt: 0,
            corners: 0, fouls: 0, yellows: 0, reds: 0, offsides: 0,
            tackles: 0, intercepts: 0, errors: 0, draws: 0, cleanSheets: 0,
            highScoring: 0, scoreless: 0 };
  const t0 = Date.now();
  for (let i = 0; i < benchmarkN; i++) {
    try {
      const e = runMatch(baseSeed + i);
      T.shots += e.stats.home.shots + e.stats.away.shots;
      const g = e.score.home + e.score.away;
      T.goals += g;
      T.OT += e.stats.home.onTarget + e.stats.away.onTarget;
      T.xg += e.stats.home.xg + e.stats.away.xg;
      T.passAtt += e.stats.home.passes + e.stats.away.passes;
      T.passOK += e.stats.home.passesCompleted + e.stats.away.passesCompleted;
      T.corners += e.stats.home.corners + e.stats.away.corners;
      T.fouls += e.stats.home.fouls + e.stats.away.fouls;
      T.yellows += (e.stats.home.yellows || 0) + (e.stats.away.yellows || 0);
      T.reds += (e.stats.home.reds || 0) + (e.stats.away.reds || 0);
      T.offsides += (e.stats.home.offsides || 0) + (e.stats.away.offsides || 0);
      T.tackles += (e.stats.home.tackles || 0) + (e.stats.away.tackles || 0);
      T.intercepts += (e.stats.home.interceptions || 0) + (e.stats.away.interceptions || 0);
      if (e.score.home === e.score.away) T.draws++;
      if (e.score.home === 0 || e.score.away === 0) T.cleanSheets++;
      if (g >= 5) T.highScoring++;
      if (g === 0) T.scoreless++;
    } catch (err) { T.errors++; console.error(`match ${i}: ${err.message}`); }
  }
  const elapsed = (Date.now() - t0) / 1000;
  const N = benchmarkN;
  const otRatio = T.shots ? (T.OT / T.shots * 100) : 0;
  const passAccPct = T.passAtt ? (T.passOK / T.passAtt * 100) : 0;
  console.log(`Benchmark: ${N} matches in ${elapsed.toFixed(1)}s (${(N / elapsed).toFixed(1)} matches/sec)`);
  console.log(`  Per match (both teams):`);
  console.log(`    shots ${(T.shots / N).toFixed(2)}  OT ${(T.OT / N).toFixed(2)} (${otRatio.toFixed(1)}%)  xG ${(T.xg / N).toFixed(2)}  goals ${(T.goals / N).toFixed(2)}`);
  console.log(`    passAcc ${passAccPct.toFixed(1)}%  corners ${(T.corners / N).toFixed(2)}  fouls ${(T.fouls / N).toFixed(2)}  yellow ${(T.yellows / N).toFixed(2)}  red ${(T.reds / N).toFixed(2)}`);
  console.log(`    offsides ${(T.offsides / N).toFixed(2)}  tackles ${(T.tackles / N).toFixed(2)}  intercepts ${(T.intercepts / N).toFixed(2)}`);
  console.log(`  Per team:`);
  console.log(`    shots ${(T.shots / N / 2).toFixed(2)}  OT ${(T.OT / N / 2).toFixed(2)}  xG ${(T.xg / N / 2).toFixed(2)}  goals ${(T.goals / N / 2).toFixed(2)}`);
  console.log(`  Match outcome distribution:`);
  console.log(`    draws ${T.draws} (${(T.draws / N * 100).toFixed(0)}%)  scoreless ${T.scoreless} (${(T.scoreless / N * 100).toFixed(0)}%)  high-scoring (≥5) ${T.highScoring} (${(T.highScoring / N * 100).toFixed(0)}%)  clean-sheets ${T.cleanSheets}`);
  if (T.errors > 0) console.log(`  errors: ${T.errors}`);
} else {
  const e = runMatch(baseSeed);
  if (jsonDump) {
    console.log(JSON.stringify(summary(e), null, 2));
  } else {
    const s = summary(e);
    console.log(`${s.home} vs ${s.away}  →  ${s.score}`);
    console.log(`  shots H${s.shots.h}/${s.onTarget.h} OT, A${s.shots.a}/${s.onTarget.a} OT`);
    console.log(`  xG H${s.xG.h}, A${s.xG.a}`);
    console.log(`  pass H ${s.pass.h}, A ${s.pass.a}`);
    console.log(`  corners H${s.corners.h} A${s.corners.a}, fouls H${s.fouls.h} A${s.fouls.a}`);
    if (s.goalsList?.length) {
      console.log(`  goals:`);
      for (const g of s.goalsList) {
        const min = (g.time / 60).toFixed(0);
        console.log(`    ${min}'  ${g.scorerName} (${g.side})${g.assistName ? ' assist ' + g.assistName : ''}`);
      }
    }
  }
}
