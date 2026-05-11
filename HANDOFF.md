# Kick-Off FM — Handoff (2026-05-11)

State at end of long dev sprint covering Track A engine refinement (S1-S32) + Track B online MVP (S33-S54). Single-tab snapshot for resuming in a fresh Claude session.

---

## 1. What's live

| Component | URL / endpoint | Status |
|---|---|---|
| Web app | https://kickoff-fm.fly.dev | ✅ |
| Telegram bot | https://t.me/KickOffFMBot | ✅ polling |
| Repo | https://github.com/justdes93/KickOffFM | private, main branch |
| Hosting | Fly.io app `kickoff-fm` (Frankfurt, fra) | 1 machine, 512MB shared CPU |
| Database | MongoDB Atlas M0 free cluster `kickoff.emvrjsz.mongodb.net/kickoff` | 512MB |

**Open https://kickoff-fm.fly.dev → login as `justdes1993@gmail.com` (admin 👑).** Beta key for new registrations: `letmein`.

---

## 2. Project layout

```
~/projects/kickoff-fm/
├── HANDOFF.md                 ← this file
├── README                       ← (in deploy/README.md)
├── package.json                 (npm scripts: sim / bench / server / server:dev / seed)
├── fly.toml                     (Fly.io config)
├── Dockerfile + docker-compose  (multi-stage prod image, non-root)
├── .env                         (gitignored — secrets live here)
├── .env.example                 (template; reproduce locally with rotated creds)
│
├── engine.js                    (Track A — physical-agent match engine, S1-S32)
├── data.js                      (FORMATIONS, ROLES, genPlayer, defaultLineup, playerOverall)
├── ai.js                        (in-match AI manager, used by browser preview only)
├── index.html + app.js + styles.css   (Ukrainian SPA — Track B+ frontend)
│
├── legacy.html + legacy-main.js + legacy-ui.js + legacy-style.css
│       — original engine sandbox UI, kept for engine-only dev
│
├── scripts/
│   ├── sim.js                   (headless match CLI: `npm run sim` / `--benchmark N`)
│   └── seed.js                  (`npm run seed` — drops + recreates world)
│
├── server/
│   ├── index.js                 (Fastify entry — listen first, DB+bot+scheduler in background)
│   ├── db/
│   │   ├── connection.js        (mongoose connect with retry)
│   │   └── models/              (User, World, League, Season, Team, Player,
│   │                             Fixture, MatchResult, Friendly, Cup, index.js)
│   ├── plugins/
│   │   └── authPlugin.js        (app.authenticate + app.requireAdmin)
│   ├── routes/
│   │   ├── auth.js              (register / login / 2fa / me / logout)
│   │   ├── world.js             (worlds / leagues / teams / claim / dashboard / formations / roles / cups read / result detail / PUT tactics)
│   │   ├── friendly.js          (create / mine / detail)
│   │   ├── league.js            (standings / top-scorers / top-assists)
│   │   └── admin.js             (CRUD: leagues, teams, players, cups; cup advance)
│   ├── services/
│   │   ├── telegram.js          (bot init + /start <token> handler + sendCode)
│   │   ├── matchRunner.js       (runFixture, executeFixture, executeFriendly, bumpSeasonStats)
│   │   └── scheduler.js         (polls Fixture + Friendly every 30s)
│   └── seed/
│       ├── teamCatalog.js       (20 EPL-style + 20 La-Liga-style teams)
│       ├── playerNames.js       (English / Spanish / foreign name pools)
│       └── fixtures.js          (round-robin generator + Tue/Thu/Sat scheduling)
│
└── deploy/README.md             (Oracle Cloud deploy guide — currently we use Fly.io but
                                  this is the fallback if Fly.io free tier ever changes)
```

---

## 3. Secrets — rotation required

User shared all credentials in chat throughout the session. **Treat all of these as compromised — rotate before showing app to anyone outside the test group:**

| Secret | Where to rotate |
|---|---|
| Telegram bot token | @BotFather → /mybots → KickOffFMBot → API Token → Revoke + new |
| MongoDB Atlas password (user `venyapetya`) | Atlas → Database Access → edit user → New Password |
| Beta key (`letmein`) | Trivial; change `BETA_KEY` in `.env` + `flyctl secrets set` |
| JWT secret | Already random; rotate only if you suspect leak (`openssl rand -hex 32`) |

