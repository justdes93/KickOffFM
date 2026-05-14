import mongoose from 'mongoose';

// Player — one footballer. Attributes follow S26 schema (24 outfield / 22 GK).
// Stored as Mixed to keep flexibility while engine attribute set evolves.

const PlayerSchema = new mongoose.Schema({
  teamId:       { type: mongoose.Schema.Types.ObjectId, ref: 'Team', required: true, index: true },
  worldId:      { type: mongoose.Schema.Types.ObjectId, ref: 'World', required: true, index: true },

  // Identity
  num:          { type: Number, required: true },                  // shirt
  name:         { type: String, required: true },                  // combined "First Last" — auto from firstName+lastName when set
  firstName:    { type: String, default: '' },                     // S57
  lastName:     { type: String, default: '' },                     // S57
  role:         { type: String, required: true },                  // primary: GK | CB | FB | DM | CM | AM | W | ST
  secondaryRole:{ type: String, default: '' },                     // S57 optional fallback position
  role_kind:    { type: String, default: null },                   // legacy sub-role (engine compat; no longer edited in UI)
  duty:         { type: String, default: 'support' },              // defend | support | attack
  tier:         { type: Number, default: 3 },                      // 1 (elite) .. 5 (squad)

  age:          { type: Number, default: 24 },
  nationality:  { type: String, default: '' },                     // ISO-2 country code
  preferredFoot:{ type: String, enum: ['L', 'R', 'BOTH'], default: 'R' },

  // S57: external profile reference
  transfermarktUrl: { type: String, default: '' },

  // 24 outfield / 22 GK attrs (S26). Stored as nested object — engine reads as `p.attrs.X`.
  attrs:        { type: mongoose.Schema.Types.Mixed, required: true },

  // Across-match state (S31/S32 future). For MVP, in-match state lives on engine instance only.
  state: {
    fitness:    { type: Number, default: 100 },
    morale:     { type: Number, default: 65 },
    formScore:  { type: Number, default: 0 },                      // last-5-match net
    yellow:     { type: Number, default: 0 },
    sentOff:    { type: Boolean, default: false },
    seasonGoals:    { type: Number, default: 0 },
    seasonAssists:  { type: Number, default: 0 },
    seasonApps:     { type: Number, default: 0 },
  },
}, { timestamps: true });

PlayerSchema.index({ teamId: 1, num: 1 }, { unique: true });

export const Player = mongoose.model('Player', PlayerSchema);
