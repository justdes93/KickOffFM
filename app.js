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
  post(p, body) { return this.req(p, { method: 'POST', body: JSON.stringify(body || {}) }); },
  put(p, body)  { return this.req(p, { method: 'PUT',  body: JSON.stringify(body || {}) }); },
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
    v === 'tactics'    ? renderTactics() :
    v === 'result'     ? renderResult() :
    `<div class="bootstrap-loader">Невідомий екран: ${v}</div>`
  );
  root.innerHTML = (state.user ? renderTopbar() : '') + html;
  attachHandlers();
}

function renderTopbar() {
  return `
    <header class="topbar">
      <div class="brand">⚽ Kick-Off FM <span class="tag">beta</span></div>
      <nav class="nav">
        <a class="${state.view === 'dashboard' ? 'active' : ''}" data-go="dashboard">Команда</a>
        ${state.user.currentTeamId ? `<a class="${state.view === 'tactics' ? 'active' : ''}" data-go="tactics">Тактика</a>` : ''}
        <span class="user">@${state.user.username}</span>
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
  const { team, tactics } = state.params;
  return `
    <div class="shell">
      <div class="dash-header">
        <div class="swatch" style="background:${team.color || '#666'}"></div>
        <div><h1>Тактика — ${team.name}</h1></div>
      </div>
      <div class="card">
        <div id="tact-err"></div>
        <form data-form="tactics">
          <div class="tactics-grid">
            ${tacticsField('formation', 'Схема', tactics.formation, FORMATIONS)}
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
            <button type="submit">Зберегти</button>
            <button class="ghost" type="button" data-go="dashboard">Скасувати</button>
          </div>
        </form>
      </div>
    </div>
  `;
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
    const data = await API.get(`/api/teams/${teamId}`);
    state.params = { _loaded: true, team: data.team, tactics: data.team.tactics };
    render();
  } catch {
    state.params = { _loaded: true, team: null };
    render();
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
        state.params = { challengeToken: r.challengeToken };
        return go('2fa');
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
