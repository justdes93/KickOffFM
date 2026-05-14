import mongoose from 'mongoose';

// MatchResult — final outcome + replay data after a fixture finishes.
// Replay payload is large; can move to GridFS / object storage later if needed.

const MatchResultSchema = new mongoose.Schema({
  fixtureId:      { type: mongoose.Schema.Types.ObjectId, ref: 'Fixture', required: true, unique: true },
  worldId:        { type: mongoose.Schema.Types.ObjectId, ref: 'World',  required: true, index: true },
  leagueId:       { type: mongoose.Schema.Types.ObjectId, ref: 'League', required: false, index: true },
  seasonId:       { type: mongoose.Schema.Types.ObjectId, ref: 'Season', required: false, index: true },
  cupId:          { type: mongoose.Schema.Types.ObjectId, ref: 'Cup',    required: false, index: true },

  homeTeamId:     { type: mongoose.Schema.Types.ObjectId, ref: 'Team', required: true },
  awayTeamId:     { type: mongoose.Schema.Types.ObjectId, ref: 'Team', required: true },
  homeScore:      { type: Number, required: true },
  awayScore:      { type: Number, required: true },

  // Per-side stats matching engine.stats — flexible to evolve.
  stats:          { type: mongoose.Schema.Types.Mixed, default: () => ({}) },

  // Goal log (engine.goalsList shape)
  goals:          { type: [mongoose.Schema.Types.Mixed], default: () => [] },

  // S79: per-shot log (engine.shots shape — see _logShot in engine.js)
  shots:          { type: [mongoose.Schema.Types.Mixed], default: () => [] },
  // S82: per-player position samples for heat maps. Map of "side-num" → [{x,y}].
  positionsLog:   { type: mongoose.Schema.Types.Mixed, default: () => ({}) },
  // S82b: per-player end-of-match snapshot for post-match player modal
  playersStats:   { type: [mongoose.Schema.Types.Mixed], default: () => [] },

  // Compressed match-event log for replay. Optional, may be lazy-loaded.
  // Schema: array of { tick, type, payload } records.
  events:         { type: [mongoose.Schema.Types.Mixed], default: () => [] },

  // Match-tactics snapshots used (so replays render with right config).
  tacticsHome:    { type: mongoose.Schema.Types.Mixed, default: () => ({}) },
  tacticsAway:    { type: mongoose.Schema.Types.Mixed, default: () => ({}) },

  finishedAt:     { type: Date, default: Date.now },
}, { timestamps: true });

export const MatchResult = mongoose.model('MatchResult', MatchResultSchema);
