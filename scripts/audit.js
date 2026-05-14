#!/usr/bin/env node
// Audit 100 matches and surface anomalies: outliers, weird event patterns,
// distributions that don't match real football. Run: node scripts/audit.js

import { MatchEngine, mulberry32 } from '../engine.js';
import { TEAMS, defaultLineup } from '../data.js';

const N = parseInt(process.argv[2] || '100', 10);

const tactics = {
  formation: '4-3-3', mentality: '0', tempo: 'normal',
  pressHeight: 'mid', pressInt: 'mid', defLine: 'mid',
  width: 'balanced', passing: 'mixed',
  dribblingFreq: 'sometimes', crossFreq: 'sometimes', longShotFreq: 'sometimes',
  cornerRoutine: 'in_swinger', freeKickRoutine: 'auto', timeWasting: 'never',
};

function runMatch(seed, homeIdx, awayIdx) {
  const e = new MatchEngine({
    home: TEAMS[homeIdx], away: TEAMS[awayIdx],
    homeTactics: tactics, awayTactics: tactics,
    homeLineup: defaultLineup(TEAMS[homeIdx], '4-3-3'),
    awayLineup: defaultLineup(TEAMS[awayIdx], '4-3-3'),
    rng: mulberry32(seed),
  });
  while (e.phase !== 'full') e.tick();
  return e;
}

const matches = [];
const evCounts = {};       // engine event-type frequency across all matches
const spectacularKinds = {};   // BIG_CHANCE, WONDER_GOAL, etc.
const goalsByMinute = new Array(95).fill(0);
let totalGoals = 0;

console.log(`Running ${N} matches...`);
const t0 = Date.now();
for (let i = 0; i < N; i++) {
  const homeIdx = i % TEAMS.length;
  const awayIdx = (i + 1) % TEAMS.length;
  const e = runMatch(0xBEEF + i, homeIdx, awayIdx);
  const sH = e.stats.home, sA = e.stats.away;
  const m = {
    seed: 0xBEEF + i,
    home: e.teams.home.meta.short,
    away: e.teams.away.meta.short,
    score: [e.score.home, e.score.away],
    shots: [sH.shots, sA.shots],
    onTarget: [sH.onTarget, sA.onTarget],
    xG: [sH.xg, sA.xg],
    passes: [sH.passes, sA.passes],
    passOK: [sH.passesCompleted, sA.passesCompleted],
    corners: [sH.corners, sA.corners],
    fouls: [sH.fouls, sA.fouls],
    yellows: [sH.yellows || 0, sA.yellows || 0],
    reds: [sH.reds || 0, sA.reds || 0],
    offsides: [sH.offsides || 0, sA.offsides || 0],
    tackles: [sH.tackles || 0, sA.tackles || 0],
    interceptions: [sH.interceptions || 0, sA.interceptions || 0],
    goals: e.goalsList || [],
  };
  matches.push(m);
  for (const ev of (e.events || [])) {
    evCounts[ev.type] = (evCounts[ev.type] || 0) + 1;
    if (ev.kind) spectacularKinds[ev.kind] = (spectacularKinds[ev.kind] || 0) + 1;
  }
  for (const g of m.goals) {
    const min = Math.min(94, Math.floor(g.time / 60));
    goalsByMinute[min]++;
    totalGoals++;
  }
}
const elapsed = (Date.now() - t0) / 1000;
console.log(`Done in ${elapsed.toFixed(1)}s (${(N / elapsed).toFixed(1)} matches/sec)\n`);

// ============================ AGGREGATES ============================
function stats(arr) {
  const sorted = [...arr].sort((a, b) => a - b);
  return {
    n: arr.length,
    min: sorted[0],
    max: sorted[sorted.length - 1],
    mean: arr.reduce((s, v) => s + v, 0) / arr.length,
    median: sorted[Math.floor(sorted.length / 2)],
    p10: sorted[Math.floor(sorted.length * 0.1)],
    p90: sorted[Math.floor(sorted.length * 0.9)],
  };
}

const teamShots = matches.flatMap(m => m.shots);
const teamGoals = matches.flatMap(m => m.score);
const teamOT = matches.flatMap(m => m.onTarget);
const teamFouls = matches.flatMap(m => m.fouls);
const teamCorners = matches.flatMap(m => m.corners);
const teamOffsides = matches.flatMap(m => m.offsides);
const teamCards = matches.flatMap(m => m.yellows);
const teamReds = matches.flatMap(m => m.reds);
const teamTackles = matches.flatMap(m => m.tackles);
const matchTotalGoals = matches.map(m => m.score[0] + m.score[1]);

function fmt(s) {
  return `min ${s.min}  p10 ${s.p10}  median ${s.median}  mean ${s.mean.toFixed(2)}  p90 ${s.p90}  max ${s.max}`;
}

console.log('=== PER-TEAM DISTRIBUTIONS ===');
console.log('shots:    ' + fmt(stats(teamShots)));
console.log('goals:    ' + fmt(stats(teamGoals)));
console.log('OT:       ' + fmt(stats(teamOT)));
console.log('corners:  ' + fmt(stats(teamCorners)));
console.log('fouls:    ' + fmt(stats(teamFouls)));
console.log('offsides: ' + fmt(stats(teamOffsides)));
console.log('yellows:  ' + fmt(stats(teamCards)));
console.log('reds:     ' + fmt(stats(teamReds)));
console.log('tackles:  ' + fmt(stats(teamTackles)));
console.log('match total goals: ' + fmt(stats(matchTotalGoals)));

