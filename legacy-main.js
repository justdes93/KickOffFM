// Entry point: bootstrap setup, start match, run loop.
// Cache-bust all sibling modules with the same ?v= as main.js so dev edits
// to data.js / engine.js / ui.js / ai.js show up on reload.

const _q = new URL(import.meta.url).search;
const { TEAMS, defaultLineup } = await import('./data.js' + _q);
const { MatchEngine, mulberry32, batchSimulate } = await import('./engine.js' + _q);
const { AIController } = await import('./ai.js' + _q);
const { buildSetupScreen, MatchScreenUI, showScreen } = await import('./legacy-ui.js' + _q);

// Debug: run N silent matches and log averaged stats. Call from console: __benchmark(20).
window.__benchmark = function(n = 10) {
  const r = batchSimulate((i) => ({
    home: TEAMS[0],
    away: TEAMS[1],
    homeTactics: defaultTactics('4-3-3'),
    awayTactics: defaultTactics('4-4-2'),
    homeLineup: defaultLineup(TEAMS[0], '4-3-3'),
    awayLineup: defaultLineup(TEAMS[1], '4-4-2'),
    rng: mulberry32(0xC0DE + i * 7919),
  }), n);
  console.log('Benchmark over', n, 'matches:', JSON.stringify(r, null, 2));
  return r;
};

// ----- Global state ('home' = player, 'away' = AI) -----
const state = {
  home: {
    team: TEAMS[0],
    tactics: defaultTactics('4-3-3'),
    lineup: null,
  },
  away: {
    team: TEAMS[1],
    tactics: defaultTactics('4-4-2'),
    lineup: null,
  },
};

let engine = null;
let ai = null;
let matchUI = null;
let loopHandle = null;

function defaultTactics(formation) {
  return {
    formation,
    mentality: '0',
    tempo: 'normal',
    pressHeight: 'mid',
    pressInt: 'mid',
    defLine: 'mid',
    width: 'balanced',
    passing: 'mixed',
    // S28 new sliders
    dribblingFreq: 'sometimes',  // rare | sometimes | often
    crossFreq: 'sometimes',
    longShotFreq: 'sometimes',
    // S30 new sliders
    cornerRoutine: 'in_swinger',     // in_swinger | out_swinger | near_post | short
    freeKickRoutine: 'auto',         // auto | direct | whip | low_drive | short
    timeWasting: 'never',            // never | sometimes | often
  };
}

function startMatch() {
  // Make sure lineups are set
  state.home.lineup = state.home.lineup || defaultLineup(state.home.team, state.home.tactics.formation);
  state.away.lineup = state.away.lineup || defaultLineup(state.away.team, state.away.tactics.formation);

  engine = new MatchEngine({
    home: state.home.team,
    away: state.away.team,
    homeTactics: state.home.tactics,
    awayTactics: state.away.tactics,
    homeLineup: state.home.lineup,
    awayLineup: state.away.lineup,
    rng: mulberry32(((Date.now() % 1e9) | 0)),
  });
  engine._speed = 4;
  engine._paused = false;

  ai = new AIController(engine, 'away');
  matchUI = new MatchScreenUI(engine, ai, () => quitMatch());
  // Debug accessors
  window.__engine = engine;
  window.__ai = ai;
  window.__ui = matchUI;

  showScreen('screen-match');

  // Reset frame state for new match.
  matchUI._lastFrameTime = null;
  matchUI._tickAccumulator = 0;

  if (loopHandle) {
    cancelAnimationFrame(loopHandle);
    clearTimeout(loopHandle);
  }
  loopHandle = scheduleLoop();
}

// Tick loop for v2 engine: 10 Hz base, multiple ticks per frame at higher speeds.
//   At 1x: 30 ticks per real-second → 3 game-sec per real-sec → 30 min real per match.
//   At 4x: 120 ticks/sec.  At 16x: 480 ticks/sec.
// Engine state is recomputed each tick; renderer reads positions every frame.

const BASE_TICKS_PER_REAL_SEC = 30;  // 30 engine-ticks → 3.0 game-sec at 1x

function loop(now) {
  if (!engine) return;
  if (engine.phase === 'full') {
    matchUI.refreshAll();
    loopHandle = scheduleLoop();
    return;
  }

  if (engine._paused) {
    matchUI._lastFrameTime = now;
    matchUI.refreshClock();
    matchUI.checkFulltime();
    loopHandle = scheduleLoop();
    return;
  }

  if (matchUI._lastFrameTime == null) matchUI._lastFrameTime = now;
  const elapsedMs = Math.min(120, now - matchUI._lastFrameTime); // cap to avoid burst on resume
  matchUI._lastFrameTime = now;

  const speed = engine._speed || 1;
  matchUI._tickAccumulator = (matchUI._tickAccumulator || 0)
    + (elapsedMs / 1000) * BASE_TICKS_PER_REAL_SEC * speed;

  // Catch up engine ticks
  let ticksThisFrame = 0;
  while (matchUI._tickAccumulator >= 1 && engine.phase !== 'full' && ticksThisFrame < 200) {
    const beforeEvents = engine.events.length;
    engine.tick();
    if (ai && ai.update) ai.update();
    matchUI._tickAccumulator -= 1;
    ticksThisFrame++;
    // If new events fired, surface them immediately to the log
    if (engine.events.length > beforeEvents) matchUI._needsEventFlush = true;
  }

  // Render per frame
  matchUI.refreshClock();
  matchUI.refreshScore();
  matchUI.refreshStats();
  matchUI.refreshPending();
  matchUI.refreshAIInfo();
  matchUI.refreshSubs();
  matchUI.refreshSubFooter();
  matchUI.refreshHighlights();
  if (matchUI._needsEventFlush) {
    matchUI.refreshEvents();
    matchUI._needsEventFlush = false;
  }
  matchUI.frame(now);
  matchUI.checkFulltime();

  loopHandle = scheduleLoop();
}

// Hybrid scheduler: rAF when tab is visible (smooth 60fps + power-friendly),
// setTimeout fallback when hidden (preview/background) so engine keeps ticking.
function scheduleLoop() {
  if (typeof document !== 'undefined' && document.hidden) {
    return setTimeout(() => loop(performance.now()), 16);
  }
  return requestAnimationFrame(loop);
}

function quitMatch() {
  if (loopHandle) {
    cancelAnimationFrame(loopHandle);
    clearTimeout(loopHandle);
  }
  engine = ai = matchUI = null;
  document.querySelector('#m-events').innerHTML = '';
  document.querySelector('#m-fulltime').classList.add('hidden');
  showScreen('screen-setup');
}

// Boot
buildSetupScreen(state, startMatch);
showScreen('screen-setup');
