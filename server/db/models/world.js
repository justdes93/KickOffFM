import mongoose from 'mongoose';

// World — isolated game-world instance. MVP launches with one world ('alpha').
// Each world has its own leagues, teams, players, fixtures.
// (Multi-world architecture preserved for later horizontal split if needed.)

const WorldSchema = new mongoose.Schema({
  slug:               { type: String, required: true, unique: true, trim: true },
  name:               { type: String, required: true },
  state:              { type: String, enum: ['pre-launch', 'active', 'archived'], default: 'pre-launch' },

  // Test-mode pacing config
  pace: {
    seasonWeeks:        { type: Number, default: 16 },             // 4-month test season
    matchesPerWeek:     { type: Number, default: 3 },
    realtimeSpeedMult:  { type: Number, default: 2 },              // 2× compressed (45 real-min match)
  },

  currentSeasonId:    { type: mongoose.Schema.Types.ObjectId, ref: 'Season', default: null },
  launchedAt:         { type: Date, default: null },
}, { timestamps: true });

export const World = mongoose.model('World', WorldSchema);
