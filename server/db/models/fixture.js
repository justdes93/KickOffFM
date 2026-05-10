import mongoose from 'mongoose';

// Fixture — scheduled match. Created up front for the whole season.
// State machine: scheduled → in_progress → finished (or postponed).
// Each match has a single engine worker, identified by `workerId` while live.

const FixtureSchema = new mongoose.Schema({
  worldId:        { type: mongoose.Schema.Types.ObjectId, ref: 'World',  required: true, index: true },
  leagueId:       { type: mongoose.Schema.Types.ObjectId, ref: 'League', required: true, index: true },
  seasonId:       { type: mongoose.Schema.Types.ObjectId, ref: 'Season', required: true, index: true },

  round:          { type: Number, required: true },                // gameweek
  homeTeamId:     { type: mongoose.Schema.Types.ObjectId, ref: 'Team', required: true, index: true },
  awayTeamId:     { type: mongoose.Schema.Types.ObjectId, ref: 'Team', required: true, index: true },

  scheduledAt:    { type: Date, required: true, index: true },
  state:          { type: String, enum: ['scheduled', 'in_progress', 'finished', 'postponed'], default: 'scheduled', index: true },

  // Set when in_progress / finished
  startedAt:      { type: Date, default: null },
  finishedAt:     { type: Date, default: null },

  // Live state (S38+)
  currentMinute:  { type: Number, default: 0 },
  homeScore:      { type: Number, default: 0 },
  awayScore:      { type: Number, default: 0 },

  homePresent:    { type: Boolean, default: false },               // human-manager attendance
  awayPresent:    { type: Boolean, default: false },

  workerId:       { type: String, default: null },                 // engine worker process / lock token
}, { timestamps: true });

FixtureSchema.index({ scheduledAt: 1, state: 1 });

export const Fixture = mongoose.model('Fixture', FixtureSchema);
