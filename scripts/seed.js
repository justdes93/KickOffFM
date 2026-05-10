#!/usr/bin/env node
// Seed the database with one world ('alpha'), two leagues (EPL/La Liga), 40 teams,
// 720 players, and a fixture schedule for the upcoming 4-month season.
//
// Usage:
//   npm run seed                 # full reset + populate
//   npm run seed -- --keep-users # don't wipe User collection
//
// Idempotent: running again drops & re-creates everything except users.

import 'node:process';
import mongoose from 'mongoose';
import { connectDb, disconnectDb } from '../server/db/connection.js';
import { World, League, Season, Team, Player, Fixture, MatchResult } from '../server/db/models/index.js';
import { EPL_TEAMS, LALIGA_TEAMS } from '../server/seed/teamCatalog.js';
import { pickName } from '../server/seed/playerNames.js';
import { generateRoundRobin, scheduleRoundDates } from '../server/seed/fixtures.js';
import { genPlayer } from '../data.js';

const args = new Set(process.argv.slice(2));
const keepUsers = args.has('--keep-users');

// 18-slot roster shape — same distribution as existing data.js TEAMS.
// `tierBias` is an offset added to team's overall tier when generating that player's stats.
// idx is just for jersey-number assignment.
const ROSTER_SHAPE = [
  // role, tierBias, jerseyHint
  ['GK', 0,   1],
  ['GK', 3,  12],
  ['CB', 0,   3],
  ['CB', 1,   4],
  ['CB', 3,  13],
  ['FB', 1,   2],
  ['FB', 2,   5],
  ['FB', 3,  22],
  ['DM', 1,   6],
  ['DM', 3,  16],
  ['CM', 0,   8],
  ['CM', 2,  14],
  ['CM', 3,  21],
  ['AM', 0,  10],
  ['W',  0,   7],
  ['W',  1,  11],
  ['ST', 0,   9],
  ['ST', 2,  19],
];

// Deterministic per-team RNG so seeds are reproducible.
function mulberry32(seed) {
  return function () {
    let t = (seed = (seed + 0x6D2B79F5) | 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashSlug(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = (h ^ s.charCodeAt(i)) * 16777619 >>> 0;
  return h;
}

function buildRoster(teamMeta, leagueSlug, worldId, teamId) {
  const rng = mulberry32(hashSlug(teamMeta.slug));
  return ROSTER_SHAPE.map(([role, tierBias], idx) => {
    const playerTier = Math.max(1, Math.min(5, teamMeta.tier + tierBias));
    const name = pickName(rng, leagueSlug);
    const skeleton = genPlayer(ROSTER_SHAPE[idx][2], name, role, playerTier);
    return {
      teamId, worldId,
      num: skeleton.num, name: skeleton.name,
      role: skeleton.role,
      role_kind: null,           // populated by engine on first match (S27 pickRole)
      duty: 'support',
      tier: playerTier,
      attrs: skeleton.attrs,
    };
  });
}

async function main() {
  await connectDb();
  console.log(`[seed] connected — db: ${mongoose.connection.name}`);

  // 1. Clear (preserving User unless --keep-users not set)
  console.log('[seed] clearing existing world data...');
  await Promise.all([
    Fixture.deleteMany({}),
    MatchResult.deleteMany({}),
    Player.deleteMany({}),
    Team.deleteMany({}),
    Season.deleteMany({}),
    League.deleteMany({}),
    World.deleteMany({}),
  ]);
  if (!keepUsers) {
    // Clear team ownership on users so seed leaves them with no current team.
    const { User } = await import('../server/db/models/index.js');
    await User.updateMany({}, { $set: { currentTeamId: null, currentWorldId: null } });
  }

  // 2. World
  const world = await World.create({
    slug: 'alpha',
    name: 'Alpha World — Friend Beta',
    state: 'pre-launch',
    pace: { seasonWeeks: 16, matchesPerWeek: 3, realtimeSpeedMult: 2 },
    launchedAt: null,
  });
  console.log(`[seed] world: ${world.slug}`);

  // 3. Leagues
  const epl = await League.create({
    worldId: world._id, slug: 'epl', name: 'Premier League', country: 'EN', tier: 1, teamCount: 20,
  });
  const laliga = await League.create({
    worldId: world._id, slug: 'laliga', name: 'La Liga', country: 'ES', tier: 1, teamCount: 20,
  });
  console.log(`[seed] leagues: ${epl.slug}, ${laliga.slug}`);

  // 4. Season — start 1 week from now
  const seasonStart = new Date();
  seasonStart.setUTCDate(seasonStart.getUTCDate() + 7);
  seasonStart.setUTCHours(19, 0, 0, 0);
  const seasonEnd = new Date(seasonStart);
  seasonEnd.setUTCDate(seasonEnd.getUTCDate() + 16 * 7);              // 16 weeks

  const eplSeason = await Season.create({
    worldId: world._id, leagueId: epl._id, seasonNumber: 1,
    startsAt: seasonStart, endsAt: seasonEnd, state: 'upcoming',
  });
  const laligaSeason = await Season.create({
    worldId: world._id, leagueId: laliga._id, seasonNumber: 1,
    startsAt: seasonStart, endsAt: seasonEnd, state: 'upcoming',
  });

  // 5. Teams + players per league
  let totalPlayers = 0;
  for (const [leagueId, leagueSlug, teamCatalog] of [
    [epl._id, 'epl', EPL_TEAMS],
    [laliga._id, 'laliga', LALIGA_TEAMS],
  ]) {
    const teamDocs = teamCatalog.map(meta => ({
      worldId: world._id, leagueId,
      slug: meta.slug, name: meta.name, short: meta.short,
      city: meta.city, color: meta.color, tier: meta.tier, founded: meta.founded,
    }));
    const insertedTeams = await Team.insertMany(teamDocs);
    console.log(`[seed] ${leagueSlug}: ${insertedTeams.length} teams`);
    for (const team of insertedTeams) {
      const meta = teamCatalog.find(m => m.slug === team.slug);
      const roster = buildRoster(meta, leagueSlug, world._id, team._id);
      await Player.insertMany(roster);
      totalPlayers += roster.length;
    }
  }
  console.log(`[seed] total players: ${totalPlayers}`);

  // 6. Fixtures per league
  for (const [season, league] of [[eplSeason, epl], [laligaSeason, laliga]]) {
    const teams = await Team.find({ leagueId: league._id }).select('_id').lean();
    const teamIds = teams.map(t => t._id);
    const rounds = generateRoundRobin(teamIds);
    const dates = scheduleRoundDates(rounds.length, seasonStart);
    const fixtureDocs = [];
    rounds.forEach((round, rIdx) => {
      round.forEach(m => {
        fixtureDocs.push({
          worldId: world._id, leagueId: league._id, seasonId: season._id,
          round: rIdx + 1,
          homeTeamId: m.home, awayTeamId: m.away,
          scheduledAt: dates[rIdx],
          state: 'scheduled',
        });
      });
    });
    await Fixture.insertMany(fixtureDocs);
    console.log(`[seed] ${league.slug}: ${rounds.length} rounds, ${fixtureDocs.length} fixtures (first kick: ${dates[0].toISOString()})`);
  }

  await disconnectDb();
  console.log('[seed] done.');
}

main().catch(err => {
  console.error('[seed] failed:', err);
  process.exit(1);
});
