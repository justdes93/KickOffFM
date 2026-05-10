// Match engine for Kick-Off FM prototype.
// Tick = 3 game seconds. 1 game half = 2700 sec = 900 ticks.
// Tactical changes apply with hidden lag of 3-5 game minutes (uniform random)
// from moment of submission. During halftime: 0 lag.

import { FORMATIONS } from './data.js';

const TICK_SEC = 3;          // game seconds per tick
const HALF_LEN = 2700;       // seconds per half
const HALFTIME_REAL_SEC = 180;

export class MatchEngine {
  constructor({ home, away, homeTactics, awayTactics, homeLineup, awayLineup, rng }) {
    this.rng = rng || mulberry32(Date.now() & 0xffffffff);
    this.gameTime = 0;
    this.phase = 'first';     // first | halftime | second | full
    this.halftimeRemaining = HALFTIME_REAL_SEC;
    this.score = { home: 0, away: 0 };
    this.events = [];
    this.tickCount = 0;
    this.subsUsed = { home: 0, away: 0 };
    this.maxSubs = 5;

    this.teams = {
      home: this.makeRuntimeTeam(home, homeLineup, homeTactics, 'home'),
      away: this.makeRuntimeTeam(away, awayLineup, awayTactics, 'away'),
    };

    // Visibility: opponent only sees home's tactics that have *taken effect*.
    // For prototype: AI sees all of player's stuff (it's an AI and doesn't cheat
    // beyond what's needed); player only sees opponent's formation + mentality
    // currently active. Hidden tactics surface via play feel.
    this.aiKnowsPlayer = true;

    this.pendingChanges = [];   // {side, payload, applyAt}
    this.pendingSetPiece = null; // {type: 'PEN'|'CORNER', side}
    this.stats = {
      home: blankStats(),
      away: blankStats(),
    };

    // Ball: zone 0..100 from possessor's own goal.
    // Start with kickoff; assign ball to home center forward area.
    this.ball = { zone: 50, holderIdx: null, side: 'home' };
    this.assignKickoffHolder('home');

    this.log({ type: 'system', text: `Kick-off! ${home.name} vs ${away.name}.` });
  }

  // ---------- Setup ----------
  makeRuntimeTeam(team, lineup, tactics, side) {
    const onPitch = lineup.lineup.map(({ slot, player }) => ({
      ...clonePlayer(player), slot
    }));
    const bench = lineup.bench.map(p => clonePlayer(p));
    return {
      meta: team,
      side,
      onPitch,
      bench,
      tactics: { ...tactics },
      formation: tactics.formation,
    };
  }

  assignKickoffHolder(side) {
    const team = this.teams[side];
    // Pick striker/AM-ish slot, excluding sent-off
    let idx = team.onPitch.findIndex(p => !p.state.sentOff && (p.slot.role === 'ST' || p.slot.role === 'AM'));
    if (idx < 0) idx = team.onPitch.findIndex(p => !p.state.sentOff && p.role !== 'GK');
    if (idx < 0) idx = team.onPitch.findIndex(p => !p.state.sentOff);
    this.ball.side = side;
    this.ball.holderIdx = Math.max(0, idx);
    this.ball.zone = 50;
  }

  // ---------- Tactical changes ----------
  submitTacticalChange(side, payload) {
    // Filter only changed fields vs current
    const cur = this.teams[side].tactics;
    const diff = {};
    for (const k of Object.keys(payload)) {
      if (payload[k] !== undefined && payload[k] !== cur[k]) diff[k] = payload[k];
    }
    if (Object.keys(diff).length === 0) return null;

    let applyAt;
    if (this.phase === 'halftime') {
      applyAt = HALF_LEN;     // applied at start of 2nd half
    } else {
      const lag = 180 + Math.floor(this.rng() * 121); // 180..300 game seconds
      applyAt = this.gameTime + lag;
    }
    const change = { id: cryptoId(this.rng), side, payload: diff, applyAt, submittedAt: this.gameTime };
    this.pendingChanges.push(change);
    return change;
  }

  cancelPendingChange(id) {
    this.pendingChanges = this.pendingChanges.filter(c => c.id !== id);
  }

  applyReadyChanges() {
    const remaining = [];
    for (const c of this.pendingChanges) {
      if (c.applyAt <= this.gameTime) {
        Object.assign(this.teams[c.side].tactics, c.payload);
        if (c.payload.formation) {
          this.teams[c.side].formation = c.payload.formation;
          this.reslotForFormation(c.side, c.payload.formation);
        }
        const summary = describeChange(c.payload);
        this.log({
          type: 'tactical', side: c.side,
          text: `${this.teams[c.side].meta.short}: ${summary} took effect.`,
        });
      } else {
        remaining.push(c);
      }
    }
    this.pendingChanges = remaining;
  }

  reslotForFormation(side, formation) {
    // Re-slot existing on-pitch players to closest position by role compatibility.
    const slots = FORMATIONS[formation];
    if (!slots) return;
    const team = this.teams[side];
    const players = [...team.onPitch];
    const reassigned = [];
    const used = new Set();
    for (const slot of slots) {
      const candidates = players
        .filter(p => !used.has(p.num))
        .map(p => ({ p, score: (p.role === slot.role ? 10 : 0) - dist(p.slot, slot) * 5 }))
        .sort((a, b) => b.score - a.score);
      const pick = candidates[0]?.p;
      if (pick) {
        used.add(pick.num);
        reassigned.push({ ...pick, slot });
      }
    }
    team.onPitch = reassigned;
  }

