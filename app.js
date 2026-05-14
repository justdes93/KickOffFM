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

// ---- S58: URL routing ------------------------------------------------------
// Each SPA view maps to a unique pathname so deep-linking, refresh and the
// browser back button all work. Server has a SPA fallback that serves
// index.html for any non-/api path. Auth-required views fall back to /login
// when the user has no session.
function viewToPath(view, params = {}) {
  switch (view) {
    case 'login':       return '/login';
    case 'register':    return '/register';
    case '2fa':         return '/2fa';
    case 'tg-link':     return '/telegram';
    case 'onboarding':  return '/onboarding';
    case 'dashboard':   return '/';
    case 'team':        return '/squad';
    case 'team-detail': return params.teamId ? `/team/${params.teamId}` : '/team';
    case 'tactics':     return params.friendlyId ? `/tactics/${params.friendlyId}` : '/tactics';
    case 'friendlies':  return '/friendlies';
    case 'friendly-live': return params.fixtureId ? `/match/${params.fixtureId}` : '/match';
    case 'friendly-wait': return params.fixtureId ? `/wait/${params.fixtureId}` : '/wait';
    case 'result':      return params.fixtureId ? `/result/${params.fixtureId}${params.isFriendly ? '?friendly=1' : ''}` : '/result';
    case 'league':      return params.currentLeagueSlug ? `/league/${params.currentLeagueSlug}` : '/league';
    case 'cups':        return '/cups';
    case 'cup':         return params.cupId ? `/cup/${params.cupId}` : '/cups';
    case 'admin':       return params.tab ? `/admin/${params.tab}` : '/admin';
    case 'admin-team':  return params.id ? `/admin/team/${params.id}` : '/admin/team/new';
    case 'admin-player':
      if (params.id) return `/admin/player/${params.id}`;
      if (params.teamId) return `/admin/player/new?team=${params.teamId}`;
      return '/admin/player/new';
    default: return '/';
  }
}

function pathToView(pathname, search = '') {
  const url = new URL(pathname + search, 'http://x');
  const path = url.pathname;
  const qs = (k) => url.searchParams.get(k);
  let m;
  if (path === '/' || path === '/dashboard') return { view: 'dashboard', params: {} };
  if (path === '/login')      return { view: 'login', params: {} };
  if (path === '/register')   return { view: 'register', params: {} };
  if (path === '/2fa')        return { view: '2fa', params: {} };
  if (path === '/telegram')   return { view: 'tg-link', params: {} };
  if (path === '/onboarding') return { view: 'onboarding', params: {} };
  if (path === '/squad' || path === '/team') return { view: 'team', params: {} };
  if ((m = path.match(/^\/team\/([^/]+)$/))) return { view: 'team-detail', params: { teamId: m[1] } };
  if (path === '/tactics')    return { view: 'tactics', params: {} };
  if ((m = path.match(/^\/tactics\/([^/]+)$/))) return { view: 'tactics', params: { friendlyId: m[1] } };
  if (path === '/friendlies') return { view: 'friendlies', params: {} };
  if ((m = path.match(/^\/match\/([^/]+)$/))) return { view: 'friendly-live', params: { fixtureId: m[1] } };
  if ((m = path.match(/^\/wait\/([^/]+)$/))) return { view: 'friendly-wait', params: { fixtureId: m[1] } };
  if ((m = path.match(/^\/result\/([^/]+)$/))) return { view: 'result', params: { fixtureId: m[1], isFriendly: qs('friendly') === '1' } };
  if ((m = path.match(/^\/league(?:\/([^/]+))?$/))) return { view: 'league', params: m[1] ? { currentLeagueSlug: m[1] } : {} };
  if (path === '/cups')       return { view: 'cups', params: {} };
  if ((m = path.match(/^\/cup\/([^/]+)$/))) return { view: 'cup', params: { cupId: m[1] } };
  if ((m = path.match(/^\/admin\/team\/(new|[^/]+)$/))) return { view: 'admin-team', params: m[1] === 'new' ? {} : { id: m[1] } };
  if ((m = path.match(/^\/admin\/player\/(new|[^/]+)$/))) {
    return { view: 'admin-player', params: m[1] === 'new' ? { teamId: qs('team') } : { id: m[1] } };
  }
  if ((m = path.match(/^\/admin(?:\/([^/]+))?$/))) return { view: 'admin', params: m[1] ? { tab: m[1] } : {} };
  return { view: 'dashboard', params: {} };
}

function go(view, params = {}, opts = {}) {
  state.view = view;
  state.params = params;
  if (!opts.skipPush) {
    const url = viewToPath(view, params);
    try {
      if (location.pathname + location.search !== url) {
        history.pushState({ view, params }, '', url);
      }
    } catch { /* ignore in non-browser */ }
  }
  render();
}

window.addEventListener('popstate', () => {
  const { view, params } = pathToView(location.pathname, location.search);
  // Block authed views when not logged in.
  if (!state.user && !['login','register','2fa','tg-link'].includes(view)) {
    return go('login', {}, { skipPush: true });
  }
  go(view, params, { skipPush: true });
});

async function bootstrap() {
  if (API.token) {
    try {
      state.user = await API.get('/api/auth/me');
    } catch (err) {
      API.setToken(null);
      state.user = null;
    }
  }
  const requested = pathToView(location.pathname, location.search);
  if (state.user) {
    startActiveMatchPoll();
    // If user requested a specific URL, honor it; otherwise default by team status.
    const isAuthOnly = ['login', 'register', '2fa', 'tg-link'].includes(requested.view);
    const defaultView = state.user.currentTeamId ? 'dashboard' : 'onboarding';
    if (isAuthOnly || (requested.view === 'dashboard' && !state.user.currentTeamId)) {
      go(defaultView, {});
    } else {
      go(requested.view, requested.params);
    }
  } else {
    // Not logged in — only allow public/auth views, otherwise redirect to login.
    const allowed = ['login', 'register', '2fa', 'tg-link'];
    go(allowed.includes(requested.view) ? requested.view : 'login', requested.params);
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
  // S56: clean up engine + RAF + legacy css when leaving live match view.
  if (v !== 'friendly-live' && _liveEngine) leaveFriendlyLive();
  // S75: stop the tg-link polling when we navigate away from the linking screen.
  if (v !== 'tg-link') clearTgLinkPoll();
  // S59: stop wait-page timers when leaving wait view
  if (v !== 'friendly-wait' && (_waitTimer || _waitPoll)) stopWait();
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
    v === 'cups'       ? renderCups() :
    v === 'cup'        ? renderCupDetail() :
    v === 'result'     ? renderResult() :
    v === 'admin'      ? renderAdmin() :
    v === 'admin-team'   ? renderAdminTeamForm() :
    v === 'admin-player' ? renderAdminPlayerForm() :
    v === 'friendly-live' ? renderFriendlyLive() :
    v === 'friendly-wait' ? renderFriendlyWait() :
    v === 'team-detail'  ? renderTeamDetail() :
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
        ${hasTeam ? `<a class="${state.view === 'cups' || state.view === 'cup' ? 'active' : ''}" data-go="cups">Кубки</a>` : ''}
        ${state.user.isAdmin ? `<a class="${state.view === 'admin' ? 'active' : ''}" data-go="admin">⚙️ Адмін</a>` : ''}
        <span class="user">@${state.user.username}${state.user.isAdmin ? ' 👑' : ''}</span>
        <button class="ghost" data-action="logout">Вийти</button>
      </nav>
      ${renderLivePill()}
    </header>
  `;
}

// S55: live-match indicator that persists across all pages. Polls every 10s.
function renderLivePill() {
  const a = state.activeMatch;
  if (!a) return '';
  if (a.kind === 'live' && state.view !== 'result' && state.view !== 'friendly-live') {
    return `
      <div class="live-pill" data-live-pill="${a.id}">
        <span class="live-dot"></span>
        <span class="lp-team">${a.home?.short || '?'}</span>
        <span class="lp-score">${a.homeScore}–${a.awayScore}</span>
        <span class="lp-team">${a.away?.short || '?'}</span>
        <span class="lp-min">${a.currentMinute}'</span>
      </div>`;
  }
  if (a.kind === 'prematch' && state.view !== 'friendly-wait') {
    const remaining = Math.max(0, new Date(a.scheduledAt).getTime() - Date.now());
    const m = Math.floor(remaining / 60000);
    const s = Math.floor((remaining % 60000) / 1000);
    return `
      <div class="live-pill prematch" data-prematch-pill="${a.id}">
        <span class="lp-icon">⏳</span>
        <span class="lp-team">${a.home?.short || '?'}</span>
        <span class="lp-vs">vs</span>
        <span class="lp-team">${a.away?.short || '?'}</span>
        <span class="lp-min">${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}</span>
      </div>`;
  }
  if (a.kind === 'invitation' && state.view !== 'friendlies') {
    return `
      <div class="live-pill invite" data-go="friendlies">
        📩 нове запрошення
      </div>`;
  }
  return '';
}

let _activeMatchPollHandle = null;
let _prematchTickHandle = null;
async function pollActiveMatch() {
  if (!state.user) return;
  try {
    const r = await API.get('/api/friendlies/active');
    const next = r.active || null;
    const prev = state.activeMatch;
    state.activeMatch = next;
    const changed = !prev !== !next
      || prev?.id !== next?.id
      || prev?.kind !== next?.kind
      || prev?.homeScore !== next?.homeScore
      || prev?.awayScore !== next?.awayScore
      || prev?.currentMinute !== next?.currentMinute
      || prev?.scheduledAt !== next?.scheduledAt;
    // Skip full re-render while the user is inside the match view itself —
    // a render() there would replace the DOM (including the open tactics
    // modal) and the user would lose their place. The pill is only shown
    // outside the match anyway.
    const isInsideMatchView = state.view === 'friendly-live' || state.view === 'friendly-wait';
    if (changed && !isInsideMatchView) render();
    // Start/stop the 1-second countdown ticker depending on pill kind.
    if (next?.kind === 'prematch') startPrematchTick();
    else stopPrematchTick();
  } catch { /* pill is best-effort */ }
}
function startActiveMatchPoll() {
  if (_activeMatchPollHandle) clearInterval(_activeMatchPollHandle);
  pollActiveMatch();
  _activeMatchPollHandle = setInterval(pollActiveMatch, 10_000);
}
function startPrematchTick() {
  if (_prematchTickHandle) return;
  _prematchTickHandle = setInterval(() => {
    const a = state.activeMatch;
    if (a?.kind !== 'prematch') return stopPrematchTick();
    const node = document.querySelector('.live-pill.prematch .lp-min');
    if (!node) return;
    const remaining = Math.max(0, new Date(a.scheduledAt).getTime() - Date.now());
    const m = Math.floor(remaining / 60000);
    const s = Math.floor((remaining % 60000) / 1000);
    node.textContent = `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
    if (remaining <= 0) pollActiveMatch();   // expect server flip to in_progress
  }, 1000);
}
function stopPrematchTick() {
  if (_prematchTickHandle) { clearInterval(_prematchTickHandle); _prematchTickHandle = null; }
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
  const { linkToken, botUsername, username, linkChecking, linkError } = state.params;
  const botName = botUsername || 'kickoff_2fa_bot';
  // S75: ensure auto-poll is running while we're on this view.
  scheduleTgLinkPoll();
  return `
    <div class="auth-shell">
      <h1>📲 Активуй Telegram</h1>
      <div class="subtitle">Привʼязка боту обовʼязкова для входу</div>
      <div class="card">
        <h2>Залишилось 2 кроки</h2>
        <div class="tg-link-box">
          <ol>
            <li>Відкрий бота в Telegram: <a href="https://t.me/${botName}" target="_blank">@${botName}</a></li>
            <li>Натисни <b>Старт</b>, або надішли:
              <span class="token">/start ${linkToken}</span>
            </li>
            <li>Бот відповість «Привʼязано» — ця сторінка автоматично продовжить.</li>
          </ol>
        </div>
        <div class="info">⚠️ Код привʼязки дійсний 24 години. Без привʼязки боту вхід неможливий — це захищає твій акаунт.</div>
        <div class="tg-poll-status">
          ${linkChecking
            ? `<span class="tg-poll-dot"></span> Чекаю на /start у Telegram…`
            : (linkError ? `<span class="muted">${linkError}</span>` : '')}
        </div>
        <div class="actions">
          <button class="primary" data-action="check-tg-link">Я натиснув Start — перевірити</button>
        </div>
      </div>
    </div>
  `;
}

let _tgLinkPollHandle = null;
function scheduleTgLinkPoll() {
  if (_tgLinkPollHandle) return;
  _tgLinkPollHandle = setInterval(() => {
    if (state.view !== 'tg-link') { clearTgLinkPoll(); return; }
    checkTgLink({ silent: true });
  }, 3000);
}
function clearTgLinkPoll() {
  if (_tgLinkPollHandle) { clearInterval(_tgLinkPollHandle); _tgLinkPollHandle = null; }
}