After rotating any secret:
```bash
# local
sed -i '' "s|^TELEGRAM_BOT_TOKEN=.*|TELEGRAM_BOT_TOKEN=<new>|" .env

# fly
~/.fly/bin/flyctl secrets set TELEGRAM_BOT_TOKEN=<new> -a kickoff-fm
# (flyctl auto-redeploys machines)
```

---

## 4. Local dev workflow

```bash
cd ~/projects/kickoff-fm
# Run server locally (reads .env)
npm run server:dev        # auto-reload on file changes

# Or browser-only engine sandbox (no DB needed)
python3 -m http.server 8765  # then open legacy.html

# Sanity tests
npm run sim                # one match, summary
npm run bench              # 16-match benchmark
npm run seed               # reset DB to fresh 40 teams / 720 players
```

The server is on `http://localhost:3000` when running locally. Mongo Atlas connects from anywhere (IP whitelist `0.0.0.0/0` for dev).

---

## 5. Deploy workflow

```bash
# Edit code...
git add . && git commit -m "..." && git push origin main

# Deploy to Fly.io
~/.fly/bin/flyctl deploy --remote-only -a kickoff-fm
# Build runs in Fly's builder. ~90s.

# Live logs
~/.fly/bin/flyctl logs -a kickoff-fm
# or:
~/.fly/bin/flyctl logs -a kickoff-fm --no-tail

# SSH into running container (for ad-hoc debugging)
~/.fly/bin/flyctl ssh console -a kickoff-fm

# List/set secrets
~/.fly/bin/flyctl secrets list -a kickoff-fm
~/.fly/bin/flyctl secrets set KEY=val -a kickoff-fm
~/.fly/bin/flyctl secrets unset KEY -a kickoff-fm --stage   # then deploy
```

**SSH for GitHub is already configured** — key `~/.ssh/github_kickoff` (ed25519), added to user's `justdes93` GitHub account. `~/.ssh/config` routes `Host github.com` to that identity. `git push` works without prompts.

---

## 6. Architecture cheatsheet

```
Browser SPA (index.html → app.js)
    │ fetch + JWT in localStorage
    ▼
Fastify server (server/index.js)
    │
    ├─ /api/auth/*      → routes/auth.js + plugins/authPlugin.js
    │                     argon2id password, JWT 7d, 2FA via Telegram
    ├─ /api/worlds/*    → routes/world.js
    │   /api/teams/*    teams listing, claim, dashboard, /tactics PUT, /results
    │   /api/formations + /api/roles  (catalogs from data.js)
    │   /api/cups/*     public cup read
    ├─ /api/friendlies/*→ routes/friendly.js
    │                     20-min exhibition matches vs anyone
    ├─ /api/leagues/*   → routes/league.js
    │                     standings + top-scorers + top-assists
    ├─ /api/admin/*     → routes/admin.js (requireAdmin guard)
    │                     CRUD: leagues, teams, players, cups (+ cup advance)
    └─ /api/_debug/*    run-fixture/:id, run-friendly/:id (force-trigger)
    │
    ├─ scheduler (every 30s) ──┐
    │                          ▼
    └─ matchRunner.executeFixture / executeFriendly
           │ loadTeamForEngine: Mongo Team + Player → engine team shape
           │ MatchEngine ticks to full-time (batch, synchronous, ~1s per match)
           │ Persist: MatchResult + Fixture.state=finished
           │ bumpSeasonStats (league fixtures only — NOT friendlies/cups)
           ▼
   MongoDB Atlas (kickoff db)
   collections: users, worlds, leagues, seasons, teams, players,
                fixtures, matchresults, friendlies, cups
```

**Engine spec:** 10Hz tick, 90 game-min in 54000 ticks, full FM-style 24-attr model with role-aware blends. Half length overridable via `halfLenSec` (friendlies use 600 = 20-min match). See `engine.js` top comment + memory.

**Auth flow:**
1. `POST /api/auth/register` → 201 with `telegramLinkToken`
2. User opens https://t.me/KickOffFMBot, sends `/start <token>` → bot links chatId
3. `POST /api/auth/login` with password →
   - If telegramChatId set: `{ needs2fa: true, challengeToken }` + bot sends 6-digit code
   - Else: direct JWT
4. `POST /api/auth/2fa/verify` with `{ challengeToken, code }` → session JWT
5. JWT in `Authorization: Bearer ...` on all protected endpoints

---

## 7. Memory references (auto-loaded across Claude sessions)

