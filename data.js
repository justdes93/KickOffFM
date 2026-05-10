// =============== FORMATIONS ===============
// x: 0..1 (own goal -> opp goal). y: 0..1 (left -> right).
// role: GK | CB | FB | DM | CM | AM | W | ST

export const FORMATIONS = {
  '4-3-3': [
    { id: 'GK',  role: 'GK', x: 0.06, y: 0.50 },
    { id: 'LB',  role: 'FB', x: 0.22, y: 0.15 },
    { id: 'LCB', role: 'CB', x: 0.18, y: 0.38 },
    { id: 'RCB', role: 'CB', x: 0.18, y: 0.62 },
    { id: 'RB',  role: 'FB', x: 0.22, y: 0.85 },
    { id: 'LCM', role: 'CM', x: 0.45, y: 0.30 },
    { id: 'CDM', role: 'DM', x: 0.40, y: 0.50 },
    { id: 'RCM', role: 'CM', x: 0.45, y: 0.70 },
    { id: 'LW',  role: 'W',  x: 0.78, y: 0.18 },
    { id: 'ST',  role: 'ST', x: 0.88, y: 0.50 },
    { id: 'RW',  role: 'W',  x: 0.78, y: 0.82 },
  ],
  '4-4-2': [
    { id: 'GK',  role: 'GK', x: 0.06, y: 0.50 },
    { id: 'LB',  role: 'FB', x: 0.22, y: 0.15 },
    { id: 'LCB', role: 'CB', x: 0.18, y: 0.38 },
    { id: 'RCB', role: 'CB', x: 0.18, y: 0.62 },
    { id: 'RB',  role: 'FB', x: 0.22, y: 0.85 },
    { id: 'LM',  role: 'W',  x: 0.50, y: 0.15 },
    { id: 'LCM', role: 'CM', x: 0.45, y: 0.40 },
    { id: 'RCM', role: 'CM', x: 0.45, y: 0.60 },
    { id: 'RM',  role: 'W',  x: 0.50, y: 0.85 },
    { id: 'LST', role: 'ST', x: 0.82, y: 0.40 },
    { id: 'RST', role: 'ST', x: 0.82, y: 0.60 },
  ],
  '4-2-3-1': [
    { id: 'GK',  role: 'GK', x: 0.06, y: 0.50 },
    { id: 'LB',  role: 'FB', x: 0.22, y: 0.15 },
    { id: 'LCB', role: 'CB', x: 0.18, y: 0.38 },
    { id: 'RCB', role: 'CB', x: 0.18, y: 0.62 },
    { id: 'RB',  role: 'FB', x: 0.22, y: 0.85 },
    { id: 'LDM', role: 'DM', x: 0.40, y: 0.40 },
    { id: 'RDM', role: 'DM', x: 0.40, y: 0.60 },
    { id: 'LAM', role: 'AM', x: 0.65, y: 0.20 },
    { id: 'CAM', role: 'AM', x: 0.65, y: 0.50 },
    { id: 'RAM', role: 'AM', x: 0.65, y: 0.80 },
    { id: 'ST',  role: 'ST', x: 0.88, y: 0.50 },
  ],
  '3-5-2': [
    { id: 'GK',  role: 'GK', x: 0.06, y: 0.50 },
    { id: 'LCB', role: 'CB', x: 0.18, y: 0.30 },
    { id: 'CCB', role: 'CB', x: 0.18, y: 0.50 },
    { id: 'RCB', role: 'CB', x: 0.18, y: 0.70 },
    { id: 'LWB', role: 'FB', x: 0.45, y: 0.10 },
    { id: 'LCM', role: 'CM', x: 0.45, y: 0.35 },
    { id: 'CDM', role: 'DM', x: 0.40, y: 0.50 },
    { id: 'RCM', role: 'CM', x: 0.45, y: 0.65 },
    { id: 'RWB', role: 'FB', x: 0.45, y: 0.90 },
    { id: 'LST', role: 'ST', x: 0.82, y: 0.42 },
    { id: 'RST', role: 'ST', x: 0.82, y: 0.58 },
  ],

  // S29 formation library expansion
  '4-4-2 diamond': [
    { id: 'GK',  role: 'GK', x: 0.06, y: 0.50 },
    { id: 'LB',  role: 'FB', x: 0.22, y: 0.15 },
    { id: 'LCB', role: 'CB', x: 0.18, y: 0.38 },
    { id: 'RCB', role: 'CB', x: 0.18, y: 0.62 },
    { id: 'RB',  role: 'FB', x: 0.22, y: 0.85 },
    { id: 'CDM', role: 'DM', x: 0.38, y: 0.50 },
    { id: 'LCM', role: 'CM', x: 0.50, y: 0.30 },
    { id: 'RCM', role: 'CM', x: 0.50, y: 0.70 },
    { id: 'CAM', role: 'AM', x: 0.65, y: 0.50 },
    { id: 'LST', role: 'ST', x: 0.82, y: 0.40 },
    { id: 'RST', role: 'ST', x: 0.82, y: 0.60 },
  ],
  '4-4-1-1': [
    { id: 'GK',  role: 'GK', x: 0.06, y: 0.50 },
    { id: 'LB',  role: 'FB', x: 0.22, y: 0.15 },
    { id: 'LCB', role: 'CB', x: 0.18, y: 0.38 },
    { id: 'RCB', role: 'CB', x: 0.18, y: 0.62 },
    { id: 'RB',  role: 'FB', x: 0.22, y: 0.85 },
    { id: 'LM',  role: 'W',  x: 0.50, y: 0.15 },
    { id: 'LCM', role: 'CM', x: 0.45, y: 0.40 },
    { id: 'RCM', role: 'CM', x: 0.45, y: 0.60 },
    { id: 'RM',  role: 'W',  x: 0.50, y: 0.85 },
    { id: 'CAM', role: 'AM', x: 0.70, y: 0.50 },
    { id: 'ST',  role: 'ST', x: 0.88, y: 0.50 },
  ],
  '4-1-4-1': [
    { id: 'GK',  role: 'GK', x: 0.06, y: 0.50 },
    { id: 'LB',  role: 'FB', x: 0.22, y: 0.15 },
    { id: 'LCB', role: 'CB', x: 0.18, y: 0.38 },
    { id: 'RCB', role: 'CB', x: 0.18, y: 0.62 },
    { id: 'RB',  role: 'FB', x: 0.22, y: 0.85 },
    { id: 'CDM', role: 'DM', x: 0.36, y: 0.50 },
    { id: 'LM',  role: 'W',  x: 0.55, y: 0.16 },
    { id: 'LCM', role: 'CM', x: 0.55, y: 0.40 },
    { id: 'RCM', role: 'CM', x: 0.55, y: 0.60 },
    { id: 'RM',  role: 'W',  x: 0.55, y: 0.84 },
    { id: 'ST',  role: 'ST', x: 0.86, y: 0.50 },
  ],
  '3-4-3': [
    { id: 'GK',  role: 'GK', x: 0.06, y: 0.50 },
    { id: 'LCB', role: 'CB', x: 0.18, y: 0.30 },
    { id: 'CCB', role: 'CB', x: 0.18, y: 0.50 },
    { id: 'RCB', role: 'CB', x: 0.18, y: 0.70 },
    { id: 'LWB', role: 'FB', x: 0.48, y: 0.10 },
    { id: 'LCM', role: 'CM', x: 0.45, y: 0.40 },
    { id: 'RCM', role: 'CM', x: 0.45, y: 0.60 },
    { id: 'RWB', role: 'FB', x: 0.48, y: 0.90 },
    { id: 'LW',  role: 'W',  x: 0.78, y: 0.20 },
    { id: 'ST',  role: 'ST', x: 0.88, y: 0.50 },
    { id: 'RW',  role: 'W',  x: 0.78, y: 0.80 },
  ],
  '5-3-2': [
    { id: 'GK',  role: 'GK', x: 0.06, y: 0.50 },
    { id: 'LWB', role: 'FB', x: 0.25, y: 0.10 },
    { id: 'LCB', role: 'CB', x: 0.18, y: 0.30 },
    { id: 'CCB', role: 'CB', x: 0.16, y: 0.50 },
    { id: 'RCB', role: 'CB', x: 0.18, y: 0.70 },
    { id: 'RWB', role: 'FB', x: 0.25, y: 0.90 },
    { id: 'LCM', role: 'CM', x: 0.50, y: 0.32 },
    { id: 'CDM', role: 'DM', x: 0.42, y: 0.50 },
    { id: 'RCM', role: 'CM', x: 0.50, y: 0.68 },
    { id: 'LST', role: 'ST', x: 0.82, y: 0.42 },
    { id: 'RST', role: 'ST', x: 0.82, y: 0.58 },
  ],
  '5-4-1': [
    { id: 'GK',  role: 'GK', x: 0.06, y: 0.50 },
    { id: 'LWB', role: 'FB', x: 0.22, y: 0.10 },
    { id: 'LCB', role: 'CB', x: 0.16, y: 0.30 },
    { id: 'CCB', role: 'CB', x: 0.14, y: 0.50 },
    { id: 'RCB', role: 'CB', x: 0.16, y: 0.70 },
    { id: 'RWB', role: 'FB', x: 0.22, y: 0.90 },
    { id: 'LM',  role: 'W',  x: 0.48, y: 0.16 },
    { id: 'LCM', role: 'CM', x: 0.45, y: 0.40 },
    { id: 'RCM', role: 'CM', x: 0.45, y: 0.60 },
    { id: 'RM',  role: 'W',  x: 0.48, y: 0.84 },
    { id: 'ST',  role: 'ST', x: 0.84, y: 0.50 },
  ],
  '4-1-2-1-2': [
    { id: 'GK',  role: 'GK', x: 0.06, y: 0.50 },
    { id: 'LB',  role: 'FB', x: 0.22, y: 0.15 },
    { id: 'LCB', role: 'CB', x: 0.18, y: 0.38 },
    { id: 'RCB', role: 'CB', x: 0.18, y: 0.62 },
    { id: 'RB',  role: 'FB', x: 0.22, y: 0.85 },
    { id: 'CDM', role: 'DM', x: 0.34, y: 0.50 },
    { id: 'LCM', role: 'CM', x: 0.50, y: 0.36 },
    { id: 'RCM', role: 'CM', x: 0.50, y: 0.64 },
    { id: 'CAM', role: 'AM', x: 0.66, y: 0.50 },
    { id: 'LST', role: 'ST', x: 0.82, y: 0.42 },
    { id: 'RST', role: 'ST', x: 0.82, y: 0.58 },
  ],
  '4-2-3-1 wide': [
    { id: 'GK',  role: 'GK', x: 0.06, y: 0.50 },
    { id: 'LB',  role: 'FB', x: 0.22, y: 0.13 },
    { id: 'LCB', role: 'CB', x: 0.18, y: 0.38 },
    { id: 'RCB', role: 'CB', x: 0.18, y: 0.62 },
    { id: 'RB',  role: 'FB', x: 0.22, y: 0.87 },
    { id: 'LDM', role: 'DM', x: 0.40, y: 0.40 },
    { id: 'RDM', role: 'DM', x: 0.40, y: 0.60 },
    { id: 'LW',  role: 'W',  x: 0.66, y: 0.16 },
    { id: 'CAM', role: 'AM', x: 0.66, y: 0.50 },
    { id: 'RW',  role: 'W',  x: 0.66, y: 0.84 },
    { id: 'ST',  role: 'ST', x: 0.88, y: 0.50 },
  ],
};

