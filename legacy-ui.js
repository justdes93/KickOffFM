// UI layer — vanilla DOM bindings for setup + match screens.
// Cache-bust data.js with same ?v= as ui.js so dev edits to data.js are picked up.

const _uiQ = new URL(import.meta.url).search;
const { TEAMS, FORMATIONS, defaultLineup, playerOverall, ROLES } = await import('./data.js' + _uiQ);

// =============== SETUP SCREEN ===============

export function buildSetupScreen(state, onStart) {
  const homeSel = el('#team-home');
  const awaySel = el('#team-away');
  const formSel = el('#home-formation');

  // Team options
  for (const t of TEAMS) {
    homeSel.add(new Option(t.name, t.id));
    awaySel.add(new Option(t.name, t.id));
  }
  homeSel.value = TEAMS[0].id;
  awaySel.value = TEAMS[1].id;

  // Formations
  for (const f of Object.keys(FORMATIONS)) formSel.add(new Option(f, f));
  formSel.value = '4-3-3';

  // Selection state for pre-match swap
  const swapSel = { pitchNum: null };

  function rerender(rebuildLineup = true) {
    state.home.team   = TEAMS.find(t => t.id === homeSel.value);
    state.away.team   = TEAMS.find(t => t.id === awaySel.value);
    state.home.tactics.formation = formSel.value;
    state.away.tactics.formation = state.away.tactics.formation || '4-4-2';
    if (rebuildLineup) {
      state.home.lineup = defaultLineup(state.home.team, state.home.tactics.formation);
      state.away.lineup = defaultLineup(state.away.team, state.away.tactics.formation);
      swapSel.pitchNum = null;
    }
    renderRoster('#home-roster', state.home.team);
    renderRoster('#away-roster', state.away.team);
    renderLineupPitch('#lineup-pitch', '#lineup-bench', state, swapSel, () => rerender(false));
  }

  homeSel.addEventListener('change', () => rerender(true));
  awaySel.addEventListener('change', () => rerender(true));
  formSel.addEventListener('change', () => rerender(true));

  // Tactic dropdowns → state.home.tactics
  bindTacticDropdowns('home', state.home.tactics, '');

  el('#btn-start').addEventListener('click', () => {
    onStart();
  });

  rerender(true);
}

function bindTacticDropdowns(side, tacticsObj, prefix) {
  const map = {
    mentality: '#home-mentality',
    tempo: '#home-tempo',
    pressHeight: '#home-pressHeight',
    pressInt: '#home-pressInt',
    defLine: '#home-defLine',
    width: '#home-width',
    passing: '#home-passing',
    dribblingFreq: '#home-dribblingFreq',
    crossFreq: '#home-crossFreq',
    longShotFreq: '#home-longShotFreq',
    cornerRoutine: '#home-cornerRoutine',
    freeKickRoutine: '#home-freeKickRoutine',
    timeWasting: '#home-timeWasting',
  };
  for (const [k, sel] of Object.entries(map)) {
    const node = document.querySelector(sel);
    if (!node) continue;
    node.value = tacticsObj[k] ?? node.value;
    node.addEventListener('change', () => {
      tacticsObj[k] = node.value;
    });
    tacticsObj[k] = node.value;
  }
}

function renderRoster(sel, team) {
  const root = el(sel);
  root.innerHTML = '';
  const sorted = [...team.roster].sort((a, b) => playerOverall(b) - playerOverall(a));
  for (const p of sorted) {
    const row = document.createElement('div');
    row.className = 'player';
    const ovr = playerOverall(p);
    const isGK = p.role === 'GK';
    const second = isGK ? p.attrs.reflexes : p.attrs.pace;
    const third  = isGK ? p.attrs.handling : p.attrs.finishing;
    row.innerHTML = `
      <span class="num">${p.num}</span>
      <span class="name">${p.name}</span>
      <span class="pos">${p.role}</span>
      <span class="pos" title="Рейтинг">${ovr}</span>
      <span class="pos" title="${isGK ? 'Реакція' : 'Швидкість'}">${second}</span>
      <span class="pos" title="${isGK ? 'Прийом мʼяча' : 'Завершення'}">${third}</span>
    `;
    row.addEventListener('click', () => openPlayerModal(p));
    root.appendChild(row);
  }
}

// =============== PLAYER ATTRIBUTE MODAL (S26) ===============

const ATTR_META = {
  // Outfield Technical
  dribbling:    { label: 'Дриблінг',         desc: 'Обігрування суперника 1-в-1 з мʼячем.' },
  finishing:    { label: 'Завершення',       desc: 'Реалізація шансів з близької відстані.' },
  first_touch:  { label: 'Перший дотик',     desc: 'Чисто приймає складні передачі.' },
  heading:      { label: 'Гра головою',      desc: 'Точність і сила в повітряних дуелях.' },
  long_shots:   { label: 'Дальні удари',     desc: 'Якість ударів з-за меж штрафного.' },
  passing:      { label: 'Пас',              desc: 'Точність коротких і довгих передач.' },
  tackling:     { label: 'Відбір',           desc: 'Чисто виграє наземні єдиноборства.' },
  crossing:     { label: 'Навіс',            desc: 'Подача в штрафний з флангу.' },
  marking:      { label: 'Опіка',            desc: 'Тримає суперника без мʼяча.' },
  set_pieces:   { label: 'Стандарти',        desc: 'Якість кутових, штрафних, пенальті.' },
  // Mental
  anticipation: { label: 'Передбачення',     desc: 'Читає гру і перехоплює.' },
  composure:    { label: 'Холоднокровність', desc: 'Зберігає спокій у моментах для удару.' },
  concentration:{ label: 'Концентрація',     desc: 'Уникає захисних помилок за 90 хв.' },
  decisions:    { label: 'Рішення',          desc: 'Обирає правильну дію під тиском.' },
  off_the_ball: { label: 'Без мʼяча',        desc: 'Знаходить простір коли команда атакує.' },
  positioning:  { label: 'Позиційна гра',    desc: 'Захисна структура без мʼяча.' },
  vision:       { label: 'Бачення',          desc: 'Бачить розрізні і ключові передачі.' },
  work_rate:    { label: 'Працелюбність',    desc: 'Дистанція і ривки на повернення.' },
  // Physical
  acceleration: { label: 'Прискорення',      desc: 'Швидкість перших 5 метрів.' },
  agility:      { label: 'Спритність',       desc: 'Повороти і зміна напрямку.' },
  jumping_reach:{ label: 'Стрибок',          desc: 'Висота у повітряних дуелях.' },
  pace:         { label: 'Швидкість',        desc: 'Максимальна швидкість бігу.' },
  stamina:      { label: 'Витривалість',     desc: 'Запас сил на 90+ хвилин.' },
  strength:     { label: 'Сила',             desc: 'Утримує суперника, виграє єдиноборства.' },
  // GK
  handling:        { label: 'Прийом мʼяча',    desc: 'Чисто ловить удари.' },
  reflexes:        { label: 'Реакція',         desc: 'Реагує на удари впритул.' },
  aerial_reach:    { label: 'Гра на виходах',  desc: 'Збирає навіси у штрафному.' },
  one_on_ones:     { label: 'Один на один',    desc: 'Виграє 1-в-1 проти нападника.' },
  kicking:         { label: 'Введення мʼяча',  desc: 'Дальність і точність вибивання.' },
  command_of_area: { label: 'Володіння зоною', desc: 'Організовує захист у штрафному.' },
  communication:   { label: 'Спілкування',     desc: 'Координує дії з партнерами.' },
  rushing_out:     { label: 'Вихід з воріт',   desc: 'Виходить грати, щоб усунути загрозу.' },
};

const OUTFIELD_GROUPS = {
  'Техніка':  ['dribbling','finishing','first_touch','heading','long_shots','passing','tackling','crossing','marking','set_pieces'],
  'Ментальні':['anticipation','composure','concentration','decisions','off_the_ball','positioning','vision','work_rate'],
  'Фізичні':  ['acceleration','agility','jumping_reach','pace','stamina','strength'],
};
const GK_GROUPS = {
  'Воротарські':['handling','reflexes','aerial_reach','one_on_ones','kicking','command_of_area','communication','rushing_out'],
  'Ментальні':  ['anticipation','composure','concentration','decisions','off_the_ball','positioning','vision','work_rate'],
  'Фізичні':    ['acceleration','agility','jumping_reach','pace','stamina','strength'],
};

