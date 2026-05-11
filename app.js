// Kick-Off FM — single-file SPA. Vanilla ES modules, no framework.
// Views: login | register | tg-link | onboarding | dashboard | tactics | result

// ============================================================================
// API helper
// ============================================================================

const API = {
  token: localStorage.getItem('kf-token') || null,
  setToken(t) { this.token = t; if (t) localStorage.setItem('kf-token', t); else localStorage.removeItem('kf-token'); },
  async req(path, opts = {}) {
    const headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) };
    if (this.token) headers.Authorization = `Bearer ${this.token}`;
    const res = await fetch(path, { ...opts, headers });
    let body = null;
    try { body = await res.json(); } catch {}
    if (!res.ok) throw Object.assign(new Error(body?.error || `http_${res.status}`), { status: res.status, body });
    return body;
  },
  get(p)        { return this.req(p); },
  post(p, body) { return this.req(p, { method: 'POST',  body: JSON.stringify(body || {}) }); },
  put(p, body)  { return this.req(p, { method: 'PUT',   body: JSON.stringify(body || {}) }); },
  patch(p, body){ return this.req(p, { method: 'PATCH', body: JSON.stringify(body || {}) }); },
  del(p)        { return this.req(p, { method: 'DELETE' }); },
};

// ============================================================================
// State + router
// ============================================================================

const state = {
  user: null,                 // null when not logged in
  view: 'boot',
  params: {},
};

function go(view, params = {}) {
  state.view = view;
  state.params = params;
  render();
}

async function bootstrap() {
  if (API.token) {
    try {
      state.user = await API.get('/api/auth/me');
    } catch (err) {
      // token bad/expired — clear and force login
      API.setToken(null);
      state.user = null;
    }
  }
  if (state.user) {
    go(state.user.currentTeamId ? 'dashboard' : 'onboarding');
  } else {
    go('login');
  }
}

// ============================================================================
// Error & status messages (Ukrainian)
// ============================================================================

const ERR_RU = {
  invalid_email:        'Невірна електронна пошта',
  invalid_username:     'Логін: 3-24 символи, латиниця/цифри/_',
  weak_password:        'Пароль закороткий (мінімум 8 символів)',
  invalid_beta_key:     'Невірний бета-ключ',
  email_taken:          'Email вже використовується',
  username_taken:       'Логін вже зайнятий',
  invalid_credentials:  'Невірний email або пароль',
  missing_fields:       'Заповни всі поля',
  user_gone:            'Акаунт не знайдено',
  invalid_challenge:    'Сесія входу неактивна, увійди знову',
  code_expired:         'Код прострочений',
  wrong_code:           'Невірний код',
  telegram_unreachable: 'Telegram не відповідає, спробуй пізніше',
  team_already_claimed_or_missing: 'Команду вже взяли',
  already_managing:     'Ти вже керуєш командою',
  not_managing:         'Ти зараз без команди',
  not_manager:          'Тільки тренер може це робити',
  team_not_found:       'Команду не знайдено',
  result_not_found:     'Результат недоступний',
  db_not_ready:         'База даних недоступна',
  http_500:             'Внутрішня помилка сервера',
};
function errMsg(code) { return ERR_RU[code] || code; }

// ============================================================================
// Render router
// ============================================================================

function el(html) {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}

function render() {
  const root = document.getElementById('app');
  const v = state.view;
  const html = (
    v === 'login'      ? renderLogin() :
    v === 'register'   ? renderRegister() :
    v === 'tg-link'    ? renderTgLink() :
    v === '2fa'        ? render2fa() :
    v === 'onboarding' ? renderOnboarding() :
    v === 'dashboard'  ? renderDashboard() :
    v === 'team'       ? renderTeam() :
    v === 'tactics'    ? renderTactics() :
    v === 'friendlies' ? renderFriendlies() :
    v === 'league'     ? renderLeague() :
    v === 'result'     ? renderResult() :
    v === 'admin'      ? renderAdmin() :
    `<div class="bootstrap-loader">Невідомий екран: ${v}</div>`
  );
  root.innerHTML = (state.user ? renderTopbar() : '') + html;
  attachHandlers();
}

function renderTopbar() {
  const hasTeam = !!state.user.currentTeamId;
  return `
    <header class="topbar">
      <div class="brand">⚽ Kick-Off FM <span class="tag">beta</span></div>
      <nav class="nav">
        <a class="${state.view === 'dashboard' ? 'active' : ''}" data-go="dashboard">Огляд</a>
        ${hasTeam ? `<a class="${state.view === 'team' ? 'active' : ''}" data-go="team">Склад</a>` : ''}
        ${hasTeam ? `<a class="${state.view === 'tactics' ? 'active' : ''}" data-go="tactics">Тактика</a>` : ''}
        ${hasTeam ? `<a class="${state.view === 'friendlies' ? 'active' : ''}" data-go="friendlies">Товарняки</a>` : ''}
        ${hasTeam ? `<a class="${state.view === 'league' ? 'active' : ''}" data-go="league">Чемпіонат</a>` : ''}
        ${state.user.isAdmin ? `<a class="${state.view === 'admin' ? 'active' : ''}" data-go="admin">⚙️ Адмін</a>` : ''}
        <span class="user">@${state.user.username}${state.user.isAdmin ? ' 👑' : ''}</span>
        <button class="ghost" data-action="logout">Вийти</button>
      </nav>
    </header>
  `;
}

// ============================================================================
// Views
// ============================================================================

function renderLogin() {
  return `
    <div class="auth-shell">
      <h1>⚽ Kick-Off FM</h1>
      <div class="subtitle">Онлайн футбольний менеджер</div>
      <div class="card">
        <h2>Вхід</h2>
        <div id="login-err"></div>
        <form data-form="login">
          <label class="field"><span class="label">Email</span>
            <input name="email" type="email" required autocomplete="email" />
          </label>
          <label class="field"><span class="label">Пароль</span>
            <input name="password" type="password" required autocomplete="current-password" />
          </label>
          <button class="primary" type="submit">Увійти</button>
        </form>
      </div>
      <div class="switch">Немає акаунту? <a data-go="register">Зареєструватися</a></div>
    </div>
  `;
}

function renderRegister() {
  return `
    <div class="auth-shell">
      <h1>⚽ Kick-Off FM</h1>
      <div class="subtitle">Реєстрація для бета-тесту</div>
      <div class="card">
        <h2>Створити акаунт</h2>
        <div id="reg-err"></div>
        <form data-form="register">
          <label class="field"><span class="label">Email</span>
            <input name="email" type="email" required autocomplete="email" />
          </label>
          <label class="field"><span class="label">Логін (3-24, лат./цифри/_)</span>
            <input name="username" required autocomplete="username" pattern="[a-zA-Z0-9_]{3,24}" />
          </label>
          <label class="field"><span class="label">Пароль (мін. 8)</span>
            <input name="password" type="password" required autocomplete="new-password" minlength="8" />
          </label>
          <label class="field"><span class="label">Бета-ключ</span>
            <input name="betaKey" required placeholder="отримай від адміна" />
          </label>
          <button class="primary" type="submit">Зареєструватися</button>
        </form>
      </div>
      <div class="switch">Вже маєш акаунт? <a data-go="login">Увійти</a></div>
    </div>
  `;
}

function renderTgLink() {
  const { linkToken, botUsername } = state.params;
  const botName = botUsername || 'kickoff_2fa_bot';
  return `
    <div class="auth-shell">
      <h1>📲 Активуй 2FA</h1>
      <div class="subtitle">Привʼяжи Telegram для отримання кодів входу</div>
      <div class="card">
        <h2>Залишилось 2 кроки</h2>
        <div class="tg-link-box">
          <ol>
            <li>Відкрий бота в Telegram: <a href="https://t.me/${botName}" target="_blank">@${botName}</a></li>
            <li>Натисни <b>Start</b>, або надішли:
              <span class="token">/start ${linkToken}</span>
            </li>
            <li>Бот відповість «Привʼязано до @username» — поверни сюди.</li>
          </ol>
        </div>
        <div class="info">⚠️ Код привʼязки одноразовий, дійсний 24 години. Без 2FA вхід все одно працює, але менш безпечно.</div>
        <div class="actions">
          <button data-go="login">Готово, увійти</button>
          <button class="ghost" data-go="login">Пропустити</button>
        </div>
      </div>
    </div>
  `;
}

function render2fa() {
  return `
    <div class="auth-shell">
      <h1>🔐 Код двофакторної</h1>
      <div class="subtitle">Перевір Telegram — бот надіслав 6-значний код</div>
      <div class="card">
        <div id="tfa-err"></div>
        <form data-form="2fa">
          <label class="field"><span class="label">Код (6 цифр)</span>
            <input name="code" required pattern="\\d{6}" inputmode="numeric" autofocus maxlength="6" />
          </label>
          <button class="primary" type="submit">Підтвердити</button>
        </form>
      </div>
    </div>
  `;
}