// =============== ATTRIBUTE GENERATION ===============
// S26: 24 outfield + 8 GK-specific attrs (replaces 10-attr legacy model).
// Scale 1-100 (clamped 20-95).
// Outfield categories:
//   Technical (10): dribbling, finishing, first_touch, heading, long_shots,
//                   passing, tackling, crossing, marking, set_pieces
//   Mental (8):     anticipation, composure, concentration, decisions,
//                   off_the_ball, positioning, vision, work_rate
//   Physical (6):   acceleration, agility, jumping_reach, pace, stamina, strength
// GK replaces 10 outfield-tech with 8 GK-tech:
//                   handling, reflexes, aerial_reach, one_on_ones,
//                   kicking, command_of_area, communication, rushing_out
// applyLegacyCompat() derives legacy {pc,sh,pa,dr,df,ph,vi,de,ta,co,gk_reflexes}
// so engine reads keep working until S26 days 3-5 migrate them.

const ROLE_BIAS = {
  GK: {
    handling: 80, reflexes: 85, aerial_reach: 75, one_on_ones: 72,
    kicking: 70, command_of_area: 75, communication: 75, rushing_out: 65,
    anticipation: 75, composure: 75, concentration: 80, decisions: 75,
    off_the_ball: 30, positioning: 78, vision: 60, work_rate: 60,
    acceleration: 40, agility: 65, jumping_reach: 75,
    pace: 35, stamina: 60, strength: 70,
  },
  CB: {
    dribbling: 45, finishing: 35, first_touch: 60, heading: 78,
    long_shots: 30, passing: 60, tackling: 82, crossing: 30,
    marking: 85, set_pieces: 35,
    anticipation: 75, composure: 70, concentration: 80, decisions: 70,
    off_the_ball: 40, positioning: 82, vision: 55, work_rate: 70,
    acceleration: 55, agility: 55, jumping_reach: 80,
    pace: 55, stamina: 75, strength: 80,
  },
  FB: {
    dribbling: 65, finishing: 45, first_touch: 65, heading: 60,
    long_shots: 45, passing: 65, tackling: 70, crossing: 70,
    marking: 70, set_pieces: 50,
    anticipation: 70, composure: 65, concentration: 65, decisions: 65,
    off_the_ball: 60, positioning: 70, vision: 60, work_rate: 75,
    acceleration: 75, agility: 70, jumping_reach: 60,
    pace: 80, stamina: 78, strength: 65,
  },
  DM: {
    dribbling: 60, finishing: 50, first_touch: 65, heading: 65,
    long_shots: 55, passing: 75, tackling: 78, crossing: 40,
    marking: 75, set_pieces: 50,
    anticipation: 75, composure: 70, concentration: 75, decisions: 75,
    off_the_ball: 50, positioning: 80, vision: 70, work_rate: 75,
    acceleration: 60, agility: 60, jumping_reach: 70,
    pace: 60, stamina: 75, strength: 75,
  },
  CM: {
    dribbling: 65, finishing: 60, first_touch: 70, heading: 55,
    long_shots: 60, passing: 78, tackling: 60, crossing: 55,
    marking: 60, set_pieces: 55,
    anticipation: 70, composure: 68, concentration: 70, decisions: 72,
    off_the_ball: 65, positioning: 70, vision: 75, work_rate: 78,
    acceleration: 65, agility: 65, jumping_reach: 60,
    pace: 65, stamina: 78, strength: 65,
  },
  AM: {
    dribbling: 78, finishing: 70, first_touch: 78, heading: 45,
    long_shots: 70, passing: 80, tackling: 40, crossing: 60,
    marking: 40, set_pieces: 65,
    anticipation: 70, composure: 72, concentration: 65, decisions: 75,
    off_the_ball: 75, positioning: 55, vision: 85, work_rate: 60,
    acceleration: 70, agility: 70, jumping_reach: 50,
    pace: 70, stamina: 65, strength: 55,
  },
  W: {
    dribbling: 80, finishing: 65, first_touch: 70, heading: 50,
    long_shots: 60, passing: 65, tackling: 50, crossing: 75,
    marking: 45, set_pieces: 55,
    anticipation: 65, composure: 65, concentration: 55, decisions: 65,
    off_the_ball: 70, positioning: 55, vision: 65, work_rate: 70,
    acceleration: 80, agility: 75, jumping_reach: 55,
    pace: 85, stamina: 70, strength: 55,
  },
  ST: {
    dribbling: 72, finishing: 85, first_touch: 75, heading: 70,
    long_shots: 65, passing: 60, tackling: 30, crossing: 50,
    marking: 25, set_pieces: 60,
    anticipation: 75, composure: 75, concentration: 60, decisions: 70,
    off_the_ball: 78, positioning: 60, vision: 65, work_rate: 65,
    acceleration: 78, agility: 70, jumping_reach: 70,
    pace: 78, stamina: 70, strength: 72,
  },
};