  // ---------- Substitutions ----------
  substitute(side, outNum, inNum) {
    const team = this.teams[side];
    if (this.subsUsed[side] >= this.maxSubs) return { ok: false, reason: 'max_subs' };
    const outIdx = team.onPitch.findIndex(p => p.num === outNum);
    const benchIdx = team.bench.findIndex(p => p.num === inNum);
    if (outIdx < 0 || benchIdx < 0) return { ok: false, reason: 'not_found' };
    const outP = team.onPitch[outIdx];
    const inP  = team.bench[benchIdx];
    if (outP.state.sentOff) return { ok: false, reason: 'sent_off' };
    inP.slot = outP.slot;
    team.onPitch[outIdx] = inP;
    team.bench[benchIdx] = outP;
    this.subsUsed[side]++;
    this.log({
      type: 'system', side,
      text: `${team.meta.short} sub: ${outP.name} ⇄ ${inP.name}`,
    });
    return { ok: true };
  }

  // ---------- Tick ----------
  tick() {
    if (this.phase === 'full') return;
    if (this.phase === 'halftime') {
      this.halftimeRemaining -= 1;
      if (this.halftimeRemaining <= 0) {
        this.phase = 'second';
        this.applyReadyChanges();   // halftime changes go in here
        this.assignKickoffHolder('away'); // 2nd half kickoff = other side
        this.log({ type: 'system', text: '2nd half — kick off!' });
      }
      return;
    }

    this.gameTime += TICK_SEC;
    this.tickCount++;

    // 1. Apply ready tactical changes
    this.applyReadyChanges();

    // 2. Player drift: fatigue rises, fitness falls.
    this.updatePlayerStates();

    // 3. Resolve action — set piece takes priority
    let ev;
    if (this.pendingSetPiece) {
      const sp = this.pendingSetPiece;
      this.pendingSetPiece = null;
      if (sp.type === 'PEN') ev = this.resolvePenalty(sp.side);
      else if (sp.type === 'CORNER') ev = this.resolveCornerKick(sp.side);
      else ev = this.resolveAction();
    } else {
      ev = this.resolveAction();
    }
    if (ev) this.log(ev);

    // 4. Possession stat
    this.stats[this.ball.side].possessionTicks++;

    // 5. Phase transitions
    if (this.gameTime >= HALF_LEN && this.phase === 'first') {
      this.phase = 'halftime';
      this.halftimeRemaining = HALFTIME_REAL_SEC;
      this.log({ type: 'system', text: `Half time. ${this.score.home}–${this.score.away}.` });
    } else if (this.gameTime >= HALF_LEN * 2 && this.phase === 'second') {
      this.phase = 'full';
      this.log({ type: 'system', text: `Full time. ${this.score.home}–${this.score.away}.` });
    }
  }

  updatePlayerStates() {
    for (const side of ['home', 'away']) {
      for (const p of this.teams[side].onPitch) {
        if (p.state.sentOff) continue;
        const intensity = pressIntensityVal(this.teams[side].tactics.pressInt);
        const tempo = tempoVal(this.teams[side].tactics.tempo);
        const drainRate = 0.025 * (0.7 + intensity * 0.5 + tempo * 0.3);
        p.state.fatigue = Math.min(100, p.state.fatigue + drainRate);
        p.state.fitness = Math.max(0, 100 - p.state.fatigue);
      }
    }
  }

