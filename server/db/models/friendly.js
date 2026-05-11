import mongoose from 'mongoose';

// Friendly — on-demand exhibition match. Independent of league/season.
// MVP: 20-minute total duration (10 min/half) — engine receives halfLenSec=600.
// Any team can be challenged, including unmanaged ones (AI plays opponent's tactics).
// Created by user; scheduledAt may be "now" for instant kickoff.

const FriendlySchema = new mongoose.Schema({
  worldId:        { type: mongoose.Schema.Types.ObjectId, ref: 'World', required: true, index: true },

  // Identity
  createdBy:      { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  homeTeamId:     { type: mongoose.Schema.Types.ObjectId, ref: 'Team', required: true, index: true },
  awayTeamId:     { type: mongoose.Schema.Types.ObjectId, ref: 'Team', required: true, index: true },

  // Timing
  scheduledAt:    { type: Date, required: true, index: true },
  startedAt:      { type: Date, default: null },
  finishedAt:     { type: Date, default: null },

  // Pace — 600s/half (10m × 2 = 20m). Stored so we can tweak per friendly later.
  halfLenSec:     { type: Number, default: 600 },

  // State machine
  state:          { type: String, enum: ['scheduled', 'in_progress', 'finished', 'cancelled'], default: 'scheduled', index: true },

  // Final result
  homeScore:      { type: Number, default: 0 },
  awayScore:      { type: Number, default: 0 },

  // Lock
  workerId:       { type: String, default: null },

  // Inline result data so we don't need a separate FriendlyResult collection.
  stats:          { type: mongoose.Schema.Types.Mixed, default: () => ({}) },
  goals:          { type: [mongoose.Schema.Types.Mixed], default: () => [] },
}, { timestamps: true });

FriendlySchema.index({ scheduledAt: 1, state: 1 });

export const Friendly = mongoose.model('Friendly', FriendlySchema);