// =============== PLAYER ROLES (S27) ===============
// 22 sub-roles spread across 7 outfield + GK positions.
// Each role:
//   position    — which p.role it's compatible with
//   defaultDuty — defend | support | attack (auto-set if duty not specified)
//   anchorOffset(slot) → { dx, dy } in slot fractional units (0-1 of pitch)
//                  pre-duty offset; engine adds duty-modulated push afterwards
//   attrPriorities — weighted scores for auto-pick (sum-product with attrs)
//   biases — { utilityKind: delta } applied to decision scores at runtime
//   label / desc — UI display
//
// Duty modulates engine behavior:
//   defend:  anchor pulled back, biases × 0.5
//   support: balanced, biases × 1.0
//   attack:  anchor pushed forward, biases × 1.4

export const ROLES = {
  // ------- GK -------
  goalkeeper: {
    position: 'GK', defaultDuty: 'defend',
    anchorOffset: () => ({ dx: 0, dy: 0 }),
    attrPriorities: { reflexes: 3, handling: 2, positioning: 1.5, command_of_area: 1, aerial_reach: 1 },
    biases: {},
    label: 'Goalkeeper', desc: 'Stays on the line, organises defence.',
  },
  sweeper_keeper: {
    position: 'GK', defaultDuty: 'support',
    anchorOffset: () => ({ dx: 0.02, dy: 0 }),
    attrPriorities: { reflexes: 2, rushing_out: 3, kicking: 2, command_of_area: 2, aerial_reach: 1 },
    biases: { rush_out: 0.3, distribute: 0.2 },
    label: 'Sweeper Keeper', desc: 'Comes off the line to clear danger.',
  },

  // ------- CB -------
  central_defender: {
    position: 'CB', defaultDuty: 'defend',
    anchorOffset: () => ({ dx: 0, dy: 0 }),
    attrPriorities: { tackling: 3, marking: 3, positioning: 2, jumping_reach: 1.5, strength: 1.5, decisions: 1 },
    biases: {},
    label: 'Centre Back', desc: 'Conservative defender, holds the line.',
  },
  ball_playing_defender: {
    position: 'CB', defaultDuty: 'defend',
    anchorOffset: () => ({ dx: 0.01, dy: 0 }),
    attrPriorities: { tackling: 2, marking: 2, passing: 2.5, vision: 2, composure: 1.5, decisions: 1.5 },
    biases: { pass_long: 0.2, pass_short: 0.1 },
    label: 'Ball-Playing Defender', desc: 'Starts attacks with progressive passes.',
  },
  no_nonsense_defender: {
    position: 'CB', defaultDuty: 'defend',
    anchorOffset: () => ({ dx: -0.01, dy: 0 }),
    attrPriorities: { tackling: 3, marking: 3, heading: 2, jumping_reach: 2, strength: 2 },
    biases: { clear: 0.4, dribble: -0.3, pass_short: -0.1 },
    label: 'No-Nonsense Defender', desc: 'Hoofs it clear, no dribbling out.',
  },

  // ------- FB -------
  full_back: {
    position: 'FB', defaultDuty: 'support',
    anchorOffset: () => ({ dx: 0, dy: 0 }),
    attrPriorities: { tackling: 2, marking: 2, pace: 2, stamina: 2, crossing: 1.5, positioning: 1.5 },
    biases: {},
    label: 'Full Back', desc: 'Solid two-way fullback.',
  },
  wing_back: {
    position: 'FB', defaultDuty: 'attack',
    anchorOffset: () => ({ dx: 0.05, dy: 0 }),
    attrPriorities: { pace: 3, stamina: 3, crossing: 2, dribbling: 1.5, work_rate: 2 },
    biases: { cross: 0.25, run: 0.2, attack_join: 0.2 },
    label: 'Wing Back', desc: 'Pushes high, delivers crosses.',
  },
  inverted_wing_back: {
    position: 'FB', defaultDuty: 'support',
    anchorOffset: (slot) => ({ dx: 0, dy: slot.y < 0.5 ? 0.06 : -0.06 }),
    attrPriorities: { passing: 2, vision: 2, decisions: 2, first_touch: 1.5, work_rate: 1.5 },
    biases: { pass_short: 0.2, drift_central: 0.3 },
    label: 'Inverted Wing Back', desc: 'Drifts inside to add midfield numbers.',
  },

  // ------- DM -------
  anchor: {
    position: 'DM', defaultDuty: 'defend',
    anchorOffset: () => ({ dx: -0.02, dy: 0 }),
    attrPriorities: { tackling: 2.5, marking: 2, positioning: 3, decisions: 2, concentration: 2 },
    biases: { tackle: 0.2, run: -0.3 },
    label: 'Anchor', desc: 'Stays put, screens the back four.',
  },
  ball_winning_midfielder: {
    position: 'DM', defaultDuty: 'support',
    anchorOffset: () => ({ dx: 0, dy: 0 }),
    attrPriorities: { tackling: 3, work_rate: 2.5, stamina: 2, aggression_proxy: 0, anticipation: 2 },
    biases: { press: 0.3, tackle: 0.2 },
    label: 'Ball-Winning Midfielder', desc: 'Hunts the ball, wins it back.',
  },
  deep_lying_playmaker: {
    position: 'DM', defaultDuty: 'support',
    anchorOffset: () => ({ dx: 0.01, dy: 0 }),
    attrPriorities: { passing: 3, vision: 3, decisions: 2.5, first_touch: 2, composure: 2 },
    biases: { pass_long: 0.3, pass_through: 0.2 },
    label: 'Deep-Lying Playmaker', desc: 'Dictates from deep, sprays passes.',
  },

  // ------- CM -------
  box_to_box: {
    position: 'CM', defaultDuty: 'support',
    anchorOffset: () => ({ dx: 0, dy: 0 }),
    attrPriorities: { stamina: 3, work_rate: 3, passing: 1.5, tackling: 1.5, finishing: 1 },
    biases: { run: 0.2, shoot: 0.1, attack_join: 0.15 },
    label: 'Box-to-Box', desc: 'Covers every blade of grass.',
  },
  mezzala: {
    position: 'CM', defaultDuty: 'attack',
    anchorOffset: (slot) => ({ dx: 0.04, dy: slot.y < 0.5 ? -0.04 : 0.04 }),
    attrPriorities: { passing: 2, dribbling: 2, vision: 2, decisions: 1.5, finishing: 1.5 },
    biases: { run: 0.2, shoot: 0.2, half_space: 0.2 },
    label: 'Mezzala', desc: 'Attacks half-spaces, late runs into the box.',
  },
  advanced_playmaker: {
    position: 'CM', defaultDuty: 'support',
    anchorOffset: () => ({ dx: 0.02, dy: 0 }),
    attrPriorities: { passing: 3, vision: 3, first_touch: 2, decisions: 2, composure: 1.5 },
    biases: { pass_through: 0.3, vision: 0.2 },
    label: 'Advanced Playmaker', desc: 'Creative hub, threads through-balls.',
  },

  // ------- AM -------
  attacking_midfielder: {
    position: 'AM', defaultDuty: 'support',
    anchorOffset: () => ({ dx: 0, dy: 0 }),
    attrPriorities: { passing: 2, vision: 2, dribbling: 1.5, finishing: 1, composure: 1 },
    biases: { pass_through: 0.2 },
    label: 'Attacking Midfielder', desc: 'Linkup creator behind the striker.',
  },
  shadow_striker: {
    position: 'AM', defaultDuty: 'attack',
    anchorOffset: () => ({ dx: 0.06, dy: 0 }),
    attrPriorities: { finishing: 2, off_the_ball: 3, anticipation: 2, composure: 1.5, pace: 1.5 },
    biases: { run: 0.3, shoot: 0.2 },
    label: 'Shadow Striker', desc: 'Late runs into the box, second striker.',
  },
  trequartista: {
    position: 'AM', defaultDuty: 'attack',
    anchorOffset: () => ({ dx: 0.02, dy: 0 }),
    attrPriorities: { dribbling: 2.5, vision: 2, passing: 2, first_touch: 2, flair_proxy: 0 },
    biases: { dribble: 0.25, pass_through: 0.2 },
    label: 'Trequartista', desc: 'Free roam, defies tactical structure.',
  },

  // ------- W -------
  winger: {
    position: 'W', defaultDuty: 'attack',
    anchorOffset: () => ({ dx: 0, dy: 0 }),
    attrPriorities: { pace: 3, dribbling: 2.5, crossing: 2.5, stamina: 1.5, work_rate: 1.5 },
    biases: { cross: 0.3, run: 0.2 },
    label: 'Winger', desc: 'Hugs the touchline, whips crosses in.',
  },
  inside_forward: {
    position: 'W', defaultDuty: 'attack',
    anchorOffset: (slot) => ({ dx: 0.03, dy: slot.y < 0.5 ? 0.05 : -0.05 }),
    attrPriorities: { finishing: 2.5, dribbling: 2, off_the_ball: 2, pace: 2, composure: 1.5 },
    biases: { run: 0.3, shoot: 0.2, cut_inside: 0.3 },
    label: 'Inside Forward', desc: 'Cuts inside on stronger foot to shoot.',
  },
  inverted_winger: {
    position: 'W', defaultDuty: 'support',
    anchorOffset: (slot) => ({ dx: 0, dy: slot.y < 0.5 ? 0.04 : -0.04 }),
    attrPriorities: { passing: 2.5, dribbling: 2, vision: 2, first_touch: 1.5 },
    biases: { pass_short: 0.2, dribble: 0.2 },
    label: 'Inverted Winger', desc: 'Drifts inside to combine in midfield.',
  },

  // ------- ST -------
  advanced_forward: {
    position: 'ST', defaultDuty: 'attack',
    anchorOffset: () => ({ dx: 0, dy: 0 }),
    attrPriorities: { finishing: 3, off_the_ball: 2.5, pace: 2, composure: 2, dribbling: 1.5 },
    biases: { run: 0.25, shoot: 0.2 },
    label: 'Advanced Forward', desc: 'Plays on the shoulder, seeks goals.',
  },
  target_forward: {
    position: 'ST', defaultDuty: 'support',
    anchorOffset: () => ({ dx: -0.02, dy: 0 }),
    attrPriorities: { heading: 3, jumping_reach: 2.5, strength: 2.5, finishing: 1.5, first_touch: 1.5 },
    biases: { hold_up: 0.3, header: 0.25, run: -0.2 },
    label: 'Target Forward', desc: 'Holds up play, wins aerial duels.',
  },
  poacher: {
    position: 'ST', defaultDuty: 'attack',
    anchorOffset: () => ({ dx: 0.02, dy: 0 }),
    attrPriorities: { finishing: 3.5, off_the_ball: 3, anticipation: 2, composure: 2 },
    biases: { run: 0.3, shoot: 0.3, in_box: 0.4 },
    label: 'Poacher', desc: 'Lurks in the box, pounces on chances.',
  },
  pressing_forward: {
    position: 'ST', defaultDuty: 'support',
    anchorOffset: () => ({ dx: 0, dy: 0 }),
    attrPriorities: { work_rate: 3, stamina: 3, finishing: 1.5, tackling: 1.5, anticipation: 2 },
    biases: { press: 0.4, run: 0.1 },
    label: 'Pressing Forward', desc: 'Harasses defenders, first defender from the front.',
  },
};