  // ---------- Action resolver ----------
  // Tuned to real-football frequencies: pass-dominated, shots rare even in attacking third.
  // Targets per team per match: ~12 shots, ~1.3 goals, ~500 passes, ~85% pass accuracy.
  resolveAction() {
    const side = this.ball.side;
    const team = this.teams[side];
    const opp = this.teams[other(side)];
    const holder = team.onPitch[this.ball.holderIdx] || team.onPitch[0];
    if (!holder) return null;

    // ~30% of ticks are "ball in transit / off-the-ball": no discrete action recorded.
    // This brings per-match counters in line with real football volumes.
    if (this.rng() < 0.30) {
      const r = this.rng();
      // Off-ball foul (shirt-pulling, midfield scuffles, etc.)
      if (r < 0.035) {
        const fouled = pickRandom(this.eligible(other(side)).filter(p => p.role !== 'GK'), this.rng);
        const fouler = pickRandom(this.eligible(side).filter(p => p.role !== 'GK'), this.rng);
        return this.awardFoul({
          fouledSide: other(side),
          foulerSide: side,
          fouler,
          fouled,
          zoneAtt: 100 - this.ball.zone,  // foul location from fouled team's view
        });
      }
      // Off-ball tackle / interception in transit (silent stat bump for defending team)
      if (r < 0.06) {
        this.stats[other(side)].tackles++;
      }
      return null;
    }

    const zone = this.ball.zone;
    const press = this.opponentPressureOn(holder, side);
    const t = team.tactics;
    const ment = mentalityVal(t.mentality);
    const inAtkThird = zone > 65;
    const inPenArea = zone > 82;
    const wideHolder = holder.slot && (holder.slot.y < 0.20 || holder.slot.y > 0.80);

    // PASS_SHORT is dominant action (real football: ~70-80% of touches are short passes).
    // Other actions are clamped to small weights so the lottery doesn't over-fire.
    const weights = {
      PASS_SHORT:
        100 + holder.attrs.pa * 0.35
        + (t.passing === 'short' ? 22 : t.passing === 'long' || t.passing === 'direct' ? -22 : 0)
        + (t.tempo === 'slow' ? 12 : t.tempo === 'fast' ? -8 : 0)
        - press * 28,

      PASS_BACK:
        18 + Math.max(0, -ment) * 6 + press * 14
        + (t.tempo === 'slow' ? 6 : 0)
        + (zone > 50 ? 0 : 6),

      PASS_LONG:
        6 + holder.attrs.pa * 0.10
        + (t.passing === 'long' ? 22 : t.passing === 'direct' ? 16 : 0)
        + (zone < 30 ? 4 : 0),

      DRIBBLE:
        (inAtkThird ? 2.5 : 1.5)
        + holder.attrs.dr * (inAtkThird ? 0.06 : 0.03)
        - press * 1.5,

      SHOOT:
        inPenArea
          ? (3.5 + holder.attrs.sh * 0.15 + ment * 1.1 - press * 1.5)
          : inAtkThird
            ? (0.5 + holder.attrs.sh * 0.035 + (zone - 65) * 0.08 + ment * 0.3)
            : 0,

      CROSS:
        (zone > 62 && wideHolder)
          ? (1.8 + holder.attrs.pa * 0.04 + (t.width === 'wide' ? 2 : 0))
          : 0,

      HOLD:
        2 + holder.attrs.co * 0.04,

      CLEAR:
        zone < 22 ? (3 + (t.passing === 'long' ? 4 : 0) + press * 8) : 0,
    };

    for (const k of Object.keys(weights)) weights[k] = Math.max(0, weights[k]);

    const action = weightedPick(weights, this.rng);

    switch (action) {
      case 'SHOOT':      return this.resolveShoot(holder, side, opp);
      case 'PASS_SHORT': return this.resolvePass(holder, side, opp, 'short');
      case 'PASS_BACK':  return this.resolvePass(holder, side, opp, 'back');
      case 'PASS_LONG':  return this.resolvePass(holder, side, opp, 'long');
      case 'DRIBBLE':    return this.resolveDribble(holder, side, opp);
      case 'CROSS':      return this.resolveCross(holder, side, opp);
      case 'CLEAR':      return this.resolveClear(holder, side);
      case 'HOLD':
      default:           return this.resolveHold(holder, side);
    }
  }

  opponentPressureOn(holder, side) {
    const opp = this.teams[other(side)];
    const pi = pressIntensityVal(opp.tactics.pressInt);
    const ph = pressHeightMatchesZone(opp.tactics.pressHeight, this.ball.zone);
    return Math.min(1, pi * (0.5 + ph));
  }

  resolveShoot(holder, side, opp) {
    const zone = this.ball.zone;
    const gk = opp.onPitch.find(p => p.role === 'GK') || opp.onPitch[0];
    // distance approximated in metres (zone 100 = goal line, ~100m field)
    const distance = Math.max(6, 100 - zone);

    // xG model — exponential decay from ~0.30 at 6m to ~0.04 at 25m, average ≈ 0.10.
    let xG = 0.32 * Math.exp(-(distance - 6) / 8.5);
    xG += (holder.attrs.sh - 70) * 0.0025;
    xG += (holder.attrs.co - 70) * 0.0010;
    xG -= (gk.attrs.gk_reflexes - 70) * 0.0030;
    const blockers = opp.onPitch.filter(p => ['CB','FB','DM'].includes(p.role)).length;
    xG -= blockers * 0.008;
    xG = Math.max(0.01, Math.min(0.55, xG));

    this.stats[side].shots++;
    this.stats[side].xg += xG;
    const team = this.teams[side];
    const r = this.rng();

    if (r < xG) {
      // GOAL
      this.score[side]++;
      this.stats[side].onTarget++;
      this.ball.zone = 50;
      this.ball.side = other(side);
      this.assignKickoffHolder(other(side));
      return {
        type: 'goal', side,
        text: `⚽ GOAL! ${holder.name} (${team.meta.short}) finishes from ${distance | 0}m. xG ${xG.toFixed(2)}. ${this.scoreLine()}`
      };
    }

    // Outcome split — approx real-football proportions:
    //   33% saved (on target), 25% blocked, 42% off target. Some blocks → corner.
    const out = this.rng();
    let outcome;
    if (out < 0.33) outcome = 'saved';
    else if (out < 0.58) outcome = 'blocked';
    else outcome = 'off';

    if (outcome === 'saved') {
      this.stats[side].onTarget++;
      // GK collects most of the time; sometimes deflects to corner
      if (this.rng() < 0.55) {
        this.awardCorner(side);
        return {
          type: 'shot', side,
          text: `🥅 ${holder.name}'s shot saved by ${gk.name}, parried for a corner. xG ${xG.toFixed(2)}.`
        };
      }
      this.ball.side = other(side);
      this.ball.zone = 12;
      this.assignHolderByRole(other(side), 'GK');
      return {
        type: 'shot', side,
        text: `🥅 ${holder.name}'s shot held by ${gk.name}. xG ${xG.toFixed(2)}.`
      };
    }

    if (outcome === 'blocked') {
      // Blocked — chance for corner, chance ball stays with attackers (rebound), else turnover
      const r2 = this.rng();
      if (r2 < 0.45) {
        this.awardCorner(side);
        return {
          type: 'shot', side,
          text: `🛡️ ${holder.name}'s shot is blocked, deflects out for a corner. xG ${xG.toFixed(2)}.`
        };
      }
      if (r2 < 0.70) {
        // rebound stays with attacking team
        this.ball.zone = Math.max(70, zone - 8);
        this.pickReceiver(side, 'forward');
        return {
          type: 'shot', side,
          text: `🛡️ ${holder.name}'s shot is blocked — ${this.currentHolderName(side)} picks up the rebound. xG ${xG.toFixed(2)}.`
        };
      }
      // turnover to defenders
      this.ball.side = other(side);
      this.ball.zone = 100 - zone + 5;
      this.assignHolderByRole(other(side), 'CB');
      return {
        type: 'shot', side,
        text: `🛡️ ${holder.name}'s shot is blocked and cleared. xG ${xG.toFixed(2)}.`
      };
    }

    // Off target — goal kick
    this.ball.side = other(side);
    this.ball.zone = 12;
    this.assignHolderByRole(other(side), 'GK');
    return {
      type: 'shot', side,
      text: `🚫 ${holder.name}'s shot from ${distance | 0}m goes wide. xG ${xG.toFixed(2)}.`
    };
  }

