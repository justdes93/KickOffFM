import mongoose from 'mongoose';

// Team — one club within a league. May or may not have an active human manager.
// AI manages clubs without a manager_user_id.
// Tactic config kept on team (current/persistent) — copied to MatchTactics on each fixture.

const TeamSchema = new mongoose.Schema({
  worldId:    { type: mongoose.Schema.Types.ObjectId, ref: 'World',  required: true, index: true },
  leagueId:   { type: mongoose.Schema.Types.ObjectId, ref: 'League', required: true, index: true },

  // Identity
  slug:       { type: String, required: true, trim: true },        // 'manchester-reds'
  name:       { type: String, required: true },                    // 'Manchester Reds'
  short:      { type: String, required: true, maxlength: 4 },      // 'MNR'
  city:       { type: String, default: '' },
  color:      { type: String, default: '#888888' },                // primary kit
  founded:    { type: Number, default: 1900 },

  // Tier within league — 1 (elite) .. 5 (relegation candidate). Drives roster strength.
  tier:       { type: Number, default: 3 },

  // Live ownership
  managerUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null, index: true },

  // Current persistent tactic — applied as default to every fixture.
  // Override per-fixture goes into MatchTactics. Schema is loose (matches data.js shape).
  tactics:    { type: mongoose.Schema.Types.Mixed, default: () => ({
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
  }) },

  // Default lineup overrides — { slotId: playerId } map, optional.
  lineupOverrides: { type: mongoose.Schema.Types.Mixed, default: () => ({}) },
}, { timestamps: true });

TeamSchema.index({ worldId: 1, slug: 1 }, { unique: true });

export const Team = mongoose.model('Team', TeamSchema);
