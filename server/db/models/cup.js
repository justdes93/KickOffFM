import mongoose from 'mongoose';

// Cup — single-knockout tournament (S54). Admins create + advance rounds manually.
// Teams paired randomly in round 1; each next round's pairings are derived from
// the previous round's winners by /api/admin/cups/:id/advance.
//
// Fixtures created on a Cup are stored in `Fixture` with `cupId` set (we reuse
// existing scheduler + match runner — no new pipeline needed).

const CupSchema = new mongoose.Schema({
  worldId:        { type: mongoose.Schema.Types.ObjectId, ref: 'World', required: true, index: true },
  slug:           { type: String, required: true, trim: true },
  name:           { type: String, required: true },

  format:         { type: String, enum: ['knockout'], default: 'knockout' },
  teamCount:      { type: Number, default: 8 },                  // 4, 8, 16 supported
  state:          { type: String, enum: ['upcoming', 'active', 'finished'], default: 'upcoming' },

  // Bracket: array of rounds; each round is array of pairings.
  // Each pairing: { home, away, winner, fixtureId, score: { home, away } }
  rounds:         { type: [mongoose.Schema.Types.Mixed], default: () => [] },
  currentRound:   { type: Number, default: 0 },                   // 0 = before round 1
  winnerTeamId:   { type: mongoose.Schema.Types.ObjectId, ref: 'Team', default: null },
}, { timestamps: true });

CupSchema.index({ worldId: 1, slug: 1 }, { unique: true });

export const Cup = mongoose.model('Cup', CupSchema);