function renderOnboarding() {
  if (!state.params._loaded) {
    loadOnboarding();
    return `<div class="shell"><div class="card">Завантаження ліг…</div></div>`;
  }
  const { suggestions, leagueTeams, currentLeague } = state.params;
  if (currentLeague && leagueTeams) {
    return `
      <div class="shell">
        <div class="card">
          <h2>${currentLeague.name}</h2>
          <p>Обери команду. Менеджер може взяти лише одну.</p>
          <div id="claim-err"></div>
          <div class="team-grid">
            ${leagueTeams.map(t => `
              <div class="team-tile ${t.claimed ? 'claimed' : ''}" data-team-id="${t._id}" data-claimed="${t.claimed}">
                <div class="swatch" style="background:${t.color || '#666'}"></div>
                <div class="tier">★${t.tier}</div>
                <div class="name">${t.name}</div>
                <div class="meta">${t.short} · ${t.city || ''}</div>
                ${t.claimed ? `<span class="claimed-by">@${t.managerUsername || '?'}</span>` : ''}
              </div>
            `).join('')}
          </div>
          <div class="actions">
            <button class="ghost" data-action="onboarding-back">← До ліг</button>
          </div>
        </div>
      </div>
    `;
  }
  return `
    <div class="shell">
      <div class="card">
        <h2>Обери лігу</h2>
        <p>Беремо тестовий світ <b>${suggestions[0]?.name}</b>. Сезон стартує 19.05.</p>
        ${suggestions[0]?.leagues.map(l => `
          <div class="league-row" data-league="${l.slug}">
            <div class="lname">${l.name}</div>
            <div class="open">${l.openTeams} команд відкрито</div>
          </div>
        `).join('') || '<div class="empty">Немає доступних ліг</div>'}
      </div>
    </div>
  `;
}

async function loadOnboarding() {
  try {
    const dash = await API.get('/api/dashboard');
    state.params = { _loaded: true, suggestions: dash.suggestions };
    render();
  } catch (err) {
    state.params = { _loaded: true, suggestions: [] };
    render();
  }
}

function renderDashboard() {
  if (!state.params._loaded) {
    loadDashboard();
    return `<div class="shell"><div class="card">Завантаження…</div></div>`;
  }
  const { managing, upcoming, recent } = state.params;
  if (!managing) return `<div class="shell"><div class="card empty">Команда не призначена. <a data-go="onboarding">Обрати →</a></div></div>`;
  const t = managing.team, l = managing.league, s = managing.season;
  return `
    <div class="shell">
      <div class="dash-header">
        <div class="swatch" style="background:${t.color || '#666'}"></div>
        <div>
          <h1>${t.name}</h1>
          <div class="ctx">${l?.name || ''} · Сезон ${s?.seasonNumber} · ★${t.tier}</div>
        </div>
      </div>
      <div class="grid-2">
        <div class="card">
          <h2>Найближчі матчі</h2>
          ${upcoming.length === 0 ? '<div class="empty">Немає запланованих матчів</div>' :
            upcoming.map(f => `
              <div class="fixture-row">
                <div class="when">${fmtDate(f.scheduledAt)}</div>
                <div class="opp">${f.opponent?.name || '?'}</div>
                <div class="venue">${f.venue === 'home' ? '🏠' : '✈️'}</div>
                <div class="score">тур ${f.round}</div>
              </div>
            `).join('')}
        </div>
        <div class="card">
          <h2>Останні результати</h2>
          ${recent.length === 0 ? '<div class="empty">Ще не зіграно жодного матчу</div>' :
            recent.map(r => `
              <div class="fixture-row clickable" data-result="${r.id}">
                <div class="when">${fmtDate(r.finishedAt)}</div>
                <div class="opp">${r.opponent?.name || '?'}</div>
                <div class="venue">${r.venue === 'home' ? '🏠' : '✈️'}</div>
                <div class="score ${r.outcome}">${r.score}</div>
              </div>
            `).join('')}
        </div>
      </div>
      <div class="card">
        <div class="actions">
          <button data-go="tactics">⚙️ Налаштувати тактику</button>
          <button class="ghost danger" data-action="release">Залишити команду</button>
        </div>
      </div>
    </div>
  `;
}

async function loadDashboard() {
  try {
    const data = await API.get('/api/dashboard');
    state.params = { _loaded: true, ...data };
    render();
  } catch {
    state.params = { _loaded: true, managing: null, upcoming: [], recent: [] };
    render();
  }
}

function renderTactics() {
  if (!state.params._loaded) {
    loadTactics();
    return `<div class="shell"><div class="card">Завантаження…</div></div>`;
  }
  const { team, roster, formations, rolesCatalog, edit } = state.params;
  const tactics = edit.tactics;
  const slots = formations[tactics.formation] || formations['4-3-3'];
  const playerMap = Object.fromEntries(roster.map(p => [p._id, p]));

  // Resolve current slot→player assignment (lineup override OR auto-pick).
  const lineup = resolveLineup(slots, roster, edit.lineup);

  return `
    <div class="shell">
      <div class="dash-header">
        <div class="swatch" style="background:${team.color || '#666'}"></div>
        <div><h1>Тактика — ${team.name}</h1></div>
      </div>

      <div class="card no-pad pitch-card">
        <div class="pitch-bar">
          <span>${tactics.formation}</span>
          <select id="t-formation">
            ${Object.keys(formations).map(f =>
              `<option ${f === tactics.formation ? 'selected' : ''}>${f}</option>`).join('')}
          </select>
        </div>
        ${renderVerticalPitch(slots, lineup, playerMap, team.color)}
        <div class="pitch-hint">Натисни на місце на полі — щоб поставити іншого гравця. Натисни на гравця — щоб обрати роль.</div>
      </div>

      <div class="card">
        <div id="tact-err"></div>
        <div class="tactics-grid">
          ${tacticsField('mentality', 'Ментальність', tactics.mentality, MENTALITIES)}
          ${tacticsField('tempo', 'Темп', tactics.tempo, TEMPOS)}
          ${tacticsField('pressHeight', 'Висота пресингу', tactics.pressHeight, PRESS_HEIGHTS)}
          ${tacticsField('pressInt', 'Інтенсивність пресингу', tactics.pressInt, PRESS_INTS)}
          ${tacticsField('defLine', 'Лінія оборони', tactics.defLine, DEF_LINES)}
          ${tacticsField('width', 'Ширина атаки', tactics.width, WIDTHS)}
          ${tacticsField('passing', 'Стиль передач', tactics.passing, PASSINGS)}
          ${tacticsField('dribblingFreq', 'Дриблінг', tactics.dribblingFreq, FREQS)}
          ${tacticsField('crossFreq', 'Подачі', tactics.crossFreq, FREQS)}
          ${tacticsField('longShotFreq', 'Дальні удари', tactics.longShotFreq, FREQS)}
          ${tacticsField('cornerRoutine', 'Кутові', tactics.cornerRoutine, CORNERS)}
          ${tacticsField('freeKickRoutine', 'Штрафні', tactics.freeKickRoutine, FKS)}
          ${tacticsField('timeWasting', 'Затягування часу', tactics.timeWasting, FREQS)}
        </div>
        <div class="actions">
          <button class="primary" data-action="save-tactics">💾 Зберегти</button>
          <button class="ghost" data-go="dashboard">Скасувати</button>
        </div>
      </div>
    </div>
  `;
}

// Vertical pitch SVG — own goal at BOTTOM, opp goal at TOP.
// slot.x ∈ [0..1] (0 = own goal, 1 = opp). screen Y flips: 1 - x.
// slot.y ∈ [0..1] (0 = left, 1 = right). screen X = y.
function renderVerticalPitch(slots, lineup, playerMap, color) {
  // viewBox: 100 wide × 140 tall (3:4 aspect, portrait).
  const W = 100, H = 140;
  const PAD = 6;
  const innerW = W - PAD * 2, innerH = H - PAD * 2;
  const pins = slots.map(slot => {
    const cx = PAD + slot.y * innerW;
    const cy = PAD + (1 - slot.x) * innerH;
    const playerId = lineup[slot.id];
    const p = playerId ? playerMap[playerId] : null;
    return { slot, cx, cy, p };
  });
  return `
    <svg class="pitch-svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet">
      <defs>
        <linearGradient id="pitchGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#1f4a30" />
          <stop offset="1" stop-color="#173a25" />
        </linearGradient>
      </defs>
      <!-- pitch surface + simple markings -->
      <rect x="2" y="2" width="${W-4}" height="${H-4}" rx="2" fill="url(#pitchGrad)" stroke="rgba(255,255,255,0.18)" stroke-width="0.4"/>
      <line x1="2" y1="${H/2}" x2="${W-2}" y2="${H/2}" stroke="rgba(255,255,255,0.15)" stroke-width="0.4"/>
      <circle cx="${W/2}" cy="${H/2}" r="9" fill="none" stroke="rgba(255,255,255,0.15)" stroke-width="0.4"/>
      <!-- top (opp) box -->
      <rect x="${W/2 - 22}" y="2" width="44" height="20" fill="none" stroke="rgba(255,255,255,0.15)" stroke-width="0.4"/>
      <rect x="${W/2 - 10}" y="2" width="20" height="8" fill="none" stroke="rgba(255,255,255,0.15)" stroke-width="0.4"/>
      <!-- bottom (own) box -->
      <rect x="${W/2 - 22}" y="${H-22}" width="44" height="20" fill="none" stroke="rgba(255,255,255,0.15)" stroke-width="0.4"/>
      <rect x="${W/2 - 10}" y="${H-10}" width="20" height="8" fill="none" stroke="rgba(255,255,255,0.15)" stroke-width="0.4"/>

      ${pins.map(({ slot, cx, cy, p }) => `
        <g class="pitch-pin" data-slot-id="${slot.id}" data-player-id="${p?._id || ''}">
          <circle cx="${cx}" cy="${cy}" r="6.4" fill="${color || '#4f8cff'}" stroke="rgba(0,0,0,0.4)" stroke-width="0.5"/>
          <text x="${cx}" y="${cy + 1.6}" text-anchor="middle" font-size="5.4" font-weight="700" fill="#fff">${p?.num ?? '?'}</text>
          <text x="${cx}" y="${cy + 11.5}" text-anchor="middle" font-size="3.6" fill="#e0e6ee">${p ? shortName(p.name) : '—'}</text>
        </g>
      `).join('')}
    </svg>
  `;
}

