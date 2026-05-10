// Simple heuristic AI opponent.
// Re-evaluates every ~5 game minutes, plus reactive responses.

const REVIEW_PERIOD = 240;     // 4 game-minutes between proactive reviews

export class AIController {
  constructor(engine, side = 'away') {
    this.engine = engine;
    this.side = side;
    this.lastReviewAt = 0;
  }

  update() {
    const e = this.engine;
    if (e.phase === 'full') return;
    if (e.phase === 'halftime') {
      // At halftime, reset and reconsider once
      if (this.lastReviewAt !== -1) {
        this.lastReviewAt = -1;
        this.halftimeAdjust();
      }
      return;
    }
    if (this.lastReviewAt < 0) this.lastReviewAt = e.gameTime;
    if (e.gameTime - this.lastReviewAt < REVIEW_PERIOD) {
      // still react to red-flag situations:
      this.fatigueSubsCheck();
      return;
    }
    this.lastReviewAt = e.gameTime;
    this.proactiveReview();
    this.fatigueSubsCheck();
  }

  proactiveReview() {
    const e = this.engine;
    const me = e.teams[this.side];
    const opp = e.teams[other(this.side)];
    const stats = e.getStats();
    const myStats = stats[this.side];
    const oppStats = stats[other(this.side)];
    const goalsMe = e.score[this.side];
    const goalsOpp = e.score[other(this.side)];
    const diff = goalsMe - goalsOpp;
    const minutes = e.gameTime / 60;
    const remaining = (5400 - e.gameTime) / 60;

    const change = {};

    // Late game adjustments
    if (remaining < 25 && diff < 0) {
      change.mentality = String(Math.min(2, parseInt(me.tactics.mentality, 10) + 1));
      change.pressHeight = 'high';
      change.tempo = 'fast';
    } else if (remaining < 25 && diff > 1) {
      change.mentality = String(Math.max(-2, parseInt(me.tactics.mentality, 10) - 1));
      change.defLine = 'deep';
      change.tempo = 'slow';
    }

    // Possession-loss reactions
    if (myStats.possession < 38 && minutes > 12) {
      change.pressHeight = 'high';
      change.pressInt = 'high';
    }

    // Getting outshot
    if (oppStats.shots > myStats.shots + 4 && minutes > 15) {
      change.defLine = 'deep';
      change.pressHeight = 'mid';
    }

    if (Object.keys(change).length > 0) {
      e.submitTacticalChange(this.side, change);
    }
  }

  halftimeAdjust() {
    // Aggressive reset if behind, conservative if ahead.
    const e = this.engine;
    const me = e.teams[this.side];
    const diff = e.score[this.side] - e.score[other(this.side)];
    const change = {};
    if (diff < 0) {
      change.mentality = String(Math.min(2, parseInt(me.tactics.mentality, 10) + 1));
      change.tempo = 'fast';
      change.pressHeight = 'high';
    } else if (diff > 0) {
      change.mentality = String(Math.max(-2, parseInt(me.tactics.mentality, 10) - 1));
      change.tempo = 'normal';
    }
    if (Object.keys(change).length > 0) {
      e.submitTacticalChange(this.side, change);
    }
  }

  fatigueSubsCheck() {
    const e = this.engine;
    if (e.subsUsed[this.side] >= e.maxSubs) return;
    if (e.gameTime < 3000) return; // earliest meaningful sub ~50 min
    const me = e.teams[this.side];
    const tired = me.onPitch
      .filter(p => p.role !== 'GK' && p.state.fitness < 60)
      .sort((a, b) => a.state.fitness - b.state.fitness)[0];
    if (!tired) return;
    // Find best benched player with compatible role
    const candidates = me.bench
      .filter(p => p.role === tired.role || roleClose(p.role, tired.role))
      .sort((a, b) => attrSum(b) - attrSum(a));
    const inP = candidates[0];
    if (!inP) return;
    e.substitute(this.side, tired.num, inP.num);
  }
}

function other(s) { return s === 'home' ? 'away' : 'home'; }

function roleClose(a, b) {
  const groups = [['GK'], ['CB','FB'], ['DM','CM','AM'], ['W','ST','AM']];
  for (const g of groups) if (g.includes(a) && g.includes(b)) return true;
  return false;
}

function attrSum(p) {
  return Object.values(p.attrs).reduce((a, b) => a + b, 0);
}