function openPlayerModal(p) {
  bindPlayerModal();
  const modal = el('#player-modal');
  if (!modal) return;
  el('#pm-num').textContent = '#' + p.num;
  el('#pm-name').textContent = p.name;
  const roleInfo = p.role_kind && ROLES[p.role_kind];
  const roleLabel = roleInfo ? roleInfo.label : p.role;
  const DUTY_UA = { defend: 'Захист', support: 'Підтримка', attack: 'Атака' };
  const dutyLabel = p.duty ? (DUTY_UA[p.duty] || p.duty) : '';
  // S32: append live morale + fitness state next to the role/duty.
  const moraleVal = Math.round(p.state?.morale ?? 65);
  const fitnessVal = Math.round(p.state?.fitness ?? 100);
  const stateLine = `${p.role} · ${roleLabel}${dutyLabel ? ' · ' + dutyLabel : ''}  ·  Настрій ${moraleVal}  ·  Форма ${fitnessVal}`;
  el('#pm-meta').textContent = stateLine;
  el('#pm-meta').title = roleInfo?.desc || '';
  el('#pm-ovr').textContent = playerOverall(p);

  const groups = p.role === 'GK' ? GK_GROUPS : OUTFIELD_GROUPS;
  // Determine top-3 / bottom-3 across all real attrs (excludes legacy compat keys).
  const allKeys = Object.values(groups).flat();
  const sorted = allKeys.map(k => ({ k, v: p.attrs[k] })).sort((a, b) => b.v - a.v);
  const best = new Set(sorted.slice(0, 3).map(x => x.k));
  const worst = new Set(sorted.slice(-3).map(x => x.k));

  const grid = el('#pm-grid');
  grid.innerHTML = '';
  for (const [groupName, keys] of Object.entries(groups)) {
    const col = document.createElement('div');
    col.className = 'attr-group';
    let inner = `<h3>${groupName}</h3>`;
    for (const k of keys) {
      const v = p.attrs[k] ?? 0;
      const meta = ATTR_META[k] || { label: k, desc: '' };
      const cls = best.has(k) ? 'best' : (worst.has(k) ? 'worst' : '');
      inner += `<div class="attr-row ${cls}" title="${meta.desc}">
        <span class="attr-name">${meta.label}</span>
        <span class="attr-bar"><span class="attr-bar-fill" style="width:${v}%"></span></span>
        <span class="attr-val">${v}</span>
      </div>`;
    }
    col.innerHTML = inner;
    grid.appendChild(col);
  }

  modal.classList.remove('hidden');
}

function bindPlayerModal() {
  const modal = el('#player-modal');
  if (!modal || modal._bound) return;
  modal._bound = true;
  el('#pm-close').addEventListener('click', () => modal.classList.add('hidden'));
  modal.addEventListener('click', (e) => { if (e.target === modal) modal.classList.add('hidden'); });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !modal.classList.contains('hidden')) modal.classList.add('hidden');
  });
}

function renderLineupPitch(pitchSel, benchSel, state, swapSel, rerender) {
  const pitch = el(pitchSel);
  const bench = el(benchSel);
  pitch.innerHTML = '';
  bench.innerHTML = '';
  const { lineup, bench: benchPlayers } = state.home.lineup;

  for (const item of lineup) {
    const slot = item.slot;
    const p = item.player;
    const pin = document.createElement('div');
    const isSel = swapSel.pitchNum === p.num;
    pin.className = 'pitch-pin' + (slot.role === 'GK' ? ' gk' : '') + (isSel ? ' selected' : '');
    pin.style.left = (slot.x * 100) + '%';
    pin.style.top = (slot.y * 100) + '%';
    pin.innerHTML = `${p.num}<span class="pin-name">${shortName(p.name)} (${slot.id})</span>`;
    pin.title = `${p.name} — ${p.role} — OVR ${playerOverall(p)}\nClick to select for swap.`;
    pin.addEventListener('click', () => {
      swapSel.pitchNum = swapSel.pitchNum === p.num ? null : p.num;
      rerender();
    });
    pitch.appendChild(pin);
  }

  if (swapSel.pitchNum != null) {
    const hint = document.createElement('div');
    hint.className = 'swap-hint';
    hint.textContent = 'Тепер клікни на гравця з лави, щоб поставити його на поле.';
    pitch.appendChild(hint);
  }

  for (const p of benchPlayers) {
    const div = document.createElement('div');
    div.className = 'player';
    div.textContent = `${p.num} ${shortName(p.name)} ${p.role} (${playerOverall(p)})`;
    div.title = swapSel.pitchNum != null
      ? `Click to bring ${shortName(p.name)} on for selected starter.`
      : `Click on a starter first to begin a swap.`;
    div.addEventListener('click', () => {
      if (swapSel.pitchNum == null) return;
      const lu = state.home.lineup;
      const slotIdx = lu.lineup.findIndex(x => x.player.num === swapSel.pitchNum);
      const benchIdx = lu.bench.findIndex(x => x.num === p.num);
      if (slotIdx < 0 || benchIdx < 0) return;
      const out = lu.lineup[slotIdx].player;
      lu.lineup[slotIdx].player = p;
      lu.bench[benchIdx] = out;
      swapSel.pitchNum = null;
      rerender();
    });
    bench.appendChild(div);
  }
}

function shortName(name) {
  // "M. Reyna" → "M. Reyna"; "John Smith" → "J. Smith"
  if (name.includes('.')) return name;
  const parts = name.split(' ');
  if (parts.length < 2) return name;
  return parts[0][0] + '. ' + parts.slice(1).join(' ');
}

// =============== MATCH SCREEN ===============

export class MatchScreenUI {
  constructor(engine, ai, onQuit) {
    this.engine = engine;
    this.ai = ai;
    this.onQuit = onQuit;
    this.subSel = { out: null, in: null };
    this.lastEventCount = 0;

    // Continuous interpolation state
    this.playerPos = {};            // id -> { x, y }
    this.ballPos = { x: 52.5, y: 34 };
    this.lastFrameTime = 0;
    this.activeTrajectory = null;   // { startTime, duration, fromX, fromY, toX, toY, arc, type }
    this.lastTrajEventNum = -1;

    // Sprint 10: debug overlay toggle (anchor circles, first-defender line, HUD)
    this.debugView = false;

    this.bindHeader();
    this.bindTactics();
    this.bindSubs();
    this.refreshNames();
    this.refreshTactics();
    this.refreshAll();
  }