// Auto-pick role from attrs — chooses highest scoring role for player's position.
export function pickRole(p) {
  const candidates = Object.entries(ROLES).filter(([, r]) => r.position === p.role);
  let best = null, bestScore = -Infinity;
  for (const [id, r] of candidates) {
    let score = 0, denom = 0;
    for (const [k, w] of Object.entries(r.attrPriorities)) {
      const v = p.attrs[k];
      if (v == null) continue;
      score += v * w; denom += w;
    }
    const norm = denom > 0 ? score / denom : 0;
    if (norm > bestScore) { bestScore = norm; best = id; }
  }
  return best || candidates[0]?.[0] || null;
}

// Deterministic small noise from name string so attrs are stable per player
function hashStr(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = (h ^ s.charCodeAt(i)) * 16777619 >>> 0;
  return h;
}
function noise(seed, idx, range = 12) {
  const v = ((seed * (idx + 1) * 2654435761) >>> 0) % 1000 / 1000;
  return Math.round((v - 0.5) * range);
}

export function genPlayer(num, name, role, tier) {
  const bias = ROLE_BIAS[role];
  const seed = hashStr(name);
  // tier scales overall: tier 1 = elite (+8), tier 5 = squad (-12)
  const tierMod = [8, 4, 0, -6, -12][tier - 1] || 0;
  const attrs = {};
  let i = 0;
  for (const [k, v] of Object.entries(bias)) {
    attrs[k] = Math.max(20, Math.min(95, v + tierMod + noise(seed, i++)));
  }
  const p = {
    num, name, role,
    pos: role,                 // initial assignment
    attrs,
    state: { fitness: 100, fatigue: 0, morale: 65, cards: 0 },
    onPitch: false,
    benched: true,
  };
  p.role_kind = pickRole(p);
  p.duty = ROLES[p.role_kind]?.defaultDuty || 'support';
  return p;
}

