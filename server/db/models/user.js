import mongoose from 'mongoose';

// User account — one per registered manager.
// Auth via email+password (argon2id). 2FA via Telegram bot.
// Each user controls one team in one world (MVP — cross-world play deferred).

const UserSchema = new mongoose.Schema({
  // `unique: true` on a String creates the index implicitly; do not also call .index()
  // on the same field below or Mongoose warns about duplicates.
  email:                { type: String, required: true, unique: true, lowercase: true, trim: true },
  passwordHash:         { type: String, required: true },
  username:             { type: String, required: true, unique: true, trim: true, minlength: 3, maxlength: 24 },

  // Telegram 2FA — set after onboarding. If null, 2FA not yet linked.
  telegramChatId:       { type: String, default: null, index: true },
  telegramLinkToken:    { type: String, default: null },          // one-shot, expires
  telegramLinkExpires:  { type: Date,   default: null },

  // Login 2FA challenge (rotates per login attempt)
  twoFaCode:            { type: String, default: null },
  twoFaCodeExpires:     { type: Date,   default: null },

  // Current ownership
  currentTeamId:        { type: mongoose.Schema.Types.ObjectId, ref: 'Team',  default: null },
  currentWorldId:       { type: mongoose.Schema.Types.ObjectId, ref: 'World', default: null },

  // Engagement metrics
  lastLoginAt:          { type: Date, default: null },
  matchesAttended:      { type: Number, default: 0 },              // attended live (S39+)

  // Admin flags
  isAdmin:              { type: Boolean, default: false },
  betaAccessGranted:    { type: Boolean, default: false },         // gated by beta-key on register
}, { timestamps: true });

// Indexes for telegramChatId already declared via `index: true` field option.

export const User = mongoose.model('User', UserSchema);