  bindHeader() {
    el('#m-pause').addEventListener('click', () => this.togglePause());
    el('#m-speed').addEventListener('change', () => {
      this.engine._speed = parseInt(el('#m-speed').value, 10);
    });
    el('#m-quit').addEventListener('click', () => this.onQuit());
    el('#m-newgame').addEventListener('click', () => this.onQuit());
    this.engine._speed = parseInt(el('#m-speed').value, 10);

    // Sprint 10: debug toggle
    const dbgBtn = el('#m-debug');
    if (dbgBtn) {
      dbgBtn.addEventListener('click', () => {
        this.debugView = !this.debugView;
        dbgBtn.classList.toggle('active', this.debugView);
        const hud = el('#m-debug-hud');
        if (hud) hud.style.display = this.debugView ? 'flex' : 'none';
        if (!this.debugView) this._clearDebugOverlay();
      });
    }

    // Sprint UI redesign: tactics modal open/close.
    // Backdrop close uses mousedown+mouseup tracking so an accidental drag
    // from inside (e.g. on a <select>) to outside doesn't close the modal.
    const tacBtn = el('#m-tactics-btn');
    const tacClose = el('#m-tactics-close');
    const modal = el('#m-tactics-modal');
    if (tacBtn && modal) {
      tacBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        modal.classList.remove('hidden');
        this.refreshTactics();
        this.refreshSubs();
        this.refreshSubFooter();
      });
    }
    if (tacClose && modal) {
      tacClose.addEventListener('click', (e) => {
        e.stopPropagation();
        modal.classList.add('hidden');
      });
    }
    if (modal) {
      let backdropDown = false;
      modal.addEventListener('mousedown', (e) => {
        backdropDown = (e.target === modal);
      });
      modal.addEventListener('click', (e) => {
        if (e.target === modal && backdropDown) {
          modal.classList.add('hidden');
        }
        backdropDown = false;
      });
    }
  }

  bindTactics() {
    const formSel = el('#m-formation');
    formSel.innerHTML = '';
    for (const f of Object.keys(FORMATIONS)) formSel.add(new Option(f, f));

    el('#m-apply').addEventListener('click', () => this.submitChanges());
  }

  bindSubs() {
    el('#m-sub-confirm').addEventListener('click', () => {
      if (!this.subSel.out || !this.subSel.in) return;
      const r = this.engine.substitute('home', this.subSel.out, this.subSel.in);
      if (r.ok) {
        this.subSel = { out: null, in: null };
        this.refreshSubs();
        this.refreshSubFooter();
      } else {
        alert('Заміна не вдалася: ' + r.reason);
      }
    });
  }

  refreshNames() {
    const h = this.engine.teams.home.meta;
    const a = this.engine.teams.away.meta;
    el('#m-home-name').textContent = h.name;
    el('#m-away-name').textContent = a.name;
    // Sprint UI redesign: side-panel team names + tactics modal title
    const homeShort = el('#m-home-team-name'); if (homeShort) homeShort.textContent = h.short;
    const awayShort = el('#m-away-team-name'); if (awayShort) awayShort.textContent = a.short;
    const tacName = el('#m-tactics-team-name'); if (tacName) tacName.textContent = h.name;
    const pH = el('#m-pitch-home'); if (pH) pH.textContent = h.short;
    const pA = el('#m-pitch-away'); if (pA) pA.textContent = a.short;
  }

  refreshTactics() {
    const t = this.engine.teams.home.tactics;
    el('#m-formation').value = t.formation;
    el('#m-mentality').value = t.mentality;
    el('#m-tempo').value = t.tempo;
    el('#m-pressHeight').value = t.pressHeight;
    el('#m-pressInt').value = t.pressInt;
    el('#m-defLine').value = t.defLine;
    el('#m-width').value = t.width;
    el('#m-passing').value = t.passing;
  }

  submitChanges() {
    const payload = {
      formation: el('#m-formation').value,
      mentality: el('#m-mentality').value,
      tempo: el('#m-tempo').value,
      pressHeight: el('#m-pressHeight').value,
      pressInt: el('#m-pressInt').value,
      defLine: el('#m-defLine').value,
      width: el('#m-width').value,
      passing: el('#m-passing').value,
    };
    const change = this.engine.submitTacticalChange('home', payload);
    if (change) {
      const lagSec = change.applyAt - change.submittedAt;
      const lagMin = (lagSec / 60).toFixed(1);
      flash(el('#m-apply'), 'У черзі ' + (this.engine.phase === 'halftime' ? '(перерва — застосується на 2-му таймі)' : `— застосується через ${lagMin}'`));
    } else {
      flash(el('#m-apply'), 'Без змін.');
    }
  }

  refreshAll() {
    this.refreshClock();
    this.refreshScore();
    this.refreshScorers();
    this.refreshEvents();
    this.refreshStats();
    this.refreshPending();
    this.refreshAIInfo();
    this.refreshSubs();
    this.refreshSubFooter();
    this.refreshPitch();
    this.checkFulltime();
  }

  refreshPitch() {
    const svg = el('#m-pitch');
    if (!svg) return;
    if (!svg.dataset.initialized) {
      this.initPitch(svg);
      svg.dataset.initialized = '1';
    }
    el('#m-pitch-home').textContent = this.engine.teams.home.meta.short;
    el('#m-pitch-away').textContent = this.engine.teams.away.meta.short;
  }

  // Called every animation frame from the main loop.
  // v2: engine drives all positions; renderer just reads engine.players[i].x/y and
  // engine.ball.x/y. We still ease toward the engine value to smooth out tick-step
  // visuals (engine ticks at 10 Hz, render at 60 fps).
  frame(now) {
    const svg = el('#m-pitch');
    if (!svg || !svg.dataset.initialized) return;
    if (!this.lastFrameTime) this.lastFrameTime = now;
    const dt = Math.min(0.05, (now - this.lastFrameTime) / 1000);
    this.lastFrameTime = now;

    // Smooth clock — refresh every frame so the timer ticks real-second-by-second.
    this.refreshClock();

    const stiff = 16; // higher stiffness — engine ticks at 10 Hz, follow tightly
    const k = 1 - Math.exp(-dt * stiff);

    // Active set of pitch players
    const allActive = new Set();
    let holderRendered = null;
    for (const side of ['home', 'away']) {
      const team = this.engine.teams[side];
      for (const p of team.onPitch) {
        if (p.state.sentOff) continue;
        allActive.add(`pl-${side}-${p.num}`);
        const id = `pl-${side}-${p.num}`;
        let cur = this.playerPos[id];
        if (!cur) cur = { x: p.x, y: p.y };
        cur.x += (p.x - cur.x) * k;
        cur.y += (p.y - cur.y) * k;
        this.playerPos[id] = cur;
        const g = ensurePitchPlayer(svg, side, p);
        g.setAttribute('transform', `translate(${cur.x.toFixed(2)} ${cur.y.toFixed(2)})`);
        // Holder ring + GK class
        const isHolder = this.engine.ball.ownerSide === side && this.engine.ball.ownerNum === p.num;
        const circle = g.querySelector('circle');
        let cls = `player-c ${side}` + (p.role === 'GK' ? ' gk' : '');
        if (p.state.sentOff) cls += ' sentoff';
        if (isHolder) { cls += ' holder'; holderRendered = cur; }
        circle.setAttribute('class', cls);
      }
    }
    // Hide subbed-off / sent-off elements
    svg.querySelectorAll('.player-g').forEach(g => {
      g.style.display = allActive.has(g.id) ? '' : 'none';
    });

    // Ball — read directly from engine state (engine handles physics).
    const eb = this.engine.ball;
    const bx = eb.x;
    const by = eb.y;
    // z used for shadow offset (visual only) — small lift above ground
    const ball = svg.querySelector('#m-ball');
    if (ball) {
      // small vertical offset based on z to fake perspective
      const zOff = -Math.min(eb.z * 0.6, 4);
      ball.setAttribute('cx', bx.toFixed(2));
      ball.setAttribute('cy', (by + zOff).toFixed(2));
    }
    const halo = svg.querySelector('#m-ball-halo');
    if (halo) {
      halo.setAttribute('cx', bx.toFixed(2));
      halo.setAttribute('cy', by.toFixed(2));
    }

    // Sprint 10: debug overlay (anchor circles, first-defender line, HUD)
    if (this.debugView) {
      this._renderDebugOverlay(svg);
    }
  }

  _renderDebugOverlay(svg) {
    const ns = 'http://www.w3.org/2000/svg';
    let layer = svg.querySelector('#m-debug-layer');
    if (!layer) {
      layer = document.createElementNS(ns, 'g');
      layer.setAttribute('id', 'm-debug-layer');
      // Insert under players (before first player-g)
      const firstPlayer = svg.querySelector('.player-g');
      if (firstPlayer) svg.insertBefore(layer, firstPlayer);
      else svg.appendChild(layer);
    }
    layer.innerHTML = '';
    // Anchor circles for each on-pitch outfield player
    for (const side of ['home', 'away']) {
      const team = this.engine.teams[side];
      for (const p of team.onPitch) {
        if (p.state.sentOff || p.role === 'GK') continue;
        if (!p.anchor) continue;
        const recovering = p.recoveryState === 'tracking_back';
        const circle = document.createElementNS(ns, 'circle');
        circle.setAttribute('class', `anchor-circle ${recovering ? 'recovery' : 'normal'}`);
        circle.setAttribute('cx', p.anchor.x.toFixed(2));
        circle.setAttribute('cy', p.anchor.y.toFixed(2));
        circle.setAttribute('r', (p.leashRadius || 10).toFixed(1));
        layer.appendChild(circle);
        const dot = document.createElementNS(ns, 'circle');
        dot.setAttribute('class', 'anchor-dot');
        dot.setAttribute('cx', p.anchor.x.toFixed(2));
        dot.setAttribute('cy', p.anchor.y.toFixed(2));
        dot.setAttribute('r', '0.3');
        layer.appendChild(dot);
      }
    }
    // First-defender → ball line
    for (const side of ['home', 'away']) {
      const fdId = this.engine.teamState[side].firstDefenderId;
      if (fdId == null) continue;
      const fd = this.engine.teams[side].onPitch.find(x => x.num === fdId);
      if (!fd) continue;
      const line = document.createElementNS(ns, 'line');
      line.setAttribute('class', 'firstdef-line');
      line.setAttribute('x1', fd.x.toFixed(2));
      line.setAttribute('y1', fd.y.toFixed(2));
      line.setAttribute('x2', this.engine.ball.x.toFixed(2));
      line.setAttribute('y2', this.engine.ball.y.toFixed(2));
      layer.appendChild(line);
    }
    // HUD update
    this._refreshDebugHUD();
  }

  _clearDebugOverlay() {
    const svg = el('#m-pitch');
    if (!svg) return;
    const layer = svg.querySelector('#m-debug-layer');
    if (layer) layer.innerHTML = '';
  }

  _refreshDebugHUD() {
    const e = this.engine;
    const home = e.teams.home, away = e.teams.away;
    const ts = e.teamState;
    const phaseHome = home.currentPhase || '?';
    const phaseAway = away.currentPhase || '?';
    const compHome = Math.abs(ts.home.atkLineX - ts.home.defLineX).toFixed(0);
    const compAway = Math.abs(ts.away.atkLineX - ts.away.defLineX).toFixed(0);
    const fdH = ts.home.firstDefenderId ?? '–';
    const fdA = ts.away.firstDefenderId ?? '–';
    const m = e.behavioralMetrics;
    const avgWithin5 = m.snapshotCount ? (m.sumPlayersWithin5m / m.snapshotCount).toFixed(1) : '0';
    const avgAnchor = m.sumAnchorDistCount ? (m.sumAnchorDist / m.sumAnchorDistCount).toFixed(1) : '0';
    const setText = (id, html) => { const n = el(id); if (n) n.innerHTML = html; };
    setText('#m-debug-phase-home', `<span class="debug-label">LIO</span> <span class="debug-value">${phaseHome}</span>`);
    setText('#m-debug-phase-away', `<span class="debug-label">FAL</span> <span class="debug-value">${phaseAway}</span>`);
    setText('#m-debug-compactness', `<span class="debug-label">comp</span> <span class="debug-value">${compHome}m / ${compAway}m</span>`);
    setText('#m-debug-firstdef', `<span class="debug-label">1st def</span> <span class="debug-value">${fdH} / ${fdA}</span>`);
    setText('#m-debug-swarm', `<span class="debug-label">≤5m</span> <span class="debug-value">${avgWithin5}</span> <span class="debug-label">anchor-d</span> <span class="debug-value">${avgAnchor}m</span> <span class="debug-label">maxPress</span> <span class="debug-value">${m.maxSimultaneousPressers}</span>`);
  }

  initPitch(svg) {
    const ns = 'http://www.w3.org/2000/svg';
    // SLF.FM-inspired: saturated green with strong vertical mowing stripes (8 bands),
    // proper goal arcs, 3D-ish goals with net mesh, corner arcs.
    const markings = `
      <defs>
        <pattern id="netPattern" patternUnits="userSpaceOnUse" width="0.6" height="0.6">
          <path d="M0,0 L0.6,0 M0,0 L0,0.6" stroke="rgba(255,255,255,0.85)" stroke-width="0.06" fill="none"/>
        </pattern>
      </defs>
      <rect class="field-bg" x="0" y="0" width="105" height="68"/>
      <rect class="field-stripe" x="0"     y="0" width="13.125" height="68"/>
      <rect class="field-stripe" x="26.25" y="0" width="13.125" height="68"/>
      <rect class="field-stripe" x="52.5"  y="0" width="13.125" height="68"/>
      <rect class="field-stripe" x="78.75" y="0" width="13.125" height="68"/>
      <rect class="marking" x="0.2" y="0.2" width="104.6" height="67.6"/>
      <line class="marking" x1="52.5" y1="0.2" x2="52.5" y2="67.8"/>
      <circle class="marking" cx="52.5" cy="34" r="9.15"/>
      <circle class="marking" cx="52.5" cy="34" r="0.35" fill="rgba(255,255,255,0.85)" stroke="none"/>
      <rect class="marking" x="0.2"  y="13.84" width="16.5" height="40.32"/>
      <rect class="marking" x="88.3" y="13.84" width="16.5" height="40.32"/>
      <rect class="marking" x="0.2"  y="24.84" width="5.5"  height="18.32"/>
      <rect class="marking" x="99.3" y="24.84" width="5.5"  height="18.32"/>
      <circle class="marking" cx="11" cy="34" r="0.35" fill="rgba(255,255,255,0.85)" stroke="none"/>
      <circle class="marking" cx="94" cy="34" r="0.35" fill="rgba(255,255,255,0.85)" stroke="none"/>
      <path class="marking" d="M 16.7 28 A 9.15 9.15 0 0 1 16.7 40"/>
      <path class="marking" d="M 88.3 28 A 9.15 9.15 0 0 0 88.3 40"/>
      <path class="marking" d="M 0.2 1.0 A 1 1 0 0 1 1.0 0.2" />
      <path class="marking" d="M 104 0.2 A 1 1 0 0 1 104.8 1.0" />
      <path class="marking" d="M 0.2 67 A 1 1 0 0 0 1.0 67.8" />
      <path class="marking" d="M 104 67.8 A 1 1 0 0 0 104.8 67" />
      <!-- 3D goals + net mesh -->
      <rect class="goal-net" x="-2.6" y="29.7" width="2.4" height="8.6"/>
      <rect class="goal-box" x="-2.6" y="29.7" width="0.4" height="8.6"/>
      <rect class="goal-net" x="105.2" y="29.7" width="2.4" height="8.6"/>
      <rect class="goal-box" x="107.2" y="29.7" width="0.4" height="8.6"/>
      <line class="marking" x1="-0.2" y1="29.7" x2="-0.2" y2="38.3" stroke-width="0.35"/>
      <line class="marking" x1="105.2" y1="29.7" x2="105.2" y2="38.3" stroke-width="0.35"/>
    `;
    svg.innerHTML = markings;

    // Players (one <g> per player, with circle + text)
    for (const side of ['home', 'away']) {
      const team = this.engine.teams[side];
      for (const p of team.onPitch) {
        const g = document.createElementNS(ns, 'g');
        g.setAttribute('class', 'player-g');
        g.setAttribute('id', `pl-${side}-${p.num}`);
        const c = document.createElementNS(ns, 'circle');
        c.setAttribute('class', `player-c ${side}` + (p.role === 'GK' ? ' gk' : ''));
        c.setAttribute('cx', '0');
        c.setAttribute('cy', '0');
        c.setAttribute('r', '1.52');
        g.appendChild(c);
        const t = document.createElementNS(ns, 'text');
        t.setAttribute('class', 'player-num');
        t.setAttribute('x', '0');
        t.setAttribute('y', '0.15');
        t.textContent = positionLabel(p);
        g.appendChild(t);
        svg.appendChild(g);
      }
    }
    // Ball halo (animated) + ball
    const halo = document.createElementNS(ns, 'circle');
    halo.setAttribute('class', 'ball-halo');
    halo.setAttribute('id', 'm-ball-halo');
    halo.setAttribute('cx', '52.5');
    halo.setAttribute('cy', '34');
    halo.setAttribute('r', '2.0');
    svg.appendChild(halo);
    const ball = document.createElementNS(ns, 'circle');
    ball.setAttribute('class', 'ball-c');
    ball.setAttribute('id', 'm-ball');
    ball.setAttribute('cx', '52.5');
    ball.setAttribute('cy', '34');
    ball.setAttribute('r', '0.91');
    svg.appendChild(ball);
  }

  refreshClock() {
    // Interpolate game-time smoothly between ticks so the clock ticks every
    // real second instead of jumping in 3-sec engine steps.
    const e = this.engine;
    let displayTime = e.gameTime;
    if (this._tickAt != null && e.phase !== 'halftime' && e.phase !== 'full') {
      const speed = e._speed || 1;
      const tickInterval = 1000 / speed;
      const fraction = Math.max(0, Math.min(1, (performance.now() - this._tickAt) / tickInterval));
      // engine.gameTime already reflects the tick that just fired; smoothly fill
      // the 3-sec gap from previous tick to this one.
      displayTime = Math.max(0, e.gameTime - 3 + 3 * fraction);
    }
    const m = Math.floor(displayTime / 60);
    const s = Math.floor(displayTime % 60);
    el('#m-clock').textContent = `${pad2(m)}:${pad2(s)}`;
    let phase = '1-й тайм';
    if (e.phase === 'halftime') phase = `Перерва — ${e.halftimeRemaining}с`;
    else if (e.phase === 'second') phase = '2-й тайм';
    else if (e.phase === 'full') phase = 'Кінець матчу';
    el('#m-phase').textContent = phase;
  }

  refreshScore() {
    el('#m-score-home').textContent = this.engine.score.home;
    el('#m-score-away').textContent = this.engine.score.away;
  }

  refreshEvents() {
    const log = el('#m-events');
    if (this.engine.events.length === this.lastEventCount) return;
    // Newest events at the TOP — prepend each new entry to the log container.
    const start = this.lastEventCount;
    for (let i = start; i < this.engine.events.length; i++) {
      const e = this.engine.events[i];
      const div = document.createElement('div');
      div.className = 'ev ' + (e.type === 'goal' ? 'goal' : '')
        + (e.type === 'tactical' ? ' tactical' : '')
        + (e.type === 'system' ? ' system' : '')
        + (e.type === 'shot' ? ' shot' : '')
        + (e.type === 'spectacular' ? ' spectacular' : '')
        + (e.side ? ' ' + e.side : '');
      const m = Math.floor(e.t / 60);
      const s = Math.floor(e.t % 60);
      div.innerHTML = `<span class="t">${pad2(m)}:${pad2(s)}</span> ${escapeHtml(e.text)}`;
      // prepend — newest goes to the top of the visible list
      log.insertBefore(div, log.firstChild);
    }
    this.lastEventCount = this.engine.events.length;
    // No scroll-to-bottom needed; user always sees the latest at the top.
    log.scrollTop = 0;
  }

  refreshStats() {
    // Sprint UI redesign: per-team stat blocks instead of unified table.
    const s = this.engine.getStats();
    const labels = [
      ['possession', 'Володіння', v => `${v}%`],
      ['shots', 'Удари', v => v],
      ['onTarget', 'У ціль', v => v],
      ['xg', 'xG', v => (typeof v === 'number' ? v.toFixed(2) : v)],
      ['passes', 'Передачі', v => v],
      ['passAcc', 'Точність пасу', v => v != null ? `${v}%` : '—'],
      ['fouls', 'Фоли', v => v],
      ['corners', 'Кутові', v => v],
      ['tackles', 'Відбори', v => v],
      ['offsides', '🚩 Офсайди', v => v],
      ['yellows', '🟨 Жовті', v => v],
      ['reds', '🟥 Червоні', v => v],
    ];
    for (const side of ['home', 'away']) {
      const node = el(`#m-${side}-stats-block`);
      if (!node) continue;
      const rows = [];
      for (const [key, label, fmt] of labels) {
        rows.push(`<span class="stat-label">${label}</span><span class="stat-value">${fmt(s[side][key])}</span>`);
      }
      node.innerHTML = rows.join('');
    }
    // Render squads (side panels) on stats refresh as well — keeps fitness up-to-date
    this.refreshSquadPanels();
  }

  refreshSquadPanels() {
    for (const side of ['home', 'away']) {
      const node = el(`#m-${side}-squad`);
      if (!node) continue;
      const team = this.engine.teams[side];
      const rows = [];
      for (const p of team.onPitch) {
        const tired = (p.state.fitness || 100) < 70;
        // UI redesign: per-player icons — goals (⚽), assists (🅰), yellow (🟨), red (🟥).
        const goalIcons = (p.state.goals || 0) > 0 ? '⚽'.repeat(p.state.goals) : '';
        const assistIcons = (p.state.assists || 0) > 0 ? '🅰'.repeat(p.state.assists) : '';
        const cardIcon = p.state.sentOff ? '🟥' : ((p.state.yellow || 0) > 0 ? '🟨' : '');
        const icons = goalIcons + assistIcons + cardIcon;
        const cls = 'squad-row' + (tired ? ' tired' : '') + (p.state.sentOff ? ' sentoff' : '');
        rows.push(`
          <div class="${cls}">
            <span class="num">${p.num}</span>
            <span class="name">${shortName(p.name)}</span>
            <span class="icons">${icons}</span>
            <span class="role">${p.role}</span>
            <span class="fitness">${Math.round(p.state.fitness || 100)}%</span>
          </div>`);
      }
      node.innerHTML = rows.join('');
    }
  }

  refreshScorers() {
    // UI redesign: read from persistent goalsList (events array is FIFO-trimmed).
    const goals = this.engine.goalsList || [];
    for (const side of ['home', 'away']) {
      const node = el(`#m-scorers-${side}`);
      if (!node) continue;
      const parts = goals.filter(g => g.side === side).map(g => {
        const min = Math.floor((g.time || 0) / 60);
        if (g.ownGoal) return `OG ${min}'`;
        const name = g.scorerName ? g.scorerName.replace(/^.\. /, '') : '?';
        return `${name} ${min}'`;
      });
      node.textContent = parts.join(', ');
    }
  }

  refreshPending() {
    const node = el('#m-pending');
    node.innerHTML = '';
    const mine = this.engine.pendingChanges.filter(c => c.side === 'home');
    if (!mine.length) {
      node.innerHTML = '<span class="muted small">Немає тактичних змін у черзі.</span>';
      return;
    }
    for (const c of mine) {
      const div = document.createElement('div');
      div.className = 'item';
      const remaining = Math.max(0, c.applyAt - this.engine.gameTime);
      const m = Math.floor(remaining / 60);
      const s = Math.floor(remaining % 60);
      div.textContent = `У черзі: ${describePayload(c.payload)} — застосується через ${pad2(m)}:${pad2(s)} ігрового часу`;
      node.appendChild(div);
    }
  }

  refreshAIInfo() {
    const t = this.engine.teams.away.tactics;
    el('#ai-form').textContent = t.formation;
    const m = parseInt(t.mentality, 10);
    el('#ai-ment').textContent = ['Дуже оборонна','Оборонна','Збалансована','Атакуюча','Дуже атакуюча'][m + 2];
  }

  refreshHighlights() {
    const node = el('#m-highlights');
    if (!node) return;
    const specs = this.engine.events.filter(e => e.type === 'spectacular');
    if (specs.length === this._lastHighlightCount) return;
    this._lastHighlightCount = specs.length;
    node.innerHTML = '';
    for (let i = specs.length - 1; i >= 0; i--) {
      const e = specs[i];
      const m = Math.floor(e.t / 60);
      const s = Math.floor(e.t % 60);
      const div = document.createElement('div');
      div.className = 'h-row';
      div.innerHTML = `<span class="t">${pad2(m)}:${pad2(s)}</span>${escapeHtml(e.text)}`;
      node.appendChild(div);
    }
  }

  refreshSubs() {
    const onPitch = el('#m-onpitch');
    const bench = el('#m-bench');
    onPitch.innerHTML = '';
    bench.innerHTML = '';
    const team = this.engine.teams.home;
    for (const p of team.onPitch) {
      const tired = p.state.fitness < 70;
      const div = document.createElement('div');
      div.className = 'player' + (tired ? ' tired' : '') + (this.subSel.out === p.num ? ' selected' : '');
      div.innerHTML = `<span>${p.num} ${shortName(p.name)} <span class="meta">(${p.role})</span></span>
        <span class="meta">${Math.round(p.state.fitness)}%</span>`;
      div.addEventListener('click', () => {
        this.subSel.out = this.subSel.out === p.num ? null : p.num;
        this.refreshSubs();
        this.refreshSubFooter();
      });
      onPitch.appendChild(div);
    }
    for (const p of team.bench) {
      const div = document.createElement('div');
      div.className = 'player' + (this.subSel.in === p.num ? ' selected' : '');
      div.innerHTML = `<span>${p.num} ${shortName(p.name)} <span class="meta">(${p.role})</span></span>
        <span class="meta">${playerOverall(p)}</span>`;
      div.addEventListener('click', () => {
        this.subSel.in = this.subSel.in === p.num ? null : p.num;
        this.refreshSubs();
        this.refreshSubFooter();
      });
      bench.appendChild(div);
    }
  }

  refreshSubFooter() {
    const team = this.engine.teams.home;
    const out = team.onPitch.find(p => p.num === this.subSel.out);
    const inP = team.bench.find(p => p.num === this.subSel.in);
    el('#m-sub-out').textContent = out ? `${out.num} ${shortName(out.name)}` : '—';
    el('#m-sub-in').textContent = inP ? `${inP.num} ${shortName(inP.name)}` : '—';
    el('#m-subs-left').textContent = `(залишилось ${this.engine.maxSubs - this.engine.subsUsed.home} з ${this.engine.maxSubs} замін)`;
    el('#m-sub-confirm').disabled = !(out && inP) || this.engine.subsUsed.home >= this.engine.maxSubs;
  }

  togglePause() {
    this.engine._paused = !this.engine._paused;
    el('#m-pause').textContent = this.engine._paused ? 'Продовжити' : 'Пауза';
  }

  checkFulltime() {
    if (this.engine.phase === 'full') {
      el('#m-fulltime').classList.remove('hidden');
      el('#m-fulltime-score').textContent =
        `${this.engine.teams.home.meta.name} ${this.engine.score.home} – ${this.engine.score.away} ${this.engine.teams.away.meta.name}`;
    } else {
      el('#m-fulltime').classList.add('hidden');
    }
  }
}