// Compact roster definitions: [num, name, role, tier]
function makeRoster(rows) {
  return rows.map(([n, name, role, tier]) => genPlayer(n, name, role, tier));
}

// =============== TEAMS ===============
// Fictional names to avoid licensing entanglement.

export const TEAMS = [
  {
    id: 'lions',
    name: 'Black Lions FC',
    short: 'LIO',
    color: '#4f8cff',
    roster: makeRoster([
      [ 1, 'M. Reyna',     'GK', 1],
      [12, 'O. Vasquez',   'GK', 4],
      [ 2, 'P. Lindqvist', 'FB', 2],
      [ 3, 'D. Olusola',   'CB', 1],
      [ 4, 'R. Kovač',     'CB', 2],
      [ 5, 'T. Mensah',    'FB', 3],
      [13, 'E. Halme',     'CB', 4],
      [22, 'A. Brun',      'FB', 4],
      [ 6, 'I. Petrov',    'DM', 2],
      [ 8, 'L. Marchetti', 'CM', 1],
      [10, 'V. Akande',    'AM', 1],
      [14, 'S. Toure',     'CM', 3],
      [16, 'H. Park',      'DM', 4],
      [21, 'F. Almeida',   'CM', 4],
      [ 7, 'J. Saric',     'W',  1],
      [11, 'K. Egwu',      'W',  2],
      [ 9, 'C. Bianchi',   'ST', 1],
      [19, 'B. Andersson', 'ST', 3],
    ]),
  },
  {
    id: 'falcons',
    name: 'Red Falcons',
    short: 'FAL',
    color: '#ff6b6b',
    roster: makeRoster([
      [ 1, 'A. Lehmann',   'GK', 2],
      [12, 'V. Cantor',    'GK', 4],
      [ 2, 'M. Devine',    'FB', 2],
      [ 3, 'P. Sokolov',   'CB', 1],
      [ 4, 'C. Diallo',    'CB', 2],
      [ 5, 'G. Fernandes', 'FB', 3],
      [13, 'L. Heikkinen', 'CB', 4],
      [22, 'S. Ozdemir',   'FB', 4],
      [ 6, 'Y. Karimi',    'DM', 2],
      [ 8, 'T. Voss',      'CM', 2],
      [10, 'D. Romero',    'AM', 1],
      [14, 'B. Schroeder', 'CM', 3],
      [18, 'J. Kerimov',   'DM', 4],
      [20, 'O. Stenberg',  'CM', 4],
      [ 7, 'N. Coulibaly', 'W',  2],
      [11, 'F. Demir',     'W',  2],
      [ 9, 'R. Kovalenko', 'ST', 1],
      [17, 'M. Aoki',      'ST', 3],
    ]),
  },
  {
    id: 'sharks',
    name: 'Blue Sharks United',
    short: 'SHA',
    color: '#37d4c8',
    roster: makeRoster([
      [ 1, 'P. Hartmann',  'GK', 1],
      [12, 'K. Rasmussen', 'GK', 3],
      [ 2, 'L. Sasaki',    'FB', 3],
      [ 3, 'A. Vidal',     'CB', 2],
      [ 4, 'I. Mendoza',   'CB', 2],
      [ 5, 'B. Owusu',     'FB', 2],
      [13, 'D. Solano',    'CB', 4],
      [22, 'M. Yilmaz',    'FB', 4],
      [ 6, 'C. Reinhardt', 'DM', 1],
      [ 8, 'F. Beric',     'CM', 2],
      [10, 'V. Caetano',   'AM', 2],
      [14, 'P. Andersen',  'CM', 3],
      [16, 'H. Tanaka',    'DM', 4],
      [21, 'E. Sandoval',  'CM', 3],
      [ 7, 'O. Lambert',   'W',  1],
      [11, 'N. Babatunde', 'W',  2],
      [ 9, 'R. Kostadinov','ST', 2],
      [19, 'A. Marchand',  'ST', 4],
    ]),
  },
  {
    id: 'storm',
    name: 'Yellow Storm SC',
    short: 'STO',
    color: '#ffcb45',
    roster: makeRoster([
      [ 1, 'T. Wahlström',  'GK', 3],
      [12, 'J. Marquez',    'GK', 4],
      [ 2, 'K. Dimitriou',  'FB', 3],
      [ 3, 'S. Eriksen',    'CB', 3],
      [ 4, 'P. Achebe',     'CB', 3],
      [ 5, 'L. Costa',      'FB', 4],
      [13, 'A. Iqbal',      'CB', 4],
      [22, 'V. Kuznetsov',  'FB', 5],
      [ 6, 'M. Nicolescu',  'DM', 3],
      [ 8, 'D. Forster',    'CM', 3],
      [10, 'R. Aslan',      'AM', 2],
      [14, 'O. Henriksen',  'CM', 4],
      [16, 'B. Khoury',     'DM', 4],
      [20, 'I. Salgado',    'CM', 4],
      [ 7, 'P. Ferreira',   'W',  3],
      [11, 'M. Janssens',   'W',  3],
      [ 9, 'C. Niang',      'ST', 2],
      [17, 'E. Rosenbaum',  'ST', 4],
    ]),
  },
];

