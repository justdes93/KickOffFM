// Kick-Off FM — physical-agent match engine (v2, Sprint 1).
//
// Architecture per spec (4 layers):
//   1. Strategic   — tactics & formation, set once / changed via submitTacticalChange()
//   2. Tactical    — phase detection + per-player target_zone, every 30 ticks (3 game-sec)
//   3. Decision    — utility AI per player, every 4 ticks (0.4 game-sec)
//   4. Physical    — integration of position/velocity for ball + 22 players, every tick
//
// Tick rate: 10 Hz, Δt = 0.1s. Match = 90 game-min × 60 × 10 = 54000 ticks (+ added time).
// Coordinates: pitch = 105×68 m, top-left origin (matches renderer viewBox).
// Goals: x=0 (home defends) and x=105 (away defends), y=30.34..37.66, height z<2.44.

// Propagate this module's full query string (?v=... or ?cb=...) when importing
// data.js so dev cache-busting flows transitively. Without this, engine.js loaded
// with ?cb=X re-imports a stale cached `./data.js` (no query) that may pre-date
// the latest export set (e.g. missing `ROLES` from S27).
const _engQ = new URL(import.meta.url).search;
const _dataMod = await import('./data.js' + _engQ);
const { FORMATIONS, ROLES } = _dataMod;

// Duty axis (S27): pulls anchor X in attacker-frame.
const DUTY_DX = { defend: -0.02, support: 0, attack: 0.02 };

// Returns the role+duty bias for a given decision key. 0 if role/key absent.
// Defend duty halves biases; attack 1.4x; support neutral.
function _roleBias(p, key) {
  if (!p || !p.role_kind) return 0;
  const r = ROLES[p.role_kind];
  if (!r || !r.biases) return 0;
  const v = r.biases[key];
  if (!v) return 0;
  const dutyMul = p.duty === 'attack' ? 1.4 : (p.duty === 'defend' ? 0.5 : 1.0);
  return v * dutyMul;
}

// =========================================================================
// CONSTANTS
// =========================================================================

const DT = 0.1;                // seconds per tick
const TICKS_PER_SEC = 10;
const HALF_LEN_SEC = 45 * 60;  // 2700 game-seconds per half
const HALFTIME_REAL_SEC = 180; // 3 min real-time break
const MAX_SUBS = 5;

const PITCH_W = 105;
const PITCH_H = 68;
const GOAL_Y_TOP = 30.34;
const GOAL_Y_BOT = 37.66;
const GOAL_HEIGHT = 2.44;

const BALL_GRAVITY = 9.81;
const BALL_BOUNCE = 0.45;          // vertical restitution on ground
const BALL_FRICTION_GROUND = 0.55; // per second when rolling
const BALL_FRICTION_AIR = 0.04;    // per second when flying (drag)
const BALL_CONTROL_RADIUS = 1.0;   // m — closest player within is candidate
const BALL_CONTROL_VEL_MAX = 8.0;  // m/s — relative velocity threshold for control

// Outfield-player running speed multiplier. Applies to actMoveToTarget vmax
// and to _computeEta (so first-defender selection stays consistent with real reach).
// Match clock (10 Hz / 54000 ticks) and all attrs are untouched.
const PLAYER_SPEED_SCALE = 0.5;

// =========================================================================
// HELPERS
// =========================================================================

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
function dist2(ax, ay, bx, by) { const dx = ax - bx, dy = ay - by; return dx * dx + dy * dy; }
function dist(ax, ay, bx, by) { return Math.sqrt(dist2(ax, ay, bx, by)); }
function lerp(a, b, t) { return a + (b - a) * t; }
function other(side) { return side === 'home' ? 'away' : 'home'; }

// =========================================================================
// SHOOTING ATTRIBUTE BLENDS (S26)
// Each function returns a 0-100 score equivalent to legacy `attrs.sh`.
// Decision sites call these so the blend depends on the kind of shot.
// =========================================================================

function shootRating(p, distGoal) {
  const a = p.attrs;
  if (distGoal != null && distGoal > 18) {
    // Long-range: long_shots-led blend.
    return 0.5 * (a.long_shots || 60) + 0.3 * _mentalAttr(p, 'decisions') + 0.2 * _mentalAttr(p, 'composure');
  }
  // Inside-box / general: finishing-led.
  return 0.5 * (a.finishing || 60) + 0.3 * _mentalAttr(p, 'composure') + 0.2 * _mentalAttr(p, 'decisions');
}

function penaltyRating(p) {
  const a = p.attrs;
  return 0.6 * (a.set_pieces || 60) + 0.4 * _mentalAttr(p, 'composure');
}

function freeKickRating(p) {
  const a = p.attrs;
  return 0.5 * (a.set_pieces || 60) + 0.3 * (a.first_touch || 60) + 0.2 * _mentalAttr(p, 'composure');
}

function headerRating(p) {
  const a = p.attrs;
  return 0.5 * (a.heading || 60) + 0.3 * (a.jumping_reach || 60) + 0.2 * (a.anticipation || 60);
}

function passRating(p, kind) {
  const a = p.attrs;
  if (kind === 'cross')   return 0.7 * (a.crossing || 60) + 0.2 * (a.first_touch || 60) + 0.1 * (a.vision || 60);
  if (kind === 'through') return 0.5 * (a.vision   || 60) + 0.3 * (a.passing     || 60) + 0.2 * _mentalAttr(p, 'decisions');
  if (kind === 'long')    return 0.5 * (a.passing  || 60) + 0.3 * (a.vision      || 60) + 0.2 * _mentalAttr(p, 'decisions');
  // 'short' / default
  return 0.7 * (a.passing || 60) + 0.2 * (a.first_touch || 60) + 0.1 * _mentalAttr(p, 'decisions');
}

function dribbleRating(p) {
  const a = p.attrs;
  return 0.6 * (a.dribbling || 60) + 0.2 * (a.agility || 60) + 0.2 * _mentalAttr(p, 'composure');
}

function tackleRating(p) {
  const a = p.attrs;
  return 0.5 * (a.tackling || 60) + 0.3 * (a.anticipation || 60) + 0.2 * (a.strength || 60);
}

function speedRating(p) {
  const a = p.attrs;
  return 0.6 * (a.pace || 60) + 0.4 * (a.acceleration || 60);
}

// S32: morale modulates mental attrs. State.morale 0..100 → multiplier 0.85..1.15.
// Goal scorers / assisters get bumps; conceding GK/CB get drops; yellows penalize.
function _mentalAttr(p, key) {
  const v = p.attrs[key] || 60;
  const morale = p.state?.morale ?? 65;
  return v * (0.85 + morale * 0.003);
}

// S32: fitness modulates technical accuracy late game. fitness 100 → 1.0,
// fitness 50 → 0.92, fitness 0 → 0.85. Engine reads this in shoot / pass noise
// formulas so tired players become measurably less precise.
function _fitMul(p) {
  const f = p.state?.fitness ?? 100;
  return 0.85 + f * 0.0015;
}

