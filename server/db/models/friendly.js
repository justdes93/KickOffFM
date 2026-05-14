import mongoose from 'mongoose';

// Friendly — on-demand exhibition match. Independent of league/season.
// MVP: 20-minute total duration (10 min/half) — engine receives halfLenSec=600.
// Any team can be challenged, including unmanaged ones (AI plays opponent's tactics).
//
// S55 invitation flow:
//   * Challenger picks an opponent. If opponent has a human manager → state=pending,
//     inviteDeadline = createdAt + 10 min. Manager has that window to accept/decline.
//   * On accept → state=scheduled, scheduledAt = acceptedAt + 10 min (prep window).
//   * On decline → state=declined.
//   * Deadline passes silently → auto-accept, scheduledAt = inviteDeadline (kicks off now).
//   * Opponent unmanaged from the start → state=scheduled, scheduledAt = createdAt + 10 min.

const FriendlySchema = new mongoose.Schema({
  worldId:        { type: mongoose.Schema.Types.ObjectId, ref: 'World', required: true, index: true },

  // Identity
  createdBy:      { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  homeTeamId:     { type: mongoose.Schema.Types.ObjectId, ref: 'Team', required: true, index: true },
  awayTeamId:     { type: mongoose.Schema.Types.ObjectId, ref: 'Team', required: true, index: true },

  // Invitation (S55)
  opponentManagerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null, index: true },
  inviteDeadline:    { type: Date, default: null },
  acceptedAt:        { type: Date, default: null },

  // Timing — scheduledAt is provisional while pending; finalised on accept / auto-accept.
  scheduledAt:    { type: Date, required: true, index: true },
  startedAt:      { type: Date, default: null },
  finishedAt:     { type: Date, default: null },

  // Pace — 2700 sim-sec/half (90 sim min total = full football match).
  halfLenSec:     { type: Number, default: 2700 },
  // Wall-clock compression: how many sim-sec pass per real-sec while playing.
  // S65: lowered 4.5 → 3.0 — users found 4.5× motion too fast to follow.
  // 90 sim min ≈ 30 real min playing + 3 min halftime = 33 real min total.
  simSpeedFactor: { type: Number, default: 3.0 },
  // Real-time halftime break in seconds. Engine pause is internal; this controls
  // the wall-clock-driven reveal/RAF loop so the user actually sees a break.
  halftimeRealSec: { type: Number, default: 180 },

  // Deterministic seed kept on the doc so a client-side engine playback matches
  // the server's authoritative simulation. Set on kickoff.
  rngSeed:        { type: Number, default: null },

  // State machine
  state:          { type: String, enum: ['pending', 'declined', 'scheduled', 'in_progress', 'finished', 'cancelled'], default: 'scheduled', index: true },

  // Final result
  homeScore:      { type: Number, default: 0 },
  awayScore:      { type: Number, default: 0 },

  // Lock
  workerId:       { type: String, default: null },

  // Inline result data so we don't need a separate FriendlyResult collection.
  stats:          { type: mongoose.Schema.Types.Mixed, default: () => ({}) },
  goals:          { type: [mongoose.Schema.Types.Mixed], default: () => [] },
  // S79: per-shot log (engine.shots shape)
  shots:          { type: [mongoose.Schema.Types.Mixed], default: () => [] },
  // S82: per-player position samples — "side-num" → [{x,y}]
  positionsLog:   { type: mongoose.Schema.Types.Mixed, default: () => ({}) },
  // S82b: per-player end-of-match snapshot for post-match player modal
  playersStats:   { type: [mongoose.Schema.Types.Mixed], default: () => [] },

  // S57: per-match tactics override. Each side's manager can save a snapshot
  // here before kickoff; matchRunner uses it instead of team.tactics. Falls
  // back to team default when no override.
  homeTacticsOverride: { type: mongoose.Schema.Types.Mixed, default: null },
  awayTacticsOverride: { type: mongoose.Schema.Types.Mixed, default: null },

  // S60: mid-match commands (tactical changes, substitutions). Server replays
  // these into a fresh engine to keep the authoritative result in sync; each
  // client engine reads the same list to converge deterministically.
  //   { side, simTime, type:'tactics'|'sub', payload, submittedAt }
  liveCommands: { type: [mongoose.Schema.Types.Mixed], default: () => [] },
}, { timestamps: true });

FriendlySchema.index({ scheduledAt: 1, state: 1 });
FriendlySchema.index({ inviteDeadline: 1, state: 1 });

export const Friendly = mongoose.model('Friendly', FriendlySchema);