// =============== UTILS ===============

function el(sel) { return document.querySelector(sel); }

// Compact 2-3 char positional label shown inside the player marker
// (SLF.FM-style: tactical-board feel — role abbreviation, not jersey number).
const SLOT_LABEL = {
  GK: 'GK',
  LB: 'LB', RB: 'RB',
  LWB: 'LB', RWB: 'RB',
  LCB: 'CB', RCB: 'CB', CCB: 'CB',
  CDM: 'DM', LDM: 'DM', RDM: 'DM',
  LCM: 'CM', RCM: 'CM',
  LAM: 'AM', RAM: 'AM', CAM: 'AM',
  LM: 'LM', RM: 'RM',
  LW: 'LW', RW: 'RW',
  ST: 'ST', LST: 'ST', RST: 'ST',
};
function positionLabel(p) {
  return SLOT_LABEL[p.slot?.id] || (p.slot?.role) || p.role || '';
}

// Legacy positioning constants kept for reference — actual positions now come from engine.
const _LEGACY_BEHAVIOR = {
  GK: { attP: 0.00, defP: 0.00, yP: 0.00, attA: 0,  defA: 0  }, // special-cased
  CB: { attP: 0.10, defP: 0.20, yP: 0.40, attA: 7,  defA: 0  },
  FB: { attP: 0.18, defP: 0.40, yP: 0.30, attA: 9,  defA: 1  },
  DM: { attP: 0.22, defP: 0.42, yP: 0.50, attA: 4,  defA: 1  },
  CM: { attP: 0.32, defP: 0.45, yP: 0.55, attA: 7,  defA: 3  },
  AM: { attP: 0.40, defP: 0.32, yP: 0.55, attA: 9,  defA: 8  },
  W:  { attP: 0.10, defP: 0.50, yP: 0.18, attA: 8,  defA: 14 },
  ST: { attP: 0.14, defP: 0.20, yP: 0.30, attA: 6,  defA: 18 },
};