// =============== HELPERS ===============

export function defaultLineup(team, formation) {
  // Pick best player per slot by role match + overall.
  const slots = FORMATIONS[formation];
  const used = new Set();
  const lineup = [];
  for (const slot of slots) {
    // Prefer exact role match, fall back to compatible roles
    const compat = compatibleRoles(slot.role);
    const candidates = team.roster
      .filter(p => !used.has(p.num) && compat.includes(p.role))
      .map(p => ({ p, score: roleScore(p, slot.role) }))
      .sort((a, b) => b.score - a.score);
    const pick = candidates[0]?.p || team.roster.find(p => !used.has(p.num));
    used.add(pick.num);
    lineup.push({ slot, player: pick });
  }
  const bench = team.roster.filter(p => !used.has(p.num));
  return { lineup, bench };
}

function compatibleRoles(role) {
  switch (role) {
    case 'GK': return ['GK'];
    case 'CB': return ['CB'];
    case 'FB': return ['FB', 'CB'];
    case 'DM': return ['DM', 'CM'];
    case 'CM': return ['CM', 'DM', 'AM'];
    case 'AM': return ['AM', 'CM', 'W'];
    case 'W':  return ['W', 'AM', 'ST'];
    case 'ST': return ['ST', 'W'];
    default:   return [role];
  }
}