// ============================ EVENT TYPES ============================
console.log('\n=== ENGINE EVENT-TYPE FREQUENCY (per match) ===');
for (const [k, v] of Object.entries(evCounts).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${k.padEnd(15)} ${(v / N).toFixed(2)}`);
}

console.log('\n=== SPECTACULAR EVENTS (per match) ===');
for (const [k, v] of Object.entries(spectacularKinds).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${k.padEnd(22)} ${(v / N).toFixed(2)}`);
}

// ============================ GOAL TIMING ============================
console.log('\n=== GOAL-TIMING BUCKETS (per match, by 15-min) ===');
const buckets = [0, 0, 0, 0, 0, 0]; // 0-15, 15-30, 30-45, 45-60, 60-75, 75-90
for (let i = 0; i < 95; i++) {
  const b = Math.min(5, Math.floor(i / 15));
  buckets[b] += goalsByMinute[i];
}
const labels = ['0-15', '15-30', '30-45', '45-60', '60-75', '75-90+'];
for (let i = 0; i < buckets.length; i++) {
  const v = buckets[i];
  const pct = (v / Math.max(1, totalGoals) * 100).toFixed(1);
  console.log(`  ${labels[i].padEnd(8)} ${(v / N).toFixed(2)}/match  (${pct}%)`);
}

// ============================ OUTLIERS ============================
console.log('\n=== OUTLIER MATCHES ===');
const sortedByGoals = [...matches].sort((a, b) => (b.score[0] + b.score[1]) - (a.score[0] + a.score[1]));
console.log('\nHighest-scoring 5:');
for (const m of sortedByGoals.slice(0, 5)) {
  console.log(`  ${m.home} ${m.score[0]}–${m.score[1]} ${m.away}  shots ${m.shots.join('/')} xG ${m.xG.map(x => x.toFixed(2)).join('/')}`);
}
console.log('\nLowest (scoreless):');
const scoreless = matches.filter(m => m.score[0] === 0 && m.score[1] === 0);
console.log(`  total ${scoreless.length} matches (${(scoreless.length / N * 100).toFixed(0)}%)`);

const blowouts = matches.filter(m => Math.abs(m.score[0] - m.score[1]) >= 5);
console.log(`\nBlowouts (margin ≥5): ${blowouts.length} matches`);
for (const m of blowouts.slice(0, 5)) {
  console.log(`  ${m.home} ${m.score[0]}–${m.score[1]} ${m.away}`);
}

const noShots = matches.filter(m => m.shots[0] + m.shots[1] < 5);
console.log(`\nVery-low-shot matches (<5 total): ${noShots.length}`);

const tonsOfGoals = matches.filter(m => m.score[0] + m.score[1] >= 8);
console.log(`\nMatches with ≥8 goals total: ${tonsOfGoals.length}`);
for (const m of tonsOfGoals.slice(0, 5)) {
  console.log(`  ${m.home} ${m.score[0]}–${m.score[1]} ${m.away}`);
}

// xG / actual divergence
console.log('\n=== xG VS ACTUAL GOAL GAPS ===');
let xgOverAchieve = 0, xgUnderAchieve = 0, hugeOverAchieve = 0;
for (const m of matches) {
  const xgT = m.xG[0] + m.xG[1];
  const gT = m.score[0] + m.score[1];
  if (gT > xgT * 2 && gT >= 3) hugeOverAchieve++;
  if (gT > xgT + 1.5) xgOverAchieve++;
  if (xgT > gT + 1.5) xgUnderAchieve++;
}
console.log(`  matches where goals >> xG (>+1.5 over): ${xgOverAchieve}`);
console.log(`  matches where xG >> goals (>+1.5 over): ${xgUnderAchieve}`);
console.log(`  matches scoring 2× their xG (≥3 goals): ${hugeOverAchieve}`);

// Big margin from one team
const oneSidedShots = matches.filter(m => m.shots[0] > 0 && m.shots[1] === 0 || m.shots[1] > 0 && m.shots[0] === 0);
console.log(`\n=== ZERO-SHOT TEAMS ===\n  matches where one team didn't take a shot at all: ${oneSidedShots.length}`);

// Card excess
const highCard = matches.filter(m => (m.yellows[0] + m.yellows[1] + m.reds[0] * 3 + m.reds[1] * 3) >= 6);
console.log(`\n=== HIGH-CARD MATCHES (≥6 cards) ===\n  ${highCard.length} matches`);

// Offside spam check
const offsideExtreme = matches.filter(m => m.offsides[0] + m.offsides[1] >= 12);
console.log(`\n=== OFFSIDE-SPAM (≥12 total) ===\n  ${offsideExtreme.length} matches`);

// Save rate
const totalShotsAll = teamShots.reduce((s, v) => s + v, 0);
const totalOTAll = teamOT.reduce((s, v) => s + v, 0);
const totalGoalsAll = teamGoals.reduce((s, v) => s + v, 0);
console.log(`\n=== AGGREGATE CONVERSION ===`);
console.log(`  shots → OT:    ${(totalOTAll / totalShotsAll * 100).toFixed(1)}%`);
console.log(`  OT → goals:    ${(totalGoalsAll / totalOTAll * 100).toFixed(1)}%`);
console.log(`  shots → goals: ${(totalGoalsAll / totalShotsAll * 100).toFixed(1)}%`);