function shortName(name) {
  // "C. Davies" — leave as-is. "John Smith" → "J. Smith".
  if (!name) return '';
  if (name.includes('.')) return name;
  const parts = name.split(' ');
  if (parts.length < 2) return name;
  return parts[0][0] + '. ' + parts.slice(1).join(' ');
}

function resolveLineup(slots, roster, overrides) {
  // Pick best player per slot by role-compatibility + OVR. Overrides take precedence.
  const compat = {
    GK: ['GK'],
    CB: ['CB'],
    FB: ['FB', 'CB'],
    DM: ['DM', 'CM'],
    CM: ['CM', 'DM', 'AM'],
    AM: ['AM', 'CM', 'W'],
    W:  ['W', 'AM', 'ST'],
    ST: ['ST', 'W'],
  };
  const used = new Set();
  // First, honor overrides.
  const out = {};
  if (overrides) {
    for (const [slotId, pid] of Object.entries(overrides)) {
      if (pid && roster.find(p => p._id === pid)) {
        out[slotId] = pid; used.add(pid);
      }
    }
  }
  for (const slot of slots) {
    if (out[slot.id]) continue;
    const compatRoles = compat[slot.role] || [slot.role];
    const candidates = roster.filter(p => !used.has(p._id) && compatRoles.includes(p.role));
    candidates.sort((a, b) => (ovrOf(b) - ovrOf(a)) + (a.role === slot.role ? -10 : 0) - (b.role === slot.role ? -10 : 0));
    const pick = candidates[0] || roster.find(p => !used.has(p._id));
    if (pick) { out[slot.id] = pick._id; used.add(pick._id); }
  }
  return out;
}

const FORMATIONS = ['4-3-3','4-4-2','4-2-3-1','3-5-2','4-4-2 diamond','4-4-1-1','4-1-4-1','3-4-3','5-3-2','5-4-1','4-1-2-1-2','4-2-3-1 wide'];
const MENTALITIES = [['-2','Дуже захисна'],['-1','Захисна'],['0','Збалансована'],['1','Атакувальна'],['2','Дуже атакувальна']];
const TEMPOS = [['slow','Повільний'],['normal','Нормальний'],['fast','Швидкий']];
const PRESS_HEIGHTS = [['low','Низький'],['mid','Середній'],['high','Високий']];
const PRESS_INTS = [['low','Низька'],['mid','Середня'],['high','Висока']];
const DEF_LINES = [['deep','Низько'],['mid','Стандартно'],['high','Високо']];
const WIDTHS = [['narrow','Вузько'],['balanced','Збалансовано'],['wide','Широко']];
const PASSINGS = [['short','Короткі'],['mixed','Змішані'],['long','Довгі'],['direct','Прямі']];
const FREQS = [['rare','Рідко'],['sometimes','Іноді'],['often','Часто']];
const CORNERS = [['in_swinger','In-swinger'],['out_swinger','Out-swinger'],['near_post','Ближня штанга'],['short','Короткий']];
const FKS = [['auto','Авто'],['direct','Прямий удар'],['whip','Подача'],['low_drive','Низький напівобертом'],['short','Короткий']];

function tacticsField(name, label, current, options) {
  const opts = options.map(o => {
    const [v, lab] = Array.isArray(o) ? o : [o, o];
    return `<option value="${v}" ${String(current) === String(v) ? 'selected' : ''}>${lab}</option>`;
  }).join('');
  return `<label class="field"><span class="label">${label}</span><select name="${name}">${opts}</select></label>`;
}

async function loadTactics() {
  try {
    const dash = await API.get('/api/dashboard');
    if (!dash.managing) return go('onboarding');
    const teamId = dash.managing.team.id;
    const [team, fm, rl] = await Promise.all([
      API.get(`/api/teams/${teamId}`),
      API.get('/api/formations'),
      API.get('/api/roles'),
    ]);
    state.params = {
      _loaded: true,
      team: team.team,
      roster: team.roster,
      formations: fm.formations,
      rolesCatalog: rl.roles,
      edit: {
        tactics: { ...team.team.tactics },
        lineup:  { ...(team.team.lineupOverrides || {}) },
        roles:   {},   // playerId → { role_kind, duty } overrides this session
      },
    };
    render();
  } catch (err) {
    state.params = { _loaded: true, team: null };
    render();
  }
}

// ---- Lineup swap menu (S47) ----
function openSlotMenu(slotId) {
  closePopups();
  const { roster, edit } = state.params;
  const slots = state.params.formations[edit.tactics.formation];
  const slot = slots.find(s => s.id === slotId);
  const currentId = edit.lineup[slotId] || resolveLineup(slots, roster, edit.lineup)[slotId];
  // Sort: same-position first, then others
  const compat = { GK:['GK'], CB:['CB'], FB:['FB','CB'], DM:['DM','CM'], CM:['CM','DM','AM'], AM:['AM','CM','W'], W:['W','AM','ST'], ST:['ST','W'] };
  const allow = compat[slot.role] || [slot.role];
  const sorted = [...roster].sort((a, b) => {
    const ac = allow.includes(a.role) ? 0 : 1;
    const bc = allow.includes(b.role) ? 0 : 1;
    if (ac !== bc) return ac - bc;
    return ovrOf(b) - ovrOf(a);
  });
  const pop = document.createElement('div');
  pop.className = 'pop-modal';
  pop.innerHTML = `
    <div class="pop-card">
      <button class="pl-close" data-action="close-popup">×</button>
      <h3>Слот ${slotId} · ${slot.role}</h3>
      <div class="pop-list">
        ${sorted.map(p => `
          <button class="pop-row ${p._id === currentId ? 'current' : ''}" data-pick-player="${p._id}" data-slot="${slotId}">
            <span class="num">#${p.num}</span>
            <span class="pos-chip pos-${p.role}">${ROLE_UA[p.role] || p.role}</span>
            <span class="name">${p.name}</span>
            <span class="ovr">${ovrOf(p)}</span>
          </button>
        `).join('')}
      </div>
    </div>
  `;
  pop.addEventListener('click', (e) => { if (e.target === pop) closePopups(); });
  document.body.appendChild(pop);
  pop.querySelectorAll('[data-pick-player]').forEach(b => {
    b.addEventListener('click', () => {
      const pid = b.getAttribute('data-pick-player');
      const sid = b.getAttribute('data-slot');
      // Remove player from any other slot they may occupy
      for (const k of Object.keys(state.params.edit.lineup)) {
        if (state.params.edit.lineup[k] === pid) delete state.params.edit.lineup[k];
      }
      state.params.edit.lineup[sid] = pid;
      closePopups(); render();
    });
  });
}

// ---- Role picker menu (S47) ----
function openRoleMenu(playerId) {
  closePopups();
  const { roster, rolesCatalog, edit } = state.params;
  const p = roster.find(x => x._id === playerId);
  if (!p) return;
  const list = rolesCatalog[p.role] || [];
  if (list.length === 0) return;
  const current = edit.roles[playerId]?.role_kind ?? p.role_kind ?? list[0].id;
  const currentDuty = edit.roles[playerId]?.duty ?? p.duty ?? 'support';

  const pop = document.createElement('div');
  pop.className = 'pop-modal';
  pop.innerHTML = `
    <div class="pop-card wide">
      <button class="pl-close" data-action="close-popup">×</button>
      <h3>#${p.num} ${p.name} · роль</h3>
      <div class="role-list">
        ${list.map(r => {
          const ua = ROLE_KIND_UA[r.id] || [r.label, r.desc];
          return `
          <button class="role-row ${r.id === current ? 'current' : ''}" data-pick-role="${r.id}" data-player="${playerId}">
            <div class="role-row-head">
              <span class="role-name">${ua[0]}</span>
              ${r.id === current ? '<span class="badge">обрано</span>' : ''}
            </div>
            <div class="role-row-desc">${ua[1] || ''}</div>
          </button>
        `; }).join('')}
      </div>
      <div class="duty-row">
        <span>Менталітет ролі:</span>
        ${['defend','support','attack'].map(d => `
          <button class="duty-chip ${d === currentDuty ? 'active' : ''}" data-pick-duty="${d}" data-player="${playerId}">${
            d === 'defend' ? 'Захисний' : d === 'attack' ? 'Атакувальний' : 'Збалансований'
          }</button>
        `).join('')}
      </div>
    </div>
  `;
  pop.addEventListener('click', (e) => { if (e.target === pop) closePopups(); });
  document.body.appendChild(pop);
  pop.querySelectorAll('[data-pick-role]').forEach(b => {
    b.addEventListener('click', () => {
      const rid = b.getAttribute('data-pick-role');
      const pid = b.getAttribute('data-player');
      const cur = state.params.edit.roles[pid] || {};
      state.params.edit.roles[pid] = { ...cur, role_kind: rid };
      closePopups(); openRoleMenu(pid);
    });
  });
  pop.querySelectorAll('[data-pick-duty]').forEach(b => {
    b.addEventListener('click', () => {
      const dty = b.getAttribute('data-pick-duty');
      const pid = b.getAttribute('data-player');
      const cur = state.params.edit.roles[pid] || {};
      state.params.edit.roles[pid] = { ...cur, duty: dty };
      closePopups(); openRoleMenu(pid);
    });
  });
}