function roleScore(p, slotRole) {
  const ovr = playerOverall(p);
  const exact = p.role === slotRole ? 10 : 0;
  return ovr + exact;
}

export function playerOverall(p) {
  const a = p.attrs;
  if (p.role === 'GK') {
    return Math.round((a.reflexes * 2 + a.handling * 1.5 + a.positioning + a.command_of_area * 0.5) / 5);
  }
  // Weighted by role using new S26 attribute names.
  const weights = {
    CB: { tackling: 3, marking: 2, positioning: 1.5, jumping_reach: 1, strength: 1, decisions: 0.5 },
    FB: { pace: 2, tackling: 1.5, crossing: 1.5, stamina: 1, positioning: 1, decisions: 0.5 },
    DM: { tackling: 2, passing: 2, positioning: 2, vision: 1, decisions: 1 },
    CM: { passing: 2.5, vision: 2, decisions: 1.5, work_rate: 1.5, dribbling: 1 },
    AM: { passing: 2, vision: 2.5, dribbling: 2, finishing: 1, composure: 1 },
    W:  { pace: 2.5, dribbling: 2.5, crossing: 1.5, finishing: 1.5, composure: 1 },
    ST: { finishing: 3, off_the_ball: 2, pace: 1.5, dribbling: 1.5, composure: 1.5 },
  }[p.role] || { passing: 1, dribbling: 1, finishing: 1, tackling: 1, pace: 1 };
  let sum = 0, denom = 0;
  for (const [k, w] of Object.entries(weights)) {
    sum += (a[k] || 50) * w; denom += w;
  }
  return Math.round(sum / denom);
}