// Phase state — drives positional rotations for each role.
// In possession (in our half / mid / final third) → 'build' | 'progress' | 'final'
// Out of possession (where we let opponent have it) → 'high-press' | 'mid-block' | 'low-block'
function getPhaseState(side, engine) {
  const z = engine.ball.zone;
  if (engine.ball.side === side) {
    return z < 35 ? 'build' : z < 65 ? 'progress' : 'final';
  }
  // Defending — ball.zone is opp possessor's perspective; high z = opp deep in our half.
  return z < 35 ? 'high-press' : z < 65 ? 'mid-block' : 'low-block';
}

function computeGK(side, t, ballPos, inPoss) {
  const ballNearOwnGoal = side === 'home' ? ballPos.x < 30 : ballPos.x > 75;
  const sweep = t.defLine === 'high' || (inPoss && !ballNearOwnGoal);
  let x = side === 'home' ? 5 : 100;
  if (sweep) x = side === 'home' ? 16 : 89;
  else if (t.defLine === 'mid') x = side === 'home' ? 9 : 96;
  let y = 34;
  if (!inPoss && ballNearOwnGoal) y = 34 + (ballPos.y - 34) * 0.25;
  return { x: clamp(x, 1, 104), y: clamp(y, 28, 40) };
}

// Compute target pitch position (105×68) for a player given current engine state.
// Layered model: anchor → tactical advance → ball pull → role-rotation override → micro-stagger.
function computePlayerTarget(side, p, engine) {
  if (p.state.sentOff) return playerAbs(side, p.slot);

  const dir = side === 'home' ? 1 : -1;
  const anchor = playerAbs(side, p.slot);
  const inPoss = engine.ball.side === side;
  const ballPos = ballAbs(engine);
  const t = engine.teams[side].tactics;
  const phase = getPhaseState(side, engine);
  const isLeft = p.slot.y < 0.5;
  const ballSameFlank = (isLeft && ballPos.y < 32) || (!isLeft && ballPos.y > 36);

  if (p.role === 'GK') return computeGK(side, t, ballPos, inPoss);

  const beh = BEHAVIOR[p.role] || BEHAVIOR.CM;

  // Tactical modulation
  const defLineMod = t.defLine === 'high' ? 6 : t.defLine === 'deep' ? -6 : 0;
  const pressMod   = t.pressHeight === 'high' ? 6 : t.pressHeight === 'low' ? -5 : 0;
  const widthMod   = t.width === 'wide' ? 1.20 : t.width === 'narrow' ? 0.78 : 1.0;
  const mentalityX = parseInt(t.mentality, 10) * 1.6;

  // Phase-driven forward / backward base shift
  let advance = inPoss ? beh.attA : -beh.defA;
  if (inPoss) {
    advance += defLineMod * 0.5 + mentalityX;
  } else {
    advance += defLineMod;
    if (['ST', 'AM', 'W'].includes(p.role)) advance += pressMod;
    if (['CB', 'FB'].includes(p.role)) advance += pressMod * 0.4;
  }

  let x = anchor.x + advance * dir;
  let y = anchor.y;

  // Width spread for FB/W in possession
  if ((p.role === 'FB' || p.role === 'W') && inPoss) {
    const fromCenter = anchor.y - 34;
    y = 34 + fromCenter * widthMod;
  }

  // Default ball pull (X) and lateral compression (Y)
  const pullX = inPoss ? beh.attP : beh.defP;
  x += (ballPos.x - anchor.x) * pullX;
  const yPullScale = inPoss ? 0.45 : 1.0;
  y += (ballPos.y - y) * beh.yP * yPullScale;

  // ===== ROLE ROTATIONS (override base position via blending) =====

  // FB: wide low (build) → invert into halfspace (progress, off-ball flank) → overlap (final, ball side)
  if (p.role === 'FB' && inPoss) {
    if (phase === 'progress' && !ballSameFlank) {
      // Inverted FB — joins midfield from halfspace
      const tx = (side === 'home' ? 48 : 57);
      const ty = isLeft ? 24 : 44;
      x = (x + tx * 1.5) / 2.5;
      y = (y + ty * 1.5) / 2.5;
    } else if (phase === 'final' && ballSameFlank) {
      // Overlap — high and wide, hug touchline
      x += 9 * dir;
      const cap = isLeft ? 6 : 62;
      y = isLeft ? Math.min(y, cap + 3) : Math.max(y, cap - 3);
    } else if (phase === 'final' && !ballSameFlank) {
      // Underlap / tuck inside to support central play
      const ty = isLeft ? 28 : 40;
      y = (y + ty) / 2;
      x += 5 * dir;
    }
  }

  // CB: split (build) → ball-side CB steps up (progress) → centre circle in sustained final
  if (p.role === 'CB' && inPoss) {
    if (phase === 'build') {
      y = anchor.y + (isLeft ? -4 : 4);
    } else if (phase === 'progress' && ballSameFlank) {
      x += 6 * dir;
      y += isLeft ? 2 : -2;
    } else if (phase === 'final') {
      // CBs settle near the centre circle, modulated by defLine.
      // defLine high → push past halfway; deep → stay slightly behind.
      const centreX = 52.5 + (defLineMod * 0.7) * dir;
      x = (x + centreX * 1.6) / 2.6;
      // Pinch toward centre line vertically too — narrow shape during sustained pressure.
      y = (y + 34) / 2 + (isLeft ? -3 : 3);
    }
  }

  // DM: drop between CBs (build) → cover ball side (progress) → rest defense (final)
  if (p.role === 'DM' && inPoss) {
    if (phase === 'build') {
      x -= 8 * dir;
      y = 34 + (anchor.y - 34) * 0.35;
    } else if (phase === 'progress') {
      y += (ballPos.y - y) * 0.18;
    } else if (phase === 'final') {
      x -= 4 * dir;
      y = 34 + (anchor.y - 34) * 0.4;
    }
  }

  // CM rotation: in final third, the CM nearest to ball Y becomes the late-runner; the other stays for cover.
  if (p.role === 'CM' && inPoss && phase === 'final') {
    const otherCMs = engine.teams[side].onPitch.filter(pl => pl.role === 'CM' && pl.num !== p.num && !pl.state.sentOff);
    let mostBallSide = true;
    for (const o of otherCMs) {
      if (Math.abs(o.slot.y * 68 - ballPos.y) < Math.abs(anchor.y - ballPos.y)) { mostBallSide = false; break; }
    }
    if (mostBallSide) {
      // late runner — push high into halfspace
      x += 7 * dir;
      y += (ballPos.y - y) * 0.35;
    } else {
      // stayer — drop slightly for rest defense
      x -= 2 * dir;
      y = anchor.y + (anchor.y - 34) * 0.2;
    }
  }

  // W: invert when ball-side FB overlaps; otherwise hold width
  if (p.role === 'W' && inPoss) {
    if (phase === 'final' && ballSameFlank) {
      // FB overlapping — winger comes inside to halfspace
      const ty = isLeft ? 22 : 46;
      const tx = side === 'home' ? 80 : 25;
      y = (y + ty) / 2;
      x = (x + tx) / 2;
    } else {
      if (isLeft) y = Math.min(y, 22);
      else y = Math.max(y, 46);
    }
  }
  if (p.role === 'W' && !inPoss) {
    const ballOnFlank = (isLeft && ballPos.y < 22) || (!isLeft && ballPos.y > 46);
    if (ballOnFlank) {
      x -= 4 * dir;
      const cap = isLeft ? 18 : 50;
      y = isLeft ? Math.min(y, cap) : Math.max(y, cap);
    }
  }

  // ST: stay high but a true onside-clamp is applied later in updatePitchState
  // (after we know opp deepest defender's actual rendered X).
  if (p.role === 'ST' && inPoss && phase === 'final') {
    y += (ballPos.y - y) * 0.25;
  }

  // AM: ball-side halfspace
  if (p.role === 'AM' && inPoss) {
    const halfspaceTarget = ballPos.y < 34 ? 24 : 44;
    y = (y + halfspaceTarget) / 2;
  }

  // ===== STABLE MICRO-STAGGER =====
  // Small deterministic offset breaks visual ties between same-role players.
  const seed = (p.num * 53 + (p.slot.id ? p.slot.id.charCodeAt(0) : 0)) % 360;
  const rad = seed * Math.PI / 180;
  x += Math.cos(rad) * 0.6;
  y += Math.sin(rad) * 0.6;

  // ===== OFF-BALL MOTION =====
  // Each player oscillates within their role's zone of responsibility, so the
  // pitch is always "alive" — runs, lateral adjustments, drift — even when the
  // ball is static. Amplitude is phase-modulated (more motion in attack).
  const offT = performance.now() / 1000;
  const offPhase = ((p.num * 17 + (p.slot.id ? p.slot.id.charCodeAt(0) : 0)) % 360) * Math.PI / 180;
  const intensity =
    phase === 'final' ? 1.25 :
    phase === 'progress' ? 1.0 :
    phase === 'build' ? 0.55 :
    phase === 'high-press' ? 1.15 :
    phase === 'mid-block' ? 0.9 :
    0.7;
  const off = roleOffBallMotion(p.role, offT, offPhase, dir, intensity);
  x += off.dx;
  y += off.dy;

  return { x: clamp(x, 1.5, 103.5), y: clamp(y, 2, 66) };
}