function closePopups() {
  document.querySelectorAll('.pop-modal').forEach(n => n.remove());
}

async function saveTactics() {
  const { team, edit } = state.params;
  // Collect tactic dropdowns from current DOM (form-less)
  const fields = ['mentality','tempo','pressHeight','pressInt','defLine','width','passing',
                  'dribblingFreq','crossFreq','longShotFreq','cornerRoutine','freeKickRoutine','timeWasting'];
  const tacticsOut = { ...edit.tactics };
  for (const f of fields) {
    const el = document.querySelector(`select[name="${f}"]`);
    if (el) tacticsOut[f] = el.value;
  }
  // formation comes from the inline pitch dropdown
  const fSel = document.getElementById('t-formation');
  if (fSel) tacticsOut.formation = fSel.value;

  try {
    await API.put(`/api/teams/${team._id}/tactics`, {
      tactics: tacticsOut,
      lineupOverrides: edit.lineup,
      playerRoles: edit.roles,
    });
    go('dashboard');
  } catch (err) {
    showErr('tact-err', err.message);
  }
}

function renderResult() {
  if (!state.params._loaded) {
    loadResult();
    return `<div class="shell"><div class="card">Завантаження…</div></div>`;
  }
  const { result, home, away } = state.params;
  if (!result) return `<div class="shell"><div class="card empty">Результат недоступний.</div></div>`;
  const sH = result.stats.home, sA = result.stats.away;
  const passH = sH.passes ? Math.round(sH.passesCompleted / sH.passes * 100) : 0;
  const passA = sA.passes ? Math.round(sA.passesCompleted / sA.passes * 100) : 0;
  return `
    <div class="shell">
      <div class="card">
        <div class="score-line">
          <div class="team-name">${home.name}</div>
          <div class="score">${result.homeScore} <span class="vs">—</span> ${result.awayScore}</div>
          <div class="team-name">${away.name}</div>
        </div>
        <h3>Статистика</h3>
        ${statsRow('Удари', sH.shots, sA.shots)}
        ${statsRow('У ціль', sH.onTarget, sA.onTarget)}
        ${statsRow('xG', sH.xg.toFixed(2), sA.xg.toFixed(2))}
        ${statsRow('Передачі %', passH + '%', passA + '%')}
        ${statsRow('Корнери', sH.corners, sA.corners)}
        ${statsRow('Фоли', sH.fouls, sA.fouls)}
        ${statsRow('Жовті', sH.yellows, sA.yellows)}
        ${statsRow('Офсайди', sH.offsides, sA.offsides)}
        <h3>Голи</h3>
        ${result.goals.length === 0 ? '<div class="empty">0:0 — без голів</div>' :
          `<div class="goal-list">
            ${result.goals.map(g => `
              <div class="goal">
                <div class="min">${Math.round(g.time / 60)}'</div>
                <div class="scorer">${g.scorerName}${g.assistName ? ` <span class="side">(${g.assistName})</span>` : ''}</div>
                <div class="side">${g.side === 'home' ? home.short : away.short}</div>
              </div>
            `).join('')}
          </div>`}
        <div class="actions">
          <button class="ghost" data-go="dashboard">← Назад</button>
        </div>
      </div>
    </div>
  `;
}

function statsRow(label, h, a) {
  const hN = parseFloat(h) || 0, aN = parseFloat(a) || 0;
  const total = hN + aN;
  const hPct = total > 0 ? hN / total * 100 : 50;
  const aPct = total > 0 ? aN / total * 100 : 50;
  return `
    <div class="stats-row">
      <div class="h">${h}</div>
      <div>
        <div class="label">${label}</div>
        <div class="stats-bar">
          <div style="width:${hPct}%"></div>
          <div style="width:${aPct}%"></div>
        </div>
      </div>
      <div class="a">${a}</div>
    </div>
  `;
}

async function loadResult() {
  try {
    if (state.params.isFriendly) {
      // S49: friendly stores result inline in Friendly doc.
      const data = await API.get(`/api/friendlies/${state.params.fixtureId}`);
      const f = data.friendly;
      if (f.state !== 'finished') {
        state.params = { ...state.params, _loaded: true, result: null, pending: true };
      } else {
        state.params = {
          ...state.params, _loaded: true,
          result: {
            homeScore: f.homeScore, awayScore: f.awayScore,
            stats: f.stats, goals: f.goals, finishedAt: f.finishedAt,
          },
          home: data.home, away: data.away,
          fixture: { round: '—', scheduledAt: f.scheduledAt, finishedAt: f.finishedAt },
        };
      }
      render();
      return;
    }
    const data = await API.get(`/api/results/${state.params.fixtureId}`);
    state.params = { ...state.params, _loaded: true, ...data };
    render();
  } catch {
    state.params = { ...state.params, _loaded: true, result: null };
    render();
  }
}

function fmtDate(d) {
  if (!d) return '—';
  const dt = new Date(d);
  const days = ['нд','пн','вт','ср','чт','пт','сб'];
  return `${days[dt.getDay()]} ${String(dt.getDate()).padStart(2,'0')}.${String(dt.getMonth()+1).padStart(2,'0')}`;
}

// ============================================================================
// Team view (S46) — roster table + player card modal
// ============================================================================

const ROLE_UA = {
  GK: 'ВР', CB: 'ЦЗ', FB: 'КЗ', DM: 'ОПЗ', CM: 'ЦПЗ',
  AM: 'АПЗ', W: 'КП', ST: 'НП',
};

// S47: Ukrainian translation map for sub-roles (data.js ROLES are English).
// Falls back to label from /api/roles if id is missing here.
const ROLE_KIND_UA = {
  goalkeeper:             ['Воротар', 'Стоїть на лінії, керує захистом'],
  sweeper_keeper:         ['Воротар-лібero', 'Виходить за межі штрафної'],
  central_defender:       ['Центральний захисник', 'Тримає лінію, нічого зайвого'],
  ball_playing_defender:  ['ЦЗ з пасом', 'Розпочинає атаки точними передачами'],
  no_nonsense_defender:   ['Жорсткий ЦЗ', 'Вибиває мʼяч, ризику немає'],
  full_back:              ['Крайній захисник', 'Надійний двосторонній КЗ'],
  wing_back:              ['Латераль', 'Підіймається високо, навіси'],
  inverted_wing_back:     ['КЗ-інверс', 'Зміщується в центр'],
  anchor:                 ['Якор', 'Сидить перед захистом'],
  ball_winning_midfielder:['Руйнівник', 'Перехоплює, відбирає, мʼяч'],
  deep_lying_playmaker:   ['Регіста', 'Диктує темп зі своєї половини'],
  box_to_box:             ['Бокс-ту-бокс', 'Покриває все поле'],
  mezzala:                ['Меззала', 'Атакує півпростір'],
  advanced_playmaker:     ['Атакувальний плеймейкер', 'Творить атаки, прориви пасом'],
  attacking_midfielder:   ['Атакувальний півзахисник', 'Звʼязок між лініями'],
  shadow_striker:         ['Тінь нападника', 'Підключається у штрафну ззаду'],
  trequartista:           ['Трекартиста', 'Вільний розіграш, без структури'],
  winger:                 ['Класичний вінгер', 'Навіси з флангу'],
  inside_forward:         ['Інсайд-форвард', 'Зрізається всередину, бʼє'],
  inverted_winger:        ['Інверсний вінгер', 'Зміщується в центр, комбінує'],
  advanced_forward:       ['Висунутий нападник', 'Грає на плечі захисника'],
  target_forward:         ['Таран', 'Тримає мʼяч, виграє верхнє'],
  poacher:                ['Браконьєр', 'Чатує у штрафній, добиває'],
  pressing_forward:       ['Пресинг-форвард', 'Тисне на захист першим'],
};

// Player age — deterministic from name hash since seed-time DB doesn't include real birthdays.
// Range 18-35, peaked around 24-28. Players keep stable ages between sessions.
function ageFromName(name) {
  let h = 2166136261;
  for (let i = 0; i < name.length; i++) h = (h ^ name.charCodeAt(i)) * 16777619 >>> 0;
  const r = (h % 1000) / 1000;
  // Triangular-ish distribution: cube-root toward 25
  const offset = Math.round((Math.cbrt(r * 2 - 1)) * 9);
  return Math.max(17, Math.min(36, 25 + offset));
}

// Approximate overall rating per role (mirrors data.js playerOverall logic).
function ovrOf(p) {
  const a = p.attrs || {};
  if (p.role === 'GK') {
    return Math.round((a.reflexes*2 + a.handling*1.5 + a.positioning + a.command_of_area*0.5) / 5);
  }
  const W = {
    CB: { tackling:3, marking:2, positioning:1.5, jumping_reach:1, strength:1, decisions:0.5 },
    FB: { pace:2, tackling:1.5, crossing:1.5, stamina:1, positioning:1, decisions:0.5 },
    DM: { tackling:2, passing:2, positioning:2, vision:1, decisions:1 },
    CM: { passing:2.5, vision:2, decisions:1.5, work_rate:1.5, dribbling:1 },
    AM: { passing:2, vision:2.5, dribbling:2, finishing:1, composure:1 },
    W:  { pace:2.5, dribbling:2.5, crossing:1.5, finishing:1.5, composure:1 },
    ST: { finishing:3, off_the_ball:2, pace:1.5, dribbling:1.5, composure:1.5 },
  }[p.role] || { passing:1, dribbling:1, finishing:1, tackling:1, pace:1 };
  let s = 0, d = 0;
  for (const [k, w] of Object.entries(W)) { s += (a[k]||50)*w; d += w; }
  return Math.round(s/d);
}

