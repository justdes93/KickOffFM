#!/usr/bin/env node
// For each tactical setting, run matches at two extreme values and report
// the delta in key stats. Effect size ≥10% on goals/shots/OT/possession is
// considered "really works"; smaller is "marginal"; near-zero is "cosmetic".
//
// Run: node scripts/tactic_check.js [N]

import { MatchEngine, mulberry32 } from '../engine.js';
import { TEAMS, defaultLineup } from '../data.js';

const N = parseInt(process.argv[2] || '16', 10);

const BASE = {
  formation: '4-3-3', mentality: '0', tempo: 'normal',
  pressHeight: 'mid', pressInt: 'mid', defLine: 'mid',
  width: 'balanced', passing: 'mixed',
  dribblingFreq: 'sometimes', crossFreq: 'sometimes', longShotFreq: 'sometimes',
  cornerRoutine: 'in_swinger', freeKickRoutine: 'auto', timeWasting: 'never',
};

function runOne(seed, homeTactics, awayTactics = BASE) {
  const e = new MatchEngine({
    home: TEAMS[0], away: TEAMS[1],
    homeTactics, awayTactics,
    homeLineup: defaultLineup(TEAMS[0], homeTactics.formation),
    awayLineup: defaultLineup(TEAMS[1], awayTactics.formation),
    rng: mulberry32(seed),
  });
  while (e.phase !== 'full') e.tick();
  return e;
}

function avg(setup, n) {
  let goals = 0, shots = 0, ot = 0, passes = 0, passOK = 0,
      corners = 0, fouls = 0, offsides = 0, tackles = 0, xg = 0,
      possession = 0;
  let goalsAg = 0, shotsAg = 0;
  for (let i = 0; i < n; i++) {
    const e = runOne(0xBEEF + i, setup);
    const sH = e.stats.home, sA = e.stats.away;
    goals += e.score.home;
    goalsAg += e.score.away;
    shots += sH.shots; shotsAg += sA.shots;
    ot += sH.onTarget;
    passes += sH.passes; passOK += sH.passesCompleted;
    corners += sH.corners;
    fouls += sH.fouls;
    offsides += sH.offsides || 0;
    tackles += sH.tackles || 0;
    xg += sH.xg;
    possession += sH.possessionTicks || 0;
  }
  return {
    goalsFor: goals / n,
    goalsAg: goalsAg / n,
    shots: shots / n,
    shotsAg: shotsAg / n,
    ot: ot / n,
    passAcc: passes ? (passOK / passes * 100) : 0,
    corners: corners / n,
    fouls: fouls / n,
    offsides: offsides / n,
    tackles: tackles / n,
    xg: xg / n,
  };
}

function pctDiff(a, b) {
  if (Math.abs(a) < 0.01 && Math.abs(b) < 0.01) return 0;
  return ((b - a) / Math.max(0.01, Math.abs(a)) * 100);
}

function compare(name, lowValue, highValue, key) {
  const setupLow = { ...BASE, [key]: lowValue };
  const setupHigh = { ...BASE, [key]: highValue };
  const lo = avg(setupLow, N);
  const hi = avg(setupHigh, N);
  // Track the largest delta across metrics
  const metrics = ['goalsFor', 'shots', 'ot', 'passAcc', 'corners', 'fouls', 'offsides', 'tackles', 'xg'];
  let maxAbsDiff = 0, biggest = '';
  const deltas = {};
  for (const m of metrics) {
    const d = pctDiff(lo[m], hi[m]);
    deltas[m] = d;
    if (Math.abs(d) > maxAbsDiff) { maxAbsDiff = Math.abs(d); biggest = m; }
  }
  const tag = maxAbsDiff > 25 ? '🟢 strong'
    : maxAbsDiff > 12 ? '🟡 moderate'
    : maxAbsDiff > 5 ? '🟠 weak'
    : '🔴 negligible';
  console.log(`\n${tag}  ${name}  [${lowValue} → ${highValue}]`);
  console.log(`  shots ${lo.shots.toFixed(1)} → ${hi.shots.toFixed(1)} (${deltas.shots.toFixed(0)}%)`
    + `  goals ${lo.goalsFor.toFixed(2)} → ${hi.goalsFor.toFixed(2)} (${deltas.goalsFor.toFixed(0)}%)`
    + `  xG ${lo.xg.toFixed(2)} → ${hi.xg.toFixed(2)} (${deltas.xg.toFixed(0)}%)`);
  console.log(`  corners ${lo.corners.toFixed(1)} → ${hi.corners.toFixed(1)} (${deltas.corners.toFixed(0)}%)`
    + `  offsides ${lo.offsides.toFixed(1)} → ${hi.offsides.toFixed(1)} (${deltas.offsides.toFixed(0)}%)`
    + `  fouls ${lo.fouls.toFixed(1)} → ${hi.fouls.toFixed(1)} (${deltas.fouls.toFixed(0)}%)`);
  console.log(`  biggest swing: ${biggest} (${maxAbsDiff.toFixed(0)}%)`);
}

console.log(`Tactical-effect check — ${N} matches each setup, home varied vs away default`);
console.log(`Base = ${JSON.stringify(BASE)}`);
console.log(`Effect tiers: 🟢 >25%  🟡 >12%  🟠 >5%  🔴 <5%`);

compare('Mentality',     '-2', '2',   'mentality');
compare('Tempo',         'slow', 'fast', 'tempo');
compare('Press height',  'low', 'high', 'pressHeight');
compare('Press intent.', 'low', 'high', 'pressInt');
compare('Def line',      'deep', 'high', 'defLine');
compare('Width',         'narrow', 'wide', 'width');
compare('Passing',       'short', 'direct', 'passing');
compare('DribblingFreq', 'rare', 'often', 'dribblingFreq');
compare('CrossFreq',     'rare', 'often', 'crossFreq');
compare('LongShotFreq',  'rare', 'often', 'longShotFreq');
compare('Corner routine','in_swinger', 'short', 'cornerRoutine');
compare('FK routine',    'auto', 'direct', 'freeKickRoutine');
compare('Time wasting',  'never', 'often', 'timeWasting');
console.log('\nFormation: 4-3-3 vs 4-4-2');
{
  const lo = avg({ ...BASE, formation: '4-3-3' }, N);
  const hi = avg({ ...BASE, formation: '4-4-2' }, N);
  console.log(`  shots ${lo.shots.toFixed(1)} → ${hi.shots.toFixed(1)} (${pctDiff(lo.shots, hi.shots).toFixed(0)}%)`
    + `  goals ${lo.goalsFor.toFixed(2)} → ${hi.goalsFor.toFixed(2)} (${pctDiff(lo.goalsFor, hi.goalsFor).toFixed(0)}%)`);
}