```
~/.claude/projects/-Users-denyschupryn/memory/
├── MEMORY.md                    (one-line index — Claude reads first)
└── project_kickoff_fm.md        (full sprint-by-sprint history S1-S54)
```

In a fresh Claude session, the index line auto-loads. To resume in detail, ask Claude to:
> Read `~/.claude/projects/-Users-denyschupryn/memory/project_kickoff_fm.md` and `~/projects/kickoff-fm/HANDOFF.md`, then continue where we left off.

---

## 8. What's done — sprint summary

### Track A (engine refinement, 100% — Track A complete)
- **S1-S25** — physical-agent engine baseline, behavior overhaul, full pause mechanics, penalty shootout, VAR
- **S26** — 24-attr FM-style player model (10 tech + 8 mental + 6 phys; GK has 8 GK-tech)
- **S27** — 24 sub-roles + duty axis (defend/support/attack), anchor offsets + decision biases
- **S28** — 10/14 tactic sliders wired in S28; remaining 4 done in S30
- **S29** — 12 formations (4 originals + 8 added)
- **S30** — 4 corner routines + 4 FK routines + time_wasting
- **S31** — deferred (cross-match form/familiarity — needs season-state)
- **S32** — in-match morale + fatigue impact mental/technical attrs

Final benchmark (N=32, 4-3-3 vs 4-3-3): Goals 2.92 ✓, xG 1.24 ✓, OT 11.19 ✓, Pass acc 86.6% ✓, Corners 5.94 ✓ (5/6 metrics in real EPL window).

### Track B (online MVP, 11/12 — S39 deferred)
- **S33** — Engine headless port (Node CLI: `scripts/sim.js`)
- **S34** — Fastify + Mongo + 8 schemas (User, World, League, Season, Team, Player, Fixture, MatchResult)
- **S35** — Auth + Telegram 2FA scaffolding
- **S36** — Team claim + dashboard API (atomic, race-aware)
- **S37** — Seed 40 fictional teams (EPL+La Liga style), 720 players, 760 fixtures, Tue/Thu/Sat schedule
- **S38** — Match runner (batch mode) + scheduler polling
- **S40** — Tactics persistence endpoint (extended to lineup + roles per S47)
- **S42** — Ukrainian SPA: login / register / 2fa / onboarding / dashboard / team-roster / tactics / friendlies / league / cups / result
- **S43** — Fly.io deploy (Frankfurt, 512MB shared CPU)
- **S45** — Coach entity (subdoc on User) + admin role (`isAdmin` field, `requireAdmin` middleware)
- **S46** — Team roster page with click-to-modal player card (24-attr breakdown, top-3/bottom-3 highlights)
- **S47** — Vertical formation editor (own goal bottom, opp top) + click-slot swap + click-player role picker
- **S48** — Championship view (standings + top scorers + top assists, league switcher)
- **S49** — Friendly matches (20-min, anytime, anyone) + custom `halfLenSec` on engine
- **S50** — Gradient polish (glass topbar, ambient bg, mobile responsive @720px, pop-in animations)
- **S51** — Admin UI (CRUD leagues/teams/players, color picker, edit prompts)
- **S52** — Emblem URL upload (admin form + edit prompt + image render inside emblem swatch)
- **S53** — Live match indicator (red pulsing LIVE dot, dashboard auto-refresh 15-30s)
- **S54** — Cup tournament (knockout, 4/8/16 teams, random bracket, admin advance button)

### Deferred (post-MVP)
- **S39** — WebSocket live match streaming (real-time player movement broadcast). Currently matches run batch-mode (sync to full-time in ~1s per match). User sees final result only. ~1-2 days to implement properly — see "Implementation hints" below.
- **S41** — Auto-manager UX polish (badge when AI handled a match; explicit "AI fallback" indicator). Engine already uses saved tactics from `team.tactics`, so the FUNCTIONALITY works — just no UX.
- **S31** — Tactical familiarity penalty (cross-match state). Needs persistent player form across matches.

---

## 9. Where to start next session