function renderTeam() {
  if (!state.params._loaded) {
    loadTeam();
    return `<div class="shell"><div class="card">Завантаження…</div></div>`;
  }
  const { team, roster, manager } = state.params;
  if (!team) return `<div class="shell"><div class="card empty">Команду не знайдено.</div></div>`;
  // Sort by role-importance then ovr
  const ROLE_ORDER = { GK:0, CB:1, FB:2, DM:3, CM:4, AM:5, W:6, ST:7 };
  const sorted = [...roster].sort((a, b) => (ROLE_ORDER[a.role] - ROLE_ORDER[b.role]) || (ovrOf(b) - ovrOf(a)));
  return `
    <div class="shell">
      <div class="team-header">
        <div class="emblem-lg" style="background:${team.color || '#666'}">${(team.short || team.name[0]).slice(0, 3)}</div>
        <div class="meta">
          <h1>${team.name}</h1>
          <div class="ctx">${team.city || ''}${team.city ? ' · ' : ''}Засновано ${team.founded || '—'} · Тренер: ${manager?.username ? '@' + manager.username : '<i>вільна команда</i>'}</div>
          <div class="ctx tier">Тір ★${'★'.repeat(Math.max(0, 5 - team.tier))}${'☆'.repeat(team.tier - 1)} <span class="muted">(${team.tier} з 5)</span></div>
        </div>
      </div>
      <div class="card no-pad">
        <table class="roster-table">
          <thead>
            <tr><th>#</th><th>Поз</th><th>Імʼя</th><th class="num">Вік</th><th class="num">OVR</th></tr>
          </thead>
          <tbody>
            ${sorted.map(p => `
              <tr data-player='${escAttr(JSON.stringify(p))}'>
                <td class="num">${p.num}</td>
                <td><span class="pos-chip pos-${p.role}">${ROLE_UA[p.role] || p.role}</span></td>
                <td>${p.name}</td>
                <td class="num">${p.age && p.age !== 24 ? p.age : ageFromName(p.name)}</td>
                <td class="num ovr"><b>${ovrOf(p)}</b></td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

async function loadTeam() {
  try {
    const teamId = state.user.currentTeamId;
    if (!teamId) return go('onboarding');
    const data = await API.get(`/api/teams/${teamId}`);
    state.params = { _loaded: true, ...data };
    render();
  } catch (err) {
    state.params = { _loaded: true, team: null };
    render();
  }
}

function escAttr(s) {
  return String(s).replace(/&/g, '&amp;').replace(/'/g, '&apos;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

// ---- Player card modal ----

const ATTR_META = {
  // Tech
  dribbling: 'Дриблінг', finishing: 'Завершення', first_touch: 'Перший дотик',
  heading: 'Гра головою', long_shots: 'Дальні удари', passing: 'Передачі',
  tackling: 'Відбір', crossing: 'Подачі', marking: 'Опіка', set_pieces: 'Стандарти',
  // Mental
  anticipation: 'Передбачення', composure: 'Холоднокровність', concentration: 'Концентрація',
  decisions: 'Рішучість', off_the_ball: 'Без мʼяча', positioning: 'Позиційна гра',
  vision: 'Бачення поля', work_rate: 'Працьовитість',
  // Physical
  acceleration: 'Прискорення', agility: 'Спритність', jumping_reach: 'Стрибучість',
  pace: 'Швидкість', stamina: 'Витривалість', strength: 'Сила',
  // GK
  handling: 'Гра руками', reflexes: 'Рефлекси', aerial_reach: 'Гра на виходах',
  one_on_ones: 'Один на один', kicking: 'Передачі ногою', command_of_area: 'Командування зоною',
  communication: 'Спілкування', rushing_out: 'Виходи з воріт',
};
const OUTFIELD_GROUPS = {
  'Технічні': ['dribbling','finishing','first_touch','heading','long_shots','passing','tackling','crossing','marking','set_pieces'],
  'Ментальні': ['anticipation','composure','concentration','decisions','off_the_ball','positioning','vision','work_rate'],
  'Фізичні':  ['acceleration','agility','jumping_reach','pace','stamina','strength'],
};
const GK_GROUPS = {
  'Воротарські': ['handling','reflexes','aerial_reach','one_on_ones','kicking','command_of_area','communication','rushing_out'],
  'Ментальні': ['anticipation','composure','concentration','decisions','off_the_ball','positioning','vision','work_rate'],
  'Фізичні':  ['acceleration','agility','jumping_reach','pace','stamina','strength'],
};

function openPlayerModal(p) {
  closePlayerModal();
  const groups = p.role === 'GK' ? GK_GROUPS : OUTFIELD_GROUPS;
  const allKeys = Object.values(groups).flat();
  const sorted = allKeys.map(k => ({ k, v: p.attrs?.[k] ?? 0 })).sort((a, b) => b.v - a.v);
  const best  = new Set(sorted.slice(0, 3).map(x => x.k));
  const worst = new Set(sorted.slice(-3).map(x => x.k));
  const age = p.age && p.age !== 24 ? p.age : ageFromName(p.name);

  const modal = document.createElement('div');
  modal.className = 'pl-modal';
  modal.innerHTML = `
    <div class="pl-modal-card">
      <button class="pl-close" data-action="close-modal">×</button>
      <header class="pl-modal-header">
        <div class="num">#${p.num}</div>
        <div class="meta">
          <h2>${p.name}</h2>
          <div class="ctx">${ROLE_UA[p.role] || p.role} · ${age} років · OVR <b>${ovrOf(p)}</b></div>
        </div>
      </header>
      <div class="pl-attrs">
        ${Object.entries(groups).map(([group, keys]) => `
          <div class="pl-group">
            <h3>${group}</h3>
            ${keys.map(k => {
              const v = p.attrs?.[k] ?? 0;
              const cls = best.has(k) ? 'best' : (worst.has(k) ? 'worst' : '');
              return `<div class="pl-attr ${cls}" title="${k}">
                <span class="pl-attr-name">${ATTR_META[k] || k}</span>
                <span class="pl-attr-bar"><span style="width:${v}%"></span></span>
                <span class="pl-attr-val">${v}</span>
              </div>`;
            }).join('')}
          </div>
        `).join('')}
      </div>
    </div>
  `;
  modal.addEventListener('click', (e) => {
    if (e.target === modal) closePlayerModal();
  });
  document.body.appendChild(modal);
}

function closePlayerModal() {
  document.querySelectorAll('.pl-modal').forEach(n => n.remove());
}

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closePlayerModal();
});

// ============================================================================
// Event handlers
// ============================================================================

function attachHandlers() {
  document.querySelectorAll('[data-go]').forEach(n => {
    n.addEventListener('click', (e) => {
      e.preventDefault();
      go(n.getAttribute('data-go'));
    });
  });
  document.querySelectorAll('[data-form]').forEach(n => {
    n.addEventListener('submit', (e) => {
      e.preventDefault();
      handleSubmit(n.getAttribute('data-form'), Object.fromEntries(new FormData(n)));
    });
  });
  document.querySelectorAll('[data-action]').forEach(n => {
    n.addEventListener('click', (e) => {
      e.preventDefault();
      handleAction(n.getAttribute('data-action'));
    });
  });
  document.querySelectorAll('[data-league]').forEach(n => {
    n.addEventListener('click', () => {
      handleAction('select-league', n.getAttribute('data-league'));
    });
  });
  document.querySelectorAll('[data-team-id]').forEach(n => {
    n.addEventListener('click', () => {
      if (n.getAttribute('data-claimed') === 'true') return;
      handleAction('claim-team', n.getAttribute('data-team-id'));
    });
  });
  document.querySelectorAll('[data-result]').forEach(n => {
    n.addEventListener('click', () => {
      go('result', { fixtureId: n.getAttribute('data-result') });
    });
  });
  // S46: roster row click → player modal
  document.querySelectorAll('[data-player]').forEach(n => {
    n.addEventListener('click', () => {
      try { openPlayerModal(JSON.parse(n.getAttribute('data-player'))); }
      catch (e) { console.error('bad player payload', e); }
    });
  });
  // S47: pitch pin click — circle = slot menu, name area = role menu
  document.querySelectorAll('.pitch-pin').forEach(g => {
    g.addEventListener('click', (e) => {
      const slotId = g.getAttribute('data-slot-id');
      const playerId = g.getAttribute('data-player-id');
      // Heuristic: if user clicked the name text (lower part), open role menu;
      // otherwise (number circle) open swap menu.
      const tagName = (e.target.tagName || '').toLowerCase();
      if (playerId && tagName === 'text' && e.target.getAttribute('font-size') === '3.6') {
        openRoleMenu(playerId);
      } else {
        openSlotMenu(slotId);
      }
    });
  });
  // S47: formation dropdown — re-render with new layout
  const fSel = document.getElementById('t-formation');
  if (fSel) {
    fSel.addEventListener('change', () => {
      state.params.edit.tactics.formation = fSel.value;
      // Wipe lineup overrides — slot ids differ between formations
      state.params.edit.lineup = {};
      render();
    });
  }
  // S49: friendly league dropdown swaps opponent list
  const frLg = document.getElementById('fr-league');
  if (frLg) {
    frLg.addEventListener('change', () => {
      const opp = document.getElementById('fr-opponent');
      const list = state.params.opponents[frLg.value] || [];
      opp.innerHTML = list.map(t =>
        `<option value="${t._id}">${t.name} (★${t.tier}) ${t.claimed ? '· живий тренер' : ''}</option>`
      ).join('');
    });
  }
  // S49: clicking a finished friendly opens its result (reuse fixture result view)
  document.querySelectorAll('[data-friendly]').forEach(n => {
    n.addEventListener('click', () => {
      go('result', { fixtureId: n.getAttribute('data-friendly'), isFriendly: true });
    });
  });
  // S48: league tab buttons
  document.querySelectorAll('[data-pick-league]').forEach(n => {
    n.addEventListener('click', () => {
      const slug = n.getAttribute('data-pick-league');
      state.params._loaded = false;
      loadLeague(slug);
    });
  });
  // S51: admin tab buttons + CRUD actions
  document.querySelectorAll('[data-admin-tab]').forEach(n => {
    n.addEventListener('click', () => {
      const tab = n.getAttribute('data-admin-tab');
      state.params = { ...state.params, _loaded: false, tab };
      loadAdmin(tab);
    });
  });
  document.querySelectorAll('[data-action="adm-pick-league"]').forEach(n => {
    n.addEventListener('change', () => {
      state.params.selectedLeague = n.value;
      state.params.selectedTeam = null;
      state.params._loaded = false;
      loadAdmin(state.params.tab);
    });
  });
  document.querySelectorAll('[data-action="adm-pick-team"]').forEach(n => {
    n.addEventListener('change', () => {
      state.params.selectedTeam = n.value || null;
      state.params._loaded = false;
      loadAdmin('players');
    });
  });
  document.querySelectorAll('[data-adm-del-league]').forEach(n => n.addEventListener('click', () => admDeleteLeague(n.getAttribute('data-adm-del-league'))));
  document.querySelectorAll('[data-adm-del-team]').forEach(n => n.addEventListener('click', () => admDeleteTeam(n.getAttribute('data-adm-del-team'))));
  document.querySelectorAll('[data-adm-edit-team]').forEach(n => n.addEventListener('click', () => admEditTeam(n.getAttribute('data-adm-edit-team'))));
  document.querySelectorAll('[data-adm-del-player]').forEach(n => n.addEventListener('click', () => admDeletePlayer(n.getAttribute('data-adm-del-player'))));
  document.querySelectorAll('[data-adm-edit-player]').forEach(n => n.addEventListener('click', () => {
    try { admEditPlayer(JSON.parse(n.getAttribute('data-adm-edit-player'))); } catch {}
  }));
}

// Hooked from data-action="close-modal" inside the modal itself.
window.addEventListener('click', (e) => {
  const t = e.target;
  if (t && t.getAttribute && t.getAttribute('data-action') === 'close-modal') closePlayerModal();
});

// ============================================================================
// Friendly matches (S49) — schedule + list anyone, anytime
// ============================================================================

function renderFriendlies() {
  if (!state.params._loaded) {
    loadFriendlies();
    return `<div class="shell"><div class="card">Завантаження…</div></div>`;
  }
  const { upcoming, recent, leagues, opponents } = state.params;
  return `
    <div class="shell">
      <div class="dash-header">
        <div>
          <h1>Товарняки</h1>
          <div class="ctx">20 хв (2 × 10). Грай проти будь-якої команди — навіть без тренера.</div>
        </div>
      </div>

      <div class="card">
        <h2>Призначити матч</h2>
        <div id="fr-err"></div>
        <div class="friendly-form">
          <label class="field">
            <span class="label">Ліга</span>
            <select id="fr-league">
              ${leagues.map(l => `<option value="${l.slug}">${l.name}</option>`).join('')}
            </select>
          </label>
          <label class="field">
            <span class="label">Команда</span>
            <select id="fr-opponent">
              ${(opponents[leagues[0].slug] || []).map(t =>
                `<option value="${t._id}">${t.name} (★${t.tier}) ${t.claimed ? '· живий тренер' : ''}</option>`
              ).join('')}
            </select>
          </label>
          <label class="field">
            <span class="label">Поле</span>
            <select id="fr-venue">
              <option value="home" selected>Удома</option>
              <option value="away">У гостях</option>
            </select>
          </label>
          <label class="field">
            <span class="label">Початок</span>
            <select id="fr-kickoff">
              <option value="0">Зараз</option>
              <option value="1" selected>Через 1 хв</option>
              <option value="5">Через 5 хв</option>
              <option value="15">Через 15 хв</option>
            </select>
          </label>
          <button class="primary" data-action="create-friendly">⚽ Зіграти</button>
        </div>
      </div>

      <div class="grid-2">
        <div class="card">
          <h2>Заплановано</h2>
          ${upcoming.length === 0 ? '<div class="empty">Немає запланованих матчів</div>' :
            upcoming.map(f => `
              <div class="fixture-row">
                <div class="when">${fmtDate(f.scheduledAt)} ${fmtTime(f.scheduledAt)}</div>
                <div class="opp">${f.opponent?.name || '?'}</div>
                <div class="venue">${f.venue === 'home' ? '🏠' : '✈️'}</div>
                <div class="score">${f.state === 'in_progress' ? '⏳ грає' : 'скоро'}</div>
              </div>
            `).join('')}
        </div>
        <div class="card">
          <h2>Зіграні</h2>
          ${recent.length === 0 ? '<div class="empty">Поки нічого</div>' :
            recent.map(f => `
              <div class="fixture-row clickable" data-friendly="${f.id}">
                <div class="when">${fmtDate(f.finishedAt)}</div>
                <div class="opp">${f.opponent?.name || '?'}</div>
                <div class="venue">${f.venue === 'home' ? '🏠' : '✈️'}</div>
                <div class="score ${f.outcome}">${f.myScore}-${f.oppScore}</div>
              </div>
            `).join('')}
        </div>
      </div>
    </div>
  `;
}

async function loadFriendlies() {
  try {
    const [mine, world] = await Promise.all([
      API.get('/api/friendlies/mine'),
      API.get('/api/worlds/alpha'),
    ]);
    const leagues = world.leagues;
    // Pre-fetch teams for each league
    const opponents = {};
    for (const lg of leagues) {
      const r = await API.get(`/api/worlds/alpha/leagues/${lg.slug}/teams`);
      opponents[lg.slug] = r.teams.filter(t => t._id !== state.user.currentTeamId);
    }
    state.params = {
      _loaded: true,
      upcoming: mine.upcoming,
      recent: mine.recent,
      leagues, opponents,
    };
    render();
  } catch (err) {
    state.params = { _loaded: true, upcoming: [], recent: [], leagues: [], opponents: {} };
    render();
  }
}

function fmtTime(d) {
  if (!d) return '';
  const dt = new Date(d);
  return `${String(dt.getHours()).padStart(2,'0')}:${String(dt.getMinutes()).padStart(2,'0')}`;
}

// ============================================================================
// League view (S48) — standings + top scorers/assists
// ============================================================================

function renderLeague() {
  if (!state.params._loaded) {
    loadLeague();
    return `<div class="shell"><div class="card">Завантаження…</div></div>`;
  }
  const { league, table, scorers, assists, leagues, currentLeagueSlug } = state.params;
  return `
    <div class="shell">
      <div class="dash-header">
        <div>
          <h1>${league?.name || 'Чемпіонат'}</h1>
          <div class="ctx">${(league?.country || '')} · ${table?.length || 0} команд</div>
        </div>
        <div class="league-switcher">
          ${leagues.map(l => `
            <button class="league-tab ${l.slug === currentLeagueSlug ? 'active' : ''}" data-pick-league="${l.slug}">${l.name}</button>
          `).join('')}
        </div>
      </div>

      <div class="card no-pad">
        <table class="standings-table">
          <thead>
            <tr>
              <th>#</th><th>Команда</th>
              <th class="num">М</th><th class="num">В</th><th class="num">Н</th><th class="num">П</th>
              <th class="num">З</th><th class="num">П</th><th class="num">Р</th><th class="num">О</th>
            </tr>
          </thead>
          <tbody>
            ${table.map(row => `
              <tr class="${state.user.currentTeamId && row.teamId === state.user.currentTeamId ? 'me' : ''}">
                <td class="num rank">${row.rank}</td>
                <td><span class="team-dot" style="background:${row.team.color || '#666'}"></span> ${row.team.name}</td>
                <td class="num">${row.P}</td>
                <td class="num">${row.W}</td>
                <td class="num">${row.D}</td>
                <td class="num">${row.L}</td>
                <td class="num">${row.GF}</td>
                <td class="num">${row.GA}</td>
                <td class="num">${row.GD >= 0 ? '+' : ''}${row.GD}</td>
                <td class="num pts">${row.Pts}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>

      <div class="grid-2">
        <div class="card">
          <h2>Бомбардири</h2>
          ${scorers.length === 0 ? '<div class="empty">Ще не забито жодного голу</div>' :
            `<table class="leaders-table">
              <tbody>
                ${scorers.map(s => `
                  <tr>
                    <td class="num">${s.rank}</td>
                    <td>${s.player.name} <span class="muted">(${s.team?.short || '?'})</span></td>
                    <td class="num"><b>${s.player.state.seasonGoals}</b></td>
                  </tr>
                `).join('')}
              </tbody>
            </table>`}
        </div>
        <div class="card">
          <h2>Асистенти</h2>
          ${assists.length === 0 ? '<div class="empty">Ще не зроблено жодної асистенції</div>' :
            `<table class="leaders-table">
              <tbody>
                ${assists.map(s => `
                  <tr>
                    <td class="num">${s.rank}</td>
                    <td>${s.player.name} <span class="muted">(${s.team?.short || '?'})</span></td>
                    <td class="num"><b>${s.player.state.seasonAssists}</b></td>
                  </tr>
                `).join('')}
              </tbody>
            </table>`}
        </div>
      </div>
    </div>
  `;
}

async function loadLeague(slug) {
  try {
    // Determine which league to show — default to user's team league or EPL
    let leagues;
    if (!state.params.leagues) {
      const world = await API.get('/api/worlds/alpha');
      leagues = world.leagues;
    } else {
      leagues = state.params.leagues;
    }
    const target = slug || state.params.currentLeagueSlug || (await guessMyLeague(leagues)) || leagues[0]?.slug || 'epl';
    const [std, top, ast] = await Promise.all([
      API.get(`/api/leagues/${target}/standings`),
      API.get(`/api/leagues/${target}/top-scorers`),
      API.get(`/api/leagues/${target}/top-assists`),
    ]);
    state.params = {
      _loaded: true,
      leagues, currentLeagueSlug: target,
      league: std.league, table: std.table,
      scorers: top.top, assists: ast.top,
    };
    render();
  } catch (err) {
    state.params = { _loaded: true, league: null, table: [], scorers: [], assists: [], leagues: state.params.leagues || [], currentLeagueSlug: slug };
    render();
  }
}

async function guessMyLeague(leagues) {
  if (!state.user?.currentTeamId) return null;
  try {
    const data = await API.get(`/api/teams/${state.user.currentTeamId}`);
    // team.leagueId → match by id against leagues
    const lg = leagues.find(l => l._id === data.team.leagueId);
    return lg?.slug || null;
  } catch { return null; }
}

async function createFriendly() {
  const lgSel = document.getElementById('fr-league');
  const oppSel = document.getElementById('fr-opponent');
  const venueSel = document.getElementById('fr-venue');
  const kickoffSel = document.getElementById('fr-kickoff');
  if (!oppSel?.value) return showErr('fr-err', 'оберіть суперника');
  try {
    await API.post('/api/friendlies', {
      opponentTeamId: oppSel.value,
      asHome: venueSel.value === 'home',
      kickoffInMin: Number(kickoffSel.value),
    });
    // Refresh list
    state.params = {};
    go('friendlies');
  } catch (err) {
    showErr('fr-err', err.message);
  }
}

// ============================================================================
// Admin (S51) — only visible to users with isAdmin=true in DB
// ============================================================================

function renderAdmin() {
  if (!state.user?.isAdmin) {
    return `<div class="shell"><div class="card empty">Доступ лише для адмінів.</div></div>`;
  }
  if (!state.params._loaded) {
    loadAdmin();
    return `<div class="shell"><div class="card">Завантаження…</div></div>`;
  }
  const { overview, leagues, teams, selectedLeague, players, selectedTeam, tab } = state.params;
  return `
    <div class="shell">
      <div class="dash-header">
        <div><h1>⚙️ Адмін-панель</h1><div class="ctx">CRUD на ліги · команди · гравці</div></div>
      </div>

      <div class="admin-tabs">
        <button class="${tab === 'overview' ? 'active' : ''}" data-admin-tab="overview">Огляд</button>
        <button class="${tab === 'leagues' ? 'active' : ''}" data-admin-tab="leagues">Ліги</button>
        <button class="${tab === 'teams' ? 'active' : ''}" data-admin-tab="teams">Команди</button>
        <button class="${tab === 'players' ? 'active' : ''}" data-admin-tab="players">Гравці</button>
      </div>

      ${tab === 'overview' ? renderAdminOverview(overview) : ''}
      ${tab === 'leagues' ? renderAdminLeagues(leagues) : ''}
      ${tab === 'teams' ? renderAdminTeams(leagues, teams, selectedLeague) : ''}
      ${tab === 'players' ? renderAdminPlayers(leagues, teams, selectedLeague, players, selectedTeam) : ''}
    </div>
  `;
}

function renderAdminOverview(o) {
  if (!o) return '<div class="card">Завантаження…</div>';
  return `
    <div class="admin-grid">
      <div class="card stat"><div class="stat-val">${o.worlds}</div><div class="stat-lab">світів</div></div>
      <div class="card stat"><div class="stat-val">${o.leagues}</div><div class="stat-lab">ліг</div></div>
      <div class="card stat"><div class="stat-val">${o.teams}</div><div class="stat-lab">команд</div></div>
      <div class="card stat"><div class="stat-val">${o.players}</div><div class="stat-lab">гравців</div></div>
      <div class="card stat"><div class="stat-val">${o.users}</div><div class="stat-lab">користувачів</div></div>
      <div class="card stat"><div class="stat-val">${o.admins}</div><div class="stat-lab">адмінів</div></div>
      <div class="card stat"><div class="stat-val">${o.managedTeams}</div><div class="stat-lab">з тренерами</div></div>
    </div>
  `;
}

function renderAdminLeagues(leagues) {
  return `
    <div class="card">
      <h2>Створити лігу</h2>
      <div id="adm-lg-err"></div>
      <div class="admin-form">
        <input id="adm-lg-slug" placeholder="slug (epl-2)" />
        <input id="adm-lg-name" placeholder="Назва (Premier 2)" />
        <input id="adm-lg-country" placeholder="EN" maxlength="2" />
        <input id="adm-lg-tier" type="number" min="1" max="5" placeholder="Tier (1)" />
        <button class="primary" data-action="adm-create-league">+ Створити</button>
      </div>
    </div>
    <div class="card no-pad">
      <table class="admin-table">
        <thead><tr><th>Slug</th><th>Назва</th><th>Країна</th><th class="num">Tier</th><th class="num">Команд</th><th></th></tr></thead>
        <tbody>
          ${leagues.map(l => `
            <tr>
              <td>${l.slug}</td>
              <td>${l.name}</td>
              <td>${l.country}</td>
              <td class="num">${l.tier}</td>
              <td class="num">${l.teamCount}</td>
              <td><button class="ghost danger small" data-adm-del-league="${l._id}">✕</button></td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;
}

function renderAdminTeams(leagues, teams, selectedLeague) {
  return `
    <div class="card">
      <h2>Створити команду</h2>
      <div id="adm-tm-err"></div>
      <div class="admin-form">
        <select id="adm-tm-league">${leagues.map(l => `<option value="${l._id}" ${l._id === selectedLeague ? 'selected' : ''}>${l.name}</option>`).join('')}</select>
        <input id="adm-tm-slug" placeholder="slug" />
        <input id="adm-tm-name" placeholder="Назва" />
        <input id="adm-tm-short" placeholder="ABC" maxlength="4" />
        <input id="adm-tm-color" type="color" value="#4f8cff" />
        <input id="adm-tm-tier" type="number" min="1" max="5" value="3" />
        <button class="primary" data-action="adm-create-team">+ Створити</button>
      </div>
    </div>
    <div class="card">
      <div class="admin-filter">
        <span>Фільтр ліги:</span>
        <select data-action="adm-pick-league">
          <option value="">Усі</option>
          ${leagues.map(l => `<option value="${l._id}" ${l._id === selectedLeague ? 'selected' : ''}>${l.name}</option>`).join('')}
        </select>
      </div>
    </div>
    <div class="card no-pad">
      <table class="admin-table">
        <thead><tr><th>Slug</th><th>Назва</th><th>Short</th><th>Колір</th><th class="num">★</th><th>Тренер</th><th></th></tr></thead>
        <tbody>
          ${teams.map(t => `
            <tr>
              <td>${t.slug}</td>
              <td>${t.name}</td>
              <td>${t.short}</td>
              <td><span class="color-dot" style="background:${t.color}"></span> ${t.color}</td>
              <td class="num">${t.tier}</td>
              <td>${t.managerUsername ? '@' + t.managerUsername : '<span class="muted">—</span>'}</td>
              <td>
                <button class="ghost small" data-adm-edit-team="${t._id}">✎</button>
                <button class="ghost danger small" data-adm-del-team="${t._id}">✕</button>
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;
}

function renderAdminPlayers(leagues, teams, selectedLeague, players, selectedTeam) {
  return `
    <div class="card">
      <div class="admin-filter">
        <span>Ліга:</span>
        <select data-action="adm-pick-league">
          ${leagues.map(l => `<option value="${l._id}" ${l._id === selectedLeague ? 'selected' : ''}>${l.name}</option>`).join('')}
        </select>
        <span>Команда:</span>
        <select data-action="adm-pick-team">
          <option value="">— оберіть —</option>
          ${teams.map(t => `<option value="${t._id}" ${t._id === selectedTeam ? 'selected' : ''}>${t.name}</option>`).join('')}
        </select>
      </div>
    </div>
    ${selectedTeam ? `
      <div class="card">
        <h2>Створити гравця</h2>
        <div id="adm-pl-err"></div>
        <div class="admin-form">
          <input id="adm-pl-num" type="number" min="1" max="99" placeholder="#" />
          <input id="adm-pl-name" placeholder="Імʼя" />
          <select id="adm-pl-role">${['GK','CB','FB','DM','CM','AM','W','ST'].map(r => `<option>${r}</option>`).join('')}</select>
          <input id="adm-pl-tier" type="number" min="1" max="5" value="3" />
          <input id="adm-pl-age" type="number" min="15" max="45" value="24" />
          <button class="primary" data-action="adm-create-player">+ Створити</button>
        </div>
      </div>
      <div class="card no-pad">
        <table class="admin-table">
          <thead><tr><th class="num">#</th><th>Імʼя</th><th>Поз</th><th>Sub-роль</th><th class="num">Tier</th><th class="num">Вік</th><th></th></tr></thead>
          <tbody>
            ${players.map(p => `
              <tr>
                <td class="num">${p.num}</td>
                <td>${p.name}</td>
                <td>${p.role}</td>
                <td>${p.role_kind || '<span class="muted">—</span>'}</td>
                <td class="num">${p.tier}</td>
                <td class="num">${p.age || '—'}</td>
                <td>
                  <button class="ghost small" data-adm-edit-player='${escAttr(JSON.stringify(p))}'>✎</button>
                  <button class="ghost danger small" data-adm-del-player="${p._id}">✕</button>
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    ` : '<div class="card empty">Оберіть команду, щоб побачити гравців.</div>'}
  `;
}

async function loadAdmin(tab = 'overview') {
  try {
    const [ov, lg] = await Promise.all([
      API.get('/api/admin/overview'),
      API.get('/api/admin/leagues'),
    ]);
    let teams = state.params.teams || [];
    let players = state.params.players || [];
    let selectedLeague = state.params.selectedLeague || lg.leagues[0]?._id;
    let selectedTeam = state.params.selectedTeam || null;
    if ((tab === 'teams' || tab === 'players') && selectedLeague) {
      const tt = await API.get(`/api/admin/teams?leagueId=${selectedLeague}`);
      teams = tt.teams;
    }
    if (tab === 'players' && selectedTeam) {
      const pp = await API.get(`/api/admin/players?teamId=${selectedTeam}`);
      players = pp.players;
    }
    state.params = {
      _loaded: true, tab,
      overview: ov, leagues: lg.leagues, teams, players,
      selectedLeague, selectedTeam,
    };
    render();
  } catch (err) {
    state.params = { _loaded: true, tab: 'overview', overview: null, leagues: [], teams: [], players: [] };
    render();
  }
}

async function admCreateLeague() {
  const slug = document.getElementById('adm-lg-slug').value.trim();
  const name = document.getElementById('adm-lg-name').value.trim();
  const country = document.getElementById('adm-lg-country').value.trim() || 'XX';
  const tier = Number(document.getElementById('adm-lg-tier').value) || 1;
  if (!slug || !name) return showErr('adm-lg-err', 'slug + name required');
  try {
    await API.post('/api/admin/leagues', { slug, name, country, tier });
    state.params = { _loaded: false, tab: 'leagues' };
    loadAdmin('leagues');
  } catch (err) { showErr('adm-lg-err', err.message); }
}

async function admCreateTeam() {
  const leagueId = document.getElementById('adm-tm-league').value;
  const slug = document.getElementById('adm-tm-slug').value.trim();
  const name = document.getElementById('adm-tm-name').value.trim();
  const short = document.getElementById('adm-tm-short').value.trim();
  const color = document.getElementById('adm-tm-color').value;
  const tier = Number(document.getElementById('adm-tm-tier').value) || 3;
  if (!leagueId || !slug || !name || !short) return showErr('adm-tm-err', 'усі поля обовʼязкові');
  try {
    await API.post('/api/admin/teams', { leagueId, slug, name, short, color, tier });
    state.params.selectedLeague = leagueId;
    loadAdmin('teams');
  } catch (err) { showErr('adm-tm-err', err.message); }
}

async function admDeleteTeam(id) {
  if (!confirm('Видалити команду? Гравці теж видаляться.')) return;
  await API.del(`/api/admin/teams/${id}`);
  loadAdmin('teams');
}

async function admDeleteLeague(id) {
  if (!confirm('Видалити лігу? (тільки якщо немає команд)')) return;
  try { await API.del(`/api/admin/leagues/${id}`); loadAdmin('leagues'); }
  catch (err) { alert(err.message); }
}

async function admCreatePlayer() {
  const teamId = state.params.selectedTeam;
  const num = Number(document.getElementById('adm-pl-num').value);
  const name = document.getElementById('adm-pl-name').value.trim();
  const role = document.getElementById('adm-pl-role').value;
  const tier = Number(document.getElementById('adm-pl-tier').value) || 3;
  const age = Number(document.getElementById('adm-pl-age').value) || 24;
  if (!num || !name) return showErr('adm-pl-err', 'імʼя + номер обовʼязкові');
  try {
    await API.post('/api/admin/players', { teamId, num, name, role, tier, age });
    loadAdmin('players');
  } catch (err) { showErr('adm-pl-err', err.message); }
}

async function admDeletePlayer(id) {
  if (!confirm('Видалити гравця?')) return;
  await API.del(`/api/admin/players/${id}`);
  loadAdmin('players');
}

async function admEditPlayer(p) {
  const name = prompt('Імʼя:', p.name);
  if (name == null) return;
  const num = Number(prompt('Номер:', p.num)) || p.num;
  const tier = Number(prompt('Tier (1-5):', p.tier)) || p.tier;
  const age = Number(prompt('Вік:', p.age || 24)) || p.age || 24;
  await API.patch(`/api/admin/players/${p._id}`, { name, num, tier, age });
  loadAdmin('players');
}

async function admEditTeam(id) {
  const t = state.params.teams.find(x => x._id === id);
  if (!t) return;
  const name = prompt('Назва:', t.name); if (name == null) return;
  const short = prompt('Short (3-4 літери):', t.short); if (short == null) return;
  const color = prompt('Колір (#hex):', t.color); if (color == null) return;
  const tier = Number(prompt('Tier (1-5):', t.tier)) || t.tier;
  await API.patch(`/api/admin/teams/${id}`, { name, short, color, tier });
  loadAdmin('teams');
}

function showErr(targetId, code) {
  const node = document.getElementById(targetId);
  if (node) node.innerHTML = `<div class="err">${errMsg(code)}</div>`;
}

async function handleSubmit(form, data) {
  if (form === 'login') {
    try {
      const r = await API.post('/api/auth/login', { email: data.email, password: data.password });
      if (r.needs2fa) {
        // Pass through go() — its default `params = {}` would otherwise wipe state.params
        // immediately after we set it (bug found during S43b smoke test on Fly.io).
        return go('2fa', { challengeToken: r.challengeToken });
      }
      API.setToken(r.token);
      state.user = r.user;
      go(state.user.currentTeamId ? 'dashboard' : 'onboarding');
    } catch (err) { showErr('login-err', err.message); }
  }
  if (form === 'register') {
    try {
      const r = await API.post('/api/auth/register', data);
      go('tg-link', { linkToken: r.telegramLinkToken, botUsername: r.botUsername });
    } catch (err) { showErr('reg-err', err.message); }
  }
  if (form === '2fa') {
    try {
      const r = await API.post('/api/auth/2fa/verify', {
        challengeToken: state.params.challengeToken,
        code: data.code,
      });
      API.setToken(r.token);
      state.user = r.user;
      go(state.user.currentTeamId ? 'dashboard' : 'onboarding');
    } catch (err) { showErr('tfa-err', err.message); }
  }
  if (form === 'tactics') {
    try {
      const teamId = state.params.team._id;
      await API.put(`/api/teams/${teamId}/tactics`, data);
      go('dashboard');
    } catch (err) { showErr('tact-err', err.message); }
  }
}

async function handleAction(action, payload) {
  if (action === 'logout') {
    API.setToken(null);
    state.user = null;
    go('login');
  }
  if (action === 'select-league') {
    try {
      const data = await API.get(`/api/worlds/alpha/leagues/${payload}/teams`);
      state.params = { ...state.params, _loaded: true, leagueTeams: data.teams, currentLeague: data.league };
      render();
    } catch (err) { showErr('claim-err', err.message); }
  }
  if (action === 'onboarding-back') {
    state.params = { ...state.params, leagueTeams: null, currentLeague: null };
    render();
  }
  if (action === 'claim-team') {
    try {
      await API.post(`/api/teams/${payload}/claim`);
      state.user = await API.get('/api/auth/me');
      state.params = {};
      go('dashboard');
    } catch (err) { showErr('claim-err', err.message); }
  }
  if (action === 'save-tactics') {
    return saveTactics();
  }
  if (action === 'create-friendly') {
    return createFriendly();
  }
  if (action === 'adm-create-league')  return admCreateLeague();
  if (action === 'adm-create-team')    return admCreateTeam();
  if (action === 'adm-create-player')  return admCreatePlayer();
  if (action === 'close-popup' || action === 'close-modal') {
    closePopups(); closePlayerModal();
    return;
  }
  if (action === 'release') {
    if (!confirm('Залишити команду? Дію не можна скасувати.')) return;
    await API.post('/api/teams/release');
    state.user = await API.get('/api/auth/me');
    state.params = {};
    go('onboarding');
  }
}

// ============================================================================
// Boot
// ============================================================================

bootstrap();