  resolvePass(holder, side, opp, type) {
    const team = this.teams[side];
    const zone = this.ball.zone;
    const press = this.opponentPressureOn(holder, side);

    // Zone-based base accuracy: easier in own half, harder in attacking third.
    let baseSucc;
    if (type === 'short')      baseSucc = 0.97 - zone * 0.0020;   // 0.97 → 0.77
    else if (type === 'back')  baseSucc = 0.98;                   // recycle is reliable
    else                       baseSucc = 0.74 - zone * 0.0015;   // long balls

    const succ = baseSucc
      + (holder.attrs.pa - 70) * 0.0030
      + (holder.attrs.vi - 70) * 0.0015
      - press * 0.14;

    const r = this.rng();
    this.stats[side].passes++;

    if (r < succ) {
      this.stats[side].passesCompleted++;
      let advance;
      if (type === 'short')      advance = randInt(this.rng, 2, 7);    // slow buildup
      else if (type === 'back')  advance = randInt(this.rng, -8, 1);   // recycle backwards
      else                       advance = randInt(this.rng, 12, 22);  // long ball
      const newZone = Math.max(0, Math.min(100, zone + advance));

      // Offside check on through-balls / long balls into final third.
      // Real frequency ≈ 2 per team per match; calibrated empirically below.
      const offsideChance =
        (type === 'long' && newZone > 78) ? 0.10 :
        (type === 'short' && advance >= 5 && newZone > 86) ? 0.06 :
        0;
      if (offsideChance > 0 && this.rng() < offsideChance) {
        this.stats[side].offsides++;
        this.ball.side = other(side);
        this.ball.zone = 28; // free kick to defenders just outside their box
        this.assignHolderByRole(other(side), 'CB');
        return {
          type: 'event', side: other(side),
          text: `🚩 Offside flagged — ${holder.name}'s ${type === 'long' ? 'long ball' : 'through ball'} catches a teammate beyond the last defender.`,
        };
      }

      this.ball.zone = newZone;
      this.pickReceiver(side, type === 'long' ? 'forward' : type === 'back' ? 'back' : 'mid');

      // Quiet most short passes — log only progressive ones to keep commentary signal/noise sane.
      if (type === 'back') return null;
      if (type === 'short' && advance < 4 && this.rng() < 0.7) return null;

      return {
        type: 'event', side,
        text: type === 'long'
          ? `${holder.name} plays a long ball forward to ${this.currentHolderName(side)}.`
          : `${team.meta.short}: ${holder.name} → ${this.currentHolderName(side)}.`,
      };
    }

    // Misplaced / intercepted
    this.ball.side = other(side);
    this.ball.zone = 100 - this.ball.zone;
    this.assignHolderByRole(other(side), pickContextRole(this.ball.zone));
    return {
      type: 'event', side: other(side),
      text: `${holder.name}'s ${type === 'long' ? 'long ball' : 'pass'} intercepted by ${this.currentHolderName(other(side))}.`,
    };
  }

  resolveDribble(holder, side, opp) {
    const press = this.opponentPressureOn(holder, side);
    const defenderQ = avgAttr(opp.onPitch, 'df');
    const succ = 0.55 + (holder.attrs.dr - 70) * 0.006 - (defenderQ - 70) * 0.004 - press * 0.18;
    const r = this.rng();
    if (r < succ) {
      this.ball.zone = Math.min(100, this.ball.zone + randInt(this.rng, 4, 10));
      return { type: 'event', side, text: `${holder.name} beats his man.` };
    } else {
      // Foul or turnover
      const fouled = this.rng() < 0.22;
      if (fouled) {
        const fouler = pickRandom(this.eligible(other(side)).filter(p => ['CB','FB','DM','CM'].includes(p.role)), this.rng);
        return this.awardFoul({
          fouledSide: side,
          foulerSide: other(side),
          fouler,
          fouled: holder,
          zoneAtt: this.ball.zone,
        });
      }
      this.stats[other(side)].tackles++;
      this.ball.side = other(side);
      this.ball.zone = 100 - this.ball.zone;
      this.assignHolderByRole(other(side), pickContextRole(this.ball.zone));
      return { type: 'event', side: other(side), text: `${this.currentHolderName(other(side))} dispossesses ${holder.name}.` };
    }
  }