// 1D smooth noise made from a sum of sines — looks organic, deterministic per phaseOff.
function noise1d(t, phaseOff, freq = 1.0) {
  return Math.sin(t * 0.30 * freq + phaseOff) * 0.55
       + Math.sin(t * 0.78 * freq + phaseOff * 1.31) * 0.30
       + Math.sin(t * 1.43 * freq + phaseOff * 1.91) * 0.18;
}

// Role-typical off-ball motion amplitudes (in pitch units). dir = attacking direction.
function roleOffBallMotion(role, t, phase, dir, intensity) {
  let ampX = 0, ampY = 0, freqX = 1, freqY = 1;
  switch (role) {
    case 'GK': ampX = 0.5; ampY = 0.3; freqX = 0.5; freqY = 0.8; break;
    case 'CB': ampX = 0.8; ampY = 1.4; freqX = 0.7; freqY = 0.9; break;   // step up / drop, lateral
    case 'FB': ampX = 2.2; ampY = 1.2; freqX = 0.85; freqY = 0.7; break;  // overlap pulses
    case 'DM': ampX = 1.3; ampY = 1.6; freqX = 0.9; freqY = 1.0; break;
    case 'CM': ampX = 2.6; ampY = 2.2; freqX = 1.05; freqY = 0.95; break; // box-to-box runs
    case 'AM': ampX = 2.4; ampY = 2.6; freqX = 1.10; freqY = 1.20; break; // pocket-finding
    case 'W':  ampX = 1.6; ampY = 2.6; freqX = 0.85; freqY = 1.00; break; // cut in / hug line
    case 'ST': ampX = 2.6; ampY = 1.9; freqX = 1.20; freqY = 0.95; break; // checking back / behind
  }
  const dx = noise1d(t, phase, freqX) * ampX * intensity * dir;
  // Y component is direction-agnostic (lateral)
  const dy = noise1d(t + 91.7, phase + 0.5, freqY) * ampY * intensity;
  return { dx, dy };
}

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