async function checkTgLink(opts = {}) {
  const { linkToken, username } = state.params;
  if (!linkToken || !username) return;
  if (!opts.silent) { state.params.linkChecking = true; render(); }
  try {
    const r = await API.post('/api/auth/check-tg', { linkToken, username });
    if (r?.linked && r.token) {
      clearTgLinkPoll();
      API.setToken(r.token);
      state.user = r.user;
      startActiveMatchPoll();
      return go(state.user.currentTeamId ? 'dashboard' : 'onboarding');
    }
    if (!opts.silent) {
      state.params.linkChecking = false;
      state.params.linkError = 'Ще не бачимо твого /start — спробуй ще раз.';
      render();
    }
  } catch (err) {
    if (!opts.silent) {
      state.params.linkChecking = false;
      state.params.linkError = err.message || 'Помилка перевірки.';
      render();
    }
  }
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
  // S53: schedule auto-refresh if there are imminent or in-progress fixtures
  scheduleDashboardRefresh(upcoming);
  return `
    <div class="shell">
      <div class="dash-header">
        ${emblemSwatch(t, { cls: 'emblem-lg', fallback: (t.short || t.name[0]).slice(0,3) })}
        <div>
          <h1>${t.name}</h1>
          <div class="ctx">${l?.name || ''} · Сезон ${s?.seasonNumber} · ★${t.tier}</div>
        </div>
      </div>
      <div class="grid-2">
        <div class="card">
          <h2>Найближчі матчі</h2>
          ${upcoming.length === 0 ? '<div class="empty">Немає запланованих матчів</div>' :
            upcoming.map(f => {
              const live = f.state === 'in_progress';
              const soon = !live && (new Date(f.scheduledAt) - Date.now()) < 5 * 60 * 1000;
              return `
              <div class="fixture-row ${live ? 'live' : ''}">
                <div class="when">${live ? '<span class="live-dot"></span> LIVE' : (soon ? '⏱ скоро' : fmtDate(f.scheduledAt))}</div>
                <div class="opp">${f.opponent?.name || '?'}</div>
                <div class="venue">${f.venue === 'home' ? '🏠' : '✈️'}</div>
                <div class="score">тур ${f.round}</div>
              </div>
            `;}).join('')}
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

// S53: auto-refresh dashboard when matches are imminent or live.
let _dashRefreshHandle = null;
function scheduleDashboardRefresh(upcoming) {
  if (_dashRefreshHandle) clearTimeout(_dashRefreshHandle);
  if (state.view !== 'dashboard') return;
  if (!upcoming || upcoming.length === 0) return;
  const next = upcoming.find(f => f.state === 'in_progress')
            || upcoming.find(f => (new Date(f.scheduledAt) - Date.now()) < 5 * 60 * 1000);
  if (!next) return;
  // 15s while live or imminent; 60s otherwise.
  const ms = next.state === 'in_progress' ? 15_000 : 30_000;
  _dashRefreshHandle = setTimeout(() => {
    if (state.view === 'dashboard') {
      state.params._loaded = false;
      loadDashboard();
    }
  }, ms);
}

function renderTactics() {
  if (!state.params._loaded) {
    loadTactics();
    return `<div class="shell wide"><div class="card">Завантаження…</div></div>`;
  }
  const { team, roster, formations, rolesCatalog, edit, nextMatch, friendlyId, friendly, opponent } = state.params;
  const tactics = edit.tactics;
  const slots = formations[tactics.formation] || formations['4-3-3'];
  const playerMap = Object.fromEntries(roster.map(p => [p._id, p]));
  const lineup = resolveLineup(slots, roster, edit.lineup);

  // S62: two modes.
  //   • friendlyId set → pre-match override for this specific friendly.
  //     Banner highlights the opponent, save targets friendly.{home,away}TacticsOverride.
  //   • no friendlyId → team default tactics. Banner shows the next upcoming match.
  let banner;
  if (friendlyId && friendly) {
    banner = `
      <div class="card next-match-banner">
        <div class="nm-label">Тактика на цей матч</div>
        <div class="nm-row">
          <div class="nm-opp">vs <strong>${opponent?.name || '?'}</strong></div>
          <div class="nm-when">${fmtDate(friendly.scheduledAt)} ${fmtTime(friendly.scheduledAt)}</div>
        </div>
        <div class="nm-hint">Збережеться як override тільки для цього матчу. Дефолтна тактика команди не зміниться.</div>
      </div>`;
  } else if (nextMatch) {
    banner = `
      <div class="card next-match-banner">
        <div class="nm-label">Наступна гра</div>
        <div class="nm-row">
          <div class="nm-opp">vs <strong>${nextMatch.opponent?.name || '?'}</strong>
            <span class="muted">· ${nextMatch.venue === 'home' ? '🏠 удома' : '✈️ у гостях'}</span>
          </div>
          <div class="nm-when">${nextMatch.kind === 'friendly' ? '🤝 товарняк' : (nextMatch.kind === 'cup' ? '🏆 кубок' : '🏟 чемпіонат')}
            · ${fmtDate(nextMatch.scheduledAt)} ${fmtTime(nextMatch.scheduledAt)}
          </div>
        </div>
        <div class="nm-hint">Тактика застосується до цього матчу та всіх наступних, доки ти її не зміниш.</div>
      </div>`;
  } else {
    banner = `
      <div class="card next-match-banner muted">
        <div class="nm-label">Тактика за замовчуванням</div>
        <div class="nm-hint">Поки немає запланованих матчів. Тактика буде застосована до наступного матчу.</div>
      </div>`;
  }

  return `
    <div class="shell wide">
      <div class="dash-header">
        <div><h1>⚙️ Тактика — ${team.name}</h1></div>
        ${friendlyId ? '<button class="ghost" data-go="friendlies" style="margin-left:auto">← До товарняків</button>' : ''}
      </div>
      ${banner}
      <div class="tactics-layout">
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
        <div class="card tactics-settings">
          <div id="tact-err"></div>
          <div class="tactics-grid compact">
            ${tacticsField('mentality', 'Ментальність', tactics.mentality, MENTALITIES)}
            ${tacticsField('tempo', 'Темп', tactics.tempo, TEMPOS)}
            ${tacticsField('pressHeight', 'Висота пресингу', tactics.pressHeight, PRESS_HEIGHTS)}
            ${tacticsField('pressInt', 'Інт. пресингу', tactics.pressInt, PRESS_INTS)}
            ${tacticsField('defLine', 'Лінія оборони', tactics.defLine, DEF_LINES)}
            ${tacticsField('width', 'Ширина атаки', tactics.width, WIDTHS)}
            ${tacticsField('passing', 'Передачі', tactics.passing, PASSINGS)}
            ${tacticsField('dribblingFreq', 'Дриблінг', tactics.dribblingFreq, FREQS)}
            ${tacticsField('crossFreq', 'Подачі', tactics.crossFreq, FREQS)}
            ${tacticsField('longShotFreq', 'Дальні удари', tactics.longShotFreq, FREQS)}
            ${tacticsField('cornerRoutine', 'Кутові', tactics.cornerRoutine, CORNERS)}
            ${tacticsField('freeKickRoutine', 'Штрафні', tactics.freeKickRoutine, FKS)}
            ${tacticsField('timeWasting', 'Затягування', tactics.timeWasting, FREQS)}
          </div>
          <div class="actions">
            <button class="primary" data-action="save-tactics">💾 Зберегти тактику</button>
            <button class="ghost" data-go="dashboard">Скасувати</button>
          </div>
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
    const friendlyId = state.params.friendlyId || null;
    const dash = await API.get('/api/dashboard');
    if (!dash.managing) return go('onboarding');
    const teamId = dash.managing.team.id;
    const [team, fm, rl, mine, friendlyData] = await Promise.all([
      API.get(`/api/teams/${teamId}`),
      API.get('/api/formations'),
      API.get('/api/roles'),
      API.get('/api/friendlies/mine').catch(() => ({ upcoming: [] })),
      friendlyId ? API.get(`/api/friendlies/${friendlyId}`).catch(() => null) : Promise.resolve(null),
    ]);

    // S62: pre-match override mode — figure out my side + opponent, seed editor
    // from existing override (if any) else team default.
    let friendly = null, mySide = null, opponent = null, override = null;
    if (friendlyId && friendlyData?.friendly) {
      friendly = friendlyData.friendly;
      const myId = teamId.toString();
      mySide = friendly.homeTeamId.toString() === myId ? 'home'
             : friendly.awayTeamId.toString() === myId ? 'away'
             : null;
      opponent = mySide === 'home' ? friendlyData.away : friendlyData.home;
      override = mySide === 'home' ? friendly.homeTacticsOverride : friendly.awayTacticsOverride;
    }

    // Default-mode: figure out next match for the banner.
    let nextMatch = null;
    if (!friendlyId) {
      const candidates = [];
      for (const f of dash.upcoming || []) {
        candidates.push({
          kind: f.cup ? 'cup' : 'league',
          scheduledAt: f.scheduledAt, opponent: f.opponent, venue: f.venue,
        });
      }
      for (const f of mine.upcoming || []) {
        if (f.state === 'pending' || f.state === 'in_progress') continue;
        candidates.push({
          kind: 'friendly',
          scheduledAt: f.scheduledAt, opponent: f.opponent, venue: f.venue,
        });
      }
      candidates.sort((a, b) => new Date(a.scheduledAt) - new Date(b.scheduledAt));
      nextMatch = candidates[0] || null;
    }

    state.params = {
      _loaded: true,
      friendlyId, friendly, opponent,
      team: team.team,
      roster: team.roster,
      formations: fm.formations,
      rolesCatalog: rl.roles,
      nextMatch,
      edit: {
        // Start with override if exists, else team default.
        tactics: { ...(override || team.team.tactics) },
        lineup:  { ...(team.team.lineupOverrides || {}) },
        roles:   {},
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
  const { team, edit, friendlyId } = state.params;
  const fields = ['mentality','tempo','pressHeight','pressInt','defLine','width','passing',
                  'dribblingFreq','crossFreq','longShotFreq','cornerRoutine','freeKickRoutine','timeWasting'];
  const tacticsOut = { ...edit.tactics };
  for (const f of fields) {
    const el = document.querySelector(`select[name="${f}"]`);
    if (el) tacticsOut[f] = el.value;
  }
  const fSel = document.getElementById('t-formation');
  if (fSel) tacticsOut.formation = fSel.value;

  try {
    if (friendlyId) {
      // S62: pre-match override mode — save only tactics snapshot for this match.
      await API.post(`/api/friendlies/${friendlyId}/tactics`, { tactics: tacticsOut });
      go('friendlies');
    } else {
      await API.put(`/api/teams/${team._id}/tactics`, {
        tactics: tacticsOut,
        lineupOverrides: edit.lineup,
        playerRoles: edit.roles,
      });
      go('dashboard');
    }
  } catch (err) {
    showErr('tact-err', err.message);
  }
}

function renderResult() {
  if (!state.params._loaded) {
    loadResult();
    return `<div class="shell"><div class="card">Завантаження…</div></div>`;
  }
  // S55: in-progress friendly — simple wall-clock view (score + minute + revealed goals).
  // Full pitch + commentary view ships in Phase 2; for now we show a clean ticking card.
  if (state.params.live) {
    const { live, home, away } = state.params;
    return `
      <div class="shell">
        <div class="card live-match">
          <div class="live-indicator"><span class="live-dot"></span> LIVE</div>
          <div class="score-line big">
            <div class="team-side">
              ${emblemSwatch(home, { cls: 'emblem-lg', fallback: (home.short || home.name[0]).slice(0,3) })}
              <div class="team-name">${home.name}</div>
            </div>
            <div class="score-block">
              <div class="score-big">${live.homeScore} <span class="vs">—</span> ${live.awayScore}</div>
              <div class="minute">${live.currentMinute}'</div>
            </div>
            <div class="team-side">
              ${emblemSwatch(away, { cls: 'emblem-lg', fallback: (away.short || away.name[0]).slice(0,3) })}
              <div class="team-name">${away.name}</div>
            </div>
          </div>
          <h3>Голи</h3>
          ${live.goals.length === 0 ? '<div class="empty">Поки без голів</div>' :
            `<div class="goal-list">
              ${live.goals.map(g => `
                <div class="goal">
                  <div class="min">${Math.round(g.time / 60)}'</div>
                  <div class="scorer">${g.scorerName || (g.ownGoal ? 'автогол' : '?')}${g.assistName ? ` <span class="side">(${g.assistName})</span>` : ''}</div>
                  <div class="side">${g.side === 'home' ? home.short : away.short}</div>
                </div>
              `).join('')}
            </div>`}
          <div class="actions">
            <button class="ghost" data-go="dashboard">← Назад (матч продовжиться у топ-панелі)</button>
          </div>
        </div>
      </div>
    `;
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

// ============================================================================
// Friendly LIVE view (S56) — port of legacy MatchScreenUI synced to wall-clock.
// The screen-match DOM is rendered verbatim so MatchScreenUI's tight DOM
// bindings work as-is; multi-player-inappropriate controls (speed/pause/subs/
// tactics modal open) are hidden via the .live-spa class on the wrapper.
// ============================================================================

// Wall-clock reveal pacing. Per-friendly values come from /replay endpoint;
// these are just defaults if the payload is missing them.
const DEFAULT_FRIENDLY_SPEED = 3.0;
const DEFAULT_HALFTIME_REAL_SEC = 180;
const DEFAULT_HALFLEN_SEC = 2700;

// Mirror of server desiredSimSec — keeps server reveal and client engine in sync.
function liveDesiredSimSec(elapsedRealSec, halfLenSec, speedFactor, halftimeRealSec) {
  const halfRealSec = halfLenSec / speedFactor;
  if (elapsedRealSec < halfRealSec) return elapsedRealSec * speedFactor;
  if (elapsedRealSec < halfRealSec + halftimeRealSec) return halfLenSec;
  const playingAfterBreak = elapsedRealSec - halfRealSec - halftimeRealSec;
  return Math.min(halfLenSec * 2, halfLenSec + playingAfterBreak * speedFactor);
}

function renderFriendlyLive() {
  if (!state.params._loaded) {
    bootstrapFriendlyLive();
    return `<div class="shell"><div class="card">Завантаження матчу…</div></div>`;
  }
  if (state.params.bootError) {
    return `<div class="shell"><div class="card err">${state.params.bootError}</div>
      <div class="actions"><button class="ghost" data-go="friendlies">← Назад</button></div></div>`;
  }
  // S74: while fast-forwarding the engine to current minute, show a clear
  // loading state instead of letting the user watch the rewind animation.
  if (state.params.bootstrapLoading) {
    return `<div class="shell"><div class="card live-bootstrap">
      <div class="live-bootstrap-spinner"></div>
      <div class="live-bootstrap-text">${state.params.bootstrapLoading}</div>
      <div class="actions"><button class="ghost" data-go="friendlies">← Скасувати</button></div>
    </div></div>`;
  }
  // The legacy match screen — DOM verbatim from legacy.html so MatchScreenUI
  // finds every element it queries. We add `.live-spa` so our CSS hides the
  // controls that don't apply to wall-clock-driven multiplayer friendlies.
  return `
    <div class="live-spa">
      <div class="live-spa-topbar">
        <button class="ghost" data-action="leave-friendly-live">← Назад (матч продовжиться у топ-панелі)</button>
      </div>
      <section id="screen-match" class="screen active">
        <header class="match-header compact">
          <div class="match-title">
            <div class="score-line">
              <span id="m-home-name" class="t-home"></span>
              <span class="score-num"><span id="m-score-home">0</span> : <span id="m-score-away">0</span></span>
              <span id="m-away-name" class="t-away"></span>
            </div>
            <div class="scorers-line">
              <span id="m-scorers-home" class="scorers-home t-home"></span>
              <span id="m-scorers-away" class="scorers-away t-away"></span>
            </div>
            <div class="clock-line">
              <span id="m-clock">00:00</span>
              <span id="m-phase" class="phase-tag">1-й тайм</span>
            </div>
          </div>
          <div class="controls">
            <label>Швидкість
              <select id="m-speed">
                <option value="1" selected>1x</option>
              </select>
            </label>
            <button id="m-debug" class="ghost">Дебаг</button>
            <button id="m-pause">Пауза</button>
            <button id="m-quit" class="ghost">Покинути</button>
          </div>
        </header>
        <div id="m-debug-hud" class="debug-hud" style="display:none">
          <span id="m-debug-phase-home"></span>
          <span class="debug-divider">·</span>
          <span id="m-debug-phase-away"></span>
          <span class="debug-divider">·</span>
          <span id="m-debug-compactness"></span>
          <span class="debug-divider">·</span>
          <span id="m-debug-firstdef"></span>
          <span class="debug-divider">·</span>
          <span id="m-debug-swarm"></span>
        </div>

        <div class="match-grid">
          <aside class="panel team-panel team-panel-home">
            <div class="team-panel-header">
              <h3 id="m-home-team-name" class="t-home">Дім</h3>
              <button id="m-tactics-btn" class="primary tactics-btn">Тактика</button>
            </div>
            <div id="m-pending" class="pending"></div>
            <div id="m-home-squad" class="squad-list"></div>
            <h3 class="mt">Статистика</h3>
            <div id="m-home-stats-block" class="team-stats"></div>
            <h3 class="mt">⭐ Моменти</h3>
            <div id="m-highlights" class="highlights small"></div>
          </aside>

          <div class="pitch-wrap panel">
            <svg id="m-pitch" viewBox="-3 -1 111 70" preserveAspectRatio="xMidYMid meet"></svg>
            <div class="pitch-overlay">
              <span class="t-home" id="m-pitch-home">—</span>
              <span class="vs">vs</span>
              <span class="t-away" id="m-pitch-away">—</span>
            </div>
          </div>

          <aside class="panel team-panel team-panel-away">
            <div class="team-panel-header">
              <h3 id="m-away-team-name" class="t-away">Гості</h3>
            </div>
            <div id="m-away-squad" class="squad-list"></div>
            <h3 class="mt">Статистика</h3>
            <div id="m-away-stats-block" class="team-stats"></div>
            <h3 class="mt">AI суперник</h3>
            <div id="m-ai-info" class="ai-info">
              <div>Схема: <b id="ai-form">—</b></div>
              <div>Ментальність: <b id="ai-ment">—</b></div>
            </div>
          </aside>

          <main class="panel commentary-panel commentary-bottom">
            <h3>Коментар</h3>
            <div id="m-events" class="event-log"></div>
          </main>
        </div>

        <div id="m-tactics-modal" class="modal hidden">
          <div class="modal-content">
            <header class="modal-header">
              <h2>Тактика — <span class="t-home" id="m-tactics-team-name">Твоя команда</span></h2>
              <button id="m-tactics-close" class="ghost">×</button>
            </header>
            <div class="modal-body">
              <div class="tactics-grid compact">
                <label>Схема <select id="m-formation"></select></label>
                <label>Ментальність <select id="m-mentality">
                  <option value="-2">Дуже обор.</option><option value="-1">Оборонна</option>
                  <option value="0">Збаланс.</option><option value="1">Атакуюча</option>
                  <option value="2">Дуже атак.</option>
                </select></label>
                <label>Темп <select id="m-tempo">
                  <option value="slow">Повільний</option><option value="normal">Звичайний</option>
                  <option value="fast">Швидкий</option>
                </select></label>
                <label>Висота пресу <select id="m-pressHeight">
                  <option value="low">Низька</option><option value="mid">Середня</option>
                  <option value="high">Висока</option>
                </select></label>
                <label>Інтенс. пресу <select id="m-pressInt">
                  <option value="low">Низька</option><option value="mid">Середня</option>
                  <option value="high">Висока</option>
                </select></label>
                <label>Лінія захисту <select id="m-defLine">
                  <option value="deep">Глибока</option><option value="mid">Середня</option>
                  <option value="high">Висока</option>
                </select></label>
                <label>Ширина <select id="m-width">
                  <option value="narrow">Вузька</option><option value="balanced">Збаланс.</option>
                  <option value="wide">Широка</option>
                </select></label>
                <label>Пас <select id="m-passing">
                  <option value="short">Короткий</option><option value="mixed">Змішаний</option>
                  <option value="long">Довгий</option><option value="direct">Прямий</option>
                </select></label>
              </div>
              <button id="m-apply" class="primary">Зберегти зміни</button>
              <h3 class="mt">Заміни <span id="m-subs-left" class="muted small"></span></h3>
              <div class="sub-block">
                <div class="sub-col">
                  <h4>На полі</h4>
                  <div id="m-onpitch" class="player-list small"></div>
                </div>
                <div class="sub-col">
                  <h4>Лава</h4>
                  <div id="m-bench" class="player-list small"></div>
                </div>
              </div>
              <div class="sub-pending">
                <span>Виходить: <b id="m-sub-out">—</b></span>
                <span>Заходить: <b id="m-sub-in">—</b></span>
                <button id="m-sub-confirm" disabled>Зробити заміну</button>
              </div>
            </div>
          </div>
        </div>

        <div id="m-fulltime" class="fulltime hidden">
          <h2>Кінець матчу</h2>
          <p id="m-fulltime-score"></p>
          <button id="m-newgame">Назад</button>
        </div>
      </section>
    </div>
  `;
}

// Ensures legacy-style.css is in the document. Removed on view exit.
function ensureLegacyCss() {
  let link = document.getElementById('legacy-css');
  if (link) return;
  link = document.createElement('link');
  link.id = 'legacy-css';
  link.rel = 'stylesheet';
  link.href = '/legacy-style.css?v=' + Date.now();
  document.head.appendChild(link);
}
function removeLegacyCss() {
  const link = document.getElementById('legacy-css');
  if (link) link.remove();
}

let _liveEngine = null;
let _liveLoopHandle = null;
let _liveStartedAtMs = 0;
let _liveFriendlyId = null;
let _liveMatchUI = null;
let _livePollHandle = null;     // server-state polling to detect 'finished'
let _liveHalfLenSec = DEFAULT_HALFLEN_SEC;
let _liveSpeedFactor = DEFAULT_FRIENDLY_SPEED;
let _liveHalftimeRealSec = DEFAULT_HALFTIME_REAL_SEC;
let _liveMySide = null;          // 'home' | 'away' | null (spectator)
let _liveAppliedCmdCount = 0;    // commands already applied to local engine

// Apply a single command from the server's liveCommands list to the local engine.
function applyServerCmdToEngine(c) {
  if (!_liveEngine || !c) return;
  try {
    if (c.type === 'tactics') {
      _liveEngine.submitTacticalChange(c.side, c.payload || {});
    } else if (c.type === 'sub') {
      _liveEngine.substitute(c.side, c.payload?.outNum, c.payload?.inNum);
    }
  } catch { /* swallow */ }
}

// Re-wire the tactics-submit and sub-confirm buttons so they POST to server
// AND apply locally, instead of legacy single-player behavior (engine only).
// S65: don't clone the modal — that strips listeners off every descendant
// (m-apply, m-sub-confirm, close button) including the legacy open handler
// on m-tactics-btn (which lives outside but reads modal via id).
function rebindLiveControls() {
  if (!_liveMySide) return;

  // 1) Override matchUI methods first so legacy handlers (e.g. open-modal in
  //    bindHeader) call my versions when they fire refreshSubs/refreshTactics.
  if (_liveMatchUI) {
    _liveMatchUI.refreshSubs = renderMySubsPanel;
    _liveMatchUI.refreshSubFooter = renderMySubsFooter;
  }

  // 2) Replace m-apply: POST to server + apply locally.
  const apply = document.getElementById('m-apply');
  if (apply) {
    const fresh = apply.cloneNode(true);
    apply.replaceWith(fresh);
    fresh.addEventListener('click', () => onLiveTacticsSubmit());
  }

  // 3) Replace m-sub-confirm.
  const subBtn = document.getElementById('m-sub-confirm');
  if (subBtn) {
    const fresh = subBtn.cloneNode(true);
    subBtn.replaceWith(fresh);
    fresh.addEventListener('click', () => onLiveSubConfirm());
  }

  // Note: backdrop-click handling lives in legacy-ui.js bindHeader and now
  // uses mousedown+mouseup tracking so an accidental drag from inside the
  // modal to outside does NOT close it. No capture-phase override needed.

  // First paint of my-side-aware sub panel.
  renderMySubsPanel();
  renderMySubsFooter();
}

function renderMySubsFooter() {
  if (!_liveEngine || !_liveMySide) return;
  const team = _liveEngine.teams[_liveMySide];
  const sel = _liveMatchUI?.subSel || {};
  const out = team.onPitch.find(p => p.num === sel.out);
  const inP = team.bench.find(p => p.num === sel.in);
  const outEl = document.getElementById('m-sub-out');
  const inEl  = document.getElementById('m-sub-in');
  const leftEl = document.getElementById('m-subs-left');
  const cBtn = document.getElementById('m-sub-confirm');
  if (outEl) outEl.textContent = out ? `${out.num} ${out.name}` : '—';
  if (inEl)  inEl.textContent  = inP ? `${inP.num} ${inP.name}` : '—';
  if (leftEl) leftEl.textContent = `(залишилось ${_liveEngine.maxSubs - (_liveEngine.subsUsed?.[_liveMySide] ?? 0)} з ${_liveEngine.maxSubs} замін)`;
  if (cBtn)  cBtn.disabled = !(out && inP) || (_liveEngine.subsUsed?.[_liveMySide] ?? 0) >= _liveEngine.maxSubs;
}

async function onLiveTacticsSubmit() {
  if (!_liveEngine || !_liveMySide) return;
  const fmEl = document.getElementById('m-formation');
  const fields = ['mentality','tempo','pressHeight','pressInt','defLine','width','passing'];
  const payload = {};
  if (fmEl?.value) payload.formation = fmEl.value;
  for (const k of fields) {
    const v = document.getElementById('m-' + k)?.value;
    if (v != null && v !== '') payload[k] = v;
  }
  // Apply locally for instant feedback.
  _liveEngine.submitTacticalChange(_liveMySide, payload);
  // POST to server (best-effort).
  try {
    await API.post(`/api/friendlies/${_liveFriendlyId}/live-cmd`, {
      type: 'tactics', payload, simTime: _liveEngine.gameTime,
    });
  } catch (err) { /* surfaced in match log */ }
  // Close modal + feedback.
  const modal = document.getElementById('m-tactics-modal');
  if (modal) modal.classList.add('hidden');
}

// S62: my-side-aware subs UX. Click on-pitch player → highlight bench
// candidates (same role first). Click bench → marks IN. "Make sub" confirms.
// S63: skip rebuild when nothing meaningful changed — was killing UI clicks
// because we wiped innerHTML 60×/sec.
let _lastSubsRenderKey = null;
function renderMySubsPanel() {
  if (!_liveEngine || !_liveMySide) return;
  const onPitch = document.getElementById('m-onpitch');
  const bench = document.getElementById('m-bench');
  if (!onPitch || !bench) return;
  const team = _liveEngine.teams[_liveMySide];
  if (!team) return;
  const sel = _liveMatchUI?.subSel || { out: null, in: null };
  // Cheap key: nums on/off + rounded fitness + selection. Rebuild only on change.
  const key = team.onPitch.map(p => `${p.num}:${Math.round(p.state?.fitness ?? 100)}`).join(',')
    + '|' + team.bench.map(p => p.num).join(',')
    + '|' + (sel.out ?? '-') + ':' + (sel.in ?? '-');
  if (key === _lastSubsRenderKey) return;
  _lastSubsRenderKey = key;

  // Bench compatibility by role (engine treats role like 'GK', 'CB', etc.).
  const compat = {
    GK:['GK'], CB:['CB','FB'], FB:['FB','CB'], DM:['DM','CM'],
    CM:['CM','DM','AM'], AM:['AM','CM','W'], W:['W','AM','ST'], ST:['ST','W'],
  };
  const outPlayer = team.onPitch.find(p => p.num === sel.out);
  const allowedRoles = outPlayer ? (compat[outPlayer.role] || [outPlayer.role]) : null;

  onPitch.innerHTML = '';
  for (const p of team.onPitch) {
    if (p.state?.sentOff) continue;
    const tired = p.state?.fitness < 70;
    const selected = sel.out === p.num;
    const div = document.createElement('div');
    div.className = 'player' + (tired ? ' tired' : '') + (selected ? ' selected' : '');
    div.innerHTML = `<span>${p.num} ${p.name} <span class="meta">(${p.role})</span></span>
      <span class="meta">${Math.round(p.state?.fitness ?? 100)}%</span>`;
    div.addEventListener('click', () => {
      _liveMatchUI.subSel = { out: selected ? null : p.num, in: null };
      renderMySubsPanel();
      _liveMatchUI.refreshSubFooter?.();
    });
    onPitch.appendChild(div);
  }

  bench.innerHTML = '';
  for (const p of team.bench) {
    if (p.state?.sentOff) continue;
    const eligible = !allowedRoles || allowedRoles.includes(p.role);
    const selected = sel.in === p.num;
    const div = document.createElement('div');
    div.className = 'player'
      + (selected ? ' selected' : '')
      + (allowedRoles && eligible ? ' eligible' : '')
      + (allowedRoles && !eligible ? ' dim' : '');
    div.innerHTML = `<span>${p.num} ${p.name} <span class="meta">(${p.role})</span></span>
      <span class="meta">★${p.tier ?? '?'}</span>`;
    if (allowedRoles && !eligible) {
      div.style.opacity = '0.4';
      div.style.cursor = 'not-allowed';
    } else {
      div.addEventListener('click', () => {
        if (!sel.out) {                                    // no out chosen yet — hint
          flashNode(div, 'Спочатку оберіть гравця для заміни');
          return;
        }
        _liveMatchUI.subSel = { out: sel.out, in: selected ? null : p.num };
        renderMySubsPanel();
        _liveMatchUI.refreshSubFooter?.();
      });
    }
    bench.appendChild(div);
  }
}

function flashNode(node, msg) {
  const prev = node.title; node.title = msg;
  node.style.outline = '2px solid var(--warn)';
  setTimeout(() => { node.title = prev; node.style.outline = ''; }, 1200);
}

async function onLiveSubConfirm() {
  if (!_liveEngine || !_liveMySide || !_liveMatchUI) return;
  const sel = _liveMatchUI.subSel || {};
  const outNum = sel.out, inNum = sel.in;
  if (!outNum || !inNum) return;
  const r = _liveEngine.substitute(_liveMySide, outNum, inNum);
  if (!r?.ok) { alert('Заміна не вдалась: ' + (r?.reason || 'error')); return; }
  try {
    await API.post(`/api/friendlies/${_liveFriendlyId}/live-cmd`, {
      type: 'sub', payload: { outNum, inNum }, simTime: _liveEngine.gameTime,
    });
  } catch { /* swallow */ }
  _liveMatchUI.subSel = { out: null, in: null };
  if (_liveMatchUI.refreshSubs) _liveMatchUI.refreshSubs();
  if (_liveMatchUI.refreshSubFooter) _liveMatchUI.refreshSubFooter();
}

// Poll server every 5s for state changes (finished) and new opponent commands.
async function pollLiveState() {
  if (!_liveFriendlyId) return;
  try {
    const r = await API.get(`/api/friendlies/${_liveFriendlyId}`);
    if (r.friendly?.state === 'finished') {
      leaveFriendlyLive();
      return go('result', { fixtureId: _liveFriendlyId, isFriendly: true });
    }
    const all = (r.friendly?.liveCommands || []);
    if (all.length > _liveAppliedCmdCount) {
      for (let i = _liveAppliedCmdCount; i < all.length; i++) {
        const c = all[i];
        // Skip my own commands (already applied locally on submit).
        if (c.side !== _liveMySide) applyServerCmdToEngine(c);
      }
      _liveAppliedCmdCount = all.length;
    }
  } catch { /* swallow */ }
}

async function bootstrapFriendlyLive() {
  const id = state.params.fixtureId;
  _liveFriendlyId = id;
  try {
    ensureLegacyCss();
    const [{ MatchEngine, mulberry32 }, dataMod, legacyUi] = await Promise.all([
      import('/engine.js?v=' + Date.now()),
      import('/data.js?v=' + Date.now()),
      import('/legacy-ui.js?v=' + Date.now()),
    ]);
    const data = await API.get(`/api/friendlies/${id}/replay`);
    if (data.state === 'finished') {
      // Match wrapped up before we got here — show static result instead.
      removeLegacyCss();
      return go('result', { fixtureId: id, isFriendly: true });
    }
    const { home, away, rngSeed, startedAt, halfLenSec, simSpeedFactor, halftimeRealSec } = data;
    const homeFormation = home.tactics?.formation || '4-3-3';
    const awayFormation = away.tactics?.formation || '4-3-3';
    const engine = new MatchEngine({
      home, away,
      homeTactics: home.tactics, awayTactics: away.tactics,
      homeLineup: dataMod.defaultLineup(home, homeFormation),
      awayLineup: dataMod.defaultLineup(away, awayFormation),
      rng: mulberry32(rngSeed),
      halfLenSec,
    });
    engine._speed = 1;
    engine._paused = false;
    _liveEngine = engine;
    _liveStartedAtMs = new Date(startedAt).getTime();
    _liveHalfLenSec = halfLenSec || DEFAULT_HALFLEN_SEC;
    _liveSpeedFactor = simSpeedFactor || DEFAULT_FRIENDLY_SPEED;
    _liveHalftimeRealSec = halftimeRealSec || DEFAULT_HALFTIME_REAL_SEC;

    // S60: determine the user's side for during-match commands (tactics/subs).
    const myTeamId = state.user?.currentTeamId;
    _liveMySide =
      (myTeamId && data.home && (data.home._dbId === myTeamId || data.home.id === myTeamId)) ? 'home'
      : null;
    // /replay doesn't return team _id, so fall back to dashboard lookup.
    if (!_liveMySide && myTeamId) {
      try {
        const dash = await API.get('/api/dashboard').catch(() => null);
        const slug = dash?.managing?.team?.slug;
        if (slug && data.home.id === slug) _liveMySide = 'home';
        else if (slug && data.away.id === slug) _liveMySide = 'away';
      } catch { /* ignore */ }
    }
    _liveAppliedCmdCount = (data.liveCommands || []).length;

    // S74: fast-forward the engine to "now" BEFORE mounting MatchScreenUI so
    // the user never sees the catch-up animation. Previously RAF caught up at
    // 80 ticks/frame → visible 2-sec rewind from minute 0. Now we tick in big
    // chunks with periodic event-loop yields (keeps UI responsive) showing a
    // simple loading message, then mount the renderer at the current minute.
    state.params = { ...state.params, _loaded: true, bootstrapLoading: 'Перемотування до поточної хвилини…' };
    render();

    const elapsedRealSec = Math.max(0, (Date.now() - _liveStartedAtMs) / 1000);
    const desiredGameTime = liveDesiredSimSec(
      elapsedRealSec, _liveHalfLenSec, _liveSpeedFactor, _liveHalftimeRealSec
    );
    const commands = (data.liveCommands || [])
      .slice()
      .sort((a, b) => (a.simTime ?? 0) - (b.simTime ?? 0));
    let cmdIdx = 0;
    const CHUNK = 600;                                // ticks per yield (~60ms compute)
    while (engine.phase !== 'full' && engine.gameTime < desiredGameTime) {
      const target = Math.min(desiredGameTime, engine.gameTime + CHUNK * 0.1);
      let safety = 0;
      while (engine.gameTime < target && engine.phase !== 'full' && safety++ < CHUNK) {
        while (cmdIdx < commands.length && (commands[cmdIdx].simTime ?? 0) <= engine.gameTime) {
          applyServerCmdToEngine(commands[cmdIdx++]);
        }
        engine.tick();
      }
      // Yield to event loop so the page stays responsive.
      await new Promise((r) => setTimeout(r, 0));
      if (!_liveEngine || _liveEngine !== engine) return;   // user navigated away
    }

    // Hide the loading message and mount the live renderer at current state.
    state.params = { ...state.params, bootstrapLoading: null };
    render();
    _liveMatchUI = new legacyUi.MatchScreenUI(engine, null, () => leaveFriendlyLive());
    engine._speed = 1;
    engine._paused = false;
    _liveMatchUI._lastFrameTime = null;
    rebindLiveControls();
    if (_liveMySide === 'away') {
      const tacBtn = document.getElementById('m-tactics-btn');
      if (tacBtn) tacBtn.textContent = 'Тактика (гості)';
      const teamNameNode = document.getElementById('m-tactics-team-name');
      if (teamNameNode && data.away) teamNameNode.textContent = data.away.name;
    }
    // RAF loop now only progresses the engine forward in real-time.
    runLiveLoop();
    // Poll server every 5s for finalization AND opponent commands.
    _livePollHandle = setInterval(pollLiveState, 5000);
  } catch (err) {
    removeLegacyCss();
    state.params = { ...state.params, _loaded: true, bootError: 'Не вдалося завантажити матч: ' + (err?.message || err) };
    render();
  }
}

function runLiveLoop() {
  if (!_liveEngine || !_liveMatchUI) return;
  // S63: cap per-frame catch-up so UI stays responsive. Was 5000 ticks/frame,
  // which blocked the main thread for ~50ms on large fast-forwards. With cap=80
  // (~10ms budget) clicks register in time; engine spreads catch-up across
  // multiple frames if needed.
  const MAX_TICKS_PER_FRAME = 80;
  const tickEngineTo = () => {
    if (!_liveEngine) return;
    const elapsedRealSec = Math.max(0, (Date.now() - _liveStartedAtMs) / 1000);
    const desiredGameTime = liveDesiredSimSec(elapsedRealSec, _liveHalfLenSec, _liveSpeedFactor, _liveHalftimeRealSec);
    let ticks = 0;
    while (_liveEngine.phase !== 'full' && _liveEngine.gameTime < desiredGameTime && ticks++ < MAX_TICKS_PER_FRAME) {
      _liveEngine.tick();
    }
  };
  const frame = (now) => {
    if (!_liveEngine || !_liveMatchUI) return;
    tickEngineTo();
    try { _liveMatchUI.frame(now); _liveMatchUI.refreshAll(); } catch { /* swallow */ }
    if (_liveEngine.phase === 'full') {
      // Engine finished — keep showing the screen, server scheduler will mark finished.
      _liveLoopHandle = null;
      return;
    }
    _liveLoopHandle = requestAnimationFrame(frame);
  };
  _liveLoopHandle = requestAnimationFrame(frame);
}

function leaveFriendlyLive() {
  if (_liveLoopHandle) { cancelAnimationFrame(_liveLoopHandle); _liveLoopHandle = null; }
  if (_livePollHandle) { clearInterval(_livePollHandle); _livePollHandle = null; }
  _liveEngine = null;
  _liveMatchUI = null;
  _liveFriendlyId = null;
  removeLegacyCss();
}

let _liveMatchRefresh = null;
async function loadResult() {
  if (_liveMatchRefresh) { clearTimeout(_liveMatchRefresh); _liveMatchRefresh = null; }
  try {
    if (state.params.isFriendly) {
      const data = await API.get(`/api/friendlies/${state.params.fixtureId}`);
      const f = data.friendly;
      if (f.state === 'in_progress') {
        // S55: progressive reveal — server filters goals by elapsed wall-clock.
        state.params = {
          ...state.params, _loaded: true,
          live: {
            currentMinute: f._currentMinute || 0,
            homeScore: f.homeScore || 0,
            awayScore: f.awayScore || 0,
            goals: f.goals || [],
          },
          home: data.home, away: data.away,
        };
        render();
        // Poll every 5s while live; the view re-renders with fresh score/minute.
        if (state.view === 'result') {
          _liveMatchRefresh = setTimeout(() => { if (state.view === 'result') loadResult(); }, 5000);
        }
        return;
      }
      if (f.state !== 'finished') {
        state.params = { ...state.params, _loaded: true, result: null, pending: true };
      } else {
        state.params = {
          ...state.params, _loaded: true, live: null,
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
    return `<div class="shell wide"><div class="card">Завантаження…</div></div>`;
  }
  const { team, roster, manager, recent = [], upcoming = [] } = state.params;
  if (!team) return `<div class="shell"><div class="card empty">Команду не знайдено.</div></div>`;
  const ROLE_ORDER = { GK:0, CB:1, FB:2, DM:3, CM:4, AM:5, W:6, ST:7 };
  const sorted = [...roster].sort((a, b) => (ROLE_ORDER[a.role] - ROLE_ORDER[b.role]) || (ovrOf(b) - ovrOf(a)));
  return `
    <div class="shell wide">
      <div class="team-header">
        ${emblemSwatch(team, { cls: 'emblem-lg', fallback: (team.short || team.name[0]).slice(0, 3) })}
        <div class="meta">
          <h1>${team.name}</h1>
          <div class="ctx">${team.city || ''}${team.city ? ' · ' : ''}Засновано ${team.founded || '—'} · Тренер: ${manager?.username ? '@' + manager.username : '<i>вільна команда</i>'}</div>
          <div class="ctx tier">Тір ★${'★'.repeat(Math.max(0, 5 - team.tier))}${'☆'.repeat(team.tier - 1)} <span class="muted">(${team.tier} з 5)</span></div>
        </div>
      </div>
      <div class="team-detail-grid">
        <div class="card no-pad">
          <h2 style="padding: 14px 16px 0">Склад (${sorted.length})</h2>
          <table class="roster-table">
            <thead>
              <tr><th>#</th><th>Поз</th><th>Імʼя</th><th class="num">Вік</th><th class="num">OVR</th></tr>
            </thead>
            <tbody>
              ${sorted.map(p => `
                <tr class="clickable" data-player='${escAttr(JSON.stringify(p))}'>
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
        <div class="td-side">
          <div class="card">
            <h2>Останні матчі</h2>
            ${recent.length === 0 ? '<div class="empty">Поки немає</div>' :
              recent.map(r => `
                <div class="fixture-row clickable" data-result="${r.id}">
                  <div class="when">${fmtDate(r.finishedAt)}</div>
                  <div class="opp">${r.opponent?.name || '?'}</div>
                  <div class="venue">${r.venue === 'home' ? '🏠' : '✈️'}</div>
                  <div class="score ${r.outcome}">${r.myScore}-${r.oppScore}</div>
                </div>
              `).join('')}
          </div>
          <div class="card">
            <h2>Наступні матчі</h2>
            ${upcoming.length === 0 ? '<div class="empty">Розклад порожній</div>' :
              upcoming.map(f => `
                <div class="fixture-row">
                  <div class="when">${fmtDate(f.scheduledAt)} ${fmtTime(f.scheduledAt)}</div>
                  <div class="opp">${f.opponent?.name || '?'}</div>
                  <div class="venue">${f.venue === 'home' ? '🏠' : '✈️'}</div>
                  <div class="score">тур ${f.round || ''}</div>
                </div>
              `).join('')}
          </div>
        </div>
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

// Render a team emblem swatch. If emblemUrl is set, the colored fallback is
// suppressed so the emblem stands on its own. Otherwise we draw the colored
// circle with optional initials/text.
function emblemSwatch(team, opts = {}) {
  const cls = opts.cls || 'swatch';
  const fallback = opts.fallback || '';
  if (team?.emblemUrl) {
    return `<div class="${cls} has-emblem"><img src="${team.emblemUrl}" alt=""></div>`;
  }
  return `<div class="${cls}" style="background:${team?.color || '#666'}">${fallback}</div>`;
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
  // S49: clicking a finished friendly opens its result (reuse fixture result view).
  // S55: live friendly rows also use this — result view branches to live UI.
  document.querySelectorAll('[data-friendly]').forEach(n => {
    n.addEventListener('click', () => {
      go('result', { fixtureId: n.getAttribute('data-friendly'), isFriendly: true });
    });
  });
  document.querySelectorAll('[data-live-pill]').forEach(n => n.addEventListener('click', () => {
    go('friendly-live', { fixtureId: n.getAttribute('data-live-pill') });
  }));
  document.querySelectorAll('[data-prematch-pill]').forEach(n => n.addEventListener('click', () => {
    go('friendly-wait', { fixtureId: n.getAttribute('data-prematch-pill') });
  }));
  document.querySelectorAll('[data-friendly-live]').forEach(n => n.addEventListener('click', (e) => {
    e.stopPropagation();
    go('friendly-live', { fixtureId: n.getAttribute('data-friendly-live') });
  }));
  document.querySelectorAll('[data-team-detail]').forEach(n => n.addEventListener('click', (e) => {
    e.stopPropagation();
    go('team-detail', { teamId: n.getAttribute('data-team-detail') });
  }));
  document.querySelectorAll('[data-friendly-tactics]').forEach(n => n.addEventListener('click', (e) => {
    e.stopPropagation();
    go('tactics', { friendlyId: n.getAttribute('data-friendly-tactics') });
  }));
  // S58: continent change repopulates country dropdown
  const contSel = document.querySelector('[data-action="pick-continent"]');
  if (contSel) {
    contSel.addEventListener('change', () => {
      const c = contSel.value;
      const countrySel = document.getElementById('adm-pl-nat');
      const countries = COUNTRIES_BY_CONTINENT[c] || [];
      countrySel.innerHTML = `<option value="">— оберіть —</option>` +
        countries.map(([code, label]) => `<option value="${code}">${label}</option>`).join('');
    });
  }
  document.querySelectorAll('[data-accept-friendly]').forEach(n => n.addEventListener('click', (e) => {
    e.stopPropagation();
    acceptFriendly(n.getAttribute('data-accept-friendly'));
  }));
  document.querySelectorAll('[data-decline-friendly]').forEach(n => n.addEventListener('click', (e) => {
    e.stopPropagation();
    declineFriendly(n.getAttribute('data-decline-friendly'));
  }));
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
  document.querySelectorAll('[data-adm-del-team]').forEach(n => n.addEventListener('click', (e) => { e.stopPropagation(); admDeleteTeam(n.getAttribute('data-adm-del-team')); }));
  document.querySelectorAll('[data-adm-del-player]').forEach(n => n.addEventListener('click', (e) => { e.stopPropagation(); admDeletePlayer(n.getAttribute('data-adm-del-player')); }));
  // S55: navigate to dedicated admin team/player form pages
  document.querySelectorAll('[data-edit-team]').forEach(n => n.addEventListener('click', (e) => {
    e.stopPropagation();
    go('admin-team', { id: n.getAttribute('data-edit-team') });
  }));
  document.querySelectorAll('[data-edit-player]').forEach(n => n.addEventListener('click', (e) => {
    e.stopPropagation();
    go('admin-player', { id: n.getAttribute('data-edit-player'), teamId: state.params.selectedTeam });
  }));
  document.querySelectorAll('[data-new-player]').forEach(n => n.addEventListener('click', (e) => {
    e.stopPropagation();
    go('admin-player', { teamId: n.getAttribute('data-new-player') });
  }));
  // S54: cup actions
  document.querySelectorAll('[data-cup]').forEach(n => n.addEventListener('click', () => {
    go('cup', { cupId: n.getAttribute('data-cup') });
  }));
  document.querySelectorAll('[data-adm-advance-cup]').forEach(n => n.addEventListener('click', () => admAdvanceCup(n.getAttribute('data-adm-advance-cup'))));
  document.querySelectorAll('[data-adm-del-cup]').forEach(n => n.addEventListener('click', () => admDeleteCup(n.getAttribute('data-adm-del-cup'))));
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
  const { upcoming, recent, leagues, opponents, invitations } = state.params;
  const upcomingRow = (f) => {
    const pending  = f.state === 'pending';
    const live     = f.state === 'in_progress';
    let when, badge, tacticsBtn = '';
    if (live) { when = '<span class="live-dot"></span> LIVE'; badge = '⏳ грає'; }
    else if (pending) { when = `чекає до ${fmtTime(f.inviteDeadline)}`; badge = '✉️ запрошено'; }
    else { when = `${fmtDate(f.scheduledAt)} ${fmtTime(f.scheduledAt)}`; badge = 'скоро'; }
    // S57: tactics-override button for upcoming matches (not live, not pending invite to others)
    if (!live) tacticsBtn = `<button class="ghost small" data-friendly-tactics="${f.id}">⚙️ Тактика</button>`;
    return `
      <div class="fixture-row friendly-row ${live ? 'live clickable' : ''}" ${live ? `data-friendly-live="${f.id}"` : ''}>
        <div class="when">${when}</div>
        <div class="opp">${f.opponent?.name || '?'}</div>
        <div class="venue">${f.venue === 'home' ? '🏠' : '✈️'}</div>
        <div class="score">${badge}</div>
        <div class="row-actions">${tacticsBtn}</div>
      </div>`;
  };
  return `
    <div class="shell">
      <div class="dash-header">
        <div>
          <h1>Товарняки</h1>
          <div class="ctx">~33 хв матч (90 хв на табло). Опонент має 5 хв на прийняття; матч стартує через 5 хв після згоди.</div>
        </div>
      </div>

      ${invitations && invitations.length ? `
        <div class="card invite-card">
          <h2>📩 Запрошення для тебе (${invitations.length})</h2>
          ${invitations.map(inv => `
            <div class="invite-row">
              <div class="invite-meta">
                <span class="challenger">@${inv.challenger}</span> кличе:
                <strong>${inv.homeTeam?.name || '?'} — ${inv.awayTeam?.name || '?'}</strong>
                <span class="muted">· відповідь до ${fmtTime(inv.inviteDeadline)}</span>
              </div>
              <div class="invite-actions">
                <button class="primary" data-accept-friendly="${inv.id}">✓ Прийняти</button>
                <button class="ghost danger" data-decline-friendly="${inv.id}">✕ Відхилити</button>
              </div>
            </div>
          `).join('')}
        </div>
      ` : ''}

      <div class="card">
        <h2>Кинути виклик</h2>
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
                `<option value="${t._id}">${t.name} (★${t.tier}) ${t.claimed ? '· 👤 живий тренер' : '· 🤖 AI'}</option>`
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
          <button class="primary" data-action="create-friendly">⚽ Кинути виклик</button>
        </div>
      </div>

      <div class="grid-2">
        <div class="card">
          <h2>Активні / очікують</h2>
          ${upcoming.length === 0 ? '<div class="empty">Немає активних матчів</div>' : upcoming.map(upcomingRow).join('')}
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

let _frRefreshHandle = null;
function scheduleFriendliesRefresh(upcoming) {
  if (_frRefreshHandle) clearTimeout(_frRefreshHandle);
  if (state.view !== 'friendlies') return;
  if (!upcoming || upcoming.length === 0) return;
  const next = upcoming.find(f => f.state === 'in_progress')
            || upcoming.find(f => (new Date(f.scheduledAt) - Date.now()) < 5 * 60 * 1000);
  if (!next) return;
  const ms = next.state === 'in_progress' ? 15_000 : 30_000;
  _frRefreshHandle = setTimeout(() => {
    if (state.view === 'friendlies') {
      state.params._loaded = false;
      loadFriendlies();
    }
  }, ms);
}

async function loadFriendlies() {
  try {
    const [mine, world, invs] = await Promise.all([
      API.get('/api/friendlies/mine'),
      API.get('/api/worlds/alpha'),
      API.get('/api/friendlies/invitations'),
    ]);
    const leagues = world.leagues;
    const opponents = {};
    for (const lg of leagues) {
      const r = await API.get(`/api/worlds/alpha/leagues/${lg.slug}/teams`);
      opponents[lg.slug] = r.teams.filter(t => t._id !== state.user.currentTeamId);
    }
    state.params = {
      _loaded: true,
      upcoming: mine.upcoming,
      recent: mine.recent,
      invitations: invs.invitations || [],
      leagues, opponents,
    };
    scheduleFriendliesRefresh(mine.upcoming);
    render();
  } catch (err) {
    state.params = { _loaded: true, upcoming: [], recent: [], invitations: [], leagues: [], opponents: {} };
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
  const { league, table, scorers, assists, leagues, currentLeagueSlug, upcomingRounds } = state.params;
  return `
    <div class="shell wide">
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

      <div class="standings-layout">
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
                <tr class="clickable ${state.user.currentTeamId && row.teamId === state.user.currentTeamId ? 'me' : ''}" data-team-detail="${row.teamId}">
                  <td class="num rank">${row.rank}</td>
                  <td>
                    <div class="team-cell">
                      ${emblemSwatch(row.team, { cls: 'mini-emblem', fallback: row.team.short })}
                      <span>${row.team.name}</span>
                    </div>
                  </td>
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
        <div class="upcoming-schedule">
          ${(upcomingRounds || []).length === 0 ? `
            <div class="card empty">Розклад завантажується…</div>
          ` : upcomingRounds.map(r => `
            <div class="card">
              <h2>Тур ${r.round}</h2>
              ${r.fixtures.map(fx => `
                <div class="round-row">
                  <div class="rr-team rr-home">
                    ${emblemSwatch(fx.home, { cls: 'mini-emblem', fallback: fx.home?.short })}
                    <span>${fx.home?.short || '?'}</span>
                  </div>
                  <div class="rr-vs">vs</div>
                  <div class="rr-team rr-away">
                    <span>${fx.away?.short || '?'}</span>
                    ${emblemSwatch(fx.away, { cls: 'mini-emblem', fallback: fx.away?.short })}
                  </div>
                </div>
                <div class="rr-when">${fmtDate(fx.scheduledAt)} ${fmtTime(fx.scheduledAt)}</div>
              `).join('')}
            </div>
          `).join('')}
        </div>
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
    const [std, top, ast, up] = await Promise.all([
      API.get(`/api/leagues/${target}/standings`),
      API.get(`/api/leagues/${target}/top-scorers`),
      API.get(`/api/leagues/${target}/top-assists`),
      API.get(`/api/leagues/${target}/upcoming`).catch(() => ({ rounds: [] })),
    ]);
    state.params = {
      _loaded: true,
      leagues, currentLeagueSlug: target,
      league: std.league, table: std.table,
      scorers: top.top, assists: ast.top,
      upcomingRounds: up.rounds || [],
    };
    render();
  } catch (err) {
    state.params = { _loaded: true, league: null, table: [], scorers: [], assists: [], upcomingRounds: [], leagues: state.params.leagues || [], currentLeagueSlug: slug };
    render();
  }
}

// ============================================================================
// Friendly waiting room (S59) — countdown to kickoff. Auto-redirects to live
// view once the match transitions to in_progress.
// ============================================================================
let _waitTimer = null;
let _waitPoll = null;

function renderFriendlyWait() {
  if (!state.params._loaded) {
    loadFriendlyWait();
    return `<div class="shell"><div class="card">Завантаження…</div></div>`;
  }
  const { friendly, home, away } = state.params;
  if (!friendly) return `<div class="shell"><div class="card empty">Матч не знайдено.</div>
    <div class="actions"><button class="ghost" data-go="friendlies">← Назад</button></div></div>`;
  const isLive = friendly.state === 'in_progress';
  const isFinished = friendly.state === 'finished';
  if (isLive) { setTimeout(() => go('friendly-live', { fixtureId: friendly._id }), 0); }
  if (isFinished) { setTimeout(() => go('result', { fixtureId: friendly._id, isFriendly: true }), 0); }

  const myTeamId = state.user?.currentTeamId;
  const mySide = friendly.homeTeamId === myTeamId || (friendly.homeTeamId?._id || friendly.homeTeamId)?.toString?.() === myTeamId ? 'home'
              : friendly.awayTeamId === myTeamId || (friendly.awayTeamId?._id || friendly.awayTeamId)?.toString?.() === myTeamId ? 'away'
              : null;

  return `
    <div class="shell">
      <div class="card wait-card">
        <div class="wait-badge">⏳ Очікування початку матчу</div>
        <div class="wait-matchup">
          <div class="wait-team">
            ${emblemSwatch(home, { cls: 'emblem-lg', fallback: (home?.short || '?').slice(0,3) })}
            <div class="wait-name ${mySide === 'home' ? 'me' : ''}">${home?.name || '?'}</div>
          </div>
          <div class="wait-vs">vs</div>
          <div class="wait-team">
            ${emblemSwatch(away, { cls: 'emblem-lg', fallback: (away?.short || '?').slice(0,3) })}
            <div class="wait-name ${mySide === 'away' ? 'me' : ''}">${away?.name || '?'}</div>
          </div>
        </div>
        <div class="wait-countdown" id="wait-countdown">--:--</div>
        <div class="wait-hint">Початок: ${fmtDate(friendly.scheduledAt)} ${fmtTime(friendly.scheduledAt)}</div>
        <div class="wait-actions">
          ${mySide ? `<button class="primary" data-friendly-tactics="${friendly._id}">⚙️ Налаштувати тактику</button>` : ''}
          <button class="ghost" data-go="friendlies">← Назад</button>
        </div>
      </div>
    </div>
  `;
}

async function loadFriendlyWait() {
  if (_waitTimer) { clearInterval(_waitTimer); _waitTimer = null; }
  if (_waitPoll)  { clearInterval(_waitPoll); _waitPoll = null; }
  try {
    const id = state.params.fixtureId;
    const det = await API.get(`/api/friendlies/${id}`);
    state.params = { ...state.params, _loaded: true, ...det };
    render();
    startWaitCountdown(det.friendly.scheduledAt);
    // Poll server every 5s to detect state change → live or finished
    _waitPoll = setInterval(async () => {
      try {
        const r = await API.get(`/api/friendlies/${id}`);
        if (r.friendly?.state === 'in_progress') {
          stopWait();
          return go('friendly-live', { fixtureId: id });
        }
        if (r.friendly?.state === 'finished') {
          stopWait();
          return go('result', { fixtureId: id, isFriendly: true });
        }
        // scheduledAt may have changed (e.g. opponent accepted after we loaded).
        if (state.params.friendly && new Date(state.params.friendly.scheduledAt).getTime() !== new Date(r.friendly.scheduledAt).getTime()) {
          state.params.friendly = r.friendly;
          startWaitCountdown(r.friendly.scheduledAt);
        }
      } catch { /* swallow */ }
    }, 5000);
  } catch (err) {
    state.params = { _loaded: true, friendly: null };
    render();
  }
}

function startWaitCountdown(scheduledAt) {
  if (_waitTimer) clearInterval(_waitTimer);
  const target = new Date(scheduledAt).getTime();
  const tick = () => {
    const el = document.getElementById('wait-countdown');
    if (!el) return;
    const remaining = Math.max(0, target - Date.now());
    const m = Math.floor(remaining / 60000);
    const s = Math.floor((remaining % 60000) / 1000);
    el.textContent = `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
    if (remaining <= 0) el.classList.add('imminent');
  };
  tick();
  _waitTimer = setInterval(tick, 1000);
}

function stopWait() {
  if (_waitTimer) { clearInterval(_waitTimer); _waitTimer = null; }
  if (_waitPoll)  { clearInterval(_waitPoll); _waitPoll = null; }
}

// ============================================================================
// Pre-match tactics (S57) — override tactics just for this friendly. Snapshot
// saves to Friendly.{home,away}TacticsOverride and matchRunner uses it on kickoff.
// ============================================================================
function renderFriendlyPreMatch() {
  if (!state.params._loaded) {
    loadFriendlyPreMatch();
    return `<div class="shell wide"><div class="card">Завантаження…</div></div>`;
  }
  const { friendly, home, away, formations, edit, mySide } = state.params;
  if (!friendly) return `<div class="shell"><div class="card empty">Матч не знайдено.</div>
    <div class="actions"><button class="ghost" data-go="friendlies">← Назад</button></div></div>`;
  const tactics = edit.tactics;
  const opp = mySide === 'home' ? away : home;
  const me  = mySide === 'home' ? home : away;
  return `
    <div class="shell wide">
      <div class="dash-header">
        <div><h1>⚙️ Тактика на матч</h1></div>
      </div>
      <div class="card next-match-banner">
        <div class="nm-label">Тактика для цієї гри</div>
        <div class="nm-row">
          <div class="nm-opp">
            <strong>${me?.name || '?'}</strong> vs <strong>${opp?.name || '?'}</strong>
            <span class="muted">· ${mySide === 'home' ? '🏠 удома' : '✈️ у гостях'}</span>
          </div>
          <div class="nm-when">${fmtDate(friendly.scheduledAt)} ${fmtTime(friendly.scheduledAt)}</div>
        </div>
        <div class="nm-hint">Зберігається тільки для цього матчу. Тактика за замовчуванням не зміниться.</div>
      </div>

      <div class="card tactics-settings">
        <div id="pmt-err"></div>
        <div class="tactics-grid compact">
          <label class="field"><span class="label">Формація</span>
            <select id="pmt-formation">
              ${Object.keys(formations).map(f => `<option ${f === tactics.formation ? 'selected' : ''}>${f}</option>`).join('')}
            </select>
          </label>
          ${tacticsField('mentality', 'Ментальність', tactics.mentality, MENTALITIES)}
          ${tacticsField('tempo', 'Темп', tactics.tempo, TEMPOS)}
          ${tacticsField('pressHeight', 'Висота пресингу', tactics.pressHeight, PRESS_HEIGHTS)}
          ${tacticsField('pressInt', 'Інт. пресингу', tactics.pressInt, PRESS_INTS)}
          ${tacticsField('defLine', 'Лінія оборони', tactics.defLine, DEF_LINES)}
          ${tacticsField('width', 'Ширина атаки', tactics.width, WIDTHS)}
          ${tacticsField('passing', 'Передачі', tactics.passing, PASSINGS)}
          ${tacticsField('dribblingFreq', 'Дриблінг', tactics.dribblingFreq, FREQS)}
          ${tacticsField('crossFreq', 'Подачі', tactics.crossFreq, FREQS)}
          ${tacticsField('longShotFreq', 'Дальні удари', tactics.longShotFreq, FREQS)}
          ${tacticsField('cornerRoutine', 'Кутові', tactics.cornerRoutine, CORNERS)}
          ${tacticsField('freeKickRoutine', 'Штрафні', tactics.freeKickRoutine, FKS)}
          ${tacticsField('timeWasting', 'Затягування', tactics.timeWasting, FREQS)}
        </div>
        <div class="form-actions">
          <button class="ghost" data-go="friendlies">Скасувати</button>
          <button class="primary" data-action="save-pre-match-tactics">✓ Підтвердити тактику</button>
        </div>
      </div>
    </div>
  `;
}

async function loadFriendlyPreMatch() {
  try {
    const id = state.params.fixtureId;
    const [det, fm, dash] = await Promise.all([
      API.get(`/api/friendlies/${id}`),
      API.get('/api/formations'),
      API.get('/api/dashboard').catch(() => null),
    ]);
    const myTeamId = state.user.currentTeamId;
    const mySide = det.friendly.homeTeamId.toString() === myTeamId ? 'home'
                 : det.friendly.awayTeamId.toString() === myTeamId ? 'away'
                 : null;
    if (!mySide) {
      state.params = { _loaded: true, friendly: null };
      return render();
    }
    // Seed editor: existing override > team default
    const override = mySide === 'home' ? det.friendly.homeTacticsOverride : det.friendly.awayTacticsOverride;
    const teamDefault = dash?.managing?.team?.tactics || {};
    state.params = {
      _loaded: true,
      fixtureId: id,                  // keep id for save handler (was lost on overwrite)
      friendly: det.friendly, home: det.home, away: det.away,
      mySide, formations: fm.formations,
      edit: { tactics: { ...(override || teamDefault) } },
    };
    render();
  } catch (err) {
    state.params = { _loaded: true, friendly: null };
    render();
  }
}

async function savePreMatchTactics() {
  // Collect all tactics fields (formation + the 12 selects from the grid).
  const root = document.querySelector('.tactics-grid');
  const tactics = { ...state.params.edit.tactics };
  tactics.formation = document.getElementById('pmt-formation').value;
  root.querySelectorAll('select[name]').forEach(sel => { tactics[sel.name] = sel.value; });
  try {
    await API.post(`/api/friendlies/${state.params.fixtureId}/tactics`, { tactics });
    go('friendlies');
  } catch (err) { showErr('pmt-err', err.message); }
}

// ============================================================================
// Team detail (S57) — public roster + recent/upcoming for any team in the world
// ============================================================================
function renderTeamDetail() {
  if (!state.params._loaded) {
    loadTeamDetail();
    return `<div class="shell"><div class="card">Завантаження…</div></div>`;
  }
  const { team, roster, manager, recent, upcoming } = state.params;
  if (!team) return `<div class="shell"><div class="card empty">Команду не знайдено.</div>
    <div class="actions"><button class="ghost" data-go="league">← До таблиці</button></div></div>`;
  const ROLE_ORDER = { GK:0, CB:1, FB:2, DM:3, CM:4, AM:5, W:6, ST:7 };
  const sorted = [...roster].sort((a, b) => (ROLE_ORDER[a.role] - ROLE_ORDER[b.role]) || (ovrOf(b) - ovrOf(a)));
  return `
    <div class="shell wide">
      <div class="team-header">
        ${emblemSwatch(team, { cls: 'emblem-lg', fallback: (team.short || team.name[0]).slice(0,3) })}
        <div class="meta">
          <h1>${team.name}</h1>
          <div class="ctx">${team.city || ''}${team.city ? ' · ' : ''}Засновано ${team.founded || '—'} · Тренер: ${manager?.username ? '@' + manager.username : '<i>вільна команда</i>'}</div>
          <div class="ctx tier">Тір ★${'★'.repeat(Math.max(0, 5 - team.tier))}${'☆'.repeat(team.tier - 1)} <span class="muted">(${team.tier} з 5)</span></div>
        </div>
        <button class="ghost" data-go="league" style="margin-left:auto">← Таблиця</button>
      </div>

      <div class="team-detail-grid">
        <div class="card no-pad">
          <h2 style="padding: 14px 16px 0">Склад</h2>
          <table class="roster-table">
            <thead><tr><th>#</th><th>Поз</th><th>Імʼя</th><th class="num">Вік</th><th class="num">OVR</th></tr></thead>
            <tbody>
              ${sorted.map(p => `
                <tr class="clickable" data-player='${escAttr(JSON.stringify(p))}'>
                  <td class="num">${p.num}</td>
                  <td>${ROLE_UA[p.role] || p.role}</td>
                  <td>${p.name}</td>
                  <td class="num">${p.age || '—'}</td>
                  <td class="num"><b>${ovrOf(p)}</b></td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
        <div class="td-side">
          <div class="card">
            <h2>Останні матчі</h2>
            ${recent.length === 0 ? '<div class="empty">Поки немає</div>' :
              recent.map(r => `
                <div class="fixture-row clickable" data-result="${r.id}">
                  <div class="when">${fmtDate(r.finishedAt)}</div>
                  <div class="opp">${r.opponent?.name || '?'}</div>
                  <div class="venue">${r.venue === 'home' ? '🏠' : '✈️'}</div>
                  <div class="score ${r.outcome}">${r.myScore}-${r.oppScore}</div>
                </div>
              `).join('')}
          </div>
          <div class="card">
            <h2>Наступні матчі</h2>
            ${upcoming.length === 0 ? '<div class="empty">Розклад порожній</div>' :
              upcoming.map(f => `
                <div class="fixture-row">
                  <div class="when">${fmtDate(f.scheduledAt)} ${fmtTime(f.scheduledAt)}</div>
                  <div class="opp">${f.opponent?.name || '?'}</div>
                  <div class="venue">${f.venue === 'home' ? '🏠' : '✈️'}</div>
                  <div class="score">тур ${f.round || ''}</div>
                </div>
              `).join('')}
          </div>
        </div>
      </div>
    </div>
  `;
}

async function loadTeamDetail() {
  try {
    const id = state.params.teamId;
    const data = await API.get(`/api/teams/${id}`);
    state.params = { ...state.params, _loaded: true, ...data };
    render();
  } catch (err) {
    state.params = { _loaded: true, team: null };
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
  const oppSel = document.getElementById('fr-opponent');
  const venueSel = document.getElementById('fr-venue');
  if (!oppSel?.value) return showErr('fr-err', 'оберіть суперника');
  try {
    await API.post('/api/friendlies', {
      opponentTeamId: oppSel.value,
      asHome: venueSel.value === 'home',
    });
    state.params = {};
    go('friendlies');
  } catch (err) {
    showErr('fr-err', err.message);
  }
}

async function acceptFriendly(id) {
  try {
    await API.post(`/api/friendlies/${id}/accept`);
    state.params = {};
    go('friendlies');
  } catch (err) { alert(err.message); }
}

async function declineFriendly(id) {
  try {
    await API.post(`/api/friendlies/${id}/decline`);
    state.params = {};
    go('friendlies');
  } catch (err) { alert(err.message); }
}

// ============================================================================
// Cups (S54) — list + bracket
// ============================================================================

function renderCups() {
  if (!state.params._loaded) { loadCups(); return `<div class="shell"><div class="card">Завантаження…</div></div>`; }
  const { cups } = state.params;
  return `
    <div class="shell">
      <div class="dash-header"><div><h1>🏆 Кубки</h1><div class="ctx">Knock-out турніри. Адмін створює, тренери дивляться.</div></div></div>
      ${cups.length === 0 ? '<div class="card empty">Турнірів ще немає. Адмін може створити з панелі.</div>' : `
        <div class="cup-grid">
          ${cups.map(c => `
            <div class="card cup-tile clickable" data-cup="${c._id}">
              <div class="cup-title">${c.name}</div>
              <div class="cup-meta">${c.teamCount} команд · ${c.state === 'finished' ? '🏁 завершено' : c.state === 'active' ? '⚽ активний' : '⏱ скоро'}</div>
              ${c.winnerTeamId ? '<div class="cup-winner">🏆 чемпіон визначений</div>' : ''}
            </div>
          `).join('')}
        </div>
      `}
    </div>
  `;
}

async function loadCups() {
  try {
    const r = await API.get('/api/cups');
    state.params = { _loaded: true, cups: r.cups };
    render();
  } catch { state.params = { _loaded: true, cups: [] }; render(); }
}

function renderCupDetail() {
  if (!state.params._loaded) { loadCupDetail(); return `<div class="shell"><div class="card">Завантаження…</div></div>`; }
  const { cup, teams } = state.params;
  if (!cup) return `<div class="shell"><div class="card empty">Кубок не знайдено.</div></div>`;
  const tn = (id) => teams[id?.toString()] || { name: '—', short: '—', color: '#666' };
  return `
    <div class="shell">
      <div class="dash-header">
        <div><h1>🏆 ${cup.name}</h1>
          <div class="ctx">${cup.teamCount} команд · стан: <b>${cup.state}</b>${cup.winnerTeamId ? ' · 🥇 ' + (teams[cup.winnerTeamId.toString()]?.name || '') : ''}</div>
        </div>
      </div>
      <div class="bracket">
        ${cup.rounds.map((r, ri) => `
          <div class="bracket-col">
            <h3>${roundLabelUa(r.label)}</h3>
            ${r.pairings.map(p => {
              const h = tn(p.home), a = tn(p.away);
              const w = p.winner?.toString();
              return `
                <div class="bracket-pair ${w ? 'decided' : ''}">
                  <div class="bp-row ${w === p.home?.toString() ? 'win' : (w && w !== p.home?.toString() ? 'lose' : '')}">
                    <span class="bp-dot" style="background:${h.color}"></span>
                    <span class="bp-name">${h.name}</span>
                    <span class="bp-score">${p.score ? p.score.home : '—'}</span>
                  </div>
                  <div class="bp-row ${w === p.away?.toString() ? 'win' : (w && w !== p.away?.toString() ? 'lose' : '')}">
                    <span class="bp-dot" style="background:${a.color}"></span>
                    <span class="bp-name">${a.name}</span>
                    <span class="bp-score">${p.score ? p.score.away : '—'}</span>
                  </div>
                </div>
              `;
            }).join('')}
          </div>
        `).join('')}
      </div>
    </div>
  `;
}

function roundLabelUa(label) {
  return ({ r16: '1/8', qf: 'Чвертьфінал', sf: 'Півфінал', final: 'Фінал' })[label] || label;
}

async function loadCupDetail() {
  try {
    const r = await API.get(`/api/cups/${state.params.cupId}`);
    state.params = { _loaded: true, cup: r.cup, teams: r.teams, cupId: state.params.cupId };
    render();
  } catch { state.params = { _loaded: true, cup: null }; render(); }
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
        <button class="${tab === 'cups' ? 'active' : ''}" data-admin-tab="cups">Кубки</button>
      </div>

      ${tab === 'overview' ? renderAdminOverview(overview) : ''}
      ${tab === 'leagues' ? renderAdminLeagues(leagues) : ''}
      ${tab === 'teams' ? renderAdminTeams(leagues, teams, selectedLeague) : ''}
      ${tab === 'players' ? renderAdminPlayers(leagues, teams, selectedLeague, players, selectedTeam) : ''}
      ${tab === 'cups' ? renderAdminCups(state.params.cups, state.params.allTeams) : ''}
    </div>
  `;
}

function renderAdminOverview(o) {
  if (!o) return '<div class="card">Завантаження…</div>';
  const tg = state.params.tgStatus;
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
    ${tg ? `
    <div class="card">
      <h2>Telegram-привʼязка</h2>
      <p>Бот: ${tg.botReady ? `✅ <b>@${tg.botUsername}</b> онлайн` : '❌ оффлайн'}</p>
      <table class="admin-table">
        <thead><tr><th>Юзер</th><th>Команда</th><th>TG</th><th>Останні 4 цифри chatId</th></tr></thead>
        <tbody>
          ${tg.users.map(u => `
            <tr>
              <td>@${u.username}${u.isAdmin ? ' 👑' : ''}</td>
              <td>${u.team || '<span class="muted">—</span>'}</td>
              <td>${u.hasChat ? '✅ привʼязано' : (u.linkPending ? '⏳ очікує /start' : '❌ не привʼязано')}</td>
              <td>${u.chatIdTail ? '…' + u.chatIdTail : '<span class="muted">—</span>'}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
    ` : ''}
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
        <input id="adm-lg-tier" type="number" min="1" max="5" placeholder="Тір (1)" />
        <button class="primary" data-action="adm-create-league">+ Створити</button>
      </div>
    </div>
    <div class="card no-pad">
      <table class="admin-table">
        <thead><tr><th>Слаг</th><th>Назва</th><th>Країна</th><th class="num">Тір</th><th class="num">Команд</th><th></th></tr></thead>
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
    <div class="card admin-action-bar">
      <div class="admin-filter">
        <span>Фільтр ліги:</span>
        <select data-action="adm-pick-league">
          <option value="">Усі</option>
          ${leagues.map(l => `<option value="${l._id}" ${l._id === selectedLeague ? 'selected' : ''}>${l.name}</option>`).join('')}
        </select>
      </div>
      <button class="primary" data-go="admin-team">+ Створити команду</button>
    </div>
    <div class="card no-pad">
      <table class="admin-table">
        <thead><tr><th>Емблема</th><th>Слаг</th><th>Назва</th><th>Скорочення</th><th class="num">★</th><th>Тренер</th><th></th></tr></thead>
        <tbody>
          ${teams.map(t => `
            <tr class="clickable" data-edit-team="${t._id}">
              <td>${emblemSwatch(t, { cls: 'mini-emblem', fallback: t.short })}</td>
              <td>${t.slug}</td>
              <td>${t.name}</td>
              <td>${t.short}</td>
              <td class="num">${t.tier}</td>
              <td>${t.managerUsername ? '@' + t.managerUsername : '<span class="muted">—</span>'}</td>
              <td>
                <button class="ghost small" data-edit-team="${t._id}">✎</button>
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
    <div class="card admin-action-bar">
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
      ${selectedTeam ? `<button class="primary" data-new-player="${selectedTeam}">+ Створити гравця</button>` : ''}
    </div>
    ${selectedTeam ? `
      <div class="card no-pad">
        <table class="admin-table">
          <thead><tr><th class="num">#</th><th>Імʼя</th><th>Поз</th><th>Підроль</th><th class="num">Тір</th><th class="num">Вік</th><th></th></tr></thead>
          <tbody>
            ${players.map(p => `
              <tr class="clickable" data-edit-player="${p._id}">
                <td class="num">${p.num}</td>
                <td>${p.name}</td>
                <td>${p.role}</td>
                <td>${p.role_kind || '<span class="muted">—</span>'}</td>
                <td class="num">${p.tier}</td>
                <td class="num">${p.age || '—'}</td>
                <td>
                  <button class="ghost small" data-edit-player="${p._id}">✎</button>
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

// ----- Admin: dedicated Team form page (create + edit) -----
function renderAdminTeamForm() {
  if (!state.params._loaded) { loadAdminTeamForm(); return `<div class="shell"><div class="card">Завантаження…</div></div>`; }
  const { team, leagues } = state.params;
  const isEdit = !!team?._id;
  const t = team || { slug:'', name:'', short:'', city:'', color:'#4f8cff', emblemUrl:'', tier:3, leagueId: leagues[0]?._id || '' };
  return `
    <div class="shell">
      <div class="dash-header">
        <div><h1>${isEdit ? '✎ Редагувати команду' : '+ Створити команду'}</h1></div>
      </div>
      <div class="card">
        <div id="adm-tm-err"></div>
        <div class="form-grid">
          <label class="field"><span class="label">Ліга</span>
            <select id="adm-tm-league">${leagues.map(l => `<option value="${l._id}" ${l._id === String(t.leagueId) ? 'selected' : ''}>${l.name}</option>`).join('')}</select>
          </label>
          <label class="field"><span class="label">Слаг</span>
            <input id="adm-tm-slug" value="${escAttr(t.slug)}" placeholder="manchester-reds" ${isEdit ? 'readonly' : ''} />
          </label>
          <label class="field"><span class="label">Назва</span>
            <input id="adm-tm-name" value="${escAttr(t.name)}" />
          </label>
          <label class="field"><span class="label">Скорочення (3-4)</span>
            <input id="adm-tm-short" value="${escAttr(t.short)}" maxlength="4" />
          </label>
          <label class="field"><span class="label">Місто</span>
            <input id="adm-tm-city" value="${escAttr(t.city || '')}" />
          </label>
          <label class="field"><span class="label">Tier (1-5)</span>
            <input id="adm-tm-tier" type="number" min="1" max="5" value="${t.tier}" />
          </label>
          <label class="field"><span class="label">Колір</span>
            <input id="adm-tm-color" type="color" value="${t.color || '#4f8cff'}" />
          </label>
          <label class="field full"><span class="label">URL емблеми</span>
            <input id="adm-tm-emblem" value="${escAttr(t.emblemUrl || '')}" placeholder="https://…  (порожньо = без емблеми)" />
          </label>
        </div>
        <div class="form-actions">
          <button class="ghost" data-go="admin">Скасувати</button>
          <button class="primary" data-action="adm-save-team">${isEdit ? '💾 Зберегти' : '+ Створити'}</button>
        </div>
      </div>
    </div>
  `;
}

async function loadAdminTeamForm() {
  try {
    const id = state.params.id;
    const lg = await API.get('/api/admin/leagues');
    let team = null;
    if (id) {
      // Get team by hitting admin teams listing — no single-team endpoint exists.
      // Pull all teams once; small worlds, no pagination needed in MVP.
      const all = await API.get('/api/admin/teams');
      team = all.teams.find(x => x._id === id) || null;
    }
    state.params = { ...state.params, _loaded: true, team, leagues: lg.leagues };
    render();
  } catch (err) {
    document.getElementById('app').innerHTML = `<div class="shell"><div class="card err">${err.message}</div></div>`;
  }
}

async function admSaveTeam() {
  const leagueId = document.getElementById('adm-tm-league').value;
  const slug = document.getElementById('adm-tm-slug').value.trim();
  const name = document.getElementById('adm-tm-name').value.trim();
  const short = document.getElementById('adm-tm-short').value.trim();
  const city = document.getElementById('adm-tm-city').value.trim();
  const color = document.getElementById('adm-tm-color').value;
  const emblemUrl = document.getElementById('adm-tm-emblem').value.trim();
  const tier = Number(document.getElementById('adm-tm-tier').value) || 3;
  if (!leagueId || !slug || !name || !short) return showErr('adm-tm-err', 'усі поля обовʼязкові');
  try {
    if (state.params.team?._id) {
      await API.patch(`/api/admin/teams/${state.params.team._id}`, { leagueId, name, short, city, color, emblemUrl, tier });
    } else {
      await API.post('/api/admin/teams', { leagueId, slug, name, short, city, color, emblemUrl, tier });
    }
    go('admin', { tab: 'teams', selectedLeague: leagueId });
  } catch (err) { showErr('adm-tm-err', err.message); }
}

// ----- Admin: dedicated Player form page (create + edit) -----
// Continent → country, alphabetised. Continent picker narrows the country list.
const COUNTRIES_BY_CONTINENT = {
  'Європа': [
    ['AL','🇦🇱 Албанія'],['AD','🇦🇩 Андорра'],['AT','🇦🇹 Австрія'],['BE','🇧🇪 Бельгія'],['BG','🇧🇬 Болгарія'],
    ['BA','🇧🇦 Боснія і Герцеговина'],['BY','🇧🇾 Білорусь'],['CH','🇨🇭 Швейцарія'],['CY','🇨🇾 Кіпр'],['CZ','🇨🇿 Чехія'],
    ['DE','🇩🇪 Німеччина'],['DK','🇩🇰 Данія'],['EE','🇪🇪 Естонія'],['EN','🏴 Англія'],['ES','🇪🇸 Іспанія'],
    ['FI','🇫🇮 Фінляндія'],['FO','🇫🇴 Фарерські острови'],['FR','🇫🇷 Франція'],['GE','🇬🇪 Грузія'],['GR','🇬🇷 Греція'],
    ['HR','🇭🇷 Хорватія'],['HU','🇭🇺 Угорщина'],['IE','🇮🇪 Ірландія'],['IS','🇮🇸 Ісландія'],['IT','🇮🇹 Італія'],
    ['LI','🇱🇮 Ліхтенштейн'],['LT','🇱🇹 Литва'],['LU','🇱🇺 Люксембург'],['LV','🇱🇻 Латвія'],['MC','🇲🇨 Монако'],
    ['MD','🇲🇩 Молдова'],['ME','🇲🇪 Чорногорія'],['MK','🇲🇰 Північна Македонія'],['MT','🇲🇹 Мальта'],['NL','🇳🇱 Нідерланди'],
    ['NI','🇮🇪 Північна Ірландія'],['NO','🇳🇴 Норвегія'],['PL','🇵🇱 Польща'],['PT','🇵🇹 Португалія'],['RO','🇷🇴 Румунія'],
    ['RS','🇷🇸 Сербія'],['RU','🇷🇺 Росія'],['SC','🏴 Шотландія'],['SE','🇸🇪 Швеція'],['SI','🇸🇮 Словенія'],
    ['SK','🇸🇰 Словаччина'],['SM','🇸🇲 Сан-Марино'],['TR','🇹🇷 Туреччина'],['UA','🇺🇦 Україна'],['VA','🇻🇦 Ватикан'],
    ['WL','🏴 Уельс'],['XK','🇽🇰 Косово'],
  ],
  'Африка': [
    ['AO','🇦🇴 Ангола'],['BF','🇧🇫 Буркіна-Фасо'],['BI','🇧🇮 Бурунді'],['BJ','🇧🇯 Бенін'],['BW','🇧🇼 Ботсвана'],
    ['CD','🇨🇩 ДР Конго'],['CF','🇨🇫 ЦАР'],['CG','🇨🇬 Конго'],['CI','🇨🇮 Кот-д\'Івуар'],['CM','🇨🇲 Камерун'],
    ['CV','🇨🇻 Кабо-Верде'],['DJ','🇩🇯 Джибуті'],['DZ','🇩🇿 Алжир'],['EG','🇪🇬 Єгипет'],['ER','🇪🇷 Еритрея'],
    ['ET','🇪🇹 Ефіопія'],['GA','🇬🇦 Габон'],['GH','🇬🇭 Гана'],['GM','🇬🇲 Гамбія'],['GN','🇬🇳 Гвінея'],
    ['GQ','🇬🇶 Екваторіальна Гвінея'],['GW','🇬🇼 Гвінея-Бісау'],['KE','🇰🇪 Кенія'],['KM','🇰🇲 Коморські о-ви'],['LR','🇱🇷 Ліберія'],
    ['LS','🇱🇸 Лесото'],['LY','🇱🇾 Лівія'],['MA','🇲🇦 Марокко'],['MG','🇲🇬 Мадагаскар'],['ML','🇲🇱 Малі'],
    ['MR','🇲🇷 Мавританія'],['MU','🇲🇺 Маврикій'],['MW','🇲🇼 Малаві'],['MZ','🇲🇿 Мозамбік'],['NA','🇳🇦 Намібія'],
    ['NE','🇳🇪 Нігер'],['NG','🇳🇬 Нігерія'],['RW','🇷🇼 Руанда'],['SC','🇸🇨 Сейшельські о-ви'],['SD','🇸🇩 Судан'],
    ['SL','🇸🇱 Сьєрра-Леоне'],['SN','🇸🇳 Сенегал'],['SO','🇸🇴 Сомалі'],['SS','🇸🇸 Південний Судан'],['ST','🇸🇹 Сан-Томе і Принсіпі'],
    ['SZ','🇸🇿 Есватіні'],['TD','🇹🇩 Чад'],['TG','🇹🇬 Того'],['TN','🇹🇳 Туніс'],['TZ','🇹🇿 Танзанія'],
    ['UG','🇺🇬 Уганда'],['ZA','🇿🇦 ПАР'],['ZM','🇿🇲 Замбія'],['ZW','🇿🇼 Зімбабве'],
  ],
  'Південна Америка': [
    ['AR','🇦🇷 Аргентина'],['BO','🇧🇴 Болівія'],['BR','🇧🇷 Бразилія'],['CL','🇨🇱 Чилі'],['CO','🇨🇴 Колумбія'],
    ['EC','🇪🇨 Еквадор'],['GY','🇬🇾 Гаяна'],['PE','🇵🇪 Перу'],['PY','🇵🇾 Парагвай'],['SR','🇸🇷 Суринам'],
    ['UY','🇺🇾 Уругвай'],['VE','🇻🇪 Венесуела'],
  ],
  'Північна Америка': [
    ['AG','🇦🇬 Антигуа і Барбуда'],['BB','🇧🇧 Барбадос'],['BS','🇧🇸 Багами'],['BZ','🇧🇿 Беліз'],['CA','🇨🇦 Канада'],
    ['CR','🇨🇷 Коста-Ріка'],['CU','🇨🇺 Куба'],['DM','🇩🇲 Домініка'],['DO','🇩🇴 Домініканська Республіка'],['GD','🇬🇩 Гренада'],
    ['GT','🇬🇹 Гватемала'],['HN','🇭🇳 Гондурас'],['HT','🇭🇹 Гаїті'],['JM','🇯🇲 Ямайка'],['KN','🇰🇳 Сент-Кітс і Невіс'],
    ['LC','🇱🇨 Сент-Люсія'],['MX','🇲🇽 Мексика'],['NI','🇳🇮 Нікарагуа'],['PA','🇵🇦 Панама'],['SV','🇸🇻 Сальвадор'],
    ['TT','🇹🇹 Тринідад і Тобаго'],['US','🇺🇸 США'],['VC','🇻🇨 Сент-Вінсент і Гренадини'],
  ],
  'Азія': [
    ['AE','🇦🇪 ОАЕ'],['AF','🇦🇫 Афганістан'],['AM','🇦🇲 Вірменія'],['AZ','🇦🇿 Азербайджан'],['BD','🇧🇩 Бангладеш'],
    ['BH','🇧🇭 Бахрейн'],['BN','🇧🇳 Бруней'],['BT','🇧🇹 Бутан'],['CN','🇨🇳 Китай'],['HK','🇭🇰 Гонконг'],
    ['ID','🇮🇩 Індонезія'],['IL','🇮🇱 Ізраїль'],['IN','🇮🇳 Індія'],['IQ','🇮🇶 Ірак'],['IR','🇮🇷 Іран'],
    ['JO','🇯🇴 Йорданія'],['JP','🇯🇵 Японія'],['KG','🇰🇬 Киргизстан'],['KH','🇰🇭 Камбоджа'],['KP','🇰🇵 КНДР'],
    ['KR','🇰🇷 Південна Корея'],['KW','🇰🇼 Кувейт'],['KZ','🇰🇿 Казахстан'],['LA','🇱🇦 Лаос'],['LB','🇱🇧 Ліван'],
    ['LK','🇱🇰 Шрі-Ланка'],['MM','🇲🇲 М\'янма'],['MN','🇲🇳 Монголія'],['MO','🇲🇴 Макао'],['MV','🇲🇻 Мальдіви'],
    ['MY','🇲🇾 Малайзія'],['NP','🇳🇵 Непал'],['OM','🇴🇲 Оман'],['PH','🇵🇭 Філіппіни'],['PK','🇵🇰 Пакистан'],
    ['PS','🇵🇸 Палестина'],['QA','🇶🇦 Катар'],['SA','🇸🇦 Саудівська Аравія'],['SG','🇸🇬 Сінгапур'],['SY','🇸🇾 Сирія'],
    ['TH','🇹🇭 Таїланд'],['TJ','🇹🇯 Таджикистан'],['TL','🇹🇱 Тимор-Лешті'],['TM','🇹🇲 Туркменістан'],['TW','🇹🇼 Тайвань'],
    ['UZ','🇺🇿 Узбекистан'],['VN','🇻🇳 В\'єтнам'],['YE','🇾🇪 Ємен'],
  ],
  'Океанія': [
    ['AS','🇦🇸 Американське Самоа'],['AU','🇦🇺 Австралія'],['CK','🇨🇰 Острови Кука'],['FJ','🇫🇯 Фіджі'],['FM','🇫🇲 Мікронезія'],
    ['KI','🇰🇮 Кірибаті'],['MH','🇲🇭 Маршаллові Острови'],['NC','🇳🇨 Нова Каледонія'],['NR','🇳🇷 Науру'],['NU','🇳🇺 Ніуе'],
    ['NZ','🇳🇿 Нова Зеландія'],['PF','🇵🇫 Французька Полінезія'],['PG','🇵🇬 Папуа Нова Гвінея'],['PW','🇵🇼 Палау'],['SB','🇸🇧 Соломонові Острови'],
    ['TO','🇹🇴 Тонга'],['TV','🇹🇻 Тувалу'],['VU','🇻🇺 Вануату'],['WS','🇼🇸 Самоа'],
  ],
};
const CONTINENTS = Object.keys(COUNTRIES_BY_CONTINENT);
// Reverse index: country code → continent (for resolving an existing player's continent).
const CONTINENT_OF = (() => {
  const m = {};
  for (const cont of CONTINENTS) for (const [code] of COUNTRIES_BY_CONTINENT[cont]) m[code] = cont;
  return m;
})();

function renderAdminPlayerForm() {
  if (!state.params._loaded) { loadAdminPlayerForm(); return `<div class="shell"><div class="card">Завантаження…</div></div>`; }
  const { player, team } = state.params;
  const isEdit = !!player?._id;
  const p = player || {
    num:'', name:'', firstName:'', lastName:'',
    role:'CM', secondaryRole:'', tier:3, age:24,
    nationality:'', preferredFoot:'R', transfermarktUrl:'',
  };
  // Backfill first/last from `name` for legacy players.
  if (!p.firstName && !p.lastName && p.name) {
    const parts = p.name.split(' ');
    p.firstName = parts[0] || '';
    p.lastName = parts.slice(1).join(' ');
  }
  const ROLES = ['GK','CB','FB','DM','CM','AM','W','ST'];
  const FOOT = [['R','правша'],['L','лівша'],['BOTH','обидві']];
  return `
    <div class="shell">
      <div class="dash-header">
        <div><h1>${isEdit ? '✎ Редагувати гравця' : '+ Створити гравця'}</h1>
          <div class="ctx">${team ? team.name : ''}</div>
        </div>
      </div>
      <div class="card">
        <div id="adm-pl-err"></div>
        <div class="form-grid">
          <label class="field"><span class="label">Імʼя</span>
            <input id="adm-pl-firstname" value="${escAttr(p.firstName || '')}" placeholder="Андрій" />
          </label>
          <label class="field"><span class="label">Прізвище</span>
            <input id="adm-pl-lastname" value="${escAttr(p.lastName || '')}" placeholder="Шевченко" />
          </label>
          <label class="field"><span class="label">Номер</span>
            <input id="adm-pl-num" type="number" min="1" max="99" value="${p.num ?? ''}" />
          </label>
          <label class="field"><span class="label">Вік</span>
            <input id="adm-pl-age" type="number" min="15" max="45" value="${p.age || 24}" />
          </label>
          <label class="field"><span class="label">Основна позиція</span>
            <select id="adm-pl-role">${ROLES.map(r => `<option ${r === p.role ? 'selected' : ''}>${r}</option>`).join('')}</select>
          </label>
          <label class="field"><span class="label">Друга позиція (опц.)</span>
            <select id="adm-pl-role2">
              <option value="">— немає —</option>
              ${ROLES.map(r => `<option ${r === p.secondaryRole ? 'selected' : ''}>${r}</option>`).join('')}
            </select>
          </label>
          <label class="field"><span class="label">Скіл (Tier 1-5)</span>
            <input id="adm-pl-tier" type="number" min="1" max="5" value="${p.tier}" />
            <span class="hint">1 — топ зірка, 3 — звичайний, 5 — резерв. Атрибути генеруються автоматично.</span>
          </label>
          <label class="field"><span class="label">Сильна нога</span>
            <select id="adm-pl-foot">${FOOT.map(([v, t]) => `<option value="${v}" ${v === (p.preferredFoot || 'R') ? 'selected' : ''}>${t}</option>`).join('')}</select>
          </label>
          <label class="field"><span class="label">Континент</span>
            <select id="adm-pl-continent" data-action="pick-continent">
              <option value="">— оберіть —</option>
              ${CONTINENTS.map(c => `<option value="${c}" ${c === (CONTINENT_OF[p.nationality || ''] || '') ? 'selected' : ''}>${c}</option>`).join('')}
            </select>
          </label>
          <label class="field"><span class="label">Країна</span>
            <select id="adm-pl-nat">
              <option value="">— оберіть континент —</option>
              ${(CONTINENT_OF[p.nationality || ''] ? COUNTRIES_BY_CONTINENT[CONTINENT_OF[p.nationality || '']] : []).map(([code, label]) => `<option value="${code}" ${code === (p.nationality || '') ? 'selected' : ''}>${label}</option>`).join('')}
            </select>
          </label>
          <label class="field full"><span class="label">Посилання Transfermarkt</span>
            <input id="adm-pl-tm" value="${escAttr(p.transfermarktUrl || '')}" placeholder="https://www.transfermarkt.com/…" />
          </label>
        </div>
        <div class="form-actions">
          <button class="ghost" data-go="admin">Скасувати</button>
          <button class="primary" data-action="adm-save-player">${isEdit ? '💾 Зберегти' : '+ Створити'}</button>
        </div>
      </div>
    </div>
  `;
}

async function loadAdminPlayerForm() {
  try {
    const { id, teamId } = state.params;
    let player = null;
    let team = null;
    if (id) {
      // Player lookup — find by id across teams. There is no single-player endpoint,
      // so we query the player's team page once teamId is known. The edit button must
      // also pass teamId via state to avoid this round-trip.
      if (state.params.teamId) {
        const r = await API.get(`/api/admin/players?teamId=${state.params.teamId}`);
        player = r.players.find(x => x._id === id) || null;
      }
      if (player) {
        const tt = await API.get('/api/admin/teams');
        team = tt.teams.find(x => x._id === String(player.teamId)) || null;
      }
    } else if (teamId) {
      const tt = await API.get('/api/admin/teams');
      team = tt.teams.find(x => x._id === teamId) || null;
    }
    state.params = { ...state.params, _loaded: true, player, team };
    render();
  } catch (err) {
    document.getElementById('app').innerHTML = `<div class="shell"><div class="card err">${err.message}</div></div>`;
  }
}

async function admSavePlayer() {
  const num = Number(document.getElementById('adm-pl-num').value);
  const firstName = document.getElementById('adm-pl-firstname').value.trim();
  const lastName  = document.getElementById('adm-pl-lastname').value.trim();
  const name = `${firstName} ${lastName}`.trim();
  const role = document.getElementById('adm-pl-role').value;
  const secondaryRole = document.getElementById('adm-pl-role2').value;
  const tier = Number(document.getElementById('adm-pl-tier').value) || 3;
  const age = Number(document.getElementById('adm-pl-age').value) || 24;
  const nationality = document.getElementById('adm-pl-nat').value;
  const preferredFoot = document.getElementById('adm-pl-foot').value;
  const transfermarktUrl = document.getElementById('adm-pl-tm').value.trim();
  if (!num || !name) return showErr('adm-pl-err', 'імʼя + прізвище + номер обовʼязкові');
  const payload = { num, name, firstName, lastName, role, secondaryRole, tier, age, nationality, preferredFoot, transfermarktUrl };
  try {
    if (state.params.player?._id) {
      await API.patch(`/api/admin/players/${state.params.player._id}`, payload);
    } else {
      const teamId = state.params.team?._id;
      if (!teamId) return showErr('adm-pl-err', 'team_missing');
      await API.post('/api/admin/players', { teamId, ...payload });
    }
    go('admin', { tab: 'players', selectedTeam: state.params.team?._id });
  } catch (err) { showErr('adm-pl-err', err.message); }
}

async function loadAdmin(tab = 'overview') {
  try {
    const [ov, lg, tg] = await Promise.all([
      API.get('/api/admin/overview'),
      API.get('/api/admin/leagues'),
      tab === 'overview' ? API.get('/api/admin/tg-status').catch(() => null) : Promise.resolve(null),
    ]);
    let teams = state.params.teams || [];
    let players = state.params.players || [];
    let cups = state.params.cups || [];
    let allTeams = state.params.allTeams || [];
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
    if (tab === 'cups') {
      const [cp, at] = await Promise.all([
        API.get('/api/admin/cups'),
        API.get('/api/admin/teams'),    // all teams (no leagueId filter — full list for picker)
      ]);
      cups = cp.cups;
      allTeams = at.teams;
    }
    state.params = {
      _loaded: true, tab,
      overview: ov, leagues: lg.leagues, teams, players, cups, allTeams,
      selectedLeague, selectedTeam,
      tgStatus: tg,
    };
    render();
  } catch (err) {
    state.params = { _loaded: true, tab: 'overview', overview: null, leagues: [], teams: [], players: [], cups: [], allTeams: [] };
    render();
  }
}

function renderAdminCups(cups, allTeams) {
  return `
    <div class="card">
      <h2>Створити кубок</h2>
      <div id="adm-cup-err"></div>
      <div class="admin-form">
        <input id="adm-cup-slug" placeholder="slug (champions-26)" />
        <input id="adm-cup-name" placeholder="Кубок Чемпіонів 2026" />
        <select id="adm-cup-size">
          <option value="4">4 команди (півфінали)</option>
          <option value="8" selected>8 команд (1/4)</option>
          <option value="16">16 команд (1/8)</option>
        </select>
        <button class="primary" data-action="adm-create-cup">+ Створити</button>
      </div>
      <div class="cup-team-picker" id="adm-cup-teams">
        <div class="hint">Обери команди (натискай на чек-боксі):</div>
        <div class="checkbox-grid">
          ${(allTeams || []).map(t => `
            <label class="cup-team-check">
              <input type="checkbox" name="cup-team" value="${t._id}" />
              <span class="cup-team-dot" style="background:${t.color}"></span>
              <span>${t.name} <span class="muted">★${t.tier}</span></span>
            </label>
          `).join('')}
        </div>
      </div>
    </div>
    <div class="card no-pad">
      <table class="admin-table">
        <thead><tr><th>Назва</th><th>Розмір</th><th>Стан</th><th>Раунд</th><th></th></tr></thead>
        <tbody>
          ${cups.map(c => `
            <tr>
              <td>${c.name}</td>
              <td>${c.teamCount}</td>
              <td>${c.state}</td>
              <td>${c.currentRound}/${Math.log2(c.teamCount)}</td>
              <td>
                ${c.state === 'active' ? `<button class="ghost small" data-adm-advance-cup="${c._id}">↪ Advance</button>` : ''}
                <button class="ghost danger small" data-adm-del-cup="${c._id}">✕</button>
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;
}

async function admCreateCup() {
  const slug = document.getElementById('adm-cup-slug').value.trim();
  const name = document.getElementById('adm-cup-name').value.trim();
  const size = Number(document.getElementById('adm-cup-size').value);
  const teamIds = [...document.querySelectorAll('input[name=cup-team]:checked')].map(n => n.value);
  if (!slug || !name) return showErr('adm-cup-err', 'slug + name required');
  if (teamIds.length !== size) return showErr('adm-cup-err', `треба точно ${size} команд (обрано ${teamIds.length})`);
  try {
    await API.post('/api/admin/cups', { slug, name, teamIds });
    loadAdmin('cups');
  } catch (err) { showErr('adm-cup-err', err.message); }
}

async function admAdvanceCup(id) {
  try {
    const r = await API.post(`/api/admin/cups/${id}/advance`);
    alert(r.finished ? '🏆 Кубок завершено!' : 'Раунд просунуто');
    loadAdmin('cups');
  } catch (err) { alert(err.message); }
}

async function admDeleteCup(id) {
  if (!confirm('Видалити кубок?')) return;
  await API.del(`/api/admin/cups/${id}`);
  loadAdmin('cups');
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

async function admDeletePlayer(id) {
  if (!confirm('Видалити гравця?')) return;
  await API.del(`/api/admin/players/${id}`);
  loadAdmin('players');
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
        return go('2fa', { challengeToken: r.challengeToken });
      }
      // S75: unlinked account — force tg-link before granting session.
      if (r.needsLink) {
        return go('tg-link', { linkToken: r.linkToken, botUsername: r.botUsername, username: r.username });
      }
      API.setToken(r.token);
      state.user = r.user;
      startActiveMatchPoll();
      go(state.user.currentTeamId ? 'dashboard' : 'onboarding');
    } catch (err) { showErr('login-err', err.message); }
  }
  if (form === 'register') {
    try {
      const r = await API.post('/api/auth/register', data);
      go('tg-link', {
        linkToken: r.telegramLinkToken,
        botUsername: r.botUsername,
        username: r.username,                 // S75: needed for check-tg poll
      });
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
      startActiveMatchPoll();
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
    state.activeMatch = null;
    if (_activeMatchPollHandle) { clearInterval(_activeMatchPollHandle); _activeMatchPollHandle = null; }
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
  if (action === 'adm-save-team')      return admSaveTeam();
  if (action === 'adm-save-player')    return admSavePlayer();
  if (action === 'adm-create-cup')     return admCreateCup();
  if (action === 'leave-friendly-live') {
    leaveFriendlyLive();
    return go('friendlies');
  }
  if (action === 'check-tg-link') return checkTgLink();
  if (action === 'save-pre-match-tactics') return savePreMatchTactics();
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