  resolveCross(holder, side, opp) {
    const succ = 0.45 + (holder.attrs.pa - 70) * 0.005;
    const r = this.rng();
    this.stats[side].passes++;
    if (r < succ) {
      this.stats[side].passesCompleted++;
      // Cross arrives in box - chance of immediate shot
      if (this.rng() < 0.55) {
        this.pickReceiver(side, 'forward');
        this.ball.zone = 88;
        return this.resolveShoot(this.teams[side].onPitch[this.ball.holderIdx], side, opp);
      }
      this.ball.zone = 80;
      this.pickReceiver(side, 'forward');
      return { type: 'event', side, text: `${holder.name} swings in a cross — ${this.currentHolderName(side)} controls.` };
    }
    // Failed cross: ~50% goes out for a corner (deflected by defender), else clean clearance.
    if (this.rng() < 0.50) {
      this.awardCorner(side);
      return { type: 'event', side, text: `${holder.name}'s cross is deflected behind — corner.` };
    }
    this.ball.side = other(side);
    this.ball.zone = 100 - 80;
    this.assignHolderByRole(other(side), 'CB');
    return { type: 'event', side: other(side), text: `${holder.name}'s cross is cleared.` };
  }

  resolveClear(holder, side) {
    this.ball.zone = Math.min(100, this.ball.zone + randInt(this.rng, 25, 40));
    // 50/50 if it ends in possession
    if (this.rng() < 0.45) {
      this.pickReceiver(side, 'forward');
      return { type: 'event', side, text: `${holder.name} hoofs it forward — ${this.currentHolderName(side)} latches on.` };
    } else {
      this.ball.side = other(side);
      this.ball.zone = 100 - this.ball.zone;
      this.assignHolderByRole(other(side), pickContextRole(this.ball.zone));
      return { type: 'event', side: other(side), text: `Long clearance, ${this.currentHolderName(other(side))} collects.` };
    }
  }

  resolveHold(holder, side) {
    // Silent: holding the ball is not match-event-worthy noise.
    return null;
  }

  // ---------- Holder assignment helpers ----------
  eligible(side) {
    return this.teams[side].onPitch.filter(p => !p.state.sentOff);
  }

  pickReceiver(side, where) {
    const team = this.teams[side];
    const candidates = this.eligible(side).filter(p => p.role !== 'GK');
    const currentHolder = team.onPitch[this.ball.holderIdx];
    const holderY = currentHolder?.slot?.y ?? 0.5;
    let pool;
    if (where === 'forward') pool = candidates.filter(p => ['ST','W','AM'].includes(p.role));
    else if (where === 'back') {
      // Back-pass: prefer same-flank defender / DM. No cross-field cannon to other side.
      pool = candidates.filter(p =>
        ['CB','FB','DM'].includes(p.role) &&
        Math.abs((p.slot?.y ?? 0.5) - holderY) < 0.4
      );
      if (pool.length === 0) pool = candidates.filter(p => ['CB','FB','DM'].includes(p.role) && Math.abs((p.slot?.y ?? 0.5) - holderY) < 0.6);
    }
    else pool = candidates.filter(p => ['CM','AM','DM','W'].includes(p.role));
    if (pool.length === 0) pool = candidates.length ? candidates : this.eligible(side);
    if (pool.length === 0) { this.ball.holderIdx = 0; return; }
    const pick = pool[Math.floor(this.rng() * pool.length)];
    this.ball.holderIdx = team.onPitch.indexOf(pick);
  }

  assignHolderByRole(side, role) {
    const team = this.teams[side];
    const eligible = this.eligible(side);
    let idx = team.onPitch.findIndex(p => p.role === role && !p.state.sentOff);
    if (idx < 0) idx = team.onPitch.findIndex(p => p.role !== 'GK' && !p.state.sentOff);
    if (idx < 0) idx = team.onPitch.findIndex(p => !p.state.sentOff);
    this.ball.side = side;
    this.ball.holderIdx = Math.max(0, idx);
  }

  assignHolderByNum(side, num) {
    const team = this.teams[side];
    const idx = team.onPitch.findIndex(p => p.num === num);
    if (idx >= 0) {
      this.ball.side = side;
      this.ball.holderIdx = idx;
    }
  }

  // ---------- Set pieces ----------
  // Award a corner: stat counter + queue resolution for next tick.
  awardCorner(side) {
    this.stats[side].corners++;
    this.pendingSetPiece = { type: 'CORNER', side };
    this.ball.zone = 100;  // visual: ball at corner flag
    this.ball.side = side;
  }