// Anti-collision pass over a flat list of {x,y} targets.
// Pushes any pair closer than minDist apart along their connecting axis.
function spreadTargets(positions, minDist = 3.4, iters = 2) {
  for (let it = 0; it < iters; it++) {
    for (let i = 0; i < positions.length; i++) {
      for (let j = i + 1; j < positions.length; j++) {
        const a = positions[i], b = positions[j];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const d2 = dx * dx + dy * dy;
        if (d2 < minDist * minDist && d2 > 0.001) {
          const d = Math.sqrt(d2);
          const push = (minDist - d) / 2;
          const ux = dx / d, uy = dy / d;
          a.x -= ux * push; a.y -= uy * push;
          b.x += ux * push; b.y += uy * push;
        }
      }
    }
  }
}

function ensurePitchPlayer(svg, side, p) {
  const id = `pl-${side}-${p.num}`;
  let g = svg.querySelector(`#${id}`);
  if (g) return g;
  const ns = 'http://www.w3.org/2000/svg';
  g = document.createElementNS(ns, 'g');
  g.setAttribute('class', 'player-g');
  g.setAttribute('id', id);
  const c = document.createElementNS(ns, 'circle');
  c.setAttribute('class', `player-c ${side}` + (p.role === 'GK' ? ' gk' : ''));
  c.setAttribute('cx', '0'); c.setAttribute('cy', '0'); c.setAttribute('r', '1.52');
  g.appendChild(c);
  const t = document.createElementNS(ns, 'text');
  t.setAttribute('class', 'player-num');
  t.setAttribute('x', '0'); t.setAttribute('y', '0.15');
  t.textContent = positionLabel(p);
  g.appendChild(t);
  // Insert before ball/halo if present
  const halo = svg.querySelector('#m-ball-halo');
  const ball = svg.querySelector('#m-ball');
  if (halo) svg.insertBefore(g, halo);
  else if (ball) svg.insertBefore(g, ball);
  else svg.appendChild(g);
  return g;
}

