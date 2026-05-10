import mongoose from 'mongoose';

// Season — one round-robin cycle within a league. MVP test season ≈ 16 weeks.

const SeasonSchema = new mongoose.Schema({
  worldId:        { type: mongoose.Schema.Types.ObjectId, ref: 'World',  required: true, index: true },
  leagueId:       { type: mongoose.Schema.Types.ObjectId, ref: 'League', required: true, index: true },
  seasonNumber:   { type: Number, default: 1 },
  startsAt:       { type: Date, required: true },
  endsAt:         { type: Date, required: true },
  state:          { type: String, enum: ['upcoming', 'active', 'finished'], default: 'upcoming' },

  // Champion / runners-up after finish
  champions:      { type: mongoose.Schema.Types.ObjectId, ref: 'Team', default: null },
}, { timestamps: true });

SeasonSchema.index({ worldId: 1, leagueId: 1, seasonNumber: 1 }, { unique: true });

export const Season = mongoose.model('Season', SeasonSchema);