  resolveCornerKick(side) {
    const team = this.teams[side];
    const opp = this.teams[other(side)];
    const kicker = pickBestPasser(team) || team.onPitch[0];
    const target = pickBestHeader(team) || team.onPitch[1];
    const r = this.rng();

    // 55% delivery reaches box and is contested
    if (r < 0.55) {
      const r2 = this.rng();
      if (r2 < 0.32) {
        // Attacker wins header / scrappy chance — shot attempt
        this.assignHolderByNum(side, target.num);
        this.ball.zone = 90;
        const xG = 0.13 + (target.attrs.ph - 70) * 0.0025 + (target.attrs.sh - 70) * 0.0015;
        const xGc = Math.max(0.04, Math.min(0.40, xG));
        this.stats[side].shots++;
        this.stats[side].xg += xGc;
        if (this.rng() < xGc) {
          this.score[side]++;
          this.stats[side].onTarget++;
          this.ball.zone = 50;
          this.ball.side = other(side);
          this.assignKickoffHolder(other(side));
          return {
            type: 'goal', side,
            text: `⚽ GOAL from the corner! ${target.name} (${team.meta.short}) heads home from ${kicker.name}'s delivery. xG ${xGc.toFixed(2)}. ${this.scoreLine()}`
          };
        }
        // Saved or off
        const out = this.rng();
        if (out < 0.50) {
          this.stats[side].onTarget++;
          this.ball.side = other(side);
          this.ball.zone = 12;
          this.assignHolderByRole(other(side), 'GK');
          return { type: 'shot', side, text: `🥅 ${target.name}'s header from the corner saved. xG ${xGc.toFixed(2)}.` };
        }
        this.ball.side = other(side);
        this.ball.zone = 12;
        this.assignHolderByRole(other(side), 'GK');
        return { type: 'shot', side, text: `🚫 ${target.name}'s header from the corner goes wide. xG ${xGc.toFixed(2)}.` };
      }
      // Defender clears
      this.ball.side = other(side);
      this.ball.zone = 100 - 75;
      this.assignHolderByRole(other(side), 'CB');
      return { type: 'event', side: other(side), text: `${kicker.name}'s corner is cleared by the defence.` };
    }
    // Weak corner — opp easily collects
    this.ball.side = other(side);
    this.ball.zone = 100 - 80;
    this.assignHolderByRole(other(side), 'CB');
    return { type: 'event', side: other(side), text: `${kicker.name}'s corner is overhit — possession to ${opp.meta.short}.` };
  }

  resolvePenalty(side) {
    const team = this.teams[side];
    const opp = this.teams[other(side)];
    const taker = pickBestShooter(team) || team.onPitch[0];
    const gk = opp.onPitch.find(p => p.role === 'GK' && !p.state.sentOff) || opp.onPitch[0];

    // Real PL conversion ~78%; tweak slightly by taker quality and GK quality.
    let xG = 0.78 + (taker.attrs.sh - 70) * 0.002 - (gk.attrs.gk_reflexes - 70) * 0.003;
    xG = Math.max(0.55, Math.min(0.92, xG));

    this.stats[side].shots++;
    this.stats[side].xg += xG;

    if (this.rng() < xG) {
      this.score[side]++;
      this.stats[side].onTarget++;
      this.ball.zone = 50;
      this.ball.side = other(side);
      this.assignKickoffHolder(other(side));
      return {
        type: 'goal', side,
        text: `⚽ PENALTY scored! ${taker.name} (${team.meta.short}) sends ${gk.name} the wrong way. ${this.scoreLine()}`
      };
    }
    // Miss: 60% saved (on target), 40% off-target
    if (this.rng() < 0.60) {
      this.stats[side].onTarget++;
      this.ball.side = other(side);
      this.ball.zone = 12;
      this.assignHolderByRole(other(side), 'GK');
      return { type: 'shot', side, text: `🥅 PENALTY saved! ${gk.name} guesses right and denies ${taker.name}.` };
    }
    this.ball.side = other(side);
    this.ball.zone = 12;
    this.assignHolderByRole(other(side), 'GK');
    return { type: 'shot', side, text: `🚫 PENALTY missed! ${taker.name} blazes it over.` };
  }

  // ---------- Foul + cards ----------
  awardFoul({ fouledSide, foulerSide, fouler, fouled, zoneAtt }) {
    this.stats[foulerSide].fouls++;

    // Card roll first — if red, the player goes off and ball still goes to fouled team
    const cardEv = this.rollCard(foulerSide, fouler);

    // Set ball to fouled team at foul location
    this.ball.side = fouledSide;
    this.ball.zone = clamp(zoneAtt, 0, 100);

    const headlineFoul = {
      type: 'event', side: foulerSide,
      text: `Foul by ${fouler?.name || '?'}${fouled ? ' on ' + fouled.name : ''}.`,
    };

    // Penalty? attacker fouled deep in the opponent box
    if (zoneAtt > 88 && this.rng() < 0.45) {
      this.pendingSetPiece = { type: 'PEN', side: fouledSide };
      this.log(headlineFoul);
      if (cardEv) this.log(cardEv);
      return { type: 'event', side: fouledSide, text: `Penalty awarded to ${this.teams[fouledSide].meta.short}!` };
    }

    // Dangerous direct free kick (zone > 70)
    if (zoneAtt > 70) {
      const taker = pickBestShooter(this.teams[fouledSide]);
      if (taker && this.rng() < 0.30) {
        this.assignHolderByNum(fouledSide, taker.num);
        // Resolve as a shot — slightly lower xG ceiling since wall + GK ready
        this.log(headlineFoul);
        if (cardEv) this.log(cardEv);
        this.log({ type: 'event', side: fouledSide, text: `${taker.name} stands over the dangerous free kick…` });
        return this.resolveShootFK(taker, fouledSide, this.teams[other(fouledSide)]);
      }
    }

    // Standard free kick: hand ball to fouled team near the spot, normal play resumes.
    this.assignHolderByRole(fouledSide, pickContextRole(zoneAtt));
    if (cardEv) this.log(cardEv);
    return headlineFoul;
  }