### High-value, small scope (~2 hours)
1. **Emblem image upload (file, not URL)** — add image upload endpoint, store in MongoDB GridFS or external blob storage. Currently admin can only paste URL.
2. **Per-team standings link** — click a team in standings → goes to team detail with `worldId` resolved (currently only user's team is reachable).
3. **In-match commentary feed** — engine emits events array per match. Display as scrollable feed on Result detail page (right now we only show goal list).
4. **Player profile pages** — `/players/:id` standalone page with career stats, similar to manager profile.

### Medium scope (~half day)
5. **S39 WebSocket live streaming** — see implementation hints below.
6. **Season standings persistence** — when season ends, write final table to a SeasonResult doc + crown champion.
7. **Cup penalty shootout** — currently ties → home advances. Replace with engine penalty shootout (engine already supports `isCup: true`).

### Larger scope (~1-2 days)
8. **Transfer market** — async bid/counter-bid system between managers. Schema sketched in original architectural doc.
9. **Manager career page** — public `/coach/:username` with trophy cabinet, lifetime stats, style.
10. **Mobile-only optimization** — current layout works but tight on phones. Dedicated mobile breakpoints below 540px.

### S39 implementation hints (WebSocket live streaming)

Two viable paths, pick one:

**Path A — Replay-style (simpler, no real-time server load)**
- Engine already produces `events[]` and `goalsList`. Add `snapshots[]` — every 30 ticks (3 game-sec) sample player+ball positions.
- Store in MatchResult.snapshots (or fly to S3 for big matches).
- Client receives full snapshot stream after match ends, animates playback at adjustable speed.
- Pros: zero real-time server load; finished matches are instantly watchable.
- Cons: live spectators see results only after match completes (which is ~1s, so not really a problem in batch mode).
- Storage: ~500KB per match × 760 matches = ~400MB. Tight on Atlas M0 (512MB total). Mitigate with compression or limit to 16-bit ints.

**Path B — Server-pushed live (truer "live" feel)**
- Replace sync `while (e.phase !== 'full') e.tick()` with `setInterval(tickFn, 50)` (2× compressed = 600 real-sec for 20-min friendly, ~11 min for 90-min league).
- Per match, keep MatchSession instance in memory with ws.Server channel.
- Client connects to `wss://kickoff-fm.fly.dev/ws/match/:id` → receives state deltas at 10 Hz.
- Pros: real "live" feel; manager sees attacks unfold; community can spectate.
- Cons: server CPU scales with concurrent matches (10 simultaneous = 200 setInterval callbacks/sec). 512MB Fly tier could fit ~20-30 concurrent matches. Beyond that — need to scale up or move to per-match worker process.

Recommended: **Path A** for MVP. Switch to Path B in a later sprint when concurrency becomes the bottleneck.

---

## 10. Known issues / gotchas

1. **Telegram bot 401 errors** — if logs show `ETELEGRAM: 401 Unauthorized`, the bot token has been revoked. Set new token via `flyctl secrets set TELEGRAM_BOT_TOKEN=...`.
2. **Mongo auth errors** — if logs show `bad auth : authentication failed`, the Atlas password was rotated. Update `MONGO_URI` secret on Fly.
3. **dev-mode pino-pretty crash** — `server/index.js` probes `pino-pretty` dynamically; safe when omitted from prod image. If you see `unable to determine transport target` again, check the guard at top of `build()`.
4. **2FA verify "missing_fields"** — historical bug where `go('2fa')` wiped `state.params`. Fix in `app.js`: pass challengeToken explicitly: `go('2fa', { challengeToken: r.challengeToken })`. Should NOT recur.
5. **Friendly stats don't count toward standings** — intentional. `bumpSeasonStats` only fires when fixture has `leagueId+seasonId`.
6. **Cup tie-breaking** — currently home team advances on tie. No penalty shootout yet (engine supports `isCup: true` flag but it's not wired into cup advance).
7. **Friendly cleanup** — old finished friendlies accumulate in Mongo. Add periodic cleanup if Atlas M0 fills up.

---

## 11. Quick smoke test (5 min)

```bash
# 1. Site loads
curl -sS https://kickoff-fm.fly.dev/api/health
# expect: {"ok":true,"env":"production","mongo":"up",...}

# 2. DB seeded
curl -sS https://kickoff-fm.fly.dev/api/_debug/counts
# expect: counts of 40 teams, 720 players, 760+ fixtures

# 3. Catalog endpoints
curl -sS https://kickoff-fm.fly.dev/api/formations | head -c 100
curl -sS https://kickoff-fm.fly.dev/api/roles | head -c 100

# 4. Standings
curl -sS https://kickoff-fm.fly.dev/api/leagues/epl/standings | python3 -m json.tool | head -10

# 5. Cups list (likely empty)
curl -sS https://kickoff-fm.fly.dev/api/cups
```

End — fresh Claude session reading this + `project_kickoff_fm.md` + recent commit messages should be able to pick up cleanly.