// Mulberry32 — deterministic seeded RNG
export function mulberry32(seed) {
  return function () {
    let t = (seed = (seed + 0x6D2B79F5) | 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// =========================================================================
// FORMATION → TARGET POSITIONS (in pitch absolute coords)
// =========================================================================
//
// Each role defines target positions per match phase. Phase X is where player wants
// to be (proportional 0..1 of pitch length, 0=own goal, 1=opp goal).
// y is symmetric (same for both sides), x is mirrored for away.

const ROLE_PHASE_TARGETS = {
  GK:  { build: 0.05, progress: 0.08, final: 0.14, def: 0.05, transAtk: 0.06, transDef: 0.05 },
  CB:  { build: 0.20, progress: 0.32, final: 0.45, def: 0.18, transAtk: 0.30, transDef: 0.20 },
  FB:  { build: 0.22, progress: 0.42, final: 0.62, def: 0.20, transAtk: 0.40, transDef: 0.22 },
  DM:  { build: 0.32, progress: 0.45, final: 0.55, def: 0.30, transAtk: 0.40, transDef: 0.30 },
  CM:  { build: 0.40, progress: 0.55, final: 0.70, def: 0.38, transAtk: 0.55, transDef: 0.40 },
  AM:  { build: 0.50, progress: 0.62, final: 0.80, def: 0.42, transAtk: 0.65, transDef: 0.45 },
  W:   { build: 0.45, progress: 0.65, final: 0.85, def: 0.40, transAtk: 0.70, transDef: 0.45 },
  ST:  { build: 0.55, progress: 0.72, final: 0.92, def: 0.45, transAtk: 0.85, transDef: 0.55 },
};

// Sprint 12: attacking slots used in `final` phase. Absolute coordinates (don't
// shift with ball) so anchors stay stable. Slots inside the box: penalty_spot,
// near_post, far_post (3 deep slots). Slots around the box: top_of_box,
// half_space_*, wide_*. With 3 deep + 5 around-box, 4-3-3's three attackers
// + AM naturally distribute without ≥3-in-box congestion.
const SLOTS_HOME = [
  { name: 'far_post',     x: 100, y: 38 },
  { name: 'near_post',    x: 100, y: 30 },
  { name: 'penalty_spot', x: 94,  y: 34 },
  { name: 'top_of_box',   x: 87,  y: 34 },
  { name: 'half_space_l', x: 86,  y: 22 },
  { name: 'half_space_r', x: 86,  y: 46 },
  { name: 'wide_left',    x: 84,  y: 10 },
  { name: 'wide_right',   x: 84,  y: 58 },
];
const SLOTS_AWAY = SLOTS_HOME.map(s => ({ name: s.name, x: 105 - s.x, y: s.y }));

// =========================================================================
// PLAYER & BALL CONSTRUCTION
// =========================================================================

function clonePlayer(p) {
  // Sprint 9: discipline derived from decisions + composure (both 50-95 range).
  // Drives leash radius (8-18m): high-discipline players hold position tighter.
  const discipline = ((p.attrs.decisions || 70) + (p.attrs.composure || 70)) / 2;
  const leashRadius = Math.min(18, Math.max(8, 6 + (100 - discipline) / 3));
  // S64: per-player reaction lag (in ticks @10Hz; 1 tick = 100ms). Anticipation
  // and concentration shorten the lag — sharp players read play earlier.
  // Range 1–4 ticks (100–400ms). Also a stable Y position bias so the defensive
  // line isn't a perfect ruler — gives organic wave look.
  const anticAttr = (p.attrs?.anticipation ?? p.attrs?.decisions ?? 65);
  const reactionLagTicks = Math.max(1, Math.round(4 - (anticAttr - 50) / 18));
  // Hash player num/name for deterministic seedless personal bias (-1.2..+1.2m).
  const seedStr = `${p.num}|${p.name || ''}`;
  let h = 0; for (let i = 0; i < seedStr.length; i++) h = ((h << 5) - h + seedStr.charCodeAt(i)) | 0;
  const posBiasX = ((h & 0xffff) / 65535 - 0.5) * 2.4;
  const posBiasY = (((h >> 16) & 0xffff) / 65535 - 0.5) * 2.4;
  return {
    ...p,
    attrs: { ...p.attrs },
    state: {
      fitness: 100, fatigue: 0, morale: 65, yellow: 0, sentOff: false,
      goals: 0, assists: 0, pressure: 0,
      // S81: per-player on-ball action counters (TTD breakdown). Each counter
      // increments when the action is taken; the *Completed pair increments on
      // success only. Team TTD = sum of all; team error% = (taken - completed) / taken.
      actions: {
        passes: 0, passesCompleted: 0,
        crosses: 0, crossesCompleted: 0,
        throughBalls: 0, throughBallsCompleted: 0,
        dribbles: 0, dribblesCompleted: 0,
        tackles: 0, tacklesAttempted: 0,
        interceptions: 0,
        blocks: 0,
        shotsTaken: 0, shotsOnTarget: 0,
        clears: 0,
        headersWon: 0, headersLost: 0,
      },
    },
    x: 52.5, y: 34, vx: 0, vy: 0, facing: 0,
    targetX: 52.5, targetY: 34,
    anchor: { x: 52.5, y: 34 },
    discipline,
    leashRadius,
    reactionLagTicks,                  // S64
    posBiasX, posBiasY,                // S64 (stable random offset)
    recoveryState: null,
    action: 'IDLE',
    actionTimer: 0,
    hadBallTick: -999,
  };
}

function createBall() {
  return {
    x: 52.5, y: 34, z: 0,
    vx: 0, vy: 0, vz: 0,
    ownerSide: null,
    ownerNum: null,
    lastTouchSide: null,
    lastTouchNum: null,
    inFlight: false,
    // Pending pass: tracks intent so we can mark success/intercept on first new contact.
    pendingPass: null,  // { fromSide, fromNum, targetSide, targetNum, kickTick, type }
    // Pending shot: tracks shot for save/goal logic.
    pendingShot: null,  // { fromSide, fromNum, kickTick, xG }
  };
}

// =========================================================================
// MATCH ENGINE
// =========================================================================

export class MatchEngine {
  constructor({ home, away, homeTactics, awayTactics, homeLineup, awayLineup, rng, isCup = false, halfLenSec }) {
    this.rng = rng || mulberry32(Date.now() & 0xffffffff);
    this.tickCount = 0;
    this.gameTime = 0;            // seconds
    // S64: ring buffer of recent ball positions for per-player reaction lag.
    this.ballHistory = new Array(8).fill(null);       // up to 8 ticks back = 800ms
    this.phase = 'pre';           // pre | first | halftime | second | full | shootout
    // S49: per-instance half length override (default 45 min = 2700s; friendly mode 10 min/half = 600s).
    this.halfLenSec = typeof halfLenSec === 'number' && halfLenSec > 0 ? halfLenSec : HALF_LEN_SEC;
    // Sprint 25a: cup-mode flag — if true and full-time is tied, a penalty
    // shootout fires instead of phase locking to 'full' on a draw.
    this.isCup = isCup;
    this.shootout = null;         // populated by _beginShootout()
    this.halftimeRemaining = HALFTIME_REAL_SEC;
    this.score = { home: 0, away: 0 };
    this.events = [];
    this.subsUsed = { home: 0, away: 0 };
    this.maxSubs = MAX_SUBS;

    this.teams = {
      home: this.makeTeam(home, homeLineup, homeTactics, 'home'),
      away: this.makeTeam(away, awayLineup, awayTactics, 'away'),
    };

    this.ball = createBall();
    this.pendingChanges = [];
    this.pendingRestart = null;   // { type, side, x, y } — set when ball goes out / goal scored
    this.lastPossessionChange = 0;

    // Spectacular-event tracking
    this.lastTouchHistory = [];   // [{ side, num, tick }] for SOLO_RUN detection
    this.lastReceivedPass = null; // { passerSide, passerNum, passerName, receiverNum, receiverName, tick } — for KEY_PASS
    this.lastBigTackleTick = { home: -9999, away: -9999 }; // BIG_TACKLE rate-limit (per side, 60 game-sec cooldown)
    this.lastAerialResolveTick = -100; // Aerial duel cooldown — prevents 4-4-2 box-cluster header spam

    // Sprint 8: team-state shell. Sub-tactical layer recomputed every 5 ticks.
    // Centralises role assignments (first defender, second defender, lane blockers)
    // so individual decideAction calls don't all converge on the ball.
    // Sprint 13: pressTrigger — active for ~25 ticks after a trigger condition;
    // when active, the second defender also presses (2-presser intensity).
    this.teamState = {
      home: { firstDefenderId: null, secondDefenderId: null, lastUpdateTick: -1, defLineX: 52.5, atkLineX: 52.5, pressTrigger: null },
      away: { firstDefenderId: null, secondDefenderId: null, lastUpdateTick: -1, defLineX: 52.5, atkLineX: 52.5, pressTrigger: null },
    };

    // Sprint 10: behavioral metrics — accumulated over the match for debug HUD.
    this.behavioralMetrics = {
      snapshotCount: 0,
      sumPlayersWithin5m: 0,
      sumAnchorDist: 0,
      sumAnchorDistCount: 0,
      maxSimultaneousPressers: 0,
      sumSimultaneousPressers: 0,
    };

    // UI redesign: persistent goal list (events array is FIFO-trimmed, this is not).
    this.goalsList = [];
    // S79: rich per-shot log (one entry per shot taken). Each entry filled in
    // at fire time with shooter+geometry+xG+pressure, then `result` is set
    // when the shot resolves (goal / saved / post / off_target / blocked).
    this.shots = [];
    // S80: per-team running aggregates of ball-recovery X positions. Used to
    // compute `defenseVector` (avg recovery X, normalised to attack dir) and
    // `pressingVector` (% of recoveries in opp half). Mapped to −100..+100.
    this._recoveryX = { home: [], away: [] };
    // S82: position samples for heat maps. Key = `${side}-${playerNum}`.
    // Sampled every 30 ticks (3 game-sec). ~1800 samples/player for full match
    // → ~30 KB per player as plain {x,y} pairs.
    this.positionsLog = {};

    // Sprint 17: unified pause foundation. All non-instant restarts (goal, card,
    // sub, injury, VAR, half-time, corner/FK/penalty in future) flow through
    // this single state machine: setup → (ready) → execute → aftermath.
    // Existing setPiece (corner/FK/penalty) is kept for now and migrates in S20.
    this.pause = {
      active: false,
      type: null,                  // 'goal' | 'throw_in' | 'goal_kick' | 'corner' | 'free_kick' | 'penalty' | 'card' | 'sub' | 'injury' | 'offside' | 'var_check' | 'half_time' | 'cooling'
      phase: null,                 // 'setup' | 'ready' | 'execute' | 'aftermath'
      phaseTimer: 0,
      phaseMax: 0,
      phaseConfig: null,           // ordered [{ name, ticks }] for the active pause
      phaseIdx: 0,
      startTick: 0,
      context: null,               // pause-specific data (handler num, target spots, etc.)
    };
    this.pauseQueue = [];
    // Added time per half: each pause contributes its duration × type-multiplier
    // (goal/injury/VAR all 1.0; throw-in/goal-kick 0.0 since they're "expected").
    this.addedTime = { firstHalf: 0, secondHalf: 0 };

    // Set piece state — orchestrates scripted positioning during corners / penalties / FKs.
    this.setPiece = null;         // { type, side, phase, timer, kickerNum, ... }
    this._setPieceTargets = null; // { [playerNum]: { x, y } }

    this.stats = { home: blankStats(), away: blankStats() };

    // Sprint 22 add-on: pre-match. Teams walk out from the tunnel and form up
    // before kickoff. After ~12 game-sec of choreography, phase advances to
    // 'first' and standard kickoff fires.
    this._beginPrematch();
  }

  makeTeam(team, lineup, tactics, side) {
    const onPitch = lineup.lineup.map(({ slot, player }) => {
      const p = clonePlayer(player);
      p.slot = slot;
      p.side = side;
      return p;
    });
    // Sprint 20 hot-fix: also set p.side for bench players so substitutes don't
    // crash on `this.teams[p.side]` lookup the moment they come on.
    const bench = lineup.bench.map(p => {
      const c = clonePlayer(p);
      c.side = side;
      return c;
    });
    return {
      meta: team,
      side,
      onPitch,
      bench,
      tactics: { ...tactics },
      formation: tactics.formation,
      currentPhase: 'def',  // build | progress | final | def | transAtk | transDef
    };
  }

  // ----------------------------------------------------------------------
  // SETUP / RESTARTS
  // ----------------------------------------------------------------------

  // Sprint 18: kick off the goal celebration choreography. Clears the ball,
  // points the scorer at the nearest corner flag, drags teammates toward the
  // pile-up, and walks the conceding side back to formation slowly.
  // Sprint 25b (VAR): 8% of open-play goals get reviewed. 93% upheld → normal
  // celebration; 7% overturned → score reverted, restart with goal kick to
  // defending team. OG and shootout goals skip review.
  _beginGoalPause(scoredBy, scorer, isOwnGoal) {
    if (!isOwnGoal && this.rng() < 0.08) {
      this.log({ type: 'system', text: '⏸ VAR — гол на перегляді...' });
      const b = this.ball;
      b.x = 52.5; b.y = 34; b.z = 0;
      b.vx = 0; b.vy = 0; b.vz = 0;
      b.ownerSide = null; b.ownerNum = null;
      b.inFlight = false;
      b.pendingShot = null; b.pendingPass = null;
      for (const side of ['home', 'away']) {
        for (const p of this.teams[side].onPitch) {
          if (p.state.sentOff) continue;
          p.action = 'IDLE';
          p.targetX = p.x; p.targetY = p.y;
          p.vx = 0; p.vy = 0;
        }
      }
      this._startPause('var_check', [{ name: 'aftermath', ticks: 60 }], {
        skipDecisions: true,
        onComplete: () => {
          if (this.rng() < 0.93) {
            this.log({ type: 'system', text: '✅ VAR підтверджує гол!' });
            this._beginGoalPauseInner(scoredBy, scorer, isOwnGoal);
          } else {
            // Overturn — undo score, scorer tally, goalsList entry.
            this.score[scoredBy] = Math.max(0, this.score[scoredBy] - 1);
            if (scorer && scorer.state) scorer.state.goals = Math.max(0, (scorer.state.goals || 1) - 1);
            if (this.goalsList.length > 0) this.goalsList.pop();
            this.log({ type: 'system', text: '❌ VAR скасовує — гол не зараховано.' });
            this._beginGoalKick(other(scoredBy));
          }
        },
      });
      return;
    }
    this._beginGoalPauseInner(scoredBy, scorer, isOwnGoal);
  }

  _beginGoalPauseInner(scoredBy, scorer, isOwnGoal) {
    const conceder = other(scoredBy);
    const b = this.ball;
    // Park the ball INSIDE the net so the goal is visually obvious during the
    // celebration. The ball will be moved to centre at the start of the setup
    // phase (just before kickoff). Ownership null + velocity 0 prevents the
    // goal detector from re-firing.
    const ballGoalX = scoredBy === 'home' ? 107 : -2;
    const ballGoalY = clamp(b.y, 31, 37);  // keep at scoring lane, inside posts
    b.x = ballGoalX; b.y = ballGoalY; b.z = 0;
    b.vx = 0; b.vy = 0; b.vz = 0;
    b.ownerSide = null; b.ownerNum = null;
    b.inFlight = false;
    b.pendingShot = null;
    b.pendingPass = null;
    b.lastTouchSide = null; b.lastTouchNum = null;

    // Pick celebration corner — same flank as scorer (or random for OG).
    const cornerY = (scorer && scorer.y < 34) || (!scorer && this.rng() < 0.5) ? 4 : 64;
    const cornerX = scoredBy === 'home' ? 100 : 5;

    // Scorer sprints to the corner. Teammates pile up nearby. GK stays.
    // We override BOTH p.target and p.anchor — executeAction re-derives
    // targetX from anchor every tick, so target alone gets overwritten.
    for (const p of this.teams[scoredBy].onPitch) {
      if (p.state.sentOff) continue;
      if (p.role === 'GK') {
        p.targetX = p.x; p.targetY = p.y;
        p.anchor.x = p.x; p.anchor.y = p.y;
        p.action = 'IDLE';
        continue;
      }
      let tx, ty;
      if (scorer && p.num === scorer.num) {
        tx = cornerX; ty = cornerY;
      } else {
        // Cluster around scorer with small jitter
        tx = cornerX + (this.rng() - 0.5) * 8;
        ty = cornerY + (this.rng() - 0.5) * 6;
      }
      p.targetX = tx; p.targetY = ty;
      p.anchor.x = tx; p.anchor.y = ty;
      p.action = 'MOVE_TO_POSITION';
      p.actionTimer = 0;
    }

    // Conceding team: walk back to own formation slot, head down.
    for (const p of this.teams[conceder].onPitch) {
      if (p.state.sentOff) continue;
      const slot = p.slot;
      const baseX = conceder === 'home' ? slot.x * 105 : (1 - slot.x) * 105;
      const baseY = slot.y * 68;
      p.targetX = baseX; p.targetY = baseY;
      p.anchor.x = baseX; p.anchor.y = baseY;
      p.action = 'MOVE_TO_POSITION';
      p.actionTimer = 0;
    }

    // Goal importance gates the celebration length. Extended for slow-engine
    // visibility — at PLAYER_SPEED_SCALE=0.5 + friendly 3× pacing, ~200 ticks
    // aftermath ≈ 6.7 real-sec of celebration, plenty to see scorer at flag.
    const lateGoal = this.gameTime > 4800; // last ~10 game-min
    const closeGame = Math.abs(this.score.home - this.score.away) <= 1;
    const dramatic = lateGoal && closeGame;
    const celebrationTicks = isOwnGoal ? 80 : (dramatic ? 280 : 200);
    const resetTicks = 200;

    this._startPause('goal', [
      { name: 'aftermath', ticks: celebrationTicks },
      { name: 'setup', ticks: resetTicks },
    ], {
      skipDecisions: true,
      scoredBy, conceder,
      scorerNum: scorer?.num,
      isOwnGoal,
      onPhaseChange: (phase) => {
        if (phase === 'setup') {
          // Now both teams walk back to their formation positions, and the
          // ball is moved to centre (out of the net) ready for kickoff.
          this.ball.x = 52.5; this.ball.y = 34; this.ball.z = 0;
          this._retargetForKickoff(conceder);
        }
      },
      onComplete: () => this.setupKickoff(conceder),
    });
  }

  // Sprint 23: half-time choreography. Players walk off to the tunnel near
  // halfway, brief stand, walk back to formation positions, then second half
  // kicks off (other team takes it). Game clock is paused throughout.
  _beginHalftime() {
    this.phase = 'halftime';
    this.log({ type: 'system', text: `Перерва. ${this.score.home}–${this.score.away}.` });
    // S63: stamina recovery during the break. Real players regain ~15% before
    // 2nd half kickoff; reflects rest + electrolytes.
    for (const side of ['home', 'away']) {
      for (const p of this.teams[side].onPitch) {
        if (p.state.sentOff) continue;
        p.state.fatigue = Math.max(0, p.state.fatigue * 0.85);
        p.state.fitness = Math.max(0, 100 - p.state.fatigue);
      }
      for (const p of this.teams[side].bench) {
        p.state.fatigue = Math.max(0, (p.state.fatigue ?? 0) * 0.5);
        p.state.fitness = Math.max(0, 100 - p.state.fatigue);
      }
    }
    // Send everyone to the touchline near halfway (their respective sides) —
    // mirroring the pre-match tunnel direction.
    for (const side of ['home', 'away']) {
      const team = this.teams[side];
      const tunnelY = side === 'home' ? 67.5 : 0.5;
      team.onPitch.forEach((p, i) => {
        if (p.state.sentOff) return;
        const xOffset = (i - (team.onPitch.length - 1) / 2) * 1.8;
        p.targetX = 52.5 + xOffset;
        p.targetY = tunnelY;
        p.action = 'MOVE_TO_POSITION';
        p.actionTimer = 0;
      });
    }
    this.ball.x = 52.5; this.ball.y = 34; this.ball.z = 0;
    this.ball.vx = 0; this.ball.vy = 0; this.ball.vz = 0;
    this.ball.ownerSide = null; this.ball.ownerNum = null;
    this.ball.inFlight = false;
    this.ball.pendingPass = null;
    this.ball.pendingShot = null;

    this._startPause('half_time', [
      { name: 'aftermath', ticks: 350 },   // walk off — extended for slow-speed engine
      { name: 'setup', ticks: 350 },       // walk back to formation
    ], {
      skipDecisions: true,
      onPhaseChange: (phase) => {
        if (phase === 'setup') {
          // Re-target to formation slots for the walk-back
          for (const side of ['home', 'away']) {
            const team = this.teams[side];
            for (const p of team.onPitch) {
              if (p.state.sentOff) continue;
              const slot = p.slot;
              const baseX = side === 'home' ? slot.x * 105 : (1 - slot.x) * 105;
              const baseY = slot.y * 68;
              p.targetX = baseX; p.targetY = baseY;
              p.action = 'MOVE_TO_POSITION';
            }
          }
        }
      },
      onComplete: () => {
        this.phase = 'second';
        this.applyReadyChanges();
        this.setupKickoff('away');
        this.log({ type: 'kickoff', text: '2-й тайм — початок!' });
      },
    });
  }

  // Sprint 23: full-time choreography. Winning team converges and celebrates;
  // losers slow walk. Brief pause before phase locks to 'full' so the overlay
  // doesn't snap on instantly.
  _beginFulltime() {
    this.log({ type: 'system', text: `Кінець матчу. ${this.score.home}–${this.score.away}.` });
    // Sprint 25a: cup tiebreaker → penalty shootout instead of celebration.
    if (this.isCup && this.score.home === this.score.away) {
      this._beginShootout();
      return;
    }
    let winner = null;
    if (this.score.home > this.score.away) winner = 'home';
    else if (this.score.away > this.score.home) winner = 'away';
    if (winner) {
      const winners = this.teams[winner].onPitch;
      // Cluster winners around centre circle for celebration.
      winners.forEach((p, i) => {
        if (p.state.sentOff) return;
        const ang = (i / winners.length) * Math.PI * 2;
        p.targetX = 52.5 + Math.cos(ang) * 6;
        p.targetY = 34 + Math.sin(ang) * 6;
        p.action = 'MOVE_TO_POSITION';
      });
      // Losers drift toward own goal area, heads down.
      const loser = other(winner);
      const lossers = this.teams[loser].onPitch;
      const ownGoalX = loser === 'home' ? 8 : 97;
      lossers.forEach((p, i) => {
        if (p.state.sentOff) return;
        p.targetX = ownGoalX + (i - 5) * 2;
        p.targetY = 34 + (this.rng() - 0.5) * 16;
        p.action = 'MOVE_TO_POSITION';
      });
    }
    // Ball stops where it was (or centre) — no more play.
    this.ball.vx = 0; this.ball.vy = 0; this.ball.vz = 0;
    this.ball.ownerSide = null; this.ball.ownerNum = null;
    this.ball.inFlight = false;

    // Use halftime-style loop: pause + physics, no game clock advance.
    this.phase = 'halftime';   // reuses 'halftime' physics path
    this._startPause('full_time', [
      { name: 'aftermath', ticks: 80 },
    ], {
      skipDecisions: true,
      onComplete: () => {
        this.phase = 'full';
      },
    });
  }

  // Sprint 22 add-on (revised): pre-match walkout from a single tunnel.
  // Phase 1 (walkout): both teams emerge stacked at the south sideline near
  //   halfway and walk in two parallel rows toward halfway line-up spots.
  // Phase 2 (lineup): teams stand briefly facing each other at halfway —
  //   home on the left of halfway, away on the right.
  // Phase 3 (positions): players disperse to their kickoff positions on own
  //   halves (compressed formation, same as setupKickoff layout).
  // onComplete: phase='first' + setupKickoff snaps positions and grants ball.
  _beginPrematch() {
    // Single tunnel at (52.5, 67.5) — sideline at halfway. Both teams stacked
    // here, away offset slightly so they don't overlap.
    for (const side of ['home', 'away']) {
      const team = this.teams[side];
      team.onPitch.forEach((p, i) => {
        const queueOffset = (i - (team.onPitch.length - 1) / 2) * 1.4;
        // Home queues just left of centre, away just right — both at south sideline.
        p.x = 52.5 + queueOffset + (side === 'home' ? -8 : 8);
        p.y = 68.5;                       // off the pitch (sideline)
        p.vx = 0; p.vy = 0;
        p.facing = -Math.PI / 2;          // facing onto the pitch
        // Phase-1 target: parallel-row lineup at halfway, two columns.
        // Home column at x=50, away column at x=55, both spreading in y.
        const lineupX = side === 'home' ? 50 : 55;
        const lineupY = 22 + i * 2.2;     // 11 players → y range 22..44
        p.targetX = lineupX;
        p.targetY = lineupY;
        p.action = 'MOVE_TO_POSITION';
        p.actionTimer = 0;
      });
    }
    // Ball waits at centre, owned by no one yet.
    this.ball.x = 52.5; this.ball.y = 34; this.ball.z = 0;
    this.ball.vx = 0; this.ball.vy = 0; this.ball.vz = 0;
    this.ball.ownerSide = null; this.ball.ownerNum = null;
    this.ball.inFlight = false;
    this.ball.pendingPass = null;
    this.ball.pendingShot = null;

    this.log({ type: 'system', text: `${this.teams.home.meta.name} vs ${this.teams.away.meta.name} — команди виходять на поле.` });

    this._startPause('prematch', [
      { name: 'aftermath', ticks: 90 },     // walkout from tunnel → halfway lineup
      { name: 'ready',     ticks: 35 },     // brief stand in two rows
      { name: 'setup',     ticks: 70 },     // disperse to own-half kickoff positions
    ], {
      skipDecisions: true,
      onPhaseChange: (phase) => {
        if (phase === 'setup') {
          // Move to compressed half-formation positions for kickoff.
          for (const side of ['home', 'away']) {
            const team = this.teams[side];
            for (const p of team.onPitch) {
              const slot = p.slot;
              const compressedX = slot.x * 0.4;
              const baseX = side === 'home' ? compressedX * 105 : (1 - compressedX) * 105;
              const baseY = slot.y * 68;
              p.targetX = baseX;
              p.targetY = baseY;
              p.action = 'MOVE_TO_POSITION';
            }
          }
        }
      },
      onComplete: () => {
        this.phase = 'first';
        this.setupKickoff('home');
        this.log({
          type: 'kickoff', side: 'home',
          text: `Стартовий свисток! ${this.teams.home.meta.name} vs ${this.teams.away.meta.name}.`,
        });
      },
    });
  }

  // Sprint 18: target-only kickoff layout (no position snap). Used during the
  // 'setup' phase of a goal pause so players walk to formation positions rather
  // than teleport at kickoff. The actual snap happens in setupKickoff().
  _retargetForKickoff(forSide) {
    // Use the SAME compressed kickoff positions as setupKickoff so when the
    // setup phase ends, no teleport-snap happens — players are already there.
    for (const side of ['home', 'away']) {
      const team = this.teams[side];
      for (const p of team.onPitch) {
        if (p.state.sentOff) continue;
        const slot = p.slot;
        const compressedX = slot.x * 0.4;
        const baseX = side === 'home' ? compressedX * 105 : (1 - compressedX) * 105;
        const baseY = slot.y * 68;
        p.targetX = baseX; p.targetY = baseY;
        p.anchor.x = baseX; p.anchor.y = baseY;
        p.action = 'MOVE_TO_POSITION';
      }
    }
  }

  // Sprint 25a: penalty shootout state machine. Picks 5 takers per side, then
  // alternates kicks. After regulation 5+5 a winner is declared if scores
  // differ; otherwise sudden death (1+1) until separated. Each kick reuses a
  // simplified physics path (taker → ball → goal trajectory) gated by a dice
  // roll based on shooter sh / GK reflexes / pressure.
  _beginShootout() {
    this.log({ type: 'system', text: `Серія пенальті — ${this.teams.home.meta.short} проти ${this.teams.away.meta.short}!` });
    const pickTakers = (side) => this.teams[side].onPitch
      .filter(p => !p.state.sentOff && p.role !== 'GK')
      .sort((a, b) => penaltyRating(b) - penaltyRating(a))
      .slice(0, 5);
    this.shootout = {
      active: true,
      takers: { home: pickTakers('home'), away: pickTakers('away') },
      scoresH: 0, scoresA: 0,
      kicksH: 0, kicksA: 0,
      suddenDeath: false,
      nextSide: this.rng() < 0.5 ? 'home' : 'away',  // coin flip
      lastResult: null,
    };
    // Position players: GKs at goals, others cluster around centre circle.
    for (const side of ['home', 'away']) {
      for (const p of this.teams[side].onPitch) {
        if (p.state.sentOff) continue;
        if (p.role === 'GK') {
          p.x = side === 'home' ? 1.5 : 103.5;
          p.y = 34;
          p.facing = side === 'home' ? 0 : Math.PI;
        } else {
          // Huddle near centre — semi-random ring
          const ang = this.rng() * Math.PI * 2;
          const radius = 6 + this.rng() * 4;
          p.x = 52.5 + Math.cos(ang) * radius;
          p.y = 34 + Math.sin(ang) * radius;
        }
        p.action = 'IDLE';
        p.vx = 0; p.vy = 0;
        p.targetX = p.x; p.targetY = p.y;
      }
    }
    this.phase = 'shootout';
    this._scheduleNextShootoutKick();
  }

  _scheduleNextShootoutKick() {
    const so = this.shootout;
    if (!so || !so.active) return;
    const side = so.nextSide;
    const idx = side === 'home' ? so.kicksH : so.kicksA;
    let kicker;
    if (so.suddenDeath) {
      // Cycle through any field player (5 takers exhausted)
      const pool = this.teams[side].onPitch.filter(p => !p.state.sentOff && p.role !== 'GK');
      kicker = pool[(idx - 5) % pool.length];
    } else {
      kicker = so.takers[side][idx];
    }
    if (!kicker) {
      // Fallback safety
      kicker = this.teams[side].onPitch.find(p => !p.state.sentOff && p.role !== 'GK');
    }
    // Position kicker just behind the spot, ball on the spot.
    const goalX = side === 'home' ? 105 : 0;
    const spotX = side === 'home' ? 94 : 11;
    kicker.x = spotX - (side === 'home' ? 1.5 : -1.5);
    kicker.y = 34;
    kicker.targetX = kicker.x; kicker.targetY = kicker.y;
    kicker.action = 'IDLE';
    kicker.vx = 0; kicker.vy = 0;
    this.ball.x = spotX; this.ball.y = 34; this.ball.z = 0;
    this.ball.vx = 0; this.ball.vy = 0; this.ball.vz = 0;
    this.ball.ownerSide = null; this.ball.ownerNum = null;
    this.ball.inFlight = false;
    this.ball.pendingShot = null;
    const kickNum = idx + 1;
    const phaseLabel = so.suddenDeath ? `SD${kickNum - 5}` : `${kickNum}/5`;
    this.log({
      type: 'event', side,
      text: `${kicker.name} підходить до мʼяча — ${this.teams[side].meta.short} ${phaseLabel} (${so.scoresH}-${so.scoresA})`,
    });
    this._startPause('penalty', [
      { name: 'setup', ticks: 30 },     // approach + GK ready
      { name: 'execute', ticks: 5 },    // strike phase
      { name: 'aftermath', ticks: 25 }, // ball flight + reaction
    ], {
      skipDecisions: true,
      handlerNum: kicker.num,
      handlerSide: side,
      onPhaseChange: (phase) => {
        if (phase === 'execute') this._resolveShootoutKick(side, kicker);
      },
      onComplete: () => this._afterShootoutKick(side),
    });
  }

  _resolveShootoutKick(side, kicker) {
    const so = this.shootout;
    const opp = this.teams[other(side)];
    const gk = opp.onPitch.find(p => p.role === 'GK' && !p.state.sentOff);
    // Pressure: more pressure when behind & late in shootout.
    const myScore = side === 'home' ? so.scoresH : so.scoresA;
    const oppScore = side === 'home' ? so.scoresA : so.scoresH;
    const trailing = Math.max(0, oppScore - myScore);
    const pressure = trailing * 0.04 + (so.suddenDeath ? 0.05 : 0);
    let goalProb = 0.78
      + (penaltyRating(kicker) - 70) * 0.005
      - ((gk?.attrs.reflexes || 70) - 70) * 0.004
      - pressure;
    goalProb = Math.max(0.40, Math.min(0.92, goalProb));
    const scored = this.rng() < goalProb;
    so.lastResult = scored;
    // Animate ball trajectory — direct shot toward goal (or wide if missing).
    const goalX = side === 'home' ? 105 : 0;
    const aimY = scored
      ? 34 + (this.rng() - 0.5) * 5
      : (this.rng() < 0.5 ? -2 : 70);   // wide miss
    const dx = goalX - kicker.x, dy = aimY - kicker.y;
    const dxy = Math.hypot(dx, dy) || 1;
    this.ball.vx = (dx / dxy) * 26;
    this.ball.vy = (dy / dxy) * 26;
    this.ball.vz = 1.2 + this.rng() * 1.2;
    this.ball.x = kicker.x + (dx / dxy) * 0.6;
    this.ball.y = kicker.y + (dy / dxy) * 0.6;
    this.ball.z = 0.3;
    this.ball.inFlight = true;
    this.ball.lastTouchSide = side;
    this.ball.lastTouchNum = kicker.num;
    this.ball.ownerSide = null; this.ball.ownerNum = null;
  }

  _afterShootoutKick(side) {
    const so = this.shootout;
    if (!so) return;
    if (so.lastResult) {
      if (side === 'home') so.scoresH++; else so.scoresA++;
    }
    if (side === 'home') so.kicksH++; else so.kicksA++;
    const verdict = so.lastResult ? '⚽ Гол' : '🥅 Не забив';
    this.log({
      type: 'event', side,
      text: `${verdict}. ${this.teams.home.meta.short} ${so.scoresH}-${so.scoresA} ${this.teams.away.meta.short}`,
    });
    so.nextSide = other(side);
    if (this._checkShootoutDecided()) {
      this._endShootout();
      return;
    }
    this._scheduleNextShootoutKick();
  }

  _checkShootoutDecided() {
    const so = this.shootout;
    if (!so.suddenDeath) {
      const totalKicks = so.kicksH + so.kicksA;
      // Mathematical decision possible after 6+ kicks (e.g., 4-1 with 2 left).
      const kicksLeftH = 5 - so.kicksH;
      const kicksLeftA = 5 - so.kicksA;
      const maxFinalH = so.scoresH + kicksLeftH;
      const maxFinalA = so.scoresA + kicksLeftA;
      if (totalKicks >= 2) {
        if (so.scoresH > maxFinalA) return true;
        if (so.scoresA > maxFinalH) return true;
      }
      // After regulation 5+5
      if (totalKicks >= 10) {
        if (so.scoresH !== so.scoresA) return true;
        so.suddenDeath = true;
        this.log({ type: 'system', text: '🚨 Несподівана смерть!' });
        return false;
      }
      return false;
    }
    // Sudden death: decided when both sides have kicked the same number AND scores differ.
    if (so.kicksH === so.kicksA && so.scoresH !== so.scoresA) return true;
    return false;
  }

  _endShootout() {
    const so = this.shootout;
    const winner = so.scoresH > so.scoresA ? 'home' : 'away';
    this.log({
      type: 'system',
      text: `🏆 ${this.teams[winner].meta.name} перемагають по пенальті (${so.scoresH}-${so.scoresA})!`,
    });
    so.active = false;
    this.phase = 'full';
  }

  setupKickoff(forSide) {
    // Bug fix: at kickoff both teams must be on their own half with visible
    // separation around halfway. Players that already walked here during the
    // pause's setup phase get a soft "nudge" (no hard snap); only those still
    // far away (e.g. shootout end, debug paths) get teleported into position.
    for (const side of ['home', 'away']) {
      const team = this.teams[side];
      for (const p of team.onPitch) {
        const slot = p.slot;
        const compressedX = slot.x * 0.4;
        const baseX = side === 'home' ? compressedX * 105 : (1 - compressedX) * 105;
        const baseY = slot.y * 68;
        const d = Math.hypot(p.x - baseX, p.y - baseY);
        if (d > 3) {                       // only teleport stragglers
          p.x = baseX; p.y = baseY;
        }
        p.vx = 0; p.vy = 0;
        p.facing = side === 'home' ? 0 : Math.PI;
        p.targetX = baseX; p.targetY = baseY;
        p.anchor.x = baseX; p.anchor.y = baseY;
        p.action = 'IDLE'; p.actionTimer = 0;
      }
    }
    // Ball at centre. Owner = team taking kickoff (a CM-ish role near centre).
    this.ball.x = 52.5; this.ball.y = 34; this.ball.z = 0;
    this.ball.vx = 0; this.ball.vy = 0; this.ball.vz = 0;
    this.ball.ownerSide = forSide;
    const team = this.teams[forSide];
    const taker = team.onPitch.find(p => ['AM','CM','ST'].includes(p.role)) || team.onPitch[0];
    // Place kicker at centre circle (touching ball) and a partner just behind.
    taker.x = 52.5 - (forSide === 'home' ? 0.5 : -0.5);
    taker.y = 34;
    taker.targetX = taker.x; taker.targetY = taker.y;
    const partner = team.onPitch.find(p =>
      p.num !== taker.num && (p.role === 'ST' || p.role === 'AM' || p.role === 'CM') && !p.state.sentOff
    );
    if (partner) {
      partner.x = 52.5 - (forSide === 'home' ? 3 : -3);
      partner.y = 34 + 1;
      partner.targetX = partner.x; partner.targetY = partner.y;
    }
    this.ball.ownerNum = taker.num;
    this.ball.lastTouchSide = forSide;
    this.ball.lastTouchNum = taker.num;
    this.ball.inFlight = false;
  }

  // Sprint 19: throw-in with proper setup pause + receiver positioning.
  // 35-tick (3.5s) setup so taker walks to spot and 2 short receivers peel off
  // the line. AI suspended during setup; ownership granted to taker on resume,
  // letting decideOnBall pick a quick pass to nearest open receiver.
  _beginThrowIn(side, x, y) {
    const team = this.teams[side];
    const taker = closestPlayer(team.onPitch, x, y);
    if (!taker) return;
    // Hybrid snap: if taker is far, snap to within 4m of the throw-in spot,
    // then let them walk the last bit during the 35-tick setup. Removes the
    // visible "teleport leap" while keeping the restart on schedule.
    const _td = dist(taker.x, taker.y, x, y);
    if (_td > 4) {
      const _tt = (_td - 4) / _td;
      taker.x = taker.x + (x - taker.x) * _tt;
      taker.y = taker.y + (y - taker.y) * _tt;
    }
    taker.vx = 0; taker.vy = 0;
    taker.targetX = x; taker.targetY = y;
    taker.action = 'MOVE_TO_POSITION'; taker.actionTimer = 0;
    // Ball at spot, no owner — AI ignores it during pause.
    this.ball.x = x; this.ball.y = y; this.ball.z = 0;
    this.ball.vx = 0; this.ball.vy = 0; this.ball.vz = 0;
    this.ball.ownerSide = null; this.ball.ownerNum = null;
    this.ball.inFlight = false;
    this.ball.lastTouchSide = side; this.ball.lastTouchNum = taker.num;
    // Two short receivers — closest non-GK teammates, peel off the line.
    const dir = side === 'home' ? 1 : -1;
    const teammates = team.onPitch
      .filter(p => p.num !== taker.num && !p.state.sentOff && p.role !== 'GK')
      .sort((a, b) => dist(a.x, a.y, x, y) - dist(b.x, b.y, x, y));
    if (teammates[0]) {
      teammates[0].targetX = x - 3 * dir;                // safe pass back
      teammates[0].targetY = clamp(y < 34 ? y + 6 : y - 6, 4, 64);
      teammates[0].action = 'MOVE_TO_POSITION';
    }
    if (teammates[1]) {
      teammates[1].targetX = x + 8 * dir;                // forward option
      teammates[1].targetY = clamp(y < 34 ? y + 5 : y - 5, 4, 64);
      teammates[1].action = 'MOVE_TO_POSITION';
    }
    this._startPause('throw_in', [
      { name: 'setup', ticks: 35 },
    ], {
      skipDecisions: true,
      handlerNum: taker.num, handlerSide: side,
      onComplete: () => {
        this.ball.ownerSide = side;
        this.ball.ownerNum = taker.num;
        this.ball.lastTouchSide = side;
        this.ball.lastTouchNum = taker.num;
        // Force a safe short pass to the back receiver — mirrors a real
        // hand-throw to the nearest teammate. Without this the taker's
        // normal AI sometimes picks a longer forward option that an
        // opponent intercepts.
        if (teammates[0]) {
          taker.action = 'PASS';
          taker.actionTimer = 3;
          taker._passTargetNum = teammates[0].num;
        }
      },
    });
  }

  // Sprint 19: goal kick with build-up positioning. CBs split wide (~16m from
  // own goal, on the edges of the box), DM drops between for short option,
  // FBs push wider+higher. ~80-tick setup so the shape forms before GK plays.
  _beginGoalKick(side) {
    const team = this.teams[side];
    const gk = team.onPitch.find(p => p.role === 'GK' && !p.state.sentOff);
    if (!gk) return;
    const ballX = side === 'home' ? 5 : 100;
    // Hybrid snap: if GK rushed far from goal, snap to within 4m then walk
    // the rest during the 80-tick setup. No visible teleport leap.
    const _gd = dist(gk.x, gk.y, ballX, 34);
    if (_gd > 4) {
      const _gt = (_gd - 4) / _gd;
      gk.x = gk.x + (ballX - gk.x) * _gt;
      gk.y = gk.y + (34 - gk.y) * _gt;
    }
    gk.vx = 0; gk.vy = 0;
    gk.targetX = ballX; gk.targetY = 34;
    gk.action = 'MOVE_TO_POSITION'; gk.actionTimer = 0;
    this.ball.x = ballX; this.ball.y = 34; this.ball.z = 0;
    this.ball.vx = 0; this.ball.vy = 0; this.ball.vz = 0;
    this.ball.ownerSide = null; this.ball.ownerNum = null;
    this.ball.inFlight = false;
    this.ball.lastTouchSide = side; this.ball.lastTouchNum = gk.num;
    // Split-CB build-up shape on own half.
    const cbX = side === 'home' ? 16 : 89;
    const dmX = side === 'home' ? 24 : 81;
    const fbX = side === 'home' ? 32 : 73;
    const cbs = team.onPitch.filter(p => p.role === 'CB' && !p.state.sentOff);
    if (cbs[0]) { cbs[0].targetX = cbX; cbs[0].targetY = 18; cbs[0].action = 'MOVE_TO_POSITION'; }
    if (cbs[1]) { cbs[1].targetX = cbX; cbs[1].targetY = 50; cbs[1].action = 'MOVE_TO_POSITION'; }
    const dm = team.onPitch.find(p => p.role === 'DM' && !p.state.sentOff);
    if (dm) { dm.targetX = dmX; dm.targetY = 34; dm.action = 'MOVE_TO_POSITION'; }
    const fbs = team.onPitch.filter(p => p.role === 'FB' && !p.state.sentOff);
    if (fbs[0]) { fbs[0].targetX = fbX; fbs[0].targetY = 8; fbs[0].action = 'MOVE_TO_POSITION'; }
    if (fbs[1]) { fbs[1].targetX = fbX; fbs[1].targetY = 60; fbs[1].action = 'MOVE_TO_POSITION'; }
    // Bug fix: opposing team must be OUTSIDE penalty area until ball is in play.
    // Push any opp player inside the box out to the edge (or further).
    const opp = this.teams[other(side)];
    const penEdgeX = side === 'home' ? 17.5 : 87.5;   // 16.5m + 1m margin
    for (const p of opp.onPitch) {
      if (p.state.sentOff || p.role === 'GK') continue;
      const inPen = (side === 'home' && p.x < 16.5) || (side === 'away' && p.x > 88.5);
      if (inPen) {
        p.targetX = penEdgeX;
        p.targetY = clamp(p.y, 4, 64);
        p.action = 'MOVE_TO_POSITION';
        // Snap immediately so they're not standing on top of the GK.
        p.x = penEdgeX;
      }
    }
    this._startPause('goal_kick', [
      { name: 'setup', ticks: 80 },
    ], {
      skipDecisions: true,
      handlerNum: gk.num, handlerSide: side,
      onComplete: () => {
        this.ball.ownerSide = side;
        this.ball.ownerNum = gk.num;
        this.ball.lastTouchSide = side;
        this.ball.lastTouchNum = gk.num;
      },
    });
  }

  setupRestart(type, side, x, y) {
    // type: 'goal_kick' | 'corner' | 'throw_in' | 'free_kick'
    const team = this.teams[side];
    let taker;
    if (type === 'goal_kick') taker = team.onPitch.find(p => p.role === 'GK');
    else if (type === 'corner') taker = pickBest(team.onPitch, p => passRating(p, 'cross') + (p.attrs.vision || 60) * 0.3);
    else if (type === 'throw_in') {
      // closest player on team to (x, y) takes
      taker = closestPlayer(team.onPitch, x, y);
    } else {
      taker = pickBest(team.onPitch, p => freeKickRating(p));
    }
    if (!taker) return;
    // Move taker to spot
    taker.x = x; taker.y = y;
    taker.vx = 0; taker.vy = 0;
    this.ball.x = x; this.ball.y = y; this.ball.z = 0;
    this.ball.vx = 0; this.ball.vy = 0; this.ball.vz = 0;
    this.ball.ownerSide = side;
    this.ball.ownerNum = taker.num;
    this.ball.lastTouchSide = side;
    this.ball.lastTouchNum = taker.num;
    this.ball.inFlight = false;
  }

  // ----------------------------------------------------------------------
  // TICK — main loop entry, called by main.js
  // ----------------------------------------------------------------------

  tick() {
    if (this.phase === 'full') return;
    // Sprint 23: halftime now uses pause + physics (was a frozen-render skip).
    // Players walk off to the tunnel, brief stand, walk back to formation,
    // then the second half kicks off with the away team.
    // Sprint 25a: 'shootout' phase shares the same physics-only loop.
    if (this.phase === 'halftime' || this.phase === 'shootout') {
      this.tickCount++;
      this._pauseTick();
      for (const side of ['home', 'away']) {
        for (const p of this.teams[side].onPitch) {
          if (p.state.sentOff) continue;
          // Jog mode during halftime so players actually reach the tunnel/back
          // even with low PLAYER_SPEED_SCALE. Shootout uses idle pacing.
          if (p.action === 'MOVE_TO_POSITION' || p.action === 'IDLE') {
            const sprint = this.phase === 'halftime';
            this.actMoveToTarget(p, sprint);
          }
          this._applyPauseSpeedCap(p);
          this.integratePlayer(p);
        }
      }
      this.integrateBall();
      return;
    }

    // Sprint 22 add-on: pre-match. Game clock doesn't tick yet; only pause
    // state-machine + physics integration so players walk from the tunnel to
    // their formation slots. When the prematch pause completes (onComplete in
    // _beginPrematch), phase transitions to 'first' and the clock starts.
    if (this.phase === 'pre') {
      this.tickCount++;
      this._pauseTick();
      for (const side of ['home', 'away']) {
        for (const p of this.teams[side].onPitch) {
          if (p.state.sentOff) continue;
          if (p.action === 'MOVE_TO_POSITION' || p.action === 'IDLE') this.actMoveToTarget(p, false);
          this._applyPauseSpeedCap(p);
          this.integratePlayer(p);
        }
      }
      this.integrateBall();
      return;
    }

    this.gameTime += DT;
    this.tickCount++;
    // S64: snapshot ball position into rolling history for per-player lag sampling.
    this.ballHistory[this.tickCount % this.ballHistory.length] = { x: this.ball.x, y: this.ball.y };
    // S82: sample positions every 60 ticks (~6 game-sec) for heat-map rendering.
    // Integers — 21×14 grid means sub-meter precision is wasted. Storage:
    // ~22 players × 900 samples × ~14 bytes JSON ≈ 280 KB / match.
    if (this.tickCount % 60 === 0) {
      for (const side of ['home', 'away']) {
        for (const p of this.teams[side].onPitch) {
          if (p.state.sentOff) continue;
          const key = `${side}-${p.num}`;
          if (!this.positionsLog[key]) this.positionsLog[key] = [];
          this.positionsLog[key].push({ x: Math.round(p.x), y: Math.round(p.y) });
        }
      }
    }

    // Set piece in progress — scripted positioning + delivery overrides normal AI.
    if (this.setPiece) {
      this.processSetPiece();
      this.integrateBall();
      // Players still integrate (move toward scripted targets)
      for (const side of ['home', 'away']) {
        for (const p of this.teams[side].onPitch) {
          if (p.state.sentOff) continue;
          if (p.action === 'MOVE_TO_POSITION' || p.action === 'IDLE') this.actMoveToTarget(p, false);
          this.integratePlayer(p);
        }
      }
      this.checkBoundaries();
      this.checkGoal();
      if (this.tickCount % 10 === 0) this.updatePlayerStates();
      // Phase transitions still tick
      if (this.gameTime >= this.halfLenSec && this.phase === 'first') {
        this._beginHalftime();
      } else if (this.gameTime >= this.halfLenSec * 2 && this.phase === 'second') {
        this._beginFulltime();
      }
      if (this.ball.ownerSide) this.stats[this.ball.ownerSide].possessionTicks++;
      return;
    }

    // 0. Sprint 17: pause state machine — advances phases, fires onComplete.
    this._pauseTick();

    // 1. Strategic — pending tactical changes
    this.applyReadyChanges();

    // 2. Tactical — phase + targets, every 30 ticks. Skipped during goal
    //    celebration pauses so the scripted choreography (scorer to corner,
    //    teammates pile up, conceders walk back) isn't overwritten by the
    //    formation-targets-from-anchor logic.
    const lockTargets = this.pause?.active && (this.pause.type === 'goal' || this.pause.type === 'var_check');
    if (this.tickCount % 30 === 0 && !lockTargets) {
      for (const side of ['home', 'away']) this.tacticalUpdate(side);
    }

    // 2b. Team-state — sub-tactical role assignments, every 5 ticks (Sprint 8)
    if (this.tickCount % 5 === 0) {
      for (const side of ['home', 'away']) {
        const fdId = this._selectFirstDefender(side);
        this.teamState[side].firstDefenderId = fdId;
        this.teamState[side].secondDefenderId = this._selectSecondDefender(side, fdId);
        this.teamState[side].lastUpdateTick = this.tickCount;
        // Sprint 13: detect press triggers and decay existing ones.
        const newTrigger = this._detectPressTrigger(side);
        if (newTrigger) {
          // Refresh / set trigger (25 ticks = 2.5 game-sec)
          this.teamState[side].pressTrigger = { type: newTrigger, remaining: 25 };
        } else if (this.teamState[side].pressTrigger) {
          this.teamState[side].pressTrigger.remaining -= 5;
          if (this.teamState[side].pressTrigger.remaining <= 0) {
            this.teamState[side].pressTrigger = null;
          }
        }

        // Sprint 11: defensive line as one body. Target X follows the ball with
        // a tactics-dependent offset; team-without-ball drops 10m deeper to reduce
        // counter-attack vulnerability.
        const team = this.teams[side];
        const baseOffset = team.tactics?.defLine === 'high' ? 18 : team.tactics?.defLine === 'deep' ? 35 : 25;
        const defendingMod = this.ball.ownerSide && this.ball.ownerSide !== side ? 10 : 0;
        const finalOffset = baseOffset + defendingMod;
        let defLineX;
        if (side === 'home') {
          defLineX = clamp(this.ball.x - finalOffset, 12, 50);
        } else {
          defLineX = clamp(this.ball.x + finalOffset, 55, 93);
        }
        this.teamState[side].defLineX = defLineX;

        // Sprint 11: defLineX is a TARGET measurement (used for compactness display
        // and for future offside-trap logic). We do NOT override anchor.x of the
        // back-four here — the existing tacticalUpdate already gives ball-aware
        // phase positions and leash mechanics keep the line cohesive enough.
        // Hard override caused excess own goals and shape collapse (see Sprint 11
        // notes). Sprint 14 (transitions) will revisit defensive line behaviour.

        // Sprint 12: attacking slot assignment. When team is in `progress` or
        // `final` phase with ball, override anchors of ST/W/AM to fixed attacking
        // slots. Slots are absolute (don't shift with ball), so each player has a
        // stable target — avoids the rapid-anchor-jump problem from Sprint 11.
        // The "3-1 rule" (max 3 attackers in box) emerges naturally from slot
        // layout (only 3 slots are deep in the box; the rest are around its edge).
        const inAttackingPhase = team.currentPhase === 'final' || team.currentPhase === 'progress';
        if (inAttackingPhase && this.ball.ownerSide === side) {
          const SLOTS = side === 'home' ? SLOTS_HOME : SLOTS_AWAY;
          const candidates = team.onPitch.filter(p =>
            !p.state.sentOff && (p.role === 'ST' || p.role === 'W' || p.role === 'AM')
          );
          const usedSlotNames = new Set();
          // Greedy: each player picks the nearest unused slot.
          for (const p of candidates) {
            let bestSlot = null, bestD = 99;
            for (const s of SLOTS) {
              if (usedSlotNames.has(s.name)) continue;
              const d = Math.hypot(s.x - p.x, s.y - p.y);
              if (d < bestD) { bestD = d; bestSlot = s; }
            }
            if (bestSlot) {
              p.anchor.x = bestSlot.x;
              p.anchor.y = bestSlot.y;
              p._slotName = bestSlot.name;
              usedSlotNames.add(bestSlot.name);
            }
          }
        }

        // atkLineX — observed forward-most outfielder (used for compactness display)
        let fwdX = side === 'home' ? -999 : 999;
        for (const p of team.onPitch) {
          if (p.state.sentOff || p.role === 'GK') continue;
          if (side === 'home') {
            if (p.x > fwdX) fwdX = p.x;
          } else {
            if (p.x < fwdX) fwdX = p.x;
          }
        }
        this.teamState[side].atkLineX = fwdX;
      }
    }

    // Sprint 10: behavioral metrics snapshot every 30 ticks (3 game-sec).
    if (this.tickCount % 30 === 0 && this.phase !== 'pre' && this.phase !== 'full') {
      let nearBall = 0, simultPress = 0, anchorSum = 0, anchorCount = 0;
      for (const side of ['home', 'away']) {
        for (const p of this.teams[side].onPitch) {
          if (p.state.sentOff || p.role === 'GK') continue;
          const dBall = dist(p.x, p.y, this.ball.x, this.ball.y);
          if (dBall < 5) nearBall++;
          if (p.action === 'PRESS_BALL_CARRIER') simultPress++;
          const dAnchor = dist(p.x, p.y, p.anchor.x, p.anchor.y);
          anchorSum += dAnchor;
          anchorCount++;
        }
      }
      const m = this.behavioralMetrics;
      m.snapshotCount++;
      m.sumPlayersWithin5m += nearBall;
      m.sumAnchorDist += anchorSum;
      m.sumAnchorDistCount += anchorCount;
      m.sumSimultaneousPressers += simultPress;
      if (simultPress > m.maxSimultaneousPressers) m.maxSimultaneousPressers = simultPress;
    }

    // 3. Decision AI — every 4 ticks (staggered per player). Sprint 18: when a
    // pause has skipDecisions context flag, AI doesn't run — players keep their
    // existing action (typically MOVE_TO_POSITION toward celebration / formation
    // targets set when the pause started).
    const pauseSkipsDecisions = this.pause.active && this.pause.context && this.pause.context.skipDecisions === true;
    if (!pauseSkipsDecisions) {
      for (const side of ['home', 'away']) {
        const team = this.teams[side];
        // S28: tempo modulates decision frequency — fast tempo decides every 3 ticks
        // (sharper reactions), slow every 5 (more deliberate); base 4.
        const tempo = team.tactics?.tempo;
        const decFreq = tempo === 'fast' ? 3 : tempo === 'slow' ? 5 : 4;
        for (const p of team.onPitch) {
          if (p.state.sentOff) continue;
          if ((this.tickCount + p.num) % decFreq === 0) {
            this.decideAction(p, team);
          }
        }
      }
    }

    // 4. Physical — execute + integrate, with Sprint 17 pause speed cap
    for (const side of ['home', 'away']) {
      const team = this.teams[side];
      for (const p of team.onPitch) {
        if (p.state.sentOff) continue;
        this.executeAction(p, team);
        this._applyPauseSpeedCap(p);
        this.integratePlayer(p);
      }
    }
    this.integrateBall();

    // 5. Ball-player contact / control
    this.resolveBallContacts();

    // 6. Match events
    this.checkBoundaries();
    this.checkGoal();

    // 7. Stamina / state drift
    if (this.tickCount % 10 === 0) this.updatePlayerStates();

    // 8. Phase transitions (Sprint 23: route through choreography helpers)
    if (this.gameTime >= this.halfLenSec && this.phase === 'first') {
      this._beginHalftime();
    } else if (this.gameTime >= this.halfLenSec * 2 && this.phase === 'second') {
      this._beginFulltime();
    }

    // 9. Possession ticks for stat
    if (this.ball.ownerSide) this.stats[this.ball.ownerSide].possessionTicks++;
  }

  // ----------------------------------------------------------------------
  // TACTICAL LAYER (every 30 ticks)
  // ----------------------------------------------------------------------

  tacticalUpdate(side) {
    const team = this.teams[side];
    const opp = this.teams[other(side)];
    const ball = this.ball;
    const dir = side === 'home' ? 1 : -1;

    // Determine team phase
    let phase;
    if (ball.ownerSide === side) {
      // attacking — by ball X (in attacker frame: x=0 own goal, x=105 opp goal)
      const attX = side === 'home' ? ball.x : 105 - ball.x;
      if (attX < 35) phase = 'build';
      else if (attX < 65) phase = 'progress';
      else phase = 'final';
    } else if (ball.ownerSide === other(side)) {
      phase = 'def';
    } else {
      // ball loose / in flight — recent possession determines mode
      if (this.lastPossessionChange && this.tickCount - this.lastPossessionChange < 50) {
        phase = ball.lastTouchSide === side ? 'transDef' : 'transAtk';
      } else {
        phase = 'def';
      }
    }

    // Sprint 14: detect phase transitions for counter-press / counter-attack triggers.
    const prevPhase = team.currentPhase;
    if (phase !== prevPhase) {
      if (phase === 'transDef') {
        // Just lost the ball — activate counter-press window (5 game-sec, same
        // mechanism as Sprint 13 triggers: secondDefender joins the press).
        this.teamState[side].pressTrigger = { type: 'counter_press', remaining: 50 };
      } else if (phase === 'transAtk') {
        // Just won the ball — fire forward runs to exploit the open space.
        // S70: real counter-attacks have role diversity — 1-2 deep runners
        // sprint into space, the rest support / trail. Previously ALL
        // attackers ran in sync → homogeneous reaction. Now pick the 1-2
        // best-positioned candidates (closest to opp goal, highest pace) and
        // only they get _runActive. Others stay supportive.
        const tempoMul = team.tactics?.tempo === 'fast' ? 0.7 : team.tactics?.tempo === 'slow' ? 1.3 : 1.0;
        const candidates = team.onPitch
          .filter(p => {
            if (p.state.sentOff) return false;
            const isAttacker = p.role === 'ST' || p.role === 'W';
            return isAttacker || _roleBias(p, 'run') > 0;
          })
          .filter(p => (p._runCooldown || 0) <= 0)
          // S72: anti-offside gate — don't trigger runs for attackers already
          // beyond the offside line, or within 1m of it. Previously the engine
          // happily fired runners straight into offside positions, ballooning
          // the offsides count to 14+/match (real ~2).
          .filter(p => !this.isOffside(p.side, p))
          .map(p => {
            const goalX = side === 'home' ? 105 : 0;
            const dToOppGoal = Math.abs(goalX - p.x);
            const paceRating = (p.attrs?.pace ?? 65);
            return { p, score: paceRating - dToOppGoal * 0.6 + _roleBias(p, 'run') * 30 };
          })
          .sort((a, b) => b.score - a.score)
          .slice(0, 2);
        for (const { p } of candidates) {
          const runBias = _roleBias(p, 'run');
          p._runActive = 30 + Math.round(runBias * 60);
          p._runCooldown = Math.round(80 * tempoMul);
        }
      }
    }
    team.currentPhase = phase;

    // Tactical params
    const t = team.tactics;
    const defLineMod = t.defLine === 'high' ? 0.06 : t.defLine === 'deep' ? -0.06 : 0;
    const widthMod = t.width === 'wide' ? 1.18 : t.width === 'narrow' ? 0.78 : 1.0;
    const mentMod = parseInt(t.mentality, 10) * 0.018;

    // Assign target_zone per player from formation slot + phase
    for (const p of team.onPitch) {
      if (p.state.sentOff) continue;
      const slot = p.slot;
      const targets = ROLE_PHASE_TARGETS[p.role] || ROLE_PHASE_TARGETS.CM;
      let normX = targets[phase];
      // Tactical shifts
      normX += defLineMod * 0.5;
      if (['ST', 'AM', 'W'].includes(p.role) && phase !== 'def') normX += mentMod;
      // Width adjust for FB / W
      let normY = slot.y;
      if ((p.role === 'FB' || p.role === 'W')) {
        const fromCenter = normY - 0.5;
        normY = 0.5 + fromCenter * widthMod;
      }
      // S27: role + duty offset in attacker-frame (slot fractional units).
      // Apply only in attacking-context phases — when defending or transitioning,
      // players collapse to formation slots instead of role-specific tweaks. This
      // keeps wing_backs from sitting advanced when defending and prevents
      // false-9s from leaving CB exposed during transDef.
      const roleDef = p.role_kind ? ROLES[p.role_kind] : null;
      if (roleDef && (phase === 'build' || phase === 'progress' || phase === 'final' || phase === 'transAtk')) {
        const off = roleDef.anchorOffset(slot, p.duty) || { dx: 0, dy: 0 };
        const dutyDx = DUTY_DX[p.duty] || 0;
        normX += off.dx + dutyDx;
        normY += off.dy;
      }
      // Convert to absolute coords (mirror for away)
      p.targetX = side === 'home' ? normX * 105 : (1 - normX) * 105;
      p.targetY = normY * 68;

      // S64: per-player position bias for organic line shape. Defenders no
      // longer step in perfect unison — small stable offsets break up the
      // "single body" silhouette without changing tactical correctness.
      const biasMul = (p.role === 'GK') ? 0.0 : (p.role === 'CB' || p.role === 'FB') ? 0.7 : 1.0;
      p.targetX += (p.posBiasX || 0) * biasMul;
      p.targetY += (p.posBiasY || 0) * biasMul;

      // Ball-side compression in defending phase — now uses each player's
      // *perceived* ball (lagged) and a role-varying pull coefficient.
      if (phase === 'def' || phase === 'transDef') {
        const pb = this._perceivedBall(p);
        const pullCoef = p.role === 'GK' ? 0.10
                       : p.role === 'CB' ? 0.22
                       : p.role === 'FB' ? 0.32
                       : p.role === 'DM' ? 0.26
                       : 0.20;
        const ballPullY = (pb.y - p.targetY) * pullCoef;
        p.targetY = clamp(p.targetY + ballPullY, 4, 64);
        // S69: vertical line dynamics. Subtle step-up/drop based on ball X.
        // Was static — defLineMod only adjusted base depth. Now line breathes
        // with the ball but coefficients are conservative to avoid corners
        // explosion (S69 v1 made line too high → clearances out for corners).
        if (p.role === 'CB' || p.role === 'FB' || p.role === 'DM') {
          const ourHalfX = side === 'home' ? 0 : 105;
          const ballDistFromOurGoal = Math.abs(ourHalfX - pb.x);
          // ±3m at extremes (ball at far end vs at goal mouth).
          const stepUp = (ballDistFromOurGoal - 52.5) * 0.06;
          const xPullCoef = p.role === 'CB' ? 0.30 : p.role === 'FB' ? 0.25 : 0.15;
          const adjust = stepUp * xPullCoef * (side === 'home' ? 1 : -1);
          p.targetX = clamp(p.targetX + adjust, 8, 97);
        }
      }

      // Sprint 9: snapshot the tactical position as the player's anchor.
      p.anchor.x = p.targetX;
      p.anchor.y = p.targetY;
    }

    // S66: cover pass lanes. When defending in our own half, two nearest
    // defensive players shade toward the most dangerous receivers (Y-only so
    // the defensive line depth stays cohesive). Keeps formation shape, just
    // shifts marker laterally — no longer "one presser + 10 statues".
    const isDefending = ball.ownerSide === other(side);
    if (isDefending) {
      const carrier = opp.onPitch.find(o => o.num === ball.ownerNum && !o.state.sentOff);
      const ownGoalX = side === 'home' ? 0 : 105;
      const carrierThreat = carrier ? Math.abs(ownGoalX - carrier.x) < 55 : false;
      if (carrier && carrierThreat) {
        const dangerous = opp.onPitch
          .filter(o => !o.state.sentOff && o.role !== 'GK' && o.num !== carrier.num)
          .map(o => {
            const dToGoal = Math.abs(ownGoalX - o.x);
            const dToCarrier = dist(o.x, o.y, carrier.x, carrier.y);
            const passReach = Math.max(0, 1 - dToCarrier / 35);
            const goalThreat = Math.max(0, 1 - dToGoal / 50);
            return { o, score: goalThreat * 0.6 + passReach * 0.4 };
          })
          .sort((a, b) => b.score - a.score)
          .slice(0, 2);

        const firstId = this.teamState?.[side]?.firstDefenderId;
        const assigned = new Set();
        if (firstId != null) assigned.add(firstId);
        for (const p of team.onPitch) p._coveringOpp = null;
        for (const { o: receiver } of dangerous) {
          let best = null, bestD = Infinity;
          for (const p of team.onPitch) {
            if (p.state.sentOff) continue;
            if (!['CB', 'FB', 'DM', 'CM'].includes(p.role)) continue;
            if (assigned.has(p.num)) continue;
            const d = Math.abs(p.anchor.y - receiver.y);    // Y-distance: stay on same lane
            if (d < bestD) { bestD = d; best = p; }
          }
          if (!best) break;
          assigned.add(best.num);
          best._coveringOpp = receiver.num;
          // Y-only soft shade: keep line X depth (don't break shape), just
          // slide toward receiver's lane.
          best.anchor.y = best.anchor.y * 0.70 + receiver.y * 0.30;
        }
      } else {
        for (const p of team.onPitch) p._coveringOpp = null;
      }
    }
  }

  // ----------------------------------------------------------------------
  // DECISION AI (every 4 ticks per player, simplified utility)
  // ----------------------------------------------------------------------

  decideAction(p, team) {
    const ball = this.ball;
    const side = p.side;

    // Don't interrupt actions with non-zero timer (hysteresis)
    if (p.actionTimer > 0) return;

    // GK has its own brain
    if (p.role === 'GK') {
      this.decideGK(p, team);
      return;
    }

    // Pending pass intended-receiver anticipation: predict ball landing and run there.
    if (ball.pendingPass && ball.pendingPass.targetNum === p.num && ball.pendingPass.fromSide === side) {
      const predict = this.predictBallTouchdown();
      if (predict) {
        p.targetX = predict.x;
        p.targetY = predict.y;
        p.action = 'INTERCEPT';
        return;
      }
    }
    if (ball.ownerNum === p.num && ball.ownerSide === side) {
      // I have the ball
      this.decideOnBall(p, team);
    } else if (ball.ownerSide === side) {
      // My team has it — support / make a run
      this.decideSupport(p, team);
    } else if (ball.ownerSide === other(side)) {
      // Opp has it. Sprint 8: only the first defender presses by default.
      // Sprint 13: when a press trigger is active (back_pass / wide_trap), the
      // second defender joins the press too — "1-2-rest" intensity.
      const carrier = this.teams[other(side)].onPitch.find(x => x.num === ball.ownerNum);
      const ts = this.teamState[side];
      const isFirstDefender = ts.firstDefenderId === p.num;
      const isSecondDefender = ts.secondDefenderId === p.num;
      const triggerActive = ts.pressTrigger && ts.pressTrigger.remaining > 0;
      // S28: pressInt — high makes second defender always join, low keeps only first.
      // S28: pressHeight high also enables second defender to join when ball is in
      // opponent half — high block = aggressive in opponent territory.
      const intH = team.tactics?.pressInt === 'high';
      const intL = team.tactics?.pressInt === 'low';
      const pressHHigh = team.tactics?.pressHeight === 'high';
      const ballInOppHalf = side === 'home' ? ball.x > 52.5 : ball.x < 52.5;
      const allowedToPress = isFirstDefender
        || (intH && isSecondDefender)
        || (!intL && triggerActive && isSecondDefender)
        || (!intL && pressHHigh && ballInOppHalf && isSecondDefender);
      if (allowedToPress && p.role !== 'GK' && (p._tackleCooldown || 0) <= 0) {
        const distToCarrier = carrier ? dist(p.x, p.y, carrier.x, carrier.y) : 99;
        // TACKLE rare and only when very close — most defending is PRESS/jockey.
        const carrierMoving = carrier && Math.hypot(carrier.vx, carrier.vy) > 2.5;
        const tackleChance = (distToCarrier < 0.7 && carrierMoving) ? 0.08 : 0.02;
        if (distToCarrier < 0.9 && this.rng() < tackleChance) {
          p.action = 'TACKLE';
          p.actionTimer = 4;
        } else {
          p.action = 'PRESS_BALL_CARRIER';
        }
      } else {
        p.action = 'MOVE_TO_POSITION';
      }
    } else {
      // Ball loose / in flight
      const couldIntercept = this.willReachBallFirst(p, side);
      p.action = couldIntercept ? 'INTERCEPT' : 'MOVE_TO_POSITION';
    }
    // Decrement cooldown
    if (p._tackleCooldown > 0) p._tackleCooldown--;
  }

  decideGK(p, team) {
    // GK behaviour: stay on goal line by default; sweeper for through-balls;
    // drop on a save line when shot incoming. Owns ball → short pass to nearest defender.
    const ball = this.ball;
    const ownGoalX = p.side === 'home' ? 0 : 105;

    if (ball.ownerSide === p.side && ball.ownerNum === p.num) {
      // Have the ball — pass short to a defender
      const def = team.onPitch.find(x => ['CB','FB','DM'].includes(x.role) && !x.state.sentOff);
      if (def) {
        p.action = 'PASS';
        p.actionTimer = 3;
        p._passTargetNum = def.num;
        return;
      }
    }

    // Shot incoming?
    if (ball.pendingShot && ball.pendingShot.fromSide === other(p.side) && ball.inFlight) {
      // Predict where ball crosses goal line
      const dx = ball.vx;
      const sign = p.side === 'home' ? -1 : 1;
      // Time until ball.x reaches ownGoalX
      let t = 0;
      if (Math.abs(dx) > 0.3) t = (ownGoalX - ball.x) / dx;
      if (t < 0) t = 0;
      const predX = ball.x + ball.vx * t;
      const predY = ball.y + ball.vy * t;
      // Reaction delay scaled by reflexes (Sprint 2: simplistic)
      const reflexCoef = 1.6 - (p.attrs.reflexes || 70) * 0.012;  // 70 → 0.76, 90 → 0.52
      const reachTime = 0.4 * reflexCoef;
      if (t < reachTime + 0.6) {
        // Move to save point
        p.targetX = clamp(predX + (p.side === 'home' ? 0.4 : -0.4), p.side === 'home' ? 0.5 : 99, p.side === 'home' ? 6 : 104.5);
        p.targetY = clamp(predY, 28, 40);
        p.action = 'MOVE_TO_POSITION';
        return;
      }
    }

    // Through-ball / sweeper — ball loose and ahead of defenders, GK comes out
    if (!ball.ownerSide && ball.x > 8 && ball.x < 97) {
      const ballAhead = p.side === 'home' ? ball.x < 30 : ball.x > 75;
      if (ballAhead) {
        // Run out (limited to penalty area)
        const limitX = p.side === 'home' ? 16 : 89;
        p.targetX = (p.side === 'home') ? Math.min(ball.x - 1, limitX) : Math.max(ball.x + 1, limitX);
        p.targetY = clamp(ball.y, 24, 44);
        p.action = 'MOVE_TO_POSITION';
        return;
      }
    }

    // S71: sweeper-keeper deployment. When our team is attacking deep in the
    // opp half + defLine='high', GK steps out to the edge of the box / D so
    // they can read long balls early and start build-up. Was static on line —
    // now matches modern football's high-line philosophy.
    const ownTeamAttacking = ball.ownerSide === p.side;
    const ballDeepInOppHalf = p.side === 'home' ? ball.x > 75 : ball.x < 30;
    const highLine = team.tactics?.defLine === 'high';
    if (ownTeamAttacking && ballDeepInOppHalf && highLine) {
      const sweeperX = p.side === 'home' ? 18 : 87;
      p.targetX = sweeperX;
      p.targetY = clamp(34 + (ball.y - 34) * 0.10, 30, 38);
      p.action = 'MOVE_TO_POSITION';
      return;
    }

    // S71: claim-area for aerial balls. If ball is in flight overhead in our
    // box AND no defender / attacker has clear advantage, GK comes off the
    // line to collect. Increases command-of-area count.
    const inOurBox = p.side === 'home' ? ball.x < 16.5 : ball.x > 88.5;
    const ballInAir = ball.z > 1.0;
    const ballSlowEnough = Math.hypot(ball.vx, ball.vy) < 14;
    if (!ball.ownerSide && inOurBox && ballInAir && ballSlowEnough) {
      const cmdR = (p.attrs?.command_of_area ?? p.attrs?.handling ?? 65);
      if (cmdR > 60) {                                  // confident keepers only
        const limitX = p.side === 'home' ? 10 : 95;
        p.targetX = (p.side === 'home') ? Math.min(ball.x, limitX) : Math.max(ball.x, limitX);
        p.targetY = clamp(ball.y, 28, 40);
        p.action = 'MOVE_TO_POSITION';
        return;
      }
    }

    // Default: stand on goal line, slightly off-centre toward ball Y
    const baseX = p.side === 'home' ? (team.tactics.defLine === 'high' ? 8 : 4) : (team.tactics.defLine === 'high' ? 97 : 101);
    p.targetX = baseX;
    p.targetY = 30 + (ball.y - 30) * 0.18 + 3;
    p.targetY = clamp(p.targetY, 28, 40);
    p.action = 'MOVE_TO_POSITION';
  }

  decideSupport(p, team) {
    // Default: move to phase target_zone (already set by tactical layer).
    // STs and Wingers may make timed runs in behind during final-third attack.
    const ball = this.ball;
    const dir = p.side === 'home' ? 1 : -1;
    if ((p.role === 'ST' || p.role === 'W')) {
      const teamPhase = team.currentPhase;
      if (teamPhase === 'final' || teamPhase === 'progress') {
        // S72: only start a new run if we're currently onside. Was unguarded
        // so the engine sprang runs straight into offside positions, ballooning
        // offside count to 14+/match (real ~2).
        if (!p._runActive && this.rng() < 0.04 && !this.isOffside(p.side, p)) {
          p._runActive = 24 + Math.floor(this.rng() * 16);  // ticks of run
        }
      } else {
        p._runActive = 0;
      }
    }
    if (p._runActive > 0) {
      // Run target: hover AT (just behind) the offside line, ready to spring on a pass.
      const opp = this.teams[other(p.side)];
      let lineX;
      if (p.side === 'home') lineX = Math.max(...opp.onPitch.filter(o => o.role !== 'GK' && !o.state.sentOff).map(o => o.x));
      else lineX = Math.min(...opp.onPitch.filter(o => o.role !== 'GK' && !o.state.sentOff).map(o => o.x));
      // S72: target sits 4m ONSIDE of the offside line so a step-up by the
      // defenders doesn't immediately leave the runner offside. Previous 2m
      // buffer kept ~14 offsides/match (real ~2). Generates more sustained
      // chances since runners stay in legal positions longer.
      p.targetX = lineX - 4 * dir;
      p.targetY = clamp(p.slot.y * 68 + (this.rng() - 0.5) * 8, 5, 63);
      if (this.isOffside(p.side, p)) p._runActive = 0;
      else p._runActive--;
    }
    p.action = 'MOVE_TO_POSITION';
  }

  decideOnBall(p, team) {
    const goalX = p.side === 'home' ? 105 : 0;
    const distGoal = dist(p.x, p.y, goalX, 34);
    // Sprint 7: shot eligibility extended from "attacking third" to "within 32m of goal" —
    // covers long-range speculative attempts (utilityShoot internally caps at 32m).
    const canShoot = distGoal <= 32;

    // Utility comparison across all on-ball macroactions.
    const candidates = [
      canShoot ? this.utilityShoot(p) : { kind: 'SHOOT', score: 0 },
      this.utilityBestPass(p, team),
      this.utilityCross(p, team),
      this.utilityThroughBall(p, team),
      this.utilityDribble(p),
      this.utilityClear(p),
    ];
    let best = { kind: 'HOLD', score: 0 };
    for (const c of candidates) if (c && c.score > best.score) best = c;

    // S30: time_wasting — when leading late, raise minScore so HOLD is preferred
    // (slow play). Has no effect when drawing or losing.
    const tw = team.tactics?.timeWasting;
    let twHoldBoost = 0;
    if (tw && tw !== 'never') {
      const myScore = this.score?.[p.side] || 0;
      const oppScore = this.score?.[other(p.side)] || 0;
      const lead = myScore - oppScore;
      const lateGame = this.gameTime > 60 * 60;  // after 60'
      if (lead >= 1 && lateGame) {
        twHoldBoost = tw === 'often' ? 0.20 : 0.08;
      }
    }
    const inDangerZone = distGoal < 16;
    // Outside-box shots require a higher utility score so the AI doesn't
    // waste possession with 30m hopeful shots that fly out for a goal kick.
    const minScore = (best.kind === 'SHOOT' ? (inDangerZone ? 0.02 : 0.15) : 0.15) + twHoldBoost;
    if (best.score < minScore) {
      p.action = 'HOLD';
      p.actionTimer = 5;
      return;
    }

    switch (best.kind) {
      case 'SHOOT':
        p.action = 'SHOOT';
        p.actionTimer = 4;
        p._aimX = goalX;
        p._aimY = 34 + (this.rng() - 0.5) * 6;
        p._aimZ = 0.8 + this.rng() * 1.2;
        break;
      case 'DRIBBLE':
        p.action = 'DRIBBLE';
        p.actionTimer = 8;
        p._dribbleTargetX = best.toX;
        p._dribbleTargetY = best.toY;
        if (p?.state?.actions) p.state.actions.dribbles++;   // S81 — attempted
        break;
      case 'CROSS':
        p.action = 'CROSS';
        p.actionTimer = 4;
        p._aimX = best.targetX;
        p._aimY = best.targetY;
        break;
      case 'THROUGH_BALL':
        p.action = 'THROUGH_BALL';
        p.actionTimer = 3;
        p._aimX = best.targetX;
        p._aimY = best.targetY;
        p._passTargetNum = best.targetNum;
        break;
      case 'CLEAR':
        p.action = 'CLEAR';
        p.actionTimer = 3;
        break;
      case 'PASS':
      default:
        p.action = 'PASS';
        p.actionTimer = 3;
        p._passTargetNum = best.targetNum;
        break;
    }
  }

  // ---- Utility: CROSS ----
  utilityCross(p, team) {
    const dir = p.side === 'home' ? 1 : -1;
    const goalX = p.side === 'home' ? 105 : 0;
    const distGoal = dist(p.x, p.y, goalX, 34);
    const onFlank = p.y < 18 || p.y > 50;
    const inAtkHalf = p.side === 'home' ? p.x > 60 : p.x < 45;
    if (!onFlank || !inAtkHalf) return { kind: 'CROSS', score: 0 };
    // Count teammates inside opp box for header
    let inBoxCount = 0;
    for (const m of team.onPitch) {
      if (m.num === p.num || m.state.sentOff || m.role === 'GK') continue;
      const inBox = (p.side === 'home' && m.x > 88 && m.y > 14 && m.y < 54) ||
                    (p.side === 'away' && m.x < 17 && m.y > 14 && m.y < 54);
      if (inBox) inBoxCount++;
    }
    if (inBoxCount === 0) return { kind: 'CROSS', score: 0 };
    let score = 0.6 + inBoxCount * 0.30 + (passRating(p, 'short') - 70) * 0.005 - Math.max(0, distGoal - 25) * 0.012;
    // S27: winger / wing_back cross more.
    score *= 1 + _roleBias(p, 'cross');
    // S28: team-level cross_freq tactic.
    const cF = team.tactics?.crossFreq;
    score *= cF === 'often' ? 1.5 : cF === 'rare' ? 0.5 : 1.0;
    // Target in box: 11m line with random Y bias
    const targetX = goalX - 11 * dir;
    const targetY = 34 + (this.rng() - 0.5) * 8;
    return { kind: 'CROSS', score, targetX, targetY };
  }

  // ---- Utility: THROUGH_BALL ----
  utilityThroughBall(p, team) {
    const dir = p.side === 'home' ? 1 : -1;
    const opp = this.teams[other(p.side)];
    const oppFieldPlayers = opp.onPitch.filter(o => !o.state.sentOff && o.role !== 'GK');
    if (oppFieldPlayers.length === 0) return { kind: 'THROUGH_BALL', score: 0 };
    const oppLineX = p.side === 'home'
      ? Math.max(...oppFieldPlayers.map(o => o.x))
      : Math.min(...oppFieldPlayers.map(o => o.x));
    let best = { kind: 'THROUGH_BALL', score: 0 };
    for (const m of team.onPitch) {
      if (m.num === p.num || m.state.sentOff || m.role === 'GK') continue;
      if (!['ST', 'W', 'AM'].includes(m.role)) continue;
      // Through-ball — receiver should be onside at kick moment (offside check fires
      // at receive moment if they're caught past the line; AI shouldn't intentionally
      // play offside passes).
      if (this.isOffside(p.side, m)) continue;
      const ahead = (m.x - p.x) * dir;
      if (ahead < 4) continue;                                       // not forward enough
      const distToM = dist(p.x, p.y, m.x, m.y);
      if (distToM > 30) continue;
      // Target = ahead of teammate, just on or past defender line
      const leadX = (p.side === 'home' ? Math.max(m.x + 4, oppLineX + 1) : Math.min(m.x - 4, oppLineX - 1));
      const leadY = clamp(m.y + (m.vy * 0.4), 5, 63);
      // Teammate in motion is bonus (running into space)
      const teamSpeed = Math.hypot(m.vx, m.vy);
      let score = 0.5 + teamSpeed * 0.10 + ((p.attrs.vision || 70) - 70) * 0.008 - Math.max(0, distToM - 20) * 0.04;
      // S27: deep_lying_playmaker / advanced_playmaker / trequartista play more through-balls.
      score *= 1 + _roleBias(p, 'pass_through');
      if (score > best.score) {
        best = { kind: 'THROUGH_BALL', score, targetX: leadX, targetY: leadY, targetNum: m.num };
      }
    }
    return best;
  }

  // ---- Utility: CLEAR ----
  utilityClear(p) {
    if (!['CB', 'FB', 'DM'].includes(p.role)) return { kind: 'CLEAR', score: 0 };
    const ownGoalX = p.side === 'home' ? 0 : 105;
    const distOwnGoal = Math.abs(p.x - ownGoalX);
    if (distOwnGoal > 25) return { kind: 'CLEAR', score: 0 };
    const opp = this.teams[other(p.side)];
    let nearestOpp = 99;
    for (const o of opp.onPitch) {
      if (o.state.sentOff) continue;
      const d = dist(p.x, p.y, o.x, o.y);
      if (d < nearestOpp) nearestOpp = d;
    }
    if (nearestOpp > 4) return { kind: 'CLEAR', score: 0 };
    const press = clamp(1 - nearestOpp / 4, 0, 1);
    const distFactor = clamp(1 - distOwnGoal / 25, 0, 1);
    // Composed defenders prefer to play out instead of hoof; rushed defenders clear.
    let score = press * 0.85 + distFactor * 0.55 - ((p.attrs.composure || 70) - 70) * 0.006;
    // S27: no_nonsense_defender clears more; ball_playing_defender slightly less.
    score *= 1 + _roleBias(p, 'clear');
    return { kind: 'CLEAR', score };
  }

  utilityDribble(p) {
    const dir = p.side === 'home' ? 1 : -1;
    const aheadX = p.x + 8 * dir;
    const aheadY = p.y;
    // How much open space ahead?
    const opp = this.teams[other(p.side)];
    let nearestAhead = 99;
    for (const o of opp.onPitch) {
      if (o.state.sentOff) continue;
      const ahead = (o.x - p.x) * dir;
      if (ahead < 0 || ahead > 12) continue;
      const lateral = Math.abs(o.y - p.y);
      if (lateral > 4) continue;
      const d = dist(p.x, p.y, o.x, o.y);
      if (d < nearestAhead) nearestAhead = d;
    }
    const space = clamp(nearestAhead - 1.5, 0, 8);
    const score = (space / 8) * (0.5 + (dribbleRating(p) - 60) * 0.012);
    // Bonus when in attacking third (cut into box)
    const inAtkThird = p.side === 'home' ? p.x > 70 : p.x < 35;
    // Sprint 16: kill dribble bonus inside the penalty box and halve raw score —
    // real attackers shoot or pass in the box, not dribble. Was overriding SHOOT
    // utility 8:1 in tight close-range scenarios → 0 open-play shots.
    const goalX = p.side === 'home' ? 105 : 0;
    const distGoalDr = Math.hypot(p.x - goalX, p.y - 34);
    const inBoxDr = distGoalDr < 16;
    const finalBonus = (inAtkThird && !inBoxDr) ? 0.2 : 0;
    const inBoxMul = inBoxDr ? 0.4 : 1.0;
    let dribbleScore = score * inBoxMul + finalBonus;
    // S27: trequartista / inverted_winger dribble more; no_nonsense_defender less.
    dribbleScore *= 1 + _roleBias(p, 'dribble');
    // S28: team-level dribbling_freq tactic.
    const team = this.teams[p.side];
    const dF = team.tactics?.dribblingFreq;
    const dribbleMul = dF === 'often' ? 1.5 : dF === 'rare' ? 0.5 : 1.0;
    dribbleScore *= dribbleMul;
    return { kind: 'DRIBBLE', score: dribbleScore, toX: aheadX, toY: aheadY };
  }

  utilityShoot(p) {
    const goalX = p.side === 'home' ? 105 : 0;
    const distGoal = dist(p.x, p.y, goalX, 34);
    if (distGoal > 32) return { kind: 'SHOOT', score: 0 };
    // Approx xG calibrated to real football: avg ≈ 0.10, peaks ≈ 0.35 in 6-yard box.
    const xGRaw = 0.13 * Math.exp(-(distGoal - 6) / 7.5) + (shootRating(p, distGoal) - 70) * 0.0018;
    const xG = clamp(xGRaw, 0.02, 0.24);
    // Pressure penalty — uses noisy opp positions (perception model)
    const opp = this.teams[other(p.side)];
    let minOppDist = 99;
    for (const o of opp.onPitch) {
      if (o.state.sentOff) continue;
      const np = this.perceivedPos(p, o);
      const d = dist(p.x, p.y, np.x, np.y);
      if (d < minOppDist) minOppDist = d;
    }
    const press = Math.max(0, 1 - minOppDist / 4);
    // In-the-box bonus so strikers actually shoot when given a chance.
    const inBox = distGoal < 16;
    const inSixYard = distGoal < 8;
    // Sprint 15: tone down box bonus (was 0.28/0.14) — was inflating average xG
    // per shot to 0.34, way above real ~0.10. Lower bonus encourages variety
    // (some long-range, some passes from box) rather than always shooting in box.
    // Second pass: lowered further (was 0.16/0.08) to hit avg xG ~0.15.
    const boxBonus = inSixYard ? 0.10 : (inBox ? 0.05 : 0);
    // Sprint 16 (Lever 4): in-box pressure penalty halved — players shoot
    // through tight space more often instead of always passing out. Boosts
    // open-play shot rate from box.
    const pressMul = inBox ? 0.25 : 0.5;
    // Sprint 7: long-range speculative bias — players willing to shoot from outside the box
    // when conditions allow (low pressure, decent shooting). Real football: ~30% of shots
    // come from outside the box. Bias scales with shooting attribute.
    const longRange = distGoal >= 18 && distGoal <= 32;
    const longShotR = shootRating(p, distGoal);
    // S28: team-level long_shot_freq tactic — drives bias for any long-range
    // chance (no longer gated on longShotR≥70 so the dial actually moves the needle).
    const team = this.teams[p.side];
    const lsF = team.tactics?.longShotFreq;
    const lsMul = lsF === 'often' ? 2.4 : lsF === 'rare' ? 0.4 : 1.0;
    const longRangeBias = longRange ? Math.max(0, (longShotR - 60) * 0.010 * lsMul) : 0;
    // S72: shoot-vs-pass scoring. S64 dropped to 1.0 which over-corrected →
    // engine took 6.5 shots/team vs real ~13. Bumped to 1.5 + raised box bonus
    // to bring shot frequency closer to real-football. Goals stay realistic via
    // S64 wide-miss gate + accuracy noise.
    let score = xG * 1.5 + boxBonus + longRangeBias - press * pressMul;
    // S27: role bias — poacher / advanced_forward / shadow_striker shoot more often.
    score *= 1 + _roleBias(p, 'shoot');
    // S27: in_box bonus for poacher-style roles when inside the area.
    if (distGoal < 16) score += _roleBias(p, 'in_box');
    // S28: longShotFreq multiplies the whole shoot score in long-range zone so
    // the dial moves total long-range output, not just a small additive bias.
    if (longRange) score *= lsMul;
    return { kind: 'SHOOT', score, xG };
  }

  utilityBestPass(p, team) {
    let best = { kind: 'PASS', score: 0, targetNum: null };
    const dir = p.side === 'home' ? 1 : -1;
    const opp = this.teams[other(p.side)];
    for (const m of team.onPitch) {
      if (m.num === p.num || m.state.sentOff || m.role === 'GK') continue;
      // Don't pass to teammates currently in offside positions.
      if (this.isOffside(p.side, m)) continue;
      const progress = (m.x - p.x) * dir;
      const distToM = dist(p.x, p.y, m.x, m.y);
      if (distToM < 4) continue;
      if (distToM > 45) continue;
      // Tight-marking penalty (perceived through passer's eyes — noisy)
      let mark = 99;
      for (const o of opp.onPitch) {
        if (o.state.sentOff) continue;
        const np = this.perceivedPos(p, o);
        const d = dist(m.x, m.y, np.x, np.y);
        if (d < mark) mark = d;
      }
      const markPenalty = Math.max(0, 1 - mark / 5);
      // Lane-blocked penalty — count opponents within 2m of the pass line.
      let blockers = 0;
      for (const o of opp.onPitch) {
        if (o.state.sentOff) continue;
        const ox = o.x - p.x, oy = o.y - p.y;
        const dx = m.x - p.x, dy = m.y - p.y;
        const lenSq = dx * dx + dy * dy;
        if (lenSq < 1) continue;
        const t = clamp((ox * dx + oy * dy) / lenSq, 0, 1);
        const proj = { x: p.x + dx * t, y: p.y + dy * t };
        const dline = dist(o.x, o.y, proj.x, proj.y);
        if (dline < 2.2 && t > 0.05 && t < 0.95) blockers++;
      }
      const lanePenalty = blockers * 1.1;
      // S28: passing setting scales distance threshold (long/direct accept longer
      // passes; short heavily penalizes anything beyond ~18m) and direct boosts
      // forward-progress weight.
      const passSet = team.tactics?.passing;
      const passT = (passSet === 'long' || passSet === 'direct') ? 28 : passSet === 'short' ? 18 : 22;
      const progMul = passSet === 'direct' ? 1.6 : passSet === 'short' ? 0.6 : 1.0;
      // S68: pass-to-runner anticipation. Teammate making a timed run (set by
      // decideSupport/transAtk) gets a big bonus on the carrier's pass scorer,
      // so the on-ball player actually finds the runner instead of choosing a
      // safer sideways option. Bonus is amplified when the runner is making
      // forward progress relative to the carrier (real "in behind" pass).
      let runBonus = 0;
      if ((m._runActive || 0) > 0) {
        const forward = progress > 4;
        runBonus = forward ? 0.8 : 0.35;
      }
      // S72: base 1 → 0.75 — pass utility was structurally too high, pushing
      // shoot below pass even for clean shooting chances.
      const score = (0.75 + Math.max(0, progress) * 0.05 * progMul)
        + runBonus
        - markPenalty * 0.5
        - lanePenalty
        - (distToM > passT ? (distToM - passT) * 0.04 : 0);
      if (score > best.score) {
        best = { kind: 'PASS', score, targetNum: m.num, targetX: m.x, targetY: m.y };
      }
    }
    return best;
  }

  // Sprint 8: ETA from player to ball, factoring carrier motion, facing, and stamina.
  // Used by team-state to pick the single first-defender per team. Lower ETA = better candidate.
  _computeEta(p, ball, carrier) {
    const playerSpeed = (7 + speedRating(p) * 0.05) * PLAYER_SPEED_SCALE; // ~10.5 m/s top × scale
    const dxy = dist(p.x, p.y, ball.x, ball.y);
    let eta = dxy / playerSpeed;
    if (carrier) {
      // Carrier moving fast: harder to catch from open angle.
      const carrierSpeed = Math.hypot(carrier.vx, carrier.vy);
      if (carrierSpeed > 3) eta += carrierSpeed * 0.05;
      // Carrier facing own goal (back to attacking dir): easier to press from behind → bonus.
      const oppDir = carrier.side === 'home' ? 1 : -1;
      const facingForward = Math.cos(carrier.facing) * oppDir > 0.3;
      if (!facingForward) eta -= 0.3;
    }
    // Stamina factor — tired player is slower
    const stam = (p.state?.stamina || 80) / 80;
    eta = eta / Math.max(0.6, stam);
    return eta;
  }

  // Sprint 13: second defender — second-best ETA, excluding first defender.
  // Same role gate (CB only when ball deep). Used during press triggers — when
  // pressTrigger is active, this player also enters PRESS_BALL_CARRIER instead
  // of holding tactical position. Off-trigger they stay in MOVE_TO_POSITION.
  _selectSecondDefender(defendingSide, firstDefenderId) {
    const ball = this.ball;
    if (ball.ownerSide !== other(defendingSide)) return null;
    if (firstDefenderId == null) return null;
    const carrier = this.teams[other(defendingSide)].onPitch.find(x => x.num === ball.ownerNum);
    if (!carrier) return null;
    const ballDeep = defendingSide === 'home' ? ball.x < 35 : ball.x > 70;
    const team = this.teams[defendingSide];
    let best = null, bestEta = 99;
    for (const p of team.onPitch) {
      if (p.state.sentOff || p.role === 'GK') continue;
      if (p.num === firstDefenderId) continue;
      if (p.role === 'CB' && !ballDeep) continue;
      const eta = this._computeEta(p, ball, carrier);
      if (eta < bestEta) { bestEta = eta; best = p; }
    }
    return best ? best.num : null;
  }

  // Sprint 13: detect press triggers. Returns trigger type or null.
  // Implements 2 triggers from doc: back_pass and wide_trap. Other triggers
  // (bad_touch, long_ball, opp_facing_own_goal) are deferred — these two cover
  // the most visible cases and validate the architecture.
  _detectPressTrigger(defendingSide) {
    const ball = this.ball;
    const oppSide = other(defendingSide);
    if (ball.ownerSide !== oppSide) return null;
    // back_pass: opponent has ball, ball moving toward their own goal at meaningful speed.
    const oppOwnGoalX = oppSide === 'home' ? 0 : 105;
    const dirToOppGoal = oppOwnGoalX - ball.x;
    const ballSpeedX = Math.abs(ball.vx);
    if (ballSpeedX > 5 && Math.sign(ball.vx) === Math.sign(dirToOppGoal)) {
      return 'back_pass';
    }
    // wide_trap: ball wide on the touchline AND in our pressing zone (mid-third).
    const ballWide = ball.y < 12 || ball.y > 56;
    const trapZone = defendingSide === 'home'
      ? (ball.x > 30 && ball.x < 80)
      : (ball.x > 25 && ball.x < 75);
    if (ballWide && trapZone) {
      return 'wide_trap';
    }
    return null;
  }

  // Sprint 8: pick the single first defender for `defendingSide` based on ETA + role gate.
  // Returns the player number, or null if no eligible defender (e.g., own team has the ball).
  _selectFirstDefender(defendingSide) {
    const ball = this.ball;
    if (ball.ownerSide !== other(defendingSide)) return null;  // we have it / loose
    const carrier = this.teams[other(defendingSide)].onPitch.find(x => x.num === ball.ownerNum);
    if (!carrier) return null;
    const team = this.teams[defendingSide];
    // S28: pressHeight scales the "ball deep" threshold — high block lets CBs/mids
    // press further up the pitch; low block keeps them deep.
    const pressH = team.tactics?.pressHeight;
    const deepThr = pressH === 'high' ? 49 : pressH === 'low' ? 21 : 35;
    const ballDeep = defendingSide === 'home' ? ball.x < deepThr : ball.x > (105 - deepThr);
    let best = null, bestEta = 99;
    for (const p of team.onPitch) {
      if (p.state.sentOff || p.role === 'GK') continue;
      if (p.role === 'CB' && !ballDeep) continue;
      const eta = this._computeEta(p, ball, carrier);
      // S27: pressing_forward / ball_winning_midfielder reach ball faster (effective ETA reduced).
      const adjEta = eta * (1 - Math.min(0.3, _roleBias(p, 'press')));
      if (adjEta < bestEta) { bestEta = adjEta; best = p; }
    }
    return best ? best.num : null;
  }

  closestDefenderNum(defendingSide, bx, by) {
    const team = this.teams[defendingSide];
    let best = null, bestD = 999;
    for (const p of team.onPitch) {
      if (p.state.sentOff || p.role === 'GK') continue;
      const d = dist(p.x, p.y, bx, by);
      if (d < bestD) { bestD = d; best = p; }
    }
    return best ? best.num : null;
  }

  // Predict where the in-flight ball will land (z=0) given current velocity / drag / gravity.
  // Cheap analytic estimate using current vz and gravity for time-to-ground; ignores air drag.
  predictBallTouchdown() {
    const b = this.ball;
    if (!b.inFlight) return { x: b.x, y: b.y };
    let timeToGround;
    if (b.z <= 0.05 && b.vz <= 0.5) {
      // rolling — use velocity decay; estimate ~0.6s of further roll
      timeToGround = 0.6;
    } else {
      // (vz)t - 0.5 g t^2 + z = 0 → solve for t (positive root)
      const a = 0.5 * BALL_GRAVITY;
      const bq = b.vz;
      const c = b.z;
      const disc = bq * bq + 4 * a * c;
      if (disc < 0) timeToGround = 0;
      else timeToGround = (bq + Math.sqrt(disc)) / (2 * a);
    }
    return { x: b.x + b.vx * timeToGround, y: b.y + b.vy * timeToGround };
  }

  willReachBallFirst(p, side) {
    // Approximate: predict ball stop position vs player ETA. Player must beat
    // BOTH the best opponent AND the best teammate — otherwise the team
    // commits 5-6 players to the same loose ball and ends up swarming.
    const ball = this.ball;
    const myEta = dist(p.x, p.y, ball.x, ball.y) / Math.max(2, speedRating(p) / 12);
    const opp = this.teams[other(side)];
    let oppEta = 99;
    for (const o of opp.onPitch) {
      if (o.state.sentOff) continue;
      const e = dist(o.x, o.y, ball.x, ball.y) / Math.max(2, speedRating(o) / 12);
      if (e < oppEta) oppEta = e;
    }
    const mine = this.teams[side];
    let bestMyEta = myEta;
    for (const m of mine.onPitch) {
      if (m.state.sentOff || m.num === p.num) continue;
      const e = dist(m.x, m.y, ball.x, ball.y) / Math.max(2, speedRating(m) / 12);
      if (e < bestMyEta) bestMyEta = e;
    }
    return myEta < oppEta && myEta <= bestMyEta;
  }

  // ----------------------------------------------------------------------
  // ACTION EXECUTION (every tick)
  // ----------------------------------------------------------------------

  executeAction(p, team) {
    if (p.actionTimer > 0) p.actionTimer--;

    switch (p.action) {
      case 'MOVE_TO_POSITION': {
        const onActiveRun = (p._runActive || 0) > 0;
        if (!onActiveRun) {
          // S67: scan micro-movement. When idle at anchor, add a tiny oscillation
          // to the target so players visibly fidget / scan / sidestep instead of
          // freezing like statues. Period varies per player so they don't sync.
          const phase = (this.tickCount + (p.num || 0) * 7) / 22;
          const jx = Math.sin(phase) * 0.7;
          const jy = Math.cos(phase * 1.3 + (p.num || 0) * 0.3) * 0.6;
          p.targetX = p.anchor.x + jx;
          p.targetY = p.anchor.y + jy;
          const distFromAnchor = Math.hypot(p.x - p.anchor.x, p.y - p.anchor.y);
          const myTeam = this.teams[p.side];
          const inAtkPhase = myTeam.currentPhase === 'final' || myTeam.currentPhase === 'progress';
          const isAttacker = p.role === 'ST' || p.role === 'W' || p.role === 'AM';
          const effLeash = (inAtkPhase && isAttacker) ? p.leashRadius * 2 : p.leashRadius;
          if (distFromAnchor > effLeash) {
            p.recoveryState = 'tracking_back';
          } else if (p.recoveryState === 'tracking_back' && distFromAnchor < effLeash * 0.7) {
            p.recoveryState = null;
          }
        }
        const sprint = !onActiveRun && p.recoveryState === 'tracking_back';
        this.actMoveToTarget(p, sprint);
        break;
      }
      case 'PRESS_BALL_CARRIER':
        p.targetX = this.ball.x;
        p.targetY = this.ball.y;
        this.actMoveToTarget(p, true);
        break;
      case 'INTERCEPT':
        // Move to predicted ball position
        const tau = 0.5;
        p.targetX = this.ball.x + this.ball.vx * tau;
        p.targetY = this.ball.y + this.ball.vy * tau;
        this.actMoveToTarget(p, true);
        break;
      case 'SHOOT':
        this.actShoot(p);
        break;
      case 'PASS':
        this.actPass(p, team);
        break;
      case 'DRIBBLE':
        this.actDribble(p, team);
        break;
      case 'TACKLE':
        this.actTackle(p, team);
        break;
      case 'CROSS':
        this.actCross(p);
        break;
      case 'THROUGH_BALL':
        this.actThroughBall(p, team);
        break;
      case 'CLEAR':
        this.actClear(p);
        break;
      case 'HOLD':
        // Light deceleration during settle — keeps a bit of forward momentum
        // so reception doesn't look like a dead stop. decideAction picks the
        // next move on the next cycle (~4 ticks).
        p.vx *= 0.88; p.vy *= 0.88;
        if (p.actionTimer <= 0) p.action = 'IDLE';
        break;
      case 'IDLE':
      default:
        this.actMoveToTarget(p, false);
        break;
    }
  }

  actMoveToTarget(p, sprint) {
    const dx = p.targetX - p.x;
    const dy = p.targetY - p.y;
    const d = Math.hypot(dx, dy);
    if (d < 0.4) {
      // close enough, decelerate
      p.vx *= 0.6; p.vy *= 0.6;
      return;
    }
    // Max speed from attrs
    const fitnessMod = 0.7 + 0.3 * (p.state.fitness / 100);
    const baseSpeed = (3 + speedRating(p) * 0.07) * fitnessMod * PLAYER_SPEED_SCALE;  // m/s, ~3-9.5 × scale
    const vmax = sprint ? baseSpeed : baseSpeed * 0.78;
    const accel = 12;  // m/s²
    // Desired velocity
    const ux = dx / d, uy = dy / d;
    const desiredVx = ux * vmax;
    const desiredVy = uy * vmax;
    // Approach desired velocity
    p.vx += (desiredVx - p.vx) * Math.min(1, accel * DT);
    p.vy += (desiredVy - p.vy) * Math.min(1, accel * DT);
    // Cap
    const speed = Math.hypot(p.vx, p.vy);
    if (speed > vmax) { p.vx *= vmax / speed; p.vy *= vmax / speed; }
    // Update facing
    p.facing = Math.atan2(p.vy, p.vx);
  }

  actShoot(p) {
    // Multi-tick: ticks 4..2 = wind-up (slow down, face goal), tick 1 = strike
    const dir = p.side === 'home' ? 1 : -1;
    const goalX = p.side === 'home' ? 105 : 0;
    p.vx *= 0.4; p.vy *= 0.4;
    p.facing = Math.atan2(34 - p.y, goalX - p.x);
    if (p.actionTimer === 0) {
      // Strike
      const aimX = p._aimX, aimY = p._aimY, aimZ = p._aimZ;
      const dx = aimX - p.x, dy = aimY - p.y;
      const dxy = Math.hypot(dx, dy);
      const distGoal = Math.abs(goalX - p.x);
      const sR = shootRating(p, distGoal);
      const power = 22 + (sR - 70) * 0.18 + (this.rng() - 0.5) * 4;
      // Sprint 15: angular accuracy noise — replaces previous additive-Y model.
      // S32: fitness widens shot noise — tired players miss more.
      // S64: explicit wide-miss gate.
      // S72: + pressure-based miss (defender close to shooter) and composure/
      // fitness-based noise amplification. Real shooters under pressure miss
      // the frame far more often than clean-look shooters.
      let minOppDist = 99;
      const oppTeam = this.teams[other(p.side)];
      for (const o of oppTeam.onPitch) {
        if (o.state.sentOff) continue;
        const d = dist(p.x, p.y, o.x, o.y);
        if (d < minOppDist) minOppDist = d;
      }
      const pressure = Math.max(0, 1 - minOppDist / 3.5);       // 0..1, 1 = opp right on shooter
      const compR = (p.attrs?.composure ?? 65);
      const composureFactor = (75 - compR) / 100;               // negative for elite (>75), positive for poor
      // S78: shooter's accumulated pressure (from previous pass / receive) adds
      // directly to the miss probability. A 35% inherited-pressure shot adds
      // +14 % wide-miss chance.
      const inheritedPressureFactor = (p.state.pressure || 0) / 100;  // 0..0.5
      // Distance gate — close-range shots should be FAR more accurate. A
      // striker 8m out shouldn't blast 15m wide of an open goal. Scales the
      // wide-miss probability and the wide-miss magnitude down for close shots.
      // Distance gate — close shots more accurate than long shots, but not
      // free goals: floor at 0.45 so 6-yard chances still have ~25-30% miss
      // rate (matching real-football conversion).
      const distFactor = clamp((distGoal - 4) / 22, 0.45, 1.0);
      const wideMissProb = Math.min(0.85 * distFactor,
        (0.18 +
        Math.max(0, distGoal - 8) * 0.022 +
        (90 - sR) * 0.005 +
        pressure * 0.30 +
        Math.max(0, composureFactor) * 0.5 +
        inheritedPressureFactor * 0.40                          // S78: carried pressure
        ) * distFactor
      );
      let aimAdjY = 0;
      if (this.rng() < wideMissProb) {
        const wideSide = this.rng() < 0.5 ? -1 : 1;
        const mag = (4 + this.rng() * 10) * distFactor + 2;
        aimAdjY = wideSide * mag;
      }
      const adjAimY = aimY + aimAdjY;
      const adx = goalX - p.x, ady = adjAimY - p.y;
      const composureMul = clamp(1 + (75 - compR) / 80, 0.8, 1.6);
      const baseAngular = (1.0 - sR / 100) * 1.4 * composureMul / _fitMul(p) * distFactor;
      const noiseAngle = (this.rng() - 0.5) * baseAngular;
      const aimAngle = Math.atan2(ady, adx) + noiseAngle;
      const noiseZ = (this.rng() - 0.5) * 0.5;
      // Set ball velocity using perturbed angle
      this.ball.vx = Math.cos(aimAngle) * power;
      this.ball.vy = Math.sin(aimAngle) * power;
      this.ball.vz = Math.max(0, aimZ + noiseZ) * 4;
      this.ball.x = p.x + Math.cos(aimAngle) * 0.6;
      this.ball.y = p.y + Math.sin(aimAngle) * 0.6;
      this.ball.z = 0.2;
      this.ball.ownerSide = null;
      this.ball.ownerNum = null;
      this.ball.lastTouchSide = p.side;
      this.ball.lastTouchNum = p.num;
      this.ball.inFlight = true;
      this.lastPossessionChange = this.tickCount;

      const xGEst = this.utilityShoot(p).xG || 0.05;
      const oppTeam2 = this.teams[other(p.side)];
      const gk2 = oppTeam2.onPitch.find(pl => pl.role === 'GK' && !pl.state.sentOff);
      const shotIdx = this._logShot({ p, distGoal, xG: xGEst, shotType: 'foot', gkName: gk2?.name });
      this.ball.pendingShot = {
        fromSide: p.side, fromNum: p.num,
        kickTick: this.tickCount,
        xG: xGEst,
        distGoal,
        shooterName: p.name,
        shotIdx,
      };
      this.ball.pendingPass = null;
      this.stats[p.side].shots++;
      this.stats[p.side].xg += xGEst;
      if (p?.state?.actions) p.state.actions.shotsTaken++;   // S81
      this._detectChanceCreatedAndKeyPass(this.ball.pendingShot);
      this.log({
        type: 'shot', side: p.side,
        text: `${p.name} (${this.teams[p.side].meta.short}) бʼє з ${distGoal.toFixed(0)}м. xG ${xGEst.toFixed(2)}.`,
      });
      p.action = 'IDLE';
    }
  }

  // S80: log a successful ball-recovery (tackle / interception / loose-ball
  // win) for the team-vector accumulators. X position is normalised at
  // getStats() time relative to the team's attacking direction.
  _logRecovery(side, x) {
    if (!this._recoveryX[side]) return;
    this._recoveryX[side].push(x);
  }

  // S79: log a shot record and return its index. The caller stores the index
  // on `ball.pendingShot.shotIdx`; the resolution paths (goal, save, post,
  // off-target, blocked) look it up and set `result`. Pressure is captured
  // BEFORE the shot to reflect "what state the shooter was in".
  _logShot({ p, distGoal, xG, shotType, gkName }) {
    const goalX = p.side === 'home' ? 105 : 0;
    // Angle subtended by the goal mouth from the shooter's position.
    // Wider = more goal to aim at; narrow = tight angle (corner).
    const dxToGoal = Math.abs(goalX - p.x);
    const angleTop = Math.atan2(GOAL_Y_TOP - p.y, dxToGoal);
    const angleBot = Math.atan2(GOAL_Y_BOT - p.y, dxToGoal);
    const angleDeg = Math.abs(angleBot - angleTop) * 180 / Math.PI;
    // GK skill that matters most depends on distance.
    const gkSkillUsed = distGoal <= 15 ? 'reflexes' : 'positioning';
    const rec = {
      time: this.gameTime,
      side: p.side,
      shooterName: p.name,
      shooterNum: p.num,
      shooterPos: p.role,
      shotType,
      distGoal: +distGoal.toFixed(1),
      angleDeg: +angleDeg.toFixed(1),
      pressure: Math.round(p.state.pressure || 0),
      xG: +xG.toFixed(3),
      gkName: gkName || '—',
      gkSkillUsed,
      result: 'pending',
    };
    this.shots.push(rec);
    return this.shots.length - 1;
  }

  // Spectacular detectors that fire at the moment the shot is taken (not when it resolves).
  // Called from open-play shoot, penalty, direct free-kick, and attacking header.
  _detectChanceCreatedAndKeyPass(ps) {
    if (!ps) return;
    if (ps.xG >= 0.30) {
      this.log({
        type: 'spectacular', side: ps.fromSide, kind: 'BIG_CHANCE_CREATED',
        text: `🎯 ВЕЛИКИЙ ШАНС — ${ps.shooterName} вийшов чисто. xG ${ps.xG.toFixed(2)}.`,
      });
    }
    if (this.lastReceivedPass && this.lastReceivedPass.receiverNum === ps.fromNum
        && this.tickCount - this.lastReceivedPass.tick < 80
        && this.lastReceivedPass.passerSide === ps.fromSide) {
      const lp = this.lastReceivedPass;
      this.log({
        type: 'spectacular', side: ps.fromSide, kind: 'KEY_PASS',
        text: `🔑 Ключова передача ${lp.passerName} → удар ${lp.receiverName}.`,
      });
    }
  }

  actDribble(p, team) {
    // Run with ball — set targetX/Y ahead of self, sprint there
    p.targetX = p._dribbleTargetX;
    p.targetY = p._dribbleTargetY;
    this.actMoveToTarget(p, true);
    if (p.actionTimer === 0) {
      // S81: dribble counted as completed if player still owns the ball when
      // the action expires (i.e. wasn't tackled/dispossessed during the run).
      if (this.ball.ownerSide === p.side && this.ball.ownerNum === p.num) {
        if (p?.state?.actions) p.state.actions.dribblesCompleted++;
      }
      p.action = 'IDLE';
    }
  }

  actCross(p) {
    // 4-tick prep: face target, decel; final tick = lofted delivery into box.
    p.vx *= 0.55; p.vy *= 0.55;
    p.facing = Math.atan2(p._aimY - p.y, p._aimX - p.x);
    if (p.actionTimer === 0) {
      const dx = p._aimX - p.x, dy = p._aimY - p.y;
      const dxy = Math.hypot(dx, dy) || 1;
      const power = clamp(dxy * 1.05, 14, 24);
      // S32: fitness scales pass noise — fatigued passes drift wider.
      const noise = (this.rng() - 0.5) * Math.max(0.05, 0.18 - passRating(p, 'short') * 0.0012) / _fitMul(p);
      const ang = Math.atan2(dy, dx) + noise;
      this.ball.vx = Math.cos(ang) * power;
      this.ball.vy = Math.sin(ang) * power;
      this.ball.vz = 5.0;            // high lofted cross
      this.ball.x = p.x + Math.cos(ang) * 0.7;
      this.ball.y = p.y + Math.sin(ang) * 0.7;
      this.ball.z = 0.4;
      this.ball.ownerSide = null; this.ball.ownerNum = null;
      this.ball.lastTouchSide = p.side; this.ball.lastTouchNum = p.num;
      this.ball.inFlight = true;
      this.ball.pendingShot = null;
      // S78: crosses are high-risk by definition — base difficulty 0.45 + passer pressure
      const crossDifficulty = clamp(0.45 + (p.state.pressure || 0) / 100 * 0.5, 0, 0.85);
      this.ball.pendingPass = {
        fromSide: p.side, fromNum: p.num,
        targetSide: p.side, targetNum: -1,
        kickTick: this.tickCount, type: 'cross',
        difficulty: crossDifficulty,
      };
      this.stats[p.side].passes++;
      p.state.actions.crosses++;         // S81
      this.log({ type: 'event', side: p.side, text: `${p.name} навішує у штрафний.` });
      p.action = 'IDLE';
    }
  }

  actThroughBall(p, team) {
    // 3-tick prep + ground pass leading the runner; offside-checked at strike.
    p.vx *= 0.6; p.vy *= 0.6;
    const target = team.onPitch.find(m => m.num === p._passTargetNum);
    if (!target) { p.action = 'IDLE'; return; }
    p.facing = Math.atan2(p._aimY - p.y, p._aimX - p.x);
    if (p.actionTimer === 0) {
      const dx = p._aimX - p.x, dy = p._aimY - p.y;
      const dxy = Math.hypot(dx, dy) || 1;
      const power = clamp(dxy * 1.15, 12, 22);
      const noise = (this.rng() - 0.5) * Math.max(0.05, 0.16 - (p.attrs.vision || 70) * 0.0010);
      const ang = Math.atan2(dy, dx) + noise;
      this.ball.vx = Math.cos(ang) * power;
      this.ball.vy = Math.sin(ang) * power;
      this.ball.vz = 0.3;             // ground pass
      this.ball.x = p.x + Math.cos(ang) * 0.6;
      this.ball.y = p.y + Math.sin(ang) * 0.6;
      this.ball.z = 0.2;
      this.ball.ownerSide = null; this.ball.ownerNum = null;
      this.ball.lastTouchSide = p.side; this.ball.lastTouchNum = p.num;
      this.ball.inFlight = true;
      this.ball.pendingShot = null;
      // Spatial offside check at the moment of the pass
      const offside = this.isOffside(p.side, target);
      // S78: through-balls are high-risk — base 0.5 + passer pressure
      const throughDifficulty = clamp(0.5 + (p.state.pressure || 0) / 100 * 0.4, 0, 0.85);
      this.ball.pendingPass = {
        fromSide: p.side, fromNum: p.num,
        targetSide: p.side, targetNum: target.num,
        kickTick: this.tickCount, type: 'through', offside,
        difficulty: throughDifficulty,
      };
      this.stats[p.side].passes++;
      p.state.actions.throughBalls++;    // S81
      this.log({ type: 'event', side: p.side, text: `${p.name} віддає розрізну на ${target.name}.` });
      p.action = 'IDLE';
    }
  }

  actClear(p) {
    p.vx *= 0.5; p.vy *= 0.5;
    if (p.actionTimer === 0) {
      // Boot upfield with high arc
      const dir = p.side === 'home' ? 1 : -1;
      const yawNoise = (this.rng() - 0.5) * 0.55;
      const ang = (dir > 0 ? 0 : Math.PI) + yawNoise;
      const power = 22 + this.rng() * 5;
      this.ball.vx = Math.cos(ang) * power;
      this.ball.vy = Math.sin(ang) * power;
      this.ball.vz = 4.5;
      this.ball.x = p.x + Math.cos(ang) * 0.6;
      this.ball.y = p.y + Math.sin(ang) * 0.6;
      this.ball.z = 0.4;
      this.ball.ownerSide = null; this.ball.ownerNum = null;
      this.ball.lastTouchSide = p.side; this.ball.lastTouchNum = p.num;
      this.ball.inFlight = true;
      this.ball.pendingShot = null;
      this.ball.pendingPass = null;
      if (p?.state?.actions) p.state.actions.clears++;   // S81
      this.log({ type: 'event', side: p.side, text: `${p.name} вибиває мʼяч геть.` });
      p.action = 'IDLE';
    }
  }

  // S64: ball as perceived by a player — sampled from history N ticks ago,
  // where N is the player's reactionLagTicks. Means individual defenders react
  // to ball movement at slightly different times → defensive line breaks the
  // "single body" sync that bothered users.
  _perceivedBall(p) {
    const lag = p.reactionLagTicks || 1;
    const buf = this.ballHistory;
    const idx = ((this.tickCount - lag) % buf.length + buf.length) % buf.length;
    const sample = buf[idx];
    return sample || { x: this.ball.x, y: this.ball.y };
  }

  // Per-spec perception model: vision range + distance-scaled position noise.
  // Outside vision range, returns "stale" position (no info). Inside, returns
  // actual + small Gaussian-ish noise scaling with distance and concentration.
  perceivedPos(observer, target) {
    if (!observer || !target) return { x: target?.x || 0, y: target?.y || 0 };
    const d = dist(observer.x, observer.y, target.x, target.y);
    const visionR = 28 + (observer.attrs.vision || 70) * 0.25;   // 70 → 45m
    if (d > visionR) {
      // Out of clear vision: return last-tactical-target (stale info)
      return { x: target.targetX || target.x, y: target.targetY || target.y };
    }
    // Position noise scales with distance × (1 - concentration%)
    const concFactor = 1 - (observer.attrs.concentration || 70) / 130;   // 70 → 0.46
    const sigma = d * 0.04 * concFactor;
    // Cheap pseudo-Gaussian (sum-of-uniform)
    const nx = ((this.rng() + this.rng() + this.rng() - 1.5) * sigma);
    const ny = ((this.rng() + this.rng() + this.rng() - 1.5) * sigma);
    return { x: target.x + nx, y: target.y + ny };
  }

  // Returns true if `target` would be in offside position at this moment for `side`.
  isOffside(side, target) {
    if (!target || target.role === 'GK') return false;
    const opp = this.teams[other(side)];
    const oppField = opp.onPitch.filter(o => !o.state.sentOff && o.role !== 'GK');
    if (oppField.length < 2) return false;
    const sortedX = oppField.map(o => o.x).sort((a, b) => a - b);
    // Second-to-last defender in defending direction
    const lineX = side === 'home'
      ? sortedX[sortedX.length - 2]   // second-highest X for home attacking right
      : sortedX[1];                   // second-lowest X for away attacking left
    if (side === 'home') return target.x > lineX + 0.3;
    return target.x < lineX - 0.3;
  }

  actTackle(p, team) {
    // 4-tick slide: 1-2 lunge forward, 3 contact, 4-... get up (slow)
    const ball = this.ball;
    const carrier = ball.ownerSide && ball.ownerNum != null
      ? this.teams[ball.ownerSide].onPitch.find(x => x.num === ball.ownerNum)
      : null;
    if (p.actionTimer === 3 || p.actionTimer === 2) {
      // Lunge — accelerate forward toward ball
      const dx = ball.x - p.x, dy = ball.y - p.y;
      const d = Math.hypot(dx, dy) || 1;
      const lunge = 6;
      p.vx = (dx / d) * lunge;
      p.vy = (dy / d) * lunge;
      p.facing = Math.atan2(dy, dx);
    } else if (p.actionTimer === 1) {
      // Contact resolution
      this.resolveTackleContact(p, carrier);
    } else {
      // Get-up: stationary, can't tackle again
      p.vx *= 0.4; p.vy *= 0.4;
      if (p.actionTimer === 0) {
        p.action = 'IDLE';
        p._tackleCooldown = 12;  // can't immediately tackle again
      }
    }
  }

  resolveTackleContact(p, carrier) {
    const ball = this.ball;
    if (!carrier) {
      // Just clear ball if close
      const d = dist(p.x, p.y, ball.x, ball.y);
      if (d < 1.5) {
        ball.vx = (this.rng() - 0.5) * 8;
        ball.vy = (this.rng() - 0.5) * 8;
        ball.ownerSide = null; ball.ownerNum = null;
        ball.lastTouchSide = p.side; ball.lastTouchNum = p.num;
        this.stats[p.side].tackles++;
      }
      return;
    }
    const distToCarrier = dist(p.x, p.y, carrier.x, carrier.y);
    if (distToCarrier > 1.5) {
      // Missed
      return;
    }
    // Tackle vs dribble roll — biased toward clean to keep foul count realistic.
    const tk = tackleRating(p);                              // 50..95
    const dr = (dribbleRating(carrier) + (carrier.attrs.composure || 70) * 0.4) / 1.4;
    const cleanProb = clamp(0.80 + (tk - dr) * 0.010, 0.55, 0.94);
    const r = this.rng();
    if (r < cleanProb) {
      // Clean tackle — ball loose
      ball.vx = (this.rng() - 0.5) * 6;
      ball.vy = (this.rng() - 0.5) * 6;
      ball.ownerSide = null; ball.ownerNum = null;
      ball.lastTouchSide = p.side; ball.lastTouchNum = p.num;
      this.stats[p.side].tackles++;
      p.state.actions.tackles++;          // S81
      p.state.actions.tacklesAttempted++;
      this._logRecovery(p.side, p.x);   // S80
      this.log({ type: 'event', side: p.side, text: `${p.name} відбирає мʼяч у ${carrier.name}.` });
      // Capture how long the opponent had been in possession BEFORE we reset the marker.
      const oppPossessionTicks = this.tickCount - this.lastPossessionChange;
      this.lastPossessionChange = this.tickCount;
      // BIG_TACKLE — clean tackle inside own penalty area during sustained opponent pressure.
      // Filters: zone <16.5m (penalty box edge), carrier advancing, ≥30 ticks of sustained
      // opponent possession (real attack, not deflection), 60-game-sec per-side cooldown.
      const ownGoalX = p.side === 'home' ? 0 : 105;
      const distOwnGoal = Math.abs(p.x - ownGoalX);
      const carrierAdvancing = (p.side === 'home' ? carrier.vx < -2 : carrier.vx > 2);
      const sustainedAttack = oppPossessionTicks >= 30;
      const cooldownOk = this.tickCount - this.lastBigTackleTick[p.side] >= 600;
      if (distOwnGoal < 16.5 && carrierAdvancing && sustainedAttack && cooldownOk) {
        this.lastBigTackleTick[p.side] = this.tickCount;
        this.log({
          type: 'spectacular', side: p.side, kind: 'BIG_TACKLE',
          text: `🛡️ Потужний відбір — ${p.name} зупиняє небезпечну атаку.`,
        });
      }
    } else {
      // Foul
      p.state.actions.tacklesAttempted++;   // S81
      this.awardFoul({ fouledSide: carrier.side, foulerSide: p.side, fouler: p, fouled: carrier });
    }
    // Sprint 22: ~1.2% chance of injury after any tackle (clean or foul).
    // Either player can be hurt; foul-causing tackles weight injury toward the
    // fouled (carrier) side — closer to real football tackle injury patterns.
    if (this.rng() < 0.012) {
      const wasFoul = r >= cleanProb;
      const victim = wasFoul ? carrier : (this.rng() < 0.6 ? carrier : p);
      this._triggerInjury(victim);
    }
  }

  actPass(p, team) {
    p.vx *= 0.6; p.vy *= 0.6;
    const target = team.onPitch.find(m => m.num === p._passTargetNum);
    if (!target) { p.action = 'IDLE'; return; }
    p.facing = Math.atan2(target.y - p.y, target.x - p.x);
    if (p.actionTimer === 0) {
      // Strike — pass with lead for receiver's velocity
      const tau = 0.4;
      const aimX = target.x + target.vx * tau;
      const aimY = target.y + target.vy * tau;
      const dx = aimX - p.x, dy = aimY - p.y;
      const dxy = Math.hypot(dx, dy);
      const desiredSpeed = clamp(dxy * 1.30, 11, 22);   // 11-22 m/s — paced for receivers
      // S78: pass difficulty — base on distance + passer skill + defender
      // proximity at target + passer's own pressure. Stored on pendingPass so
      // controlBall can pass it to the receiver as their inherited pressure.
      const passerPressure = p.state.pressure || 0;
      const distFactor = clamp(dxy / 35, 0.10, 0.85);
      const passSkill = passRating(p, dxy > 22 ? 'long' : 'short');
      const skillFactor = clamp(1.2 - passSkill / 100, 0.4, 1.1);
      let nearestOpp = 99;
      const oppTeam = this.teams[other(p.side)];
      for (const o of oppTeam.onPitch) {
        if (o.state.sentOff) continue;
        const d = dist(o.x, o.y, aimX, aimY);
        if (d < nearestOpp) nearestOpp = d;
      }
      const oppFactor = nearestOpp < 2 ? 0.25 : nearestOpp < 4 ? 0.15 : 0;
      const passerPressureFactor = passerPressure / 100;
      const passDifficulty = clamp(distFactor * skillFactor + oppFactor + passerPressureFactor, 0, 0.90);
      // Accuracy noise — widens with passer's current pressure (up to +50 %).
      const baseSigma = Math.max(0.05, 0.7 - passRating(p, 'cross') / 120) * (dxy / 25);
      const accSigma = baseSigma * (1 + passerPressure / 100);
      const noiseAng = (this.rng() - 0.5) * accSigma;
      const ang = Math.atan2(dy, dx) + noiseAng;
      this.ball.vx = Math.cos(ang) * desiredSpeed;
      this.ball.vy = Math.sin(ang) * desiredSpeed;
      this.ball.vz = dxy > 18 ? 2.5 : 0.3;  // lofted for long pass — modest height
      this.ball.x = p.x + Math.cos(ang) * 0.6;
      this.ball.y = p.y + Math.sin(ang) * 0.6;
      this.ball.z = 0.2;
      this.ball.ownerSide = null;
      this.ball.ownerNum = null;
      this.ball.lastTouchSide = p.side;
      this.ball.lastTouchNum = p.num;
      this.ball.inFlight = true;
      this.ball.pendingPass = {
        fromSide: p.side, fromNum: p.num,
        targetSide: target.side, targetNum: target.num,
        kickTick: this.tickCount,
        type: dxy > 22 ? 'long' : 'short',
        offside: this.isOffside(p.side, target),
        difficulty: passDifficulty,                       // S78
      };
      this.ball.pendingShot = null;
      this.stats[p.side].passes++;
      p.state.actions.passes++;          // S81
      this.log({
        type: 'event', side: p.side,
        text: `${p.name} → пас на ${target.name}.`,
      });
      p.action = 'IDLE';
    }
  }

  // ----------------------------------------------------------------------
  // PHYSICS INTEGRATION
  // ----------------------------------------------------------------------

  integratePlayer(p) {
    p.x += p.vx * DT;
    p.y += p.vy * DT;
    // Clamp to pitch (with small margin)
    p.x = clamp(p.x, 0.5, PITCH_W - 0.5);
    p.y = clamp(p.y, 0.5, PITCH_H - 0.5);
    // Drag if not actively driven
    p.vx *= (1 - 1.5 * DT);
    p.vy *= (1 - 1.5 * DT);
  }

  integrateBall() {
    const b = this.ball;
    // If owned: ball moves with owner (slightly forward of facing)
    if (b.ownerSide && b.ownerNum != null) {
      const owner = this.teams[b.ownerSide].onPitch.find(p => p.num === b.ownerNum);
      if (owner) {
        const fX = Math.cos(owner.facing), fY = Math.sin(owner.facing);
        b.x = owner.x + fX * 0.7;
        b.y = owner.y + fY * 0.7;
        b.z = 0;
        b.vx = owner.vx; b.vy = owner.vy; b.vz = 0;
        return;
      } else {
        b.ownerSide = null; b.ownerNum = null;
      }
    }
    // Free flight / rolling
    b.x += b.vx * DT;
    b.y += b.vy * DT;
    b.z += b.vz * DT;
    if (b.z > 0) {
      b.vz -= BALL_GRAVITY * DT;
      // Air drag
      b.vx *= (1 - BALL_FRICTION_AIR * DT);
      b.vy *= (1 - BALL_FRICTION_AIR * DT);
    } else {
      b.z = 0;
      if (b.vz < 0) b.vz = -b.vz * BALL_BOUNCE;
      if (b.vz < 0.5) b.vz = 0;
      // Rolling friction
      b.vx *= (1 - BALL_FRICTION_GROUND * DT);
      b.vy *= (1 - BALL_FRICTION_GROUND * DT);
      if (Math.hypot(b.vx, b.vy) < 0.3) { b.vx = 0; b.vy = 0; }
    }
    if (Math.hypot(b.vx, b.vy, b.vz) < 0.3 && b.z < 0.05) b.inFlight = false;
  }

  // ----------------------------------------------------------------------
  // BALL CONTACT / CONTROL
  // ----------------------------------------------------------------------

  resolveBallContacts() {
    const b = this.ball;
    if (b.ownerNum != null) return;  // owner already controls

    // Aerial ball — if high enough, contested header takes priority over ground control.
    if (b.z >= 1.4 && b.z <= 2.8) {
      if (this.resolveAerialBall()) return;
    }
    if (b.z > 1.8) return;            // ball too high to control without header

    // Pending shot saved/cleared if too old
    if (b.pendingShot && this.tickCount - b.pendingShot.kickTick > 60) {
      // S79: if the shot expired without being resolved, it counts as off-target.
      const idx = b.pendingShot.shotIdx;
      if (idx != null && this.shots[idx]?.result === 'pending') this.shots[idx].result = 'off_target';
      b.pendingShot = null;
    }
    // Pending pass cleared if too old (~3 sec)
    if (b.pendingPass && this.tickCount - b.pendingPass.kickTick > 30) {
      // Pass timed out — counted as misplaced
      b.pendingPass = null;
    }

    // Find closest player to ball within control radius (varies by first-touch quality).
    let best = null, bestD = Infinity;
    for (const side of ['home', 'away']) {
      for (const p of this.teams[side].onPitch) {
        if (p.state.sentOff) continue;
        const d = dist(p.x, p.y, b.x, b.y);
        const ftMod = 0.7 + ((p.attrs.composure || 70) / 100) * 0.5;  // composure widens reach
        const radius = BALL_CONTROL_RADIUS * ftMod;
        if (d < radius && d < bestD) { bestD = d; best = p; }
      }
    }
    if (!best) return;
    // Check relative velocity vs first-touch threshold
    const rvx = b.vx - best.vx, rvy = b.vy - best.vy;
    const relSpeed = Math.hypot(rvx, rvy);
    const ftQuality = ((best.attrs.first_touch || 60) + (best.attrs.composure || 70)) / 2;  // 0..100
    const ctrlMax = 4 + ftQuality * 0.07;  // 70 → 8.9, 90 → 10.3
    if (relSpeed > ctrlMax) {
      // Ball is too fast to control — leniency depends on who is trying.
      const isIntended = b.pendingPass && b.pendingPass.fromSide === best.side &&
        b.pendingPass.targetNum === best.num;
      const isTeammate = b.pendingPass && b.pendingPass.fromSide === best.side;
      const leniency = isIntended ? 3.0 : isTeammate ? 1.6 : 1.0;
      if (relSpeed > ctrlMax * leniency) {
        // Last-ditch block by defender in own penalty area — ~30% deflection
        const inOwnPenArea = (best.side === 'home' && best.x < 16.7) ||
                              (best.side === 'away' && best.x > 88.3);
        if (best.role !== 'GK' && inOwnPenArea && this.rng() < 0.45) {
          // Defender blocks dangerous fast ball — direct deflection to corner.
          // S79: mark the originating shot (if any) as blocked.
          if (b.pendingShot?.shotIdx != null) {
            const blk = this.shots[b.pendingShot.shotIdx];
            if (blk && blk.result === 'pending') blk.result = 'blocked';
          }
          if (best?.state?.actions) best.state.actions.blocks++;   // S81
          const cornerSide = other(best.side);
          const cornerY = best.y < 34 ? 0.5 : 67.5;
          const cornerX = best.side === 'home' ? 0.5 : 104.5;
          this.log({ type: 'event', side: best.side, text: `${best.name} переводить мʼяч на кутовий.` });
          this.awardCornerSetPiece(cornerSide, cornerX, cornerY);
          return;
        }
        return;
      }
      // Within leniency — bad first touch but takes ownership briefly
      b.vx *= 0.30; b.vy *= 0.30;
      b.lastTouchSide = best.side;
      b.lastTouchNum = best.num;
    }

    const fromSide = b.lastTouchSide;
    const toSide = best.side;
    const wasOpponentBall = fromSide && fromSide !== toSide;

    // Resolve pending pass / shot semantics
    if (b.pendingShot) {
      const ps = b.pendingShot;
      // S79: shot ended in someone's possession before crossing the goal line.
      if (ps.shotIdx != null && this.shots[ps.shotIdx]?.result === 'pending') {
        this.shots[ps.shotIdx].result = best.role === 'GK' && best.side !== ps.fromSide ? 'off_target' : 'off_target';
      }
      // S64: don't count GK-collects-loose-ball as on-target. "On target" only
      // increments via the checkBoundaries path when ball actually crosses
      // goal line within the mouth (saves, woodwork, goals).
      if (best.role === 'GK' && best.side !== ps.fromSide) {
        this.log({
          type: 'shot', side: ps.fromSide,
          text: `🥅 ${best.name} ловить удар ${this.teams[ps.fromSide].meta.short}. xG ${ps.xG.toFixed(2)}.`,
        });
      } else if (best.side === ps.fromSide) {
        this.log({ type: 'shot', side: ps.fromSide, text: `${best.name} підбирає відскік.` });
      }
      b.pendingShot = null;
    }

    if (b.pendingPass) {
      const pp = b.pendingPass;
      // Offside check — flag goes up when intended receiver controls the ball
      if (pp.offside && toSide === pp.fromSide && best.num === pp.targetNum) {
        this.stats[pp.fromSide].offsides++;
        this.log({ type: 'event', side: other(pp.fromSide), text: `🚩 Офсайд! ${best.name} опинився за лінією захисту.` });
        // Sprint 21: 25-tick whistle freeze before play resumes — gives the
        // visual moment of "flag up, attacker raises hands". skipDecisions
        // suspends AI so players don't immediately start chasing the ball.
        b.pendingPass = null;
        b.x = clamp(best.x, 1, PITCH_W - 1);
        b.y = clamp(best.y, 1, PITCH_H - 1);
        b.z = 0; b.vx = 0; b.vy = 0; b.vz = 0;
        b.ownerSide = null; b.ownerNum = null;
        b.lastTouchSide = pp.fromSide; b.lastTouchNum = best.num;
        b.inFlight = false;
        const fkSide = other(pp.fromSide);
        this._startPause('offside', [{ name: 'setup', ticks: 25 }], {
          skipDecisions: true,
          onComplete: () => {
            const fkTaker = pickBest(this.teams[fkSide].onPitch.filter(p => !p.state.sentOff && p.role !== 'GK'),
              p => passRating(p, 'short'));
            if (fkTaker) {
              fkTaker.x = this.ball.x; fkTaker.y = this.ball.y;
              this.ball.ownerSide = fkSide;
              this.ball.ownerNum = fkTaker.num;
              this.ball.lastTouchSide = fkSide;
              this.ball.lastTouchNum = fkTaker.num;
            }
          },
        });
        return;
      }
      if (toSide === pp.fromSide) {
        // Same team controls → pass completed
        this.stats[pp.fromSide].passesCompleted++;
        // S81: per-player pass completion — find the passer + bump the right counter by pass type
        const passerActor = this.teams[pp.fromSide].onPitch.find(x => x.num === pp.fromNum);
        if (passerActor?.state?.actions) {
          if (pp.type === 'cross') passerActor.state.actions.crossesCompleted++;
          else if (pp.type === 'through') passerActor.state.actions.throughBallsCompleted++;
          else passerActor.state.actions.passesCompleted++;
        }
        // S78: receiver inherits pressure proportional to the pass difficulty.
        // Tight, defended passes leave the receiver under more pressure on
        // their first touch and bias their next action (shoot/dribble) toward
        // misses. Clean passes pass on almost nothing.
        if (typeof pp.difficulty === 'number') {
          const inherited = clamp(pp.difficulty * 50, 0, 50);
          best.state.pressure = Math.max(best.state.pressure || 0, inherited);
        }
        // KEY_PASS tracking — if received attacker shoots within next ~3 sec, this assists.
        const passer = this.teams[pp.fromSide].onPitch.find(x => x.num === pp.fromNum);
        this.lastReceivedPass = {
          passerSide: pp.fromSide,
          passerNum: pp.fromNum,
          passerName: passer ? passer.name : '?',
          receiverNum: best.num,
          receiverName: best.name,
          tick: this.tickCount,
        };
        // THROUGH_BALL_INTO_BOX detector
        if (pp.type === 'through' || pp.type === 'cross') {
          const inBox = (pp.fromSide === 'home' && best.x > 88 && best.y > 14 && best.y < 54)
            || (pp.fromSide === 'away' && best.x < 17 && best.y > 14 && best.y < 54);
          if (inBox && pp.type === 'through') {
            this.log({
              type: 'spectacular', side: pp.fromSide, kind: 'THROUGH_BALL_INTO_BOX',
              text: `🎯 Розрізна передача — ${best.name} у штрафному.`,
            });
          }
        }
        if (best.num !== pp.targetNum) {
          this.log({ type: 'event', side: pp.fromSide, text: `${best.name} приймає мʼяч.` });
        }
      } else {
        // Interception by opponent (separate from physical tackles).
        this.stats[toSide].interceptions++;
        if (best?.state?.actions) best.state.actions.interceptions++;   // S81
        this._logRecovery(toSide, best.x);   // S80
        this.log({ type: 'event', side: toSide, text: `${best.name} перехоплює.` });
      }
      b.pendingPass = null;
    } else if (wasOpponentBall) {
      // Loose-ball recovery — log but don't count as tackle (real "tackles" stat
      // is reserved for clean slide-tackles + interceptions of attempted passes).
      this.lastPossessionChange = this.tickCount;
      this._logRecovery(toSide, best.x);   // S80
      this.log({ type: 'event', side: toSide, text: `${best.name} оволодіває мʼячем.` });
    }

    b.ownerSide = toSide;
    b.ownerNum = best.num;
    b.lastTouchSide = toSide;
    b.lastTouchNum = best.num;
    b.inFlight = false;
    best.hadBallTick = this.tickCount;
    if (wasOpponentBall) this.lastPossessionChange = this.tickCount;

    // SOLO_RUN tracking — same player keeps the ball through multiple distinct touches with progress.
    if (this.lastTouchHistory.length === 0 || this.lastTouchHistory[this.lastTouchHistory.length - 1].num !== best.num) {
      this.lastTouchHistory.push({ side: best.side, num: best.num, name: best.name, x: best.x, tick: this.tickCount });
      // Trim old entries (older than 10 sec)
      while (this.lastTouchHistory.length && this.tickCount - this.lastTouchHistory[0].tick > 100) {
        this.lastTouchHistory.shift();
      }
      // Detect run: same player with 4+ consecutive recent touches and >= 25m forward progress
      const recent = this.lastTouchHistory.slice(-6);
      const sameRun = recent.length >= 4 && recent.every(e => e.num === best.num && e.side === best.side);
      if (sameRun) {
        const dir = best.side === 'home' ? 1 : -1;
        const progress = (recent[recent.length - 1].x - recent[0].x) * dir;
        if (progress >= 25 && !best._announcedSolo) {
          this.log({
            type: 'spectacular', side: best.side, kind: 'SOLO_RUN',
            text: `⚡ Сольний прохід ${best.name} — ${progress.toFixed(0)}м уперед.`,
          });
          best._announcedSolo = this.tickCount;
        }
      }
      // Reset announced flag if player loses ball
      if (this.lastTouchHistory.length > 1 && best._announcedSolo
          && this.lastTouchHistory[this.lastTouchHistory.length - 2].num !== best.num) {
        best._announcedSolo = 0;
      }
    }

    // Settle cooldown — short so decideAction can fire on the next 4-tick
    // cycle instead of standing still for 1.4 game-sec after every reception.
    if (best.action !== 'PASS' && best.action !== 'SHOOT') {
      best.action = 'HOLD';
      best.actionTimer = 4;
    }
  }

  // ----------------------------------------------------------------------
  // BOUNDARIES & GOAL
  // ----------------------------------------------------------------------

  checkBoundaries() {
    const b = this.ball;
    if (b.ownerNum != null) return;  // ball is held — can't be out

    // Check goal lines first
    if (b.x <= 0 || b.x >= PITCH_W) {
      const inGoal = b.y >= GOAL_Y_TOP && b.y <= GOAL_Y_BOT && b.z < GOAL_HEIGHT;
      const lastSide = b.lastTouchSide;
      const goalSide = b.x <= 0 ? 'home' : 'away';  // whose goal is at this end
      if (inGoal) {
        // Slow ball into the net — almost certainly a misplaced touch the GK collects.
        const ballSpeed = Math.hypot(b.vx, b.vy);
        if (!b.pendingShot && ballSpeed < 12) {
          // GK collects, goal kick
          b.pendingShot = null;
          this._beginGoalKick(goalSide);
          return;
        }
        // WOODWORK — narrow miss inside posts that hits the woodwork (2% of close shots).
        if (b.pendingShot && this.rng() < 0.025) {
          const distFromCenterY = Math.abs(b.y - 34);
          const nearPost = distFromCenterY > 3.0;       // close to a post
          if (nearPost) {
            const ps = b.pendingShot;
            if (ps.shotIdx != null && this.shots[ps.shotIdx]?.result === 'pending') this.shots[ps.shotIdx].result = 'post';
            this.log({
              type: 'spectacular', side: ps.fromSide, kind: 'WOODWORK',
              text: `🪵 У штангу! ${ps.shooterName} влучає в каркас.`,
            });
            this.stats[ps.fromSide].onTarget++;  // counts as on target
            // S81: post counts as OT for the shooter
            const shooter = this.teams[ps.fromSide].onPitch.find(pl => pl.num === ps.fromNum);
            if (shooter?.state?.actions) shooter.state.actions.shotsOnTarget++;
            // Ball bounces back into play
            b.vx = -b.vx * 0.55;
            b.vy = b.vy * 0.7 + (this.rng() - 0.5) * 4;
            b.vz = 1 + this.rng() * 2;
            b.x = goalSide === 'home' ? 0.5 : 104.5;
            b.lastTouchSide = ps.fromSide;
            b.lastTouchNum = ps.fromNum;
            b.pendingShot = null;
            return;
          }
        }
        // GK save chance — only if there was a tracked shot
        if (b.pendingShot && b.pendingShot.fromSide !== goalSide) {
          const opp = this.teams[goalSide];
          const gk = opp.onPitch.find(p => p.role === 'GK' && !p.state.sentOff);
          const reflexBonus = ((gk?.attrs.reflexes || 70) - 70) * 0.006;
          // Calibrated so xG 0.10 → ~89% save, xG 0.30 → ~77% save, xG 0.45 → ~68% save.
          // Average shot xG ≈ 0.10 → ~11% goal rate (matches real football).
          const saveProb = clamp(0.88 - b.pendingShot.xG * 0.6 + reflexBonus, 0.15, 0.96);
          if (this.rng() < saveProb) {
            this.stats[b.pendingShot.fromSide].onTarget++;
            const ps = b.pendingShot;
            // S79: shot saved
            if (ps.shotIdx != null && this.shots[ps.shotIdx]?.result === 'pending') this.shots[ps.shotIdx].result = 'saved';
            // S81: saved counts as OT for the shooter
            const shooter = this.teams[ps.fromSide].onPitch.find(pl => pl.num === ps.fromNum);
            if (shooter?.state?.actions) shooter.state.actions.shotsOnTarget++;
            // BIG_CHANCE_MISSED — high-xG shot that didn't go in
            if (ps.xG >= 0.30) {
              this.log({
                type: 'spectacular', side: ps.fromSide, kind: 'BIG_CHANCE_MISSED',
                text: `😱 Великий шанс ВТРАЧЕНО — ${ps.shooterName} не реалізував. xG ${ps.xG.toFixed(2)}.`,
              });
            }
            // LONG_RANGE_SHOT_SAVED — outside-the-box shot saved
            if (ps.distGoal >= 25) {
              this.log({
                type: 'spectacular', side: ps.fromSide, kind: 'LONG_RANGE_SHOT_SAVED',
                text: `💪 Дальній удар відбито — ${ps.shooterName} з ${ps.distGoal.toFixed(0)}м.`,
              });
            }
            // GK save outcomes — Sprint 15 retuned: 65% caught, 30% corner, 5% rebound.
            // Rebound was 10% which inflated conversion (close-range follow-up shots);
            // 5% is closer to real GK reliability.
            const saveOutcome = this.rng();
            if (saveOutcome < 0.65) {
              // Catch — clean hands, goal kick
              this.log({ type: 'shot', side: ps.fromSide, text: `🥅 ${gk?.name || 'Воротар'} ловить удар.` });
              b.pendingShot = null;
              this._beginGoalKick(goalSide);
            } else if (saveOutcome < 0.95) {
              // Parry to corner
              const cornerSide = other(goalSide);
              const cornerY = b.y < 34 ? 0.5 : 67.5;
              const cornerX = goalSide === 'home' ? 0.5 : 104.5;
              this.log({ type: 'shot', side: ps.fromSide, text: `🥅 ${gk?.name || 'Воротар'} переводить на кутовий. xG ${ps.xG.toFixed(2)}.` });
              b.pendingShot = null;
              this.awardCornerSetPiece(cornerSide, cornerX, cornerY);
            } else {
              // Rebound — ball palmed back into play, attackers can pounce
              this.log({ type: 'shot', side: ps.fromSide, text: `🥅 ${gk?.name || 'Воротар'} відбиває — відскік у штрафному!` });
              const dirOut = ps.fromSide === 'home' ? 1 : -1;  // back toward attacking direction
              b.vx = dirOut * (3 + this.rng() * 5);
              b.vy = (this.rng() - 0.5) * 6;
              b.vz = 1.0 + this.rng() * 1.0;
              b.x = goalSide === 'home' ? 8 : 97;
              b.y = clamp(34 + (this.rng() - 0.5) * 8, 26, 42);
              b.z = 0.4;
              b.ownerSide = null; b.ownerNum = null;
              b.lastTouchSide = goalSide;
              b.lastTouchNum = gk?.num || null;
              b.pendingShot = null;
              b.pendingPass = null;
              b.inFlight = true;
              this.lastPossessionChange = this.tickCount;
            }
            return;
          }
          // Goal — save failed
        }
        // Goal scored against goalSide
        const scoredBy = other(goalSide);
        if (lastSide === scoredBy) {
          // Open-play goal
          this.score[scoredBy]++;
          // Spectacular detectors before standard goal log
          const ps = b.pendingShot;
          // S79: goal resolved
          if (ps?.shotIdx != null && this.shots[ps.shotIdx]?.result === 'pending') this.shots[ps.shotIdx].result = 'goal';
          // S81: goal counts as OT for the shooter (if we know who)
          if (ps?.fromNum != null) {
            const shooter = this.teams[scoredBy].onPitch.find(pl => pl.num === ps.fromNum);
            if (shooter?.state?.actions) shooter.state.actions.shotsOnTarget++;
          }
          if (ps) {
            if (ps.xG < 0.05) {
              this.log({
                type: 'spectacular', side: scoredBy, kind: 'WONDER_GOAL',
                text: `✨ ШЕДЕВРАЛЬНИЙ ГОЛ — ${ps.shooterName} забиває попри все! xG ${ps.xG.toFixed(2)}.`,
              });
            }
            if (ps.distGoal >= 25) {
              this.log({
                type: 'spectacular', side: scoredBy, kind: 'LONG_RANGE_GOAL',
                text: `🚀 ГОЛ ЗДАЛЕКУ — ${ps.shooterName} з ${ps.distGoal.toFixed(0)}м!`,
              });
            }
          }
          // UI redesign: attribute goal to last toucher (more robust than pendingShot,
          // which expires after 60 ticks if the ball bounces around before crossing the line).
          const scorerNum = b.lastTouchNum;
          const scorer = scorerNum != null ? this.teams[scoredBy].onPitch.find(pl => pl.num === scorerNum) : null;
          if (scorer) {
            scorer.state.goals = (scorer.state.goals || 0) + 1;
            // S32: morale bumps on goal — scorer +6, all teammates +1.
            scorer.state.morale = Math.min(100, (scorer.state.morale || 65) + 6);
            for (const tm of this.teams[scoredBy].onPitch) {
              if (tm.num !== scorer.num && !tm.state.sentOff) {
                tm.state.morale = Math.min(100, (tm.state.morale || 65) + 1);
              }
            }
          }
          let assistName = null;
          if (scorer && this.lastReceivedPass && this.lastReceivedPass.receiverNum === scorer.num
              && this.lastReceivedPass.passerSide === scoredBy
              && this.tickCount - this.lastReceivedPass.tick < 80) {
            const passer = this.teams[scoredBy].onPitch.find(pl => pl.num === this.lastReceivedPass.passerNum);
            if (passer) {
              passer.state.assists = (passer.state.assists || 0) + 1;
              passer.state.morale = Math.min(100, (passer.state.morale || 65) + 4);
              assistName = passer.name;
            }
          }
          // S32: morale drops for conceding side — GK -4, defenders -2, others -1.
          for (const tm of this.teams[other(scoredBy)].onPitch) {
            if (tm.state.sentOff) continue;
            const drop = tm.role === 'GK' ? 4 : (tm.role === 'CB' || tm.role === 'FB') ? 2 : 1;
            tm.state.morale = Math.max(0, (tm.state.morale || 65) - drop);
          }
          this.goalsList.push({
            side: scoredBy, scorerName: scorer?.name, scorerNum: scorer?.num,
            assistName, time: this.gameTime, ownGoal: false,
          });
          this.log({
            type: 'goal', side: scoredBy,
            text: `⚽ ГОЛ! ${this.teams[scoredBy].meta.short} забиває! ${this.score.home}–${this.score.away}.${assistName ? ' Асист: ' + assistName + '.' : ''}`,
            scorerName: scorer?.name, scorerNum: scorer?.num,
            assistName, assistNum: this.lastReceivedPass?.passerNum,
            time: this.gameTime,
          });
          // Bug fix: if pendingShot expired (>60 ticks since shot), the goal
          // came from a deflection / scramble after the original shot. Without
          // a fresh shot count, OT > shots in match stats. Treat the deflection
          // touch as a shot so stats stay coherent.
          // S73: also credit a reasonable xG (real "scramble" goals = ~0.20
          // close-range chance). Without this, scoreline could show 2 goals
          // with 0 xG which is impossible by definition.
          if (!b.pendingShot) {
            this.stats[scoredBy].shots++;
            this.stats[scoredBy].xg += 0.20;
          }
          this.stats[scoredBy].onTarget++;
          b.pendingShot = null;
          // Sprint 18: goal celebration. Move ball to center (kills goal re-fire),
          // assign celebration targets, start pause. AI is suspended so players
          // keep MOVE_TO_POSITION toward celebration / formation targets.
          this._beginGoalPause(scoredBy, scorer, false);
        } else {
          // Own goal
          this.score[scoredBy]++;
          this.goalsList.push({
            side: scoredBy, ownGoal: true, time: this.gameTime,
          });
          this.log({
            type: 'goal', side: scoredBy,
            text: `⚽ АВТОГОЛ! На користь ${this.teams[scoredBy].meta.short}. ${this.score.home}–${this.score.away}.`,
            ownGoal: true,
            time: this.gameTime,
          });
          b.pendingShot = null;
          // Sprint 18: muted celebration for own goal (no scorer to lift),
          // shorter aftermath, conceding side reaction same.
          this._beginGoalPause(scoredBy, null, true);
        }
        return;
      }
      // Out for goal kick or corner
      if (lastSide === goalSide) {
        // Opponent gets a corner — scripted setup + delivery
        const cornerSide = other(goalSide);
        const cornerY = b.y < 34 ? 0.5 : 67.5;
        const cornerX = goalSide === 'home' ? 0.5 : 104.5;
        this.awardCornerSetPiece(cornerSide, cornerX, cornerY);
      } else {
        // Goal kick for goalSide
        this._beginGoalKick(goalSide);
      }
      return;
    }

    // Touchlines
    if (b.y <= 0 || b.y >= PITCH_H) {
      const lastSide = b.lastTouchSide;
      const throwSide = lastSide ? other(lastSide) : 'home';
      const tx = clamp(b.x, 1, PITCH_W - 1);
      const ty = b.y <= 0 ? 0.5 : PITCH_H - 0.5;
      this.log({ type: 'event', side: throwSide, text: `Аут на користь ${this.teams[throwSide].meta.short}.` });
      this._beginThrowIn(throwSide, tx, ty);
      return;
    }
  }

  checkGoal() {
    // Goal detection happens inside checkBoundaries (when ball crosses goal line)
  }

  // ----------------------------------------------------------------------
  // PLAYER STATE DRIFT
  // ----------------------------------------------------------------------

  updatePlayerStates() {
    for (const side of ['home', 'away']) {
      for (const p of this.teams[side].onPitch) {
        if (p.state.sentOff) continue;
        const speed = Math.hypot(p.vx, p.vy);
        // S63 calibration: role + attribute multipliers. Before this was uniform,
        // so GKs drained as fast as STs. Target per real-football data: outfield
        // 25–45% drain over 90 min, GK <10%.
        const roleMult = p.role === 'GK' ? 0.15
                       : p.role === 'FB' ? 1.15
                       : p.role === 'CM' ? 1.10
                       : p.role === 'CB' ? 0.85
                       : p.role === 'ST' ? 0.95
                       : 1.0;
        const stamAttr = p.attrs?.stamina ?? 60;
        const attrMult = 1.5 - stamAttr / 100;            // 0.5 (stam=100) .. 1.5 (stam=0)
        // Halved base so total drain over 90 sim-min stays in target band.
        const baseDrain = 0.006 + 0.008 * (speed / 7);
        const drain = baseDrain * roleMult * attrMult;
        p.state.fatigue = Math.min(100, p.state.fatigue + drain);
        p.state.fitness = Math.max(0, 100 - p.state.fatigue);
        // S78: pressure decay — called every 10 ticks (1 game-sec) so 50 %
        // pressure clears in ~5 game-sec if the player isn't put under
        // pressure again by a follow-up tight pass.
        if ((p.state.pressure || 0) > 0) {
          p.state.pressure = Math.max(0, p.state.pressure - 10);
        }
      }
    }
  }

  // ----------------------------------------------------------------------
  // PUBLIC API: tactics, subs, stats
  // ----------------------------------------------------------------------

  submitTacticalChange(side, payload) {
    const cur = this.teams[side].tactics;
    const diff = {};
    for (const k of Object.keys(payload)) {
      if (payload[k] !== undefined && payload[k] !== cur[k]) diff[k] = payload[k];
    }
    if (Object.keys(diff).length === 0) return null;
    let applyAt;
    if (this.phase === 'halftime') applyAt = this.halfLenSec;
    else {
      const lagSec = 180 + Math.floor(this.rng() * 121);  // 3-5 min in game
      applyAt = this.gameTime + lagSec;
    }
    const change = { id: ((this.rng() * 1e9) | 0).toString(36), side, payload: diff, applyAt, submittedAt: this.gameTime };
    this.pendingChanges.push(change);
    return change;
  }

  applyReadyChanges() {
    const remaining = [];
    for (const c of this.pendingChanges) {
      if (c.applyAt <= this.gameTime) {
        Object.assign(this.teams[c.side].tactics, c.payload);
        if (c.payload.formation) this.teams[c.side].formation = c.payload.formation;
        const summary = describeTacticalChange(c.payload);
        this.log({
          type: 'tactical', side: c.side,
          text: `${this.teams[c.side].meta.short}: ${summary} застосовано.`,
        });
      } else remaining.push(c);
    }
    this.pendingChanges = remaining;
  }

  substitute(side, outNum, inNum) {
    const team = this.teams[side];
    if (this.subsUsed[side] >= this.maxSubs) return { ok: false, reason: 'max_subs' };
    const outIdx = team.onPitch.findIndex(p => p.num === outNum);
    const benchIdx = team.bench.findIndex(p => p.num === inNum);
    if (outIdx < 0 || benchIdx < 0) return { ok: false, reason: 'not_found' };
    const outP = team.onPitch[outIdx];
    const inP = team.bench[benchIdx];
    if (outP.state.sentOff) return { ok: false, reason: 'sent_off' };
    inP.slot = outP.slot;
    inP.x = outP.x; inP.y = outP.y;
    inP.targetX = outP.targetX; inP.targetY = outP.targetY;
    inP.facing = outP.facing;
    team.onPitch[outIdx] = inP;
    team.bench[benchIdx] = outP;
    this.subsUsed[side]++;
    this.log({ type: 'system', side, text: `${team.meta.short} заміна: ${outP.name} ⇄ ${inP.name}` });
    return { ok: true };
  }

  // ----------------------------------------------------------------------
  // SET PIECES
  // ----------------------------------------------------------------------

  awardCornerSetPiece(cornerSide, cornerX, cornerY) {
    this.stats[cornerSide].corners++;
    const team = this.teams[cornerSide];
    const opp = this.teams[other(cornerSide)];
    // S30: corner routine variants — in_swinger (default), out_swinger, near_post, short.
    const routine = team.tactics?.cornerRoutine || 'in_swinger';
    const CORNER_ROUTINE_UA = { in_swinger: 'закручений', out_swinger: 'розкручений', near_post: 'на ближню', short: 'розіграш' };
    this.log({ type: 'event', side: cornerSide, text: `Кутовий на користь ${team.meta.short} (${CORNER_ROUTINE_UA[routine] || routine}).` });
    // For 'short', pick best short-passer near corner; otherwise best crosser.
    const kicker = routine === 'short'
      ? pickBest(team.onPitch.filter(p => !p.state.sentOff && p.role !== 'GK'),
          p => passRating(p, 'short') + (p.attrs.set_pieces || 50) * 0.5)
      : pickBest(team.onPitch.filter(p => !p.state.sentOff && p.role !== 'GK'),
          p => passRating(p, 'cross') + (p.attrs.set_pieces || 50) * 0.5);
    if (!kicker) return;

    // Place ball at corner flag (no owner — ball sits at the flag while
    // attackers and the kicker walk into position; ball doesn't follow anyone).
    this.ball.x = cornerX; this.ball.y = cornerY; this.ball.z = 0;
    this.ball.vx = 0; this.ball.vy = 0; this.ball.vz = 0;
    this.ball.ownerSide = null;
    this.ball.ownerNum = null;
    this.ball.lastTouchSide = cornerSide;
    this.ball.lastTouchNum = kicker.num;
    this.ball.inFlight = false;
    this.ball.pendingShot = null;
    this.ball.pendingPass = null;

    // Compute scripted positions
    const goalX = cornerSide === 'home' ? 105 : 0;
    const sixYardX = goalX === 105 ? 99.5 : 5.5;
    const elevenX = goalX === 105 ? 94 : 11;
    const boxEdgeX = goalX === 105 ? 88 : 17;
    const isLowCorner = cornerY < 34;

    // Attacker-script positions in the box (relative to corner Y)
    const attackerSpots = [
      { x: sixYardX,  y: isLowCorner ? 31 : 37 },  // near post
      { x: sixYardX,  y: 34 },                      // 6-yard centre
      { x: sixYardX,  y: isLowCorner ? 39 : 29 },   // far post
      { x: elevenX,   y: 32 },                      // 11m near
      { x: elevenX,   y: 36 },                      // 11m far
      { x: boxEdgeX,  y: 34 },                      // edge — second ball
    ];
    const defenderSpots = [
      { x: sixYardX + (goalX === 105 ? -1 : 1), y: isLowCorner ? 30.5 : 37.5 },  // near post
      { x: sixYardX + (goalX === 105 ? -1 : 1), y: isLowCorner ? 38 : 30 },      // far post
      { x: sixYardX,  y: 33 },
      { x: sixYardX,  y: 35 },
      { x: elevenX,   y: 31 },
      { x: elevenX,   y: 37 },
      { x: boxEdgeX,  y: 30 },
      { x: boxEdgeX,  y: 38 },
    ];
    const gkX = goalX === 105 ? 102 : 3;
    const gkY = isLowCorner ? 35 : 33;  // slight off-centre toward far post

    // Hybrid snap: if kicker is far from the flag, snap them to within 4m so
    // the 80-tick setup is enough to walk in — no teleport, no missed kicks.
    const _kd = dist(kicker.x, kicker.y, cornerX, cornerY);
    if (_kd > 4) {
      const _kt = (_kd - 4) / _kd;
      kicker.x = kicker.x + (cornerX - kicker.x) * _kt;
      kicker.y = kicker.y + (cornerY - kicker.y) * _kt;
      kicker.vx = 0; kicker.vy = 0;
    }

    this._setPieceTargets = {};
    this._setPieceTargets[`${cornerSide}-${kicker.num}`] = { x: cornerX, y: cornerY };

    // Hybrid-snap attackers to within 8m of their box spot so the 80-tick
    // setup is enough for them to actually arrive before the kick is taken.
    const snapToWithin = (p, tx, ty, within) => {
      const d = dist(p.x, p.y, tx, ty);
      if (d > within) {
        const t = (d - within) / d;
        p.x = p.x + (tx - p.x) * t;
        p.y = p.y + (ty - p.y) * t;
        p.vx = 0; p.vy = 0;
      }
    };

    const fieldAttackers = team.onPitch.filter(p => !p.state.sentOff && p.role !== 'GK' && p.num !== kicker.num);
    fieldAttackers.slice(0, attackerSpots.length).forEach((p, i) => {
      const spot = attackerSpots[i];
      snapToWithin(p, spot.x, spot.y, 8);
      this._setPieceTargets[`${cornerSide}-${p.num}`] = spot;
    });
    fieldAttackers.slice(attackerSpots.length).forEach(p => {
      // Stragglers stay at edge of opp half
      this._setPieceTargets[`${cornerSide}-${p.num}`] = { x: boxEdgeX + (goalX === 105 ? -8 : 8), y: 34 + (this.rng() - 0.5) * 12 };
    });
    // Attacking GK stays back
    const atkGK = team.onPitch.find(p => p.role === 'GK' && !p.state.sentOff);
    if (atkGK) this._setPieceTargets[`${cornerSide}-${atkGK.num}`] = { x: cornerSide === 'home' ? 6 : 99, y: 34 };

    const fieldDefenders = opp.onPitch.filter(p => !p.state.sentOff && p.role !== 'GK');
    fieldDefenders.slice(0, defenderSpots.length).forEach((p, i) => {
      const spot = defenderSpots[i];
      snapToWithin(p, spot.x, spot.y, 8);
      this._setPieceTargets[`${other(cornerSide)}-${p.num}`] = spot;
    });
    fieldDefenders.slice(defenderSpots.length).forEach(p => {
      this._setPieceTargets[`${other(cornerSide)}-${p.num}`] = { x: boxEdgeX + (goalX === 105 ? -10 : 10), y: 34 };
    });
    const defGK = opp.onPitch.find(p => p.role === 'GK' && !p.state.sentOff);
    if (defGK) this._setPieceTargets[`${other(cornerSide)}-${defGK.num}`] = { x: gkX, y: gkY };

    // S30: delivery target depends on routine.
    let delivX, delivY;
    if (routine === 'near_post') {
      delivX = sixYardX + (goalX === 105 ? -1 : 1);
      delivY = isLowCorner ? 31 : 37;
    } else if (routine === 'out_swinger') {
      // Target the 11m line — defender-friendlier zone, but better for striker run-on.
      delivX = elevenX + (goalX === 105 ? -1 : 1);
      delivY = 34 + (this.rng() - 0.5) * 4;
    } else if (routine === 'short') {
      // Short pass: target a teammate stationed near corner (one of the spots near edge).
      delivX = boxEdgeX + (goalX === 105 ? -2 : 2);
      delivY = isLowCorner ? 18 : 50;
    } else {
      // in_swinger (default): aim near 6-yard line, ball curls toward keeper.
      delivX = sixYardX + (goalX === 105 ? -2 : 2);
      delivY = 34 + (this.rng() - 0.5) * 6;
    }

    this.setPiece = {
      type: 'CORNER',
      side: cornerSide,
      // Sprint 20: 80t setup so attackers walk into box; doc target 15-25s total.
      phase: 'setup',
      timer: 80,
      kickerNum: kicker.num,
      targetX: delivX,
      targetY: delivY,
      routine,
    };
  }

  awardPenaltySetPiece(side, fouler) {
    const opp = this.teams[other(side)];
    const team = this.teams[side];
    this.log({ type: 'event', side, text: `🎯 ПЕНАЛЬТІ на користь ${team.meta.short}!` });

    const kicker = pickBest(team.onPitch.filter(p => !p.state.sentOff && p.role !== 'GK'),
      p => penaltyRating(p));
    if (!kicker) return;
    const goalX = side === 'home' ? 105 : 0;
    const spotX = side === 'home' ? 94 : 11;

    // Ball at penalty spot
    this.ball.x = spotX; this.ball.y = 34; this.ball.z = 0;
    this.ball.vx = 0; this.ball.vy = 0; this.ball.vz = 0;
    this.ball.ownerSide = side;
    this.ball.ownerNum = kicker.num;
    this.ball.lastTouchSide = side;
    this.ball.lastTouchNum = kicker.num;
    this.ball.inFlight = false;
    this.ball.pendingShot = null;
    this.ball.pendingPass = null;

    // Scripted positions: kicker at spot; everyone else outside box; GK on line
    this._setPieceTargets = {};
    this._setPieceTargets[`${side}-${kicker.num}`] = { x: spotX - (side === 'home' ? 0.7 : -0.7), y: 34 };
    const boxEdgeAtt = side === 'home' ? 88 : 17;
    const others = team.onPitch.filter(p => !p.state.sentOff && p.num !== kicker.num);
    others.forEach((p, i) => {
      const yj = 16 + (i * 36 / Math.max(1, others.length - 1));
      this._setPieceTargets[`${side}-${p.num}`] = { x: boxEdgeAtt + (side === 'home' ? -2 : 2), y: yj };
    });
    const oppPlayers = opp.onPitch.filter(p => !p.state.sentOff && p.role !== 'GK');
    oppPlayers.forEach((p, i) => {
      const yj = 16 + (i * 36 / Math.max(1, oppPlayers.length - 1));
      this._setPieceTargets[`${other(side)}-${p.num}`] = { x: boxEdgeAtt + (side === 'home' ? -3 : 3), y: yj };
    });
    const gk = opp.onPitch.find(p => p.role === 'GK' && !p.state.sentOff);
    if (gk) this._setPieceTargets[`${other(side)}-${gk.num}`] = { x: side === 'home' ? 104 : 1, y: 34 };

    this.setPiece = {
      type: 'PENALTY',
      side,
      phase: 'setup',
      timer: 18,
      kickerNum: kicker.num,
      targetX: goalX,
      targetY: 34 + (this.rng() - 0.5) * 5.5,
    };
  }

  processSetPiece() {
    const sp = this.setPiece;
    if (!sp) return;

    if (sp.phase === 'setup') {
      // Move all players toward scripted targets — including the kicker, who
      // must walk to the ball at the flag/spot. actMoveToTarget naturally
      // decelerates when within 0.4m of target, so they settle there.
      for (const side of ['home', 'away']) {
        for (const p of this.teams[side].onPitch) {
          if (p.state.sentOff) continue;
          const target = this._setPieceTargets[`${side}-${p.num}`];
          if (target) {
            p.targetX = target.x;
            p.targetY = target.y;
            p.action = 'MOVE_TO_POSITION';
          }
        }
      }
      sp.timer--;
      if (sp.timer <= 0) {
        sp.phase = 'kick';
        sp.timer = 5;
      }
      return;
    }

    if (sp.phase === 'kick') {
      sp.timer--;
      if (sp.timer <= 0) {
        if (sp.type === 'CORNER') this.deliverCorner(sp);
        else if (sp.type === 'PENALTY') this.takePenalty(sp);
        else if (sp.type === 'FREE_KICK') this.takeFreeKick(sp);
      }
      return;
    }
  }

  deliverCorner(sp) {
    const team = this.teams[sp.side];
    const kicker = team.onPitch.find(p => p.num === sp.kickerNum && !p.state.sentOff);
    if (!kicker) { this.setPiece = null; this._setPieceTargets = null; return; }
    const dx = sp.targetX - kicker.x, dy = sp.targetY - kicker.y;
    const dxy = Math.hypot(dx, dy);
    // S30: 'short' = ground pass to nearby teammate; lofted variants curl differently.
    const isShort = sp.routine === 'short';
    const isInSwinger = sp.routine === 'in_swinger' || !sp.routine;  // default
    // Compute horizontal speed so the ball actually reaches the target.
    // Flight time T = 2*vz/g for lofted; ground ball uses different drag.
    const vz = isShort ? 1.2 : 5.5;
    const flightTime = isShort ? 0.6 : (2 * vz / 9.81);   // ~1.12s lofted
    const power = clamp(dxy / flightTime, isShort ? 8 : 14, isShort ? 18 : 38);
    // Curl: in_swinger curls inward (toward goal), out_swinger outward (away).
    const curl = isInSwinger ? 0.06 : (sp.routine === 'out_swinger' ? -0.06 : 0);
    const noise = (this.rng() - 0.5) * 0.10 + curl;
    const ang = Math.atan2(dy, dx) + noise;
    this.ball.vx = Math.cos(ang) * power;
    this.ball.vy = Math.sin(ang) * power;
    this.ball.vz = vz;
    this.ball.x = kicker.x + Math.cos(ang) * 0.7;
    this.ball.y = kicker.y + Math.sin(ang) * 0.7;
    this.ball.z = isShort ? 0.2 : 0.4;
    this.ball.ownerSide = null;
    this.ball.ownerNum = null;
    this.ball.lastTouchSide = sp.side;
    this.ball.lastTouchNum = sp.kickerNum;
    this.ball.inFlight = true;
    this.ball.pendingPass = {
      fromSide: sp.side, fromNum: sp.kickerNum,
      targetSide: sp.side, targetNum: -1,
      kickTick: this.tickCount, type: isShort ? 'corner_short' : 'corner',
    };
    this.stats[sp.side].passes++;
    const verb = isShort ? 'розігрує накоротко' : (sp.routine === 'near_post' ? 'подає на ближню штангу' : sp.routine === 'out_swinger' ? 'розкручує мʼяч' : 'закручує мʼяч у штрафний');
    this.log({ type: 'event', side: sp.side, text: `${kicker.name} ${verb}.` });
    this.setPiece = null;
    this._setPieceTargets = null;
  }

  takePenalty(sp) {
    const team = this.teams[sp.side];
    const opp = this.teams[other(sp.side)];
    const kicker = team.onPitch.find(p => p.num === sp.kickerNum && !p.state.sentOff);
    if (!kicker) { this.setPiece = null; this._setPieceTargets = null; return; }
    const gk = opp.onPitch.find(p => p.role === 'GK' && !p.state.sentOff);
    const goalX = sp.side === 'home' ? 105 : 0;
    const aimY = sp.targetY;
    const dx = goalX - kicker.x, dy = aimY - kicker.y;
    const dxy = Math.hypot(dx, dy) || 1;
    const power = 26 + (penaltyRating(kicker) - 70) * 0.05;
    // Penalty aim — small noise scaled by composure
    const noise = (this.rng() - 0.5) * Math.max(0.02, 0.10 - (kicker.attrs.composure || 70) * 0.0008);
    const ang = Math.atan2(dy, dx) + noise;
    this.ball.vx = Math.cos(ang) * power;
    this.ball.vy = Math.sin(ang) * power;
    this.ball.vz = 1.0 + this.rng() * 1.5;
    this.ball.x = kicker.x + Math.cos(ang) * 0.6;
    this.ball.y = kicker.y + Math.sin(ang) * 0.6;
    this.ball.z = 0.3;
    this.ball.ownerSide = null; this.ball.ownerNum = null;
    this.ball.lastTouchSide = sp.side; this.ball.lastTouchNum = sp.kickerNum;
    this.ball.inFlight = true;
    // Penalty xG ~0.78
    let xG = 0.78 + (penaltyRating(kicker) - 70) * 0.0025 - ((gk?.attrs.reflexes || 70) - 70) * 0.003;
    xG = clamp(xG, 0.55, 0.92);
    const penDist = Math.abs((sp.side === 'home' ? 105 : 0) - kicker.x);
    const penShotIdx = this._logShot({ p: kicker, distGoal: penDist, xG, shotType: 'penalty', gkName: gk?.name });
    this.ball.pendingShot = {
      fromSide: sp.side, fromNum: sp.kickerNum,
      kickTick: this.tickCount, xG,
      distGoal: penDist,
      shooterName: kicker.name,
      shotIdx: penShotIdx,
    };
    this.stats[sp.side].shots++;
    this.stats[sp.side].xg += xG;
    if (kicker?.state?.actions) kicker.state.actions.shotsTaken++;   // S81
    this._detectChanceCreatedAndKeyPass(this.ball.pendingShot);
    this.log({ type: 'shot', side: sp.side, text: `🎯 ${kicker.name} підходить до мʼяча... xG ${xG.toFixed(2)}.` });
    this.setPiece = null;
    this._setPieceTargets = null;
  }

  takeFreeKick(sp) {
    const team = this.teams[sp.side];
    const opp = this.teams[other(sp.side)];
    const kicker = team.onPitch.find(p => p.num === sp.kickerNum && !p.state.sentOff);
    if (!kicker) { this.setPiece = null; this._setPieceTargets = null; return; }
    const goalX = sp.side === 'home' ? 105 : 0;
    const distGoal = Math.abs(goalX - kicker.x);
    // S30: freeKickRoutine variants — auto / direct / whip / low_drive / short.
    const fkRoutine = team.tactics?.freeKickRoutine || 'auto';
    const inDirectRange = distGoal < 28;
    const wantDirect = fkRoutine === 'direct' || (fkRoutine === 'auto' && sp.directShot && inDirectRange);
    const wantWhip = fkRoutine === 'whip' && distGoal < 50;
    const wantLowDrive = fkRoutine === 'low_drive' && distGoal < 32;
    if (wantWhip) {
      // Whip a cross into box — lofted, target near 11m line.
      const elevenX = goalX === 105 ? 94 : 11;
      const aimX = elevenX, aimY = 34 + (this.rng() - 0.5) * 8;
      const dx = aimX - kicker.x, dy = aimY - kicker.y;
      const dxy = Math.hypot(dx, dy) || 1;
      const power = clamp(dxy * 0.85, 14, 26);
      const noise = (this.rng() - 0.5) * 0.10;
      const ang = Math.atan2(dy, dx) + noise;
      this.ball.vx = Math.cos(ang) * power;
      this.ball.vy = Math.sin(ang) * power;
      this.ball.vz = 5.0;
      this.ball.x = kicker.x + Math.cos(ang) * 0.6;
      this.ball.y = kicker.y + Math.sin(ang) * 0.6;
      this.ball.z = 0.4;
      this.ball.ownerSide = null; this.ball.ownerNum = null;
      this.ball.lastTouchSide = sp.side; this.ball.lastTouchNum = sp.kickerNum;
      this.ball.inFlight = true;
      this.ball.pendingPass = {
        fromSide: sp.side, fromNum: sp.kickerNum,
        targetSide: sp.side, targetNum: -1,
        kickTick: this.tickCount, type: 'fk_whip',
      };
      this.stats[sp.side].passes++;
      this.log({ type: 'event', side: sp.side, text: `${kicker.name} навішує штрафний у штрафний.` });
    } else if (wantDirect || wantLowDrive) {
      // Direct attempt — standard or low-driven (less curl, more power).
      const aimY = 34 + (this.rng() - 0.5) * 5;
      const dx = goalX - kicker.x, dy = aimY - kicker.y;
      const dxy = Math.hypot(dx, dy) || 1;
      const drive = wantLowDrive ? 1.20 : 1.0;
      const power = (24 + (freeKickRating(kicker) - 70) * 0.10) * drive;
      const noise = (this.rng() - 0.5) * (wantLowDrive ? 0.07 : 0.10);
      const ang = Math.atan2(dy, dx) + noise;
      this.ball.vx = Math.cos(ang) * power;
      this.ball.vy = Math.sin(ang) * power;
      this.ball.vz = wantLowDrive ? 0.6 : (distGoal < 22 ? 2.0 : 1.0);
      this.ball.x = kicker.x + Math.cos(ang) * 0.6;
      this.ball.y = kicker.y + Math.sin(ang) * 0.6;
      this.ball.z = 0.3;
      this.ball.ownerSide = null; this.ball.ownerNum = null;
      this.ball.lastTouchSide = sp.side; this.ball.lastTouchNum = sp.kickerNum;
      this.ball.inFlight = true;
      const xGBase = 0.10 * Math.exp(-(distGoal - 18) / 11);
      const xG = clamp(xGBase * (wantLowDrive ? 1.15 : 1.0), 0.02, 0.20);
      const fkGk = this.teams[other(sp.side)].onPitch.find(pl => pl.role === 'GK' && !pl.state.sentOff);
      const fkShotIdx = this._logShot({ p: kicker, distGoal, xG, shotType: 'fk', gkName: fkGk?.name });
      this.ball.pendingShot = {
        fromSide: sp.side, fromNum: sp.kickerNum,
        kickTick: this.tickCount, xG,
        distGoal,
        shooterName: kicker.name,
        shotIdx: fkShotIdx,
      };
      this.stats[sp.side].shots++;
      this.stats[sp.side].xg += xG;
      if (kicker?.state?.actions) kicker.state.actions.shotsTaken++;   // S81
      this._detectChanceCreatedAndKeyPass(this.ball.pendingShot);
      const verb = wantLowDrive ? 'низом бʼє штрафний' : 'закручує штрафний у ворота';
      this.log({ type: 'shot', side: sp.side, text: `${kicker.name} ${verb}. xG ${xG.toFixed(2)}.` });
    } else {
      // Short pass to nearest free teammate
      const targets = team.onPitch.filter(p => !p.state.sentOff && p.num !== kicker.num && p.role !== 'GK');
      const target = targets.sort((a, b) => dist(kicker.x, kicker.y, a.x, a.y) - dist(kicker.x, kicker.y, b.x, b.y))[0];
      if (target) {
        const dx = target.x - kicker.x, dy = target.y - kicker.y;
        const dxy = Math.hypot(dx, dy) || 1;
        const power = clamp(dxy * 1.0, 9, 18);
        const ang = Math.atan2(dy, dx);
        this.ball.vx = Math.cos(ang) * power;
        this.ball.vy = Math.sin(ang) * power;
        this.ball.vz = 0.5;
        this.ball.x = kicker.x + Math.cos(ang) * 0.6;
        this.ball.y = kicker.y + Math.sin(ang) * 0.6;
        this.ball.z = 0.2;
        this.ball.ownerSide = null; this.ball.ownerNum = null;
        this.ball.lastTouchSide = sp.side; this.ball.lastTouchNum = sp.kickerNum;
        this.ball.inFlight = true;
        this.ball.pendingPass = {
          fromSide: sp.side, fromNum: sp.kickerNum,
          targetSide: sp.side, targetNum: target.num,
          kickTick: this.tickCount, type: 'short',
        };
        this.stats[sp.side].passes++;
        this.log({ type: 'event', side: sp.side, text: `${kicker.name} → ${target.name} зі штрафного.` });
      }
    }
    this.setPiece = null;
    this._setPieceTargets = null;
  }

  resolveAerialBall() {
    // Returns true if a header was resolved (caller should skip ground-control).
    // Cooldown prevents box-cluster header spam — same ball can't be repeatedly
    // headered when 4-4-2's two STs cluster around a high ball.
    if (this.tickCount - this.lastAerialResolveTick < 5) return false;
    const b = this.ball;
    const cands = [];
    for (const side of ['home', 'away']) {
      for (const p of this.teams[side].onPitch) {
        if (p.state.sentOff || p.role === 'GK') continue;
        const d = dist(p.x, p.y, b.x, b.y);
        if (d < 1.8) cands.push({ p, d });
      }
    }
    if (cands.length === 0) return false;
    this.lastAerialResolveTick = this.tickCount;
    // Score each candidate by jumping × heading × proximity + small RNG.
    const scored = cands.map(c => ({
      p: c.p, d: c.d,
      score: headerRating(c.p) * 0.75
           - c.d * 10
           + this.rng() * 25,
    }));
    scored.sort((a, b2) => b2.score - a.score);
    const winner = scored[0].p;
    const dir = winner.side === 'home' ? 1 : -1;
    const goalX = winner.side === 'home' ? 105 : 0;
    const distToOppGoal = dist(winner.x, winner.y, goalX, 34);
    const isAttackingHeader = distToOppGoal < 14 && (winner.role === 'ST' || winner.role === 'AM' || winner.role === 'W' || winner.role === 'CB');

    if (isAttackingHeader) {
      const aimY = 34 + (this.rng() - 0.5) * 6;
      const dx = goalX - winner.x, dy = aimY - winner.y;
      const dxy = Math.hypot(dx, dy) || 1;
      const power = 17 + (headerRating(winner) - 70) * 0.10;
      const noise = (this.rng() - 0.5) * 0.18;
      const ang = Math.atan2(dy, dx) + noise;
      b.vx = Math.cos(ang) * power;
      b.vy = Math.sin(ang) * power;
      b.vz = -0.8; // attacking headers descend toward goal — exits aerial window in 1-2 ticks but still travels
      b.x = winner.x + Math.cos(ang) * 0.5;
      b.y = winner.y + Math.sin(ang) * 0.5;
      b.z = 1.2;
      b.ownerSide = null; b.ownerNum = null;
      b.lastTouchSide = winner.side; b.lastTouchNum = winner.num;
      b.inFlight = true;
      // Sprint 15: lower header xG cap (was 0.30 → 0.18) to bring conversion in line.
      const xG = clamp(0.06 + (headerRating(winner) - 65) * 0.0020, 0.03, 0.18);
      const headerDist = Math.abs(goalX - winner.x);
      const headerGk = this.teams[other(winner.side)].onPitch.find(pl => pl.role === 'GK' && !pl.state.sentOff);
      const headerShotIdx = this._logShot({ p: winner, distGoal: headerDist, xG, shotType: 'head', gkName: headerGk?.name });
      b.pendingShot = {
        fromSide: winner.side, fromNum: winner.num,
        kickTick: this.tickCount, xG,
        distGoal: headerDist,
        shooterName: winner.name,
        shotIdx: headerShotIdx,
      };
      b.pendingPass = null;
      this.stats[winner.side].shots++;
      this.stats[winner.side].xg += xG;
      if (winner?.state?.actions) {
        winner.state.actions.shotsTaken++;        // S81
        winner.state.actions.headersWon++;
      }
      this._detectChanceCreatedAndKeyPass(b.pendingShot);
      this.log({ type: 'shot', side: winner.side, text: `🪶 ${winner.name} бʼє головою у ворота! xG ${xG.toFixed(2)}.` });
    } else {
      // Defensive header — clear away from own goal
      const ownGoalX = winner.side === 'home' ? 0 : 105;
      const dx = winner.x - ownGoalX;
      const dy = (this.rng() - 0.5) * 30;
      const dxy = Math.hypot(dx, dy) || 1;
      const power = 14 + this.rng() * 4;
      b.vx = (dx / dxy) * power;
      b.vy = (dy / dxy) * power;
      b.vz = 2.5;
      b.lastTouchSide = winner.side; b.lastTouchNum = winner.num;
      b.ownerSide = null; b.ownerNum = null;
      b.inFlight = true;
      b.pendingShot = null;
      b.pendingPass = null;
      if (winner?.state?.actions) winner.state.actions.headersWon++;   // S81
      this.log({ type: 'event', side: winner.side, text: `${winner.name} вибиває головою.` });
    }
    return true;
  }

  // ----------------------------------------------------------------------
  // FOULS + CARDS
  // ----------------------------------------------------------------------

  awardFoul({ fouledSide, foulerSide, fouler, fouled }) {
    this.stats[foulerSide].fouls++;
    const cardEv = this.rollCard(foulerSide, fouler);
    if (cardEv) this.log(cardEv);
    this.log({
      type: 'event', side: foulerSide,
      text: `Фол від ${fouler.name}${fouled ? ' на ' + fouled.name : ''}.`,
    });

    // Penalty if foul is inside the defending team's penalty area
    const fx = fouled ? fouled.x : this.ball.x;
    const fy = fouled ? fouled.y : this.ball.y;
    const inPenAreaForAttacker =
      (fouledSide === 'home' && fx > 88.3 && fy > 13.84 && fy < 54.16) ||
      (fouledSide === 'away' && fx < 16.7  && fy > 13.84 && fy < 54.16);
    // Sprint 15: only ~35% of in-box fouls awarded as penalty.
    const isPen = inPenAreaForAttacker && this.rng() < 0.35;

    const continueResolution = () => {
      if (isPen) this.awardPenaltySetPiece(fouledSide, fouler);
      else this.awardFreeKickSetPiece(fouledSide, fouler, fx, fy);
    };

    // Sprint 21: card-show pause — brief delay before FK / penalty setup so
    // the ref-shows-card moment is visible. Yellow 25t (2.5s), red 60t (6s).
    if (cardEv) {
      const isRed = /RED|sent off/i.test(cardEv.text);
      this._startPause('card', [{ name: 'setup', ticks: isRed ? 60 : 25 }], {
        skipDecisions: true,
        onComplete: continueResolution,
      });
    } else {
      continueResolution();
    }
  }

  awardFreeKickSetPiece(side, fouler, fx, fy) {
    const team = this.teams[side];
    const opp = this.teams[other(side)];
    const goalX = side === 'home' ? 105 : 0;
    const distGoal = Math.abs(goalX - fx);
    const isDangerous = distGoal < 28;

    const taker = pickBest(team.onPitch.filter(p => !p.state.sentOff && p.role !== 'GK'),
      p => passRating(p, 'long') + freeKickRating(p) * (isDangerous ? 0.8 : 0.3));
    if (!taker) return;
    const ball = this.ball;
    ball.x = clamp(fx, 1, PITCH_W - 1);
    ball.y = clamp(fy, 1, PITCH_H - 1);
    ball.z = 0; ball.vx = 0; ball.vy = 0; ball.vz = 0;
    ball.ownerSide = side; ball.ownerNum = taker.num;
    ball.lastTouchSide = side; ball.lastTouchNum = taker.num;
    ball.inFlight = false;
    ball.pendingPass = null; ball.pendingShot = null;

    // Scripted: kicker at ball, wall (3 defenders) at 9.15m, others stay-ish.
    this._setPieceTargets = {};
    this._setPieceTargets[`${side}-${taker.num}`] = { x: ball.x, y: ball.y };

    if (isDangerous) {
      // Sprint 20: dynamic wall composition. Size by distance to goal — closer
      // shot needs bigger wall; further out, drop wall to keep more bodies in
      // the box. Wall ROLE preference excludes CBs (they mark attackers in the
      // box) and goalkeeper.
      const dxToGoal = goalX - ball.x;
      const dyToGoal = 34 - ball.y;
      const dToGoal = Math.hypot(dxToGoal, dyToGoal) || 1;
      const ux = dxToGoal / dToGoal, uy = dyToGoal / dToGoal;
      const wallX = ball.x + ux * 9.15;
      const wallY = ball.y + uy * 9.15;
      const px = -uy, py = ux;
      // Wall size by distance: 5 inside 22m, 4 at 22-28m, 3 at 28-32m, 2 if far.
      let wallSize;
      if (distGoal < 22) wallSize = 5;
      else if (distGoal < 28) wallSize = 4;
      else if (distGoal < 32) wallSize = 3;
      else wallSize = 2;
      // Symmetric spread around the wall midpoint.
      const wallSpots = [];
      for (let i = 0; i < wallSize; i++) {
        const offset = i - (wallSize - 1) / 2;
        wallSpots.push({ x: wallX + px * offset, y: wallY + py * offset });
      }
      // Role priority for wall — anyone except GK and CB (CBs stay marking).
      // Score by role rank then by closeness; ties broken by ph (height).
      const ROLE_WALL_RANK = { W: 1, AM: 2, CM: 3, DM: 4, FB: 5, ST: 6, CB: 99, GK: 99 };
      const oppPlayers = opp.onPitch.filter(p => !p.state.sentOff && p.role !== 'GK');
      const wallCandidates = oppPlayers
        .filter(p => p.role !== 'CB')
        .sort((a, b) => {
          const ra = ROLE_WALL_RANK[a.role] || 50;
          const rb = ROLE_WALL_RANK[b.role] || 50;
          if (ra !== rb) return ra - rb;
          return dist(a.x, a.y, ball.x, ball.y) - dist(b.x, b.y, ball.x, ball.y);
        });
      const inWall = wallCandidates.slice(0, wallSize);
      const inWallSet = new Set(inWall.map(p => p.num));
      inWall.forEach((p, i) => {
        this._setPieceTargets[`${other(side)}-${p.num}`] = wallSpots[i];
      });
      // CBs and other non-wall defenders stay near box marking attackers.
      const boxDefenders = oppPlayers.filter(p => !inWallSet.has(p.num));
      boxDefenders.forEach((p, i) => {
        const baseY = 22 + (i % 5) * 6;
        this._setPieceTargets[`${other(side)}-${p.num}`] = {
          x: side === 'home' ? 92 - (p.role === 'CB' ? 0 : 4) : 13 + (p.role === 'CB' ? 0 : 4),
          y: baseY,
        };
      });
      const gk = opp.onPitch.find(p => p.role === 'GK' && !p.state.sentOff);
      if (gk) this._setPieceTargets[`${other(side)}-${gk.num}`] = { x: side === 'home' ? 102 : 3, y: 34 };

      // Push attackers out of the keeper's immediate area (≤4.5m). Stops the
      // visual "opponent standing on the GK" you'd otherwise inherit from
      // whatever positions players were in at the moment of the foul.
      if (gk) {
        const teamAttackers = team.onPitch.filter(p => !p.state.sentOff && p.num !== taker.num);
        teamAttackers.forEach((p, i) => {
          const d = dist(p.x, p.y, gk.x, gk.y);
          if (d < 4.5) {
            // Move them to the edge of the penalty box, spread along Y.
            const edgeX = side === 'home' ? 88 : 17;
            const baseY = 24 + (i % 4) * 6;
            this._setPieceTargets[`${side}-${p.num}`] = { x: edgeX, y: baseY };
          }
        });
      }

      this.setPiece = {
        type: 'FREE_KICK',
        side,
        phase: 'setup',
        timer: 70,                  // ~7 sec at friendly speed — enough for wall + box shape to form
        kickerNum: taker.num,
        directShot: this.rng() < 0.45,
        targetX: goalX,
        targetY: 34,
      };
    } else {
      // Non-dangerous FK — quick restart, normal play resumes within a few ticks
      // (no scripted setup, just give possession)
    }
  }

  // ----------------------------------------------------------------------
  // AERIAL BALL / HEADER
  // ----------------------------------------------------------------------

  // Sprint 22: minimal injury system. Severity weights match doc (90% minor,
  // 10% serious; critical/moderate folded into these for v1). On serious the
  // player is sent off (treated as out — sub system can replace later).
  // Sportsmanship ball-out and drop-ball restarts are deferred to a follow-up.
  _triggerInjury(victim) {
    if (!victim || victim.state.sentOff) return;
    const r = this.rng();
    const isSerious = r < 0.10;
    const pauseTicks = isSerious ? 300 : 80;
    const text = isSerious
      ? `🚑 СЕРЙОЗНА ТРАВМА — ${victim.name} не зможе продовжити.`
      : `🤕 ${victim.name} лежить, отримує допомогу.`;
    this.log({ type: 'event', side: victim.side, text });
    this._startPause('injury', [{ name: 'aftermath', ticks: pauseTicks }], {
      skipDecisions: true,
      onComplete: () => {
        if (isSerious) {
          victim.state.sentOff = true;
          // Note: doc would auto-sub here; we let the AI/UI handle subs as a
          // follow-up. For now the team plays a man down.
          this.log({
            type: 'event', side: victim.side,
            text: `${victim.name} винесли на ношах — ${this.eligible(victim.side).length} гравців.`,
          });
        }
      },
    });
  }

  rollCard(foulerSide, fouler) {
    if (!fouler || fouler.state.sentOff) return null;
    const r = this.rng();
    if (r < 0.005) {
      // Direct red
      fouler.state.sentOff = true;
      this.stats[foulerSide].reds++;
      return { type: 'event', side: foulerSide, text: `🟥 ЧЕРВОНА — ${fouler.name} вилучено! ${this.eligible(foulerSide).length} гравців на полі.` };
    }
    const yellowProb = fouler.state.yellow >= 1 ? 0.05 : 0.18;
    if (r < 0.005 + yellowProb) {
      if (fouler.state.yellow >= 1) {
        fouler.state.sentOff = true;
        fouler.state.yellow = 2;
        this.stats[foulerSide].yellows++;
        this.stats[foulerSide].reds++;
        // S32: red-via-second-yellow → severe morale drop on player + team.
        fouler.state.morale = Math.max(0, (fouler.state.morale || 65) - 8);
        for (const tm of this.teams[foulerSide].onPitch) {
          if (tm.num !== fouler.num && !tm.state.sentOff) {
            tm.state.morale = Math.max(0, (tm.state.morale || 65) - 2);
          }
        }
        return { type: 'event', side: foulerSide, text: `🟨🟨 ДРУГА ЖОВТА — ${fouler.name} вилучено!` };
      }
      fouler.state.yellow = 1;
      this.stats[foulerSide].yellows++;
      // S32: yellow card → mild morale drop on offender.
      fouler.state.morale = Math.max(0, (fouler.state.morale || 65) - 2);
      return { type: 'event', side: foulerSide, text: `🟨 Жовта картка — ${fouler.name}.` };
    }
    return null;
  }

  // Stats getter
  // S82b: snapshot of per-player end-of-match data. Used for post-match
  // player modal — actions, heatmap key, attrs, meta. Lives once match ends
  // and is persisted to MatchResult / Friendly.playersStats.
  getPlayerStats() {
    const out = [];
    for (const side of ['home', 'away']) {
      const all = this.teams[side].onPitch.concat(this.teams[side].bench);
      for (const p of all) {
        out.push({
          side,
          num: p.num,
          name: p.name,
          role: p.role,
          role_kind: p.role_kind,
          duty: p.duty,
          attrs: p.attrs,
          state: {
            goals: p.state.goals || 0,
            assists: p.state.assists || 0,
            morale: Math.round(p.state.morale || 65),
            fitness: Math.round(p.state.fitness || 100),
            yellow: p.state.yellow || 0,
            sentOff: !!p.state.sentOff,
            actions: { ...p.state.actions },
          },
        });
      }
    }
    return out;
  }

  getStats() {
    const s = this.stats;
    const total = Math.max(1, s.home.possessionTicks + s.away.possessionTicks);
    // S80: compute team-level vectors from recovery-X log. Both vectors are
    // mapped to −100..+100 and are relative to the team's attacking direction.
    //   defenseVector  — avg recovery X (high = team wins ball far up the pitch)
    //   pressingVector — % recoveries in opp half (high = aggressive press)
    const computeVectors = (side) => {
      const arr = this._recoveryX[side] || [];
      if (arr.length === 0) return { defenseVector: 0, pressingVector: 0 };
      const attackDir = side === 'home' ? 1 : -1;
      // Anchor at "own 35m line" — empirically the league-average defensive
      // line so a balanced team comes out near 0 instead of always negative.
      const anchorX = side === 'home' ? 35 : 70;
      const avgX = arr.reduce((sum, v) => sum + v, 0) / arr.length;
      const delta = (avgX - anchorX) * attackDir;          // + = higher up the pitch
      // Scale: deep-block side has 35m of range, high-block side has 70m.
      const scale = delta >= 0 ? 70 : 35;
      const defenseVector = Math.round(clamp(delta / scale * 100, -100, 100));
      // pressingVector: % of recoveries on opp half. 50/50 = +0, 80/20 = +60.
      const oppHalf = arr.filter(x => attackDir > 0 ? x > 52.5 : x < 52.5).length;
      const ratio = oppHalf / arr.length;
      const pressingVector = Math.round(clamp((ratio - 0.5) * 200, -100, 100));
      return { defenseVector, pressingVector };
    };
    const vH = computeVectors('home');
    const vA = computeVectors('away');
    // S81: team TTD = sum of all on-ball actions across the squad; error% =
    // (attempted - completed) / attempted. Helps you see who's wasteful.
    const ttdFor = (side) => {
      let attempted = 0, completed = 0;
      for (const p of this.teams[side].onPitch.concat(this.teams[side].bench)) {
        const a = p.state?.actions;
        if (!a) continue;
        attempted += a.passes + a.crosses + a.throughBalls + a.dribbles
                   + a.tacklesAttempted + a.shotsTaken;
        completed += a.passesCompleted + a.crossesCompleted + a.throughBallsCompleted
                   + a.dribblesCompleted + a.tackles + a.shotsOnTarget;
      }
      const errPct = attempted > 0 ? Math.round((attempted - completed) / attempted * 100) : 0;
      return { ttd: attempted, ttdCompleted: completed, ttdErrorPct: errPct };
    };
    const ttdH = ttdFor('home');
    const ttdA = ttdFor('away');
    return {
      home: {
        ...s.home,
        possession: Math.round((s.home.possessionTicks / total) * 100),
        passAcc: s.home.passes ? Math.round(s.home.passesCompleted * 100 / s.home.passes) : null,
        defenseVector: vH.defenseVector,
        pressingVector: vH.pressingVector,
        ttd: ttdH.ttd,
        ttdCompleted: ttdH.ttdCompleted,
        ttdErrorPct: ttdH.ttdErrorPct,
      },
      away: {
        ...s.away,
        possession: Math.round((s.away.possessionTicks / total) * 100),
        passAcc: s.away.passes ? Math.round(s.away.passesCompleted * 100 / s.away.passes) : null,
        defenseVector: vA.defenseVector,
        pressingVector: vA.pressingVector,
        ttd: ttdA.ttd,
        ttdCompleted: ttdA.ttdCompleted,
        ttdErrorPct: ttdA.ttdErrorPct,
      },
    };
  }

  // ----------------------------------------------------------------------
  // LOG
  // ----------------------------------------------------------------------

  // Sprint 17: pause foundation — unified state machine for all stoppages.
  // Phase config is an ordered list e.g. [{name:'setup', ticks:50}, {name:'aftermath', ticks:30}].
  // Caller passes context (handlerNum, handlerSide, onComplete callback, etc.).
  _startPause(type, phaseConfig, context = {}) {
    if (this.pause.active) {
      // Queue if a pause is already running. Priority handled by ordering at
      // queue-insertion time (S17 keeps simple FIFO; S22+ adds priority weight).
      this.pauseQueue.push({ type, phaseConfig, context });
      return;
    }
    if (!phaseConfig || phaseConfig.length === 0) return;
    this.pause.active = true;
    this.pause.type = type;
    this.pause.phaseConfig = phaseConfig;
    this.pause.phaseIdx = 0;
    this.pause.phase = phaseConfig[0].name;
    this.pause.phaseTimer = 0;
    this.pause.phaseMax = phaseConfig[0].ticks;
    this.pause.startTick = this.tickCount;
    this.pause.context = context;
  }

  _pauseTick() {
    if (!this.pause.active) return;
    this.pause.phaseTimer++;
    if (this.pause.phaseTimer >= this.pause.phaseMax) {
      this.pause.phaseIdx++;
      if (this.pause.phaseIdx >= this.pause.phaseConfig.length) {
        this._endPause();
      } else {
        const next = this.pause.phaseConfig[this.pause.phaseIdx];
        this.pause.phase = next.name;
        this.pause.phaseTimer = 0;
        this.pause.phaseMax = next.ticks;
        const cb = this.pause.context?.onPhaseChange;
        if (typeof cb === 'function') cb(next.name);
      }
    }
  }

  _endPause() {
    if (!this.pause.active) return;
    // Accumulate added time using doc's per-type multipliers.
    const durationTicks = this.tickCount - this.pause.startTick;
    const durationSec = durationTicks * 0.1;
    const PAUSE_ADDED_TIME_MULT = {
      goal: 1.0, injury: 1.0, var_check: 1.0,
      substitution: 0.7, card: 0.5,
      free_kick: 0.3, corner: 0.2,
      throw_in: 0.0, goal_kick: 0.0,
      half_time: 0.0, cooling: 0.0, offside: 0.4,
    };
    const m = PAUSE_ADDED_TIME_MULT[this.pause.type] ?? 0.5;
    const halfKey = this.phase === 'second' ? 'secondHalf' : 'firstHalf';
    this.addedTime[halfKey] += durationSec * m;
    const cb = this.pause.context?.onComplete;
    // Reset state before callback (so callback can start a new pause if needed).
    this.pause.active = false;
    this.pause.type = null;
    this.pause.phase = null;
    this.pause.phaseConfig = null;
    this.pause.phaseTimer = 0;
    this.pause.phaseMax = 0;
    this.pause.context = null;
    if (typeof cb === 'function') cb();
    // Drain queue.
    if (!this.pause.active && this.pauseQueue.length > 0) {
      const next = this.pauseQueue.shift();
      this._startPause(next.type, next.phaseConfig, next.context);
    }
  }

  // Speed cap during the setup/ready phases of a pause: outfield players who
  // aren't the designated handler walk (max 5 m/s), not sprint. Lets
  // choreographies like "everyone clears the box for a penalty" look natural.
  // Note: 'aftermath' phase is NOT capped — celebrations need scorer to sprint
  // to the corner, while losing-team slow walk emerges naturally from
  // MOVE_TO_POSITION's non-sprint baseline.
  _applyPauseSpeedCap(p) {
    if (!this.pause.active) return;
    if (this.pause.phase !== 'setup' && this.pause.phase !== 'ready') return;
    const ctx = this.pause.context;
    if (ctx && p.num === ctx.handlerNum && p.side === ctx.handlerSide) return;
    const maxSpeed = this.pause.phase === 'ready' ? 3.0 : 5.0;
    const speed = Math.hypot(p.vx, p.vy);
    if (speed > maxSpeed) {
      p.vx *= maxSpeed / speed;
      p.vy *= maxSpeed / speed;
    }
  }

  log(ev) {
    const e = { ...ev, t: this.gameTime, phase: this.phase, num: this.events.length + 1, tick: this.tickCount };
    this.events.push(e);
    if (this.events.length > 600) this.events.splice(0, 100);
  }

  // Legacy shims (used by ai.js / ui.js)
  get ball_holderIdx() {
    if (!this.ball.ownerSide) return -1;
    return this.teams[this.ball.ownerSide].onPitch.findIndex(p => p.num === this.ball.ownerNum);
  }
  // eligible(side) — used by AI for filtering sent-off
  eligible(side) {
    return this.teams[side].onPitch.filter(p => !p.state.sentOff);
  }
  // For UI compatibility
  get _legacyBallShim() {
    // Translate (x, y, ownerSide) into the old (zone, side, holderIdx) shape on demand.
    // Used by some renderer code for fallback ball anchoring.
    const side = this.ball.ownerSide || this.ball.lastTouchSide || 'home';
    const z = side === 'home' ? this.ball.x / 1.05 : (105 - this.ball.x) / 1.05;
    const holderIdx = side ? this.teams[side].onPitch.findIndex(p => p.num === this.ball.ownerNum) : -1;
    return { side, zone: clamp(z, 0, 100), holderIdx };
  }
}

// =========================================================================
// HELPERS
// =========================================================================

function blankStats() {
  return {
    possessionTicks: 0,
    shots: 0, onTarget: 0, xg: 0,
    passes: 0, passesCompleted: 0,
    fouls: 0, corners: 0, tackles: 0, interceptions: 0,
    yellows: 0, reds: 0, offsides: 0,
  };
}

function pickBest(arr, scoreFn) {
  let best = null, bestS = -Infinity;
  for (const a of arr) { if (a.state?.sentOff) continue; const s = scoreFn(a); if (s > bestS) { bestS = s; best = a; } }
  return best;
}

function closestPlayer(arr, x, y) {
  let best = null, bestD = Infinity;
  for (const p of arr) { if (p.state?.sentOff) continue; const d = dist(p.x, p.y, x, y); if (d < bestD) { bestD = d; best = p; } }
  return best;
}

function describeTacticalChange(payload) {
  const parts = [];
  if (payload.formation) parts.push(`схема → ${payload.formation}`);
  if (payload.mentality !== undefined) parts.push(`мент. ${payload.mentality > 0 ? '+' : ''}${payload.mentality}`);
  if (payload.tempo) parts.push(`темп ${payload.tempo}`);
  if (payload.pressHeight) parts.push(`висота пресу ${payload.pressHeight}`);
  if (payload.pressInt) parts.push(`інтенс. пресу ${payload.pressInt}`);
  if (payload.defLine) parts.push(`лінія захисту ${payload.defLine}`);
  if (payload.width) parts.push(`ширина ${payload.width}`);
  if (payload.passing) parts.push(`пас ${payload.passing}`);
  return parts.join(', ');
}

// =========================================================================
// HEADLESS SIMULATION (for batch testing)
// =========================================================================

export function simulateMatch(setup) {
  const e = new MatchEngine(setup);
  while (e.phase !== 'full') {
    if (e.phase === 'halftime') {
      e.halftimeRemaining = 0;
      e.phase = 'second';
      e.applyReadyChanges();
      e.setupKickoff('away');
      continue;
    }
    e.tick();
  }
  return { score: { ...e.score }, stats: e.getStats() };
}

export function batchSimulate(buildSetup, n = 10) {
  const totals = { homeGoals: 0, awayGoals: 0, home: blankAgg(), away: blankAgg() };
  for (let i = 0; i < n; i++) {
    const r = simulateMatch(buildSetup(i));
    totals.homeGoals += r.score.home;
    totals.awayGoals += r.score.away;
    accAgg(totals.home, r.stats.home);
    accAgg(totals.away, r.stats.away);
  }
  return {
    matches: n,
    avg: {
      homeGoals: round1(totals.homeGoals / n),
      awayGoals: round1(totals.awayGoals / n),
      home: avgAgg(totals.home, n),
      away: avgAgg(totals.away, n),
    },
  };
}
function blankAgg() { return { possession: 0, shots: 0, onTarget: 0, xg: 0, passes: 0, passAcc: 0, fouls: 0, corners: 0, tackles: 0 }; }
function accAgg(a, s) { for (const k of Object.keys(a)) a[k] += (s[k] != null ? s[k] : 0); }
function avgAgg(a, n) { const o = {}; for (const [k, v] of Object.entries(a)) o[k] = (k === 'xg') ? +(v / n).toFixed(2) : Math.round(v / n); return o; }
function round1(x) { return Math.round(x * 10) / 10; }