  resolveShootFK(holder, side, opp) {
    // Direct free-kick shot: lower xG than open-play (defensive wall, set GK).
    const zone = this.ball.zone;
    const gk = opp.onPitch.find(p => p.role === 'GK' && !p.state.sentOff) || opp.onPitch[0];
    const distance = Math.max(18, 100 - zone);
    let xG = 0.12 * Math.exp(-(distance - 18) / 12);
    xG += (holder.attrs.sh - 70) * 0.0030;
    xG -= (gk.attrs.gk_reflexes - 70) * 0.0025;
    xG = Math.max(0.02, Math.min(0.25, xG));

    this.stats[side].shots++;
    this.stats[side].xg += xG;

    if (this.rng() < xG) {
      this.score[side]++;
      this.stats[side].onTarget++;
      this.ball.zone = 50;
      this.ball.side = other(side);
      this.assignKickoffHolder(other(side));
      return {
        type: 'goal', side,
        text: `⚽ GOAL from a free kick! ${holder.name} (${this.teams[side].meta.short}) curls it past ${gk.name}. xG ${xG.toFixed(2)}. ${this.scoreLine()}`
      };
    }
    const out = this.rng();
    if (out < 0.30) {
      this.stats[side].onTarget++;
      // Possible deflection to corner
      if (this.rng() < 0.30) {
        this.awardCorner(side);
        return { type: 'shot', side, text: `🥅 ${holder.name}'s free kick saved — corner. xG ${xG.toFixed(2)}.` };
      }
      this.ball.side = other(side);
      this.ball.zone = 12;
      this.assignHolderByRole(other(side), 'GK');
      return { type: 'shot', side, text: `🥅 ${holder.name}'s free kick saved by ${gk.name}. xG ${xG.toFixed(2)}.` };
    }
    if (out < 0.55) {
      // Hits the wall — possession scrambled, often back to attacking team
      if (this.rng() < 0.5) {
        this.pickReceiver(side, 'forward');
        return { type: 'shot', side, text: `🛡️ ${holder.name}'s free kick deflects off the wall — ${this.currentHolderName(side)} picks up. xG ${xG.toFixed(2)}.` };
      }
      this.ball.side = other(side);
      this.ball.zone = 100 - zone;
      this.assignHolderByRole(other(side), 'CB');
      return { type: 'shot', side, text: `🛡️ ${holder.name}'s free kick is blocked by the wall. xG ${xG.toFixed(2)}.` };
    }
    this.ball.side = other(side);
    this.ball.zone = 12;
    this.assignHolderByRole(other(side), 'GK');
    return { type: 'shot', side, text: `🚫 ${holder.name}'s free kick goes over the bar. xG ${xG.toFixed(2)}.` };
  }

  rollCard(foulerSide, fouler) {
    if (!fouler || fouler.state.sentOff) return null;
    // Direct red — rare (~0.5% of fouls)
    if (this.rng() < 0.005) {
      fouler.state.sentOff = true;
      this.stats[foulerSide].reds++;
      return { type: 'event', side: foulerSide, text: `🟥 RED CARD — ${fouler.name} (${this.teams[foulerSide].meta.short}) sent off! Down to ${this.eligible(foulerSide).length} men.` };
    }
    // Already-booked players are notably more cautious → much lower yellow rate
    const yellowProb = fouler.state.yellow >= 1 ? 0.05 : 0.16;
    if (this.rng() < yellowProb) {
      if (fouler.state.yellow >= 1) {
        fouler.state.sentOff = true;
        fouler.state.yellow = 2;
        this.stats[foulerSide].yellows++;
        this.stats[foulerSide].reds++;
        return { type: 'event', side: foulerSide, text: `🟨🟨 SECOND YELLOW — ${fouler.name} (${this.teams[foulerSide].meta.short}) sent off! Down to ${this.eligible(foulerSide).length} men.` };
      }
      fouler.state.yellow = 1;
      this.stats[foulerSide].yellows++;
      return { type: 'event', side: foulerSide, text: `🟨 Yellow card — ${fouler.name} (${this.teams[foulerSide].meta.short}).` };
    }
    return null;
  }

  currentHolderName(side) {
    const team = this.teams[side];
    return team.onPitch[this.ball.holderIdx]?.name || '?';
  }
  scoreLine() { return `${this.teams.home.meta.short} ${this.score.home}–${this.score.away} ${this.teams.away.meta.short}`; }

  // ---------- Logging ----------
  log(ev) {
    const e = { ...ev, t: this.gameTime, phase: this.phase, num: this.events.length + 1 };
    this.events.push(e);
    if (this.events.length > 500) this.events.splice(0, 100);
  }

  // ---------- Inspection ----------
  getStats() {
    const homeT = this.stats.home.possessionTicks;
    const awayT = this.stats.away.possessionTicks;
    const total = Math.max(1, homeT + awayT);
    return {
      home: {
        ...this.stats.home,
        possession: Math.round(homeT * 100 / total),
        passAcc: this.stats.home.passes ? Math.round(this.stats.home.passesCompleted * 100 / this.stats.home.passes) : null,
      },
      away: {
        ...this.stats.away,
        possession: Math.round(awayT * 100 / total),
        passAcc: this.stats.away.passes ? Math.round(this.stats.away.passesCompleted * 100 / this.stats.away.passes) : null,
      },
    };
  }
}

// ---------- Helpers ----------
function blankStats() {
  return {
    possessionTicks: 0,
    shots: 0, onTarget: 0, xg: 0,
    passes: 0, passesCompleted: 0,
    fouls: 0, corners: 0, tackles: 0,
    yellows: 0, reds: 0, offsides: 0,
  };
}

function clonePlayer(p) {
  return {
    ...p,
    attrs: { ...p.attrs },
    state: { ...p.state, yellow: 0, sentOff: false },
  };
}

function other(side) { return side === 'home' ? 'away' : 'home'; }