// Compute target positions for all on-pitch players (sent-off excluded).
// Returns array [{ side, p, x, y, isHolder }]. No DOM mutation.
function computeAllTargets(engine) {
  const items = [];
  for (const side of ['home', 'away']) {
    const team = engine.teams[side];
    for (const p of team.onPitch) {
      if (p.state.sentOff) continue;
      const target = computePlayerTarget(side, p, engine);
      const isHolder = engine.ball.side === side && engine.ball.holderIdx === team.onPitch.indexOf(p);
      items.push({ side, p, x: target.x, y: target.y, isHolder });
    }
  }
  // Onside-clamp ST
  for (const item of items) {
    if (item.p.role !== 'ST') continue;
    const oppItems = items.filter(i => i.side !== item.side && i.p.role !== 'GK');
    if (oppItems.length === 0) continue;
    if (item.side === 'home') {
      const lineX = Math.max(...oppItems.map(i => i.x));
      if (item.x > lineX - 0.5) item.x = lineX - 1.5;
    } else {
      const lineX = Math.min(...oppItems.map(i => i.x));
      if (item.x < lineX + 0.5) item.x = lineX + 1.5;
    }
  }
  // Anti-collision spreads
  for (const side of ['home', 'away']) {
    const sideItems = items.filter(it => it.side === side);
    spreadTargets(sideItems, 3.0, 2);
  }
  spreadTargets(items, 2.2, 1);
  return items;
}

// Update only class states (holder ring, sent-off) — called per tick from refreshPitch.
function refreshPlayerClasses(svg, engine) {
  for (const side of ['home', 'away']) {
    const team = engine.teams[side];
    for (const p of team.onPitch) {
      const g = ensurePitchPlayer(svg, side, p);
      const circle = g.querySelector('circle');
      const isHolder = engine.ball.side === side && engine.ball.holderIdx === team.onPitch.indexOf(p);
      let cls = `player-c ${side}` + (p.role === 'GK' ? ' gk' : '');
      if (p.state.sentOff) cls += ' sentoff';
      if (isHolder) cls += ' holder';
      circle.setAttribute('class', cls);
    }
  }
}

function updatePitchState(svg, engine) {
  // Hide elements for players no longer on pitch (substituted off)
  const allActive = new Set();
  for (const side of ['home','away']) for (const p of engine.teams[side].onPitch) allActive.add(`pl-${side}-${p.num}`);
  svg.querySelectorAll('.player-g').forEach(g => {
    if (!allActive.has(g.id)) g.style.display = 'none';
    else g.style.display = '';
  });

  // 1) Compute all targets first so we can run anti-collision over them.
  const items = [];
  let holderItem = null;
  for (const side of ['home', 'away']) {
    const team = engine.teams[side];
    for (const p of team.onPitch) {
      if (p.state.sentOff) continue;
      const target = computePlayerTarget(side, p, engine);
      const isHolder = engine.ball.side === side && engine.ball.holderIdx === team.onPitch.indexOf(p);
      const item = { side, p, x: target.x, y: target.y, isHolder };
      items.push(item);
      if (isHolder) holderItem = item;
    }
  }

  // 2) Onside clamp for STs — pull them back behind opponent's deepest field defender
  //    so they aren't permanently in offside positions.
  for (const item of items) {
    if (item.p.role !== 'ST') continue;
    const oppItems = items.filter(i => i.side !== item.side && i.p.role !== 'GK' && !i.p.state.sentOff);
    if (oppItems.length === 0) continue;
    let lineX;
    if (item.side === 'home') {
      // home attacks toward X=105; deepest opp defender = highest X among opp
      lineX = Math.max(...oppItems.map(i => i.x));
      if (item.x > lineX - 0.5) item.x = lineX - 1.5;  // 1.5m onside
    } else {
      lineX = Math.min(...oppItems.map(i => i.x));
      if (item.x < lineX + 0.5) item.x = lineX + 1.5;
    }
  }

  // 3) Spread overlapping players (each team independently — opponents may overlap legitimately
  //    while same-team should not stack on the same patch).
  for (const side of ['home', 'away']) {
    const sideItems = items.filter(it => it.side === side);
    spreadTargets(sideItems, 3.4, 2);
  }
  // Light cross-team spread to avoid pixel-perfect overlap of opposing markers
  spreadTargets(items, 2.5, 1);

  // 3) Render players
  for (const it of items) {
    const g = ensurePitchPlayer(svg, it.side, it.p);
    g.setAttribute('transform', `translate(${it.x.toFixed(2)} ${it.y.toFixed(2)})`);
    const circle = g.querySelector('circle');
    let cls = `player-c ${it.side}` + (it.p.role === 'GK' ? ' gk' : '');
    if (it.isHolder) cls += ' holder';
    circle.setAttribute('class', cls);
  }
  // Render hidden sent-off elements with sentoff class so they fade in if they reappear
  for (const side of ['home','away']) {
    for (const p of engine.teams[side].onPitch) {
      if (!p.state.sentOff) continue;
      const g = ensurePitchPlayer(svg, side, p);
      g.querySelector('circle').setAttribute('class', `player-c ${side} sentoff`);
    }
  }

  // 4) Ball — pinned to the holder's actual rendered position, slightly ahead.
  let bx, by;
  if (holderItem) {
    const dir = holderItem.side === 'home' ? 1 : -1;
    bx = holderItem.x + 1.8 * dir;
    by = holderItem.y + 0.5;
  } else {
    const fallback = ballAbs(engine);
    bx = fallback.x; by = fallback.y;
  }
  const ball = svg.querySelector('#m-ball');
  if (ball) { ball.setAttribute('cx', bx.toFixed(2)); ball.setAttribute('cy', by.toFixed(2)); }
  const halo = svg.querySelector('#m-ball-halo');
  if (halo) { halo.setAttribute('cx', bx.toFixed(2)); halo.setAttribute('cy', by.toFixed(2)); }
}

function pad2(n) { return String(n).padStart(2, '0'); }

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

function flash(node, msg) {
  const orig = node.textContent;
  node.textContent = msg;
  node.disabled = true;
  setTimeout(() => { node.textContent = orig; node.disabled = false; }, 1600);
}

function describePayload(payload) {
  const parts = [];
  if (payload.formation) parts.push(`схема:${payload.formation}`);
  if (payload.mentality !== undefined) parts.push(`мент:${payload.mentality}`);
  if (payload.tempo) parts.push(`темп:${payload.tempo}`);
  if (payload.pressHeight) parts.push(`ВП:${payload.pressHeight}`);
  if (payload.pressInt) parts.push(`ІП:${payload.pressInt}`);
  if (payload.defLine) parts.push(`ЛЗ:${payload.defLine}`);
  if (payload.width) parts.push(`Ш:${payload.width}`);
  if (payload.passing) parts.push(`пас:${payload.passing}`);
  return parts.join(' · ');
}

export function showScreen(id) {
  for (const s of document.querySelectorAll('.screen')) s.classList.remove('active');
  el('#' + id).classList.add('active');
}
