import mongoose from 'mongoose';

// League — top-level competition within a world. MVP: EPL-style + La-Liga-style
// (real-feeling fictional names per S35 plan).

const LeagueSchema = new mongoose.Schema({
  worldId:    { type: mongoose.Schema.Types.ObjectId, ref: 'World', required: true, index: true },
  slug:       { type: String, required: true, trim: true },        // 'epl' | 'laliga'
  name:       { type: String, required: true },                    // 'Premier League' (display)
  country:    { type: String, default: 'EN' },                     // ISO-2 country code
  tier:       { type: Number, default: 1 },                        // 1 = top division
  teamCount:  { type: Number, default: 20 },
}, { timestamps: true });

LeagueSchema.index({ worldId: 1, slug: 1 }, { unique: true });

export const League = mongoose.model('League', LeagueSchema);