function tempoVal(t) { return t === 'fast' ? 1 : t === 'slow' ? 0.5 : 0.75; }
function pressIntensityVal(p) { return p === 'high' ? 1 : p === 'low' ? 0.4 : 0.7; }
function mentalityVal(m) { return parseInt(m, 10); }

function pressHeightMatchesZone(height, zone) {
  // zone is from possessor's perspective; 0=own, 100=opp.
  // Press height is opponent's. They press high if zone (for possessor) is low (i.e. holder near own goal).
  const fromOppZone = 100 - zone; // distance to possessor's goal as opp sees
  if (height === 'high') return fromOppZone > 60 ? 1 : 0.4;   // opp pressing in their attacking third
  if (height === 'low')  return fromOppZone < 30 ? 1 : 0.3;
  return 0.6;
}

function pickContextRole(zone) {
  if (zone < 30) return 'CB';
  if (zone < 60) return 'CM';
  if (zone < 80) return 'AM';
  return 'ST';
}

function avgAttr(arr, key) {
  if (!arr.length) return 70;
  return arr.reduce((s, p) => s + (p.attrs[key] || 60), 0) / arr.length;
}

function dist(a, b) {
  return Math.hypot((a.x || 0) - (b.x || 0), (a.y || 0) - (b.y || 0));
}

function describeChange(payload) {
  const parts = [];
  if (payload.formation) parts.push(`formation → ${payload.formation}`);
  if (payload.mentality !== undefined) parts.push(`mentality ${payload.mentality > 0 ? '+' : ''}${payload.mentality}`);
  if (payload.tempo) parts.push(`tempo ${payload.tempo}`);
  if (payload.pressHeight) parts.push(`press height ${payload.pressHeight}`);
  if (payload.pressInt) parts.push(`press int. ${payload.pressInt}`);
  if (payload.defLine) parts.push(`def line ${payload.defLine}`);
  if (payload.width) parts.push(`width ${payload.width}`);
  if (payload.passing) parts.push(`passing ${payload.passing}`);
  return parts.join(', ');
}

function weightedPick(weights, rng) {
  const sum = Object.values(weights).reduce((a, b) => a + b, 0);
  let r = rng() * sum;
  for (const [k, v] of Object.entries(weights)) {
    r -= v;
    if (r <= 0) return k;
  }
  return Object.keys(weights)[0];
}

function randInt(rng, lo, hi) {
  return lo + Math.floor(rng() * (hi - lo + 1));
}

function pickRandom(arr, rng) {
  if (!arr || !arr.length) return null;
  return arr[Math.floor(rng() * arr.length)];
}

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

function pickBestShooter(team) {
  const e = team.onPitch.filter(p => !p.state.sentOff && p.role !== 'GK');
  if (!e.length) return null;
  return e.reduce((a, b) => (b.attrs.sh + b.attrs.co * 0.4) > (a.attrs.sh + a.attrs.co * 0.4) ? b : a);
}
function pickBestPasser(team) {
  const e = team.onPitch.filter(p => !p.state.sentOff && p.role !== 'GK');
  if (!e.length) return null;
  return e.reduce((a, b) => (b.attrs.pa + b.attrs.vi * 0.5) > (a.attrs.pa + a.attrs.vi * 0.5) ? b : a);
}
function pickBestHeader(team) {
  const e = team.onPitch.filter(p => !p.state.sentOff && (p.role === 'ST' || p.role === 'CB'));
  if (!e.length) return team.onPitch.filter(p => !p.state.sentOff)[0] || null;
  return e.reduce((a, b) => (b.attrs.ph + b.attrs.sh * 0.5) > (a.attrs.ph + a.attrs.sh * 0.5) ? b : a);
}

function cryptoId(rng) {
  return ((rng() * 1e9) | 0).toString(36);
}

// Seeded RNG (Mulberry32)
export function mulberry32(seed) {
  return function() {
    let t = seed += 0x6D2B79F5;
    t = Math.imul(t ^ t >>> 15, t | 1);
    t ^= t + Math.imul(t ^ t >>> 7, t | 61);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

// Headless simulator — runs full match in a tight loop, no UI, no halftime delay.
// Used for batch balance testing.
export function simulateMatch(setup) {
  const e = new MatchEngine(setup);
  while (e.phase !== 'full') {
    if (e.phase === 'halftime') {
      e.halftimeRemaining = 0;
      e.phase = 'second';
      e.applyReadyChanges();
      e.assignKickoffHolder('away');
      continue;
    }
    e.tick();
  }
  return { score: { ...e.score }, stats: e.getStats() };
}

// Run N matches with given setup-builder, return aggregated averages.
export function batchSimulate(buildSetup, n = 10) {
  const totals = {
    homeGoals: 0, awayGoals: 0,
    home: blankAgg(), away: blankAgg(),
  };
  for (let i = 0; i < n; i++) {
    const setup = buildSetup(i);
    const r = simulateMatch(setup);
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

function blankAgg() {
  return { possession: 0, shots: 0, onTarget: 0, xg: 0, passes: 0, passAcc: 0, fouls: 0, corners: 0, tackles: 0 };
}
function accAgg(agg, s) {
  for (const k of Object.keys(agg)) agg[k] += (s[k] != null ? s[k] : 0);
}
function avgAgg(agg, n) {
  const out = {};
  for (const [k, v] of Object.entries(agg)) {
    out[k] = (k === 'xg') ? +(v / n).toFixed(2) : Math.round(v / n);
  }
  return out;
}
function round1(x) { return Math.round(x * 10) / 10; }
