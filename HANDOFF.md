# Kick-Off FM — Handoff (2026-05-14)

Snapshot at end of S55-S77 sprint block. Continues from the original 2026-05-11 handoff which covered S1-S54. Reusable for a fresh Claude session — everything needed to keep building is in this file + the linked memory entries.

> **2026-05-14**: section §10 added covering S77 (full localisation + PLAYER_SPEED_SCALE=0.5 + visual fixes + bench rebalance). Deployed to prod. Commit `c5734d0` on `main`.

---

## 1. What's live

| Component | URL / endpoint | Status |
|---|---|---|
| Web app | https://kickoff-fm.fly.dev | ✅ |
| Telegram bot | https://t.me/KickOffFMBot | ✅ polling (2 machines → 409 warnings, harmless) |
| Repo | https://github.com/justdes93/KickOffFM | private, main branch |
| Hosting | Fly.io app `kickoff-fm` (Frankfurt, fra) | **2 machines**, 512 MB shared CPU |
| Database | MongoDB Atlas M0 free cluster `kickoff.emvrjsz.mongodb.net/kickoff` | 512 MB |

**Login as admin**: `justdes1993@gmail.com` (👑). Beta key for new registrations: `letmein`.

---

## 2. Sprint log since last handoff (S55 → S76)

| Sprint | Topic | Notes |
|---|---|---|
| **S55** | Friendly invitation flow | `pending` / `declined` states, opponent gets 5 min to respond, accept → +5 min to kickoff, decline → friendly cancelled. Schema: `inviteDeadline`, `acceptedAt`, `opponentManagerId`. |
| **S56** | Pitch port — full match view | Imported `MatchScreenUI` from legacy-ui.js into SPA. Deterministic playback from `rngSeed` + `startedAt`. |
| **S57** | UX batch | Emblem-without-bg, blue/yellow palette, admin team+player as dedicated pages, standings emblems + next-2-rounds, team-detail page, tactics layout overhaul, player schema (firstName/lastName/secondaryRole/nationality select/transfermarktUrl), skill→attrs via `genPlayer`. |
| **S58** | URL routing + deep links | Per-view paths, history.pushState/popstate, server SPA fallback. League/cup wall-clock pacing (Fixture schema gained `rngSeed` etc.). |
| **S59** | Friendly invite polish | Shrunk invite + prep windows to 5 min, pre-match countdown page `/wait/:id`, top-bar pre-match pill, TG inline accept/decline buttons. Scheduler poll 30s → 10s, removed stale lower-bound. |
| **S60** | Mid-match controls | `liveCommands[]` on Friendly. Submit tactics or sub during match → POST `/api/friendlies/:id/live-cmd` → server re-sims with command embedded at simTime. Pre-match-tactics view unified with `/tactics?friendlyId=`. |
| **S61** | Security baseline | helmet (CSP off for now), rate-limit (5 auth-attempts/15 min, 300 req/min global), CORS locked to prod domain, fail-fast JWT_SECRET, global error handler. |
| **S62** | Subs UX rebuild | Click pitch player → highlight bench candidates by role compat → click bench → confirm. Modal stays open (capture-phase listener blocks backdrop close). Tactics modal works for both sides (legacy was hardcoded `home`). |
| **S63** | Engine polish #1 | Stamina rebalance (role + attr multipliers + halftime recovery). UI catch-up cap (80 ticks/frame). Subs panel debounce. |
| **S64** | Engine polish #2 | Reaction-lag per player (`reactionLagTicks`), `ballHistory[8]` ring buffer, stable `posBiasX/Y`, wide-miss gate, GK-pickup no longer counts as on-target. |
| **S65** | Slow-down + pre-match | Friendly `simSpeedFactor` 4.5 → 3.0 (33 real-min match instead of 23). Pre-match tactics fix (markModified for Mongoose Mixed override). Live pill score sync (markModified for goals/stats). |
| **S66** | Cover pass lanes | Defenders shade dangerous opp receivers (Y-only, top-2, CB/FB/DM/CM only). |
| **S67** | Anchor jitter | Off-ball micro-movement so players "breathe" instead of marching. |
| **S68** | Pass-to-runner sync | `utilityBestPass` bonuses teammates with `_runActive > 0` who advance forward. |
| **S69** | Defensive line X dynamics | Line breathes vertically with ball X (conservative coef). |
| **S70** | Counter-attack diversity | Only top 1-2 candidates (pace + closeness to opp goal) run on transAtk, not all attackers. |
| **S71** | GK proactive | Sweeper-keeper when defLine=high; claims aerials in own box when `command_of_area` > 60. |
| **S72** | Shot calibration loop | utilityShoot ×1.5, utilityBestPass base 0.75, wide-miss + pressure (+25%) + composure (+15%), composure-based noise mul. Anti-offside run gate. |
| **S73** | Determinism fix | `/replay` re-simulates before returning so server state always matches current engine code. Scramble goals contribute xG. |
| **S74** | Instant-jump-to-now | Engine catch-up runs in chunks (600 ticks + setTimeout(0)) with loading overlay before MatchScreenUI mounts. No more visible rewind. |
| **S75** | Mandatory Telegram | Login refuses session JWT if no `telegramChatId`. Auto-poll `/api/auth/check-tg` on tg-link page. Skip button removed. Fixed SPA deep-link refresh (index.html absolute paths). |
| **S76** | Orphan manager cleanup | Startup task frees `Team.managerUserId` references pointing at deleted users. Admin trigger `POST /api/admin/cleanup-orphan-managers`. |

---

## 3. Bench results after S72 (per team, vs real EPL)

| Metric | Engine | Real | Status |
|---|---|---|---|
| Shots | 13.01 | 13.0 | ✅ |
| OT % | 41.0 % | 35 % | ✅ close |
| OT / team | 5.33 | 4.5 | ✅ |
| xG | 1.42 | 1.30 | ✅ |
| Goals | 1.20 | 1.30 | ✅ |
| Pass accuracy | 81.6 % | 83 % | ✅ |
| Corners | 3.3 | 5.0 | ⚠ slight under |
| Fouls | 6.5 | 10.5 | ⚠ under (engine plays clean) |
| Yellow | 1.1 | 1.5 | ⚠ slight under |
| Offsides | 13.6 | 2.0 | ⚠ still high (anti-offside helped) |
| Draws | 24 % | 25 % | ✅ |
| Scoreless | 13 % | 8 % | ⚠ slight over |

Run `npm run bench` for a 16-match sample. For 100 matches: `node scripts/sim.js --benchmark 100`.

---

## 4. Project layout (additions since 2026-05-11)

Same as previous handoff plus:

```
server/
├── routes/
│   ├── friendly.js              (S55 invite flow, S60 live-cmd, S73 re-sim on /replay)
│   ├── auth.js                  (S75 needsLink branch, /check-tg endpoint)
│   ├── admin.js                 (S76 cleanup-orphan-managers, tg-status, dedicated CRUD)
│   └── league.js                (S57 upcoming endpoint with next 2 rounds + emblems)
├── services/
│   ├── matchRunner.js           (S60 resimulateFriendly, S64 stored rngSeed, S72 calibration intact)
│   ├── scheduler.js             (S59 10s poll, fast finalize pass for fixtures)
│   └── telegram.js              (S59 sendFriendlyInvite + inline button callbacks, HTML mode)
└── index.js                     (S61 helmet+rate-limit, S76 startup cleanup, SPA fallback)
```

Frontend additions in `app.js`:
- `friendly-live`, `friendly-wait`, `team-detail` views
- `pollActiveMatch` + top-bar live-pill + prematch countdown
- `bootstrapFriendlyLive` (S74 chunked catch-up)
- `pollLiveState`, `rebindLiveControls`, `renderMySubsPanel`, `renderMySubsFooter`
- TG-link auto-poll (`scheduleTgLinkPoll`, `checkTgLink`)
- URL routing: `viewToPath` / `pathToView`

Engine additions in `engine.js`:
- `ballHistory[8]` ring buffer
- Per-player `reactionLagTicks` + `posBiasX/Y` + `_coveringOpp`
- `tacticalUpdate` cover-pass-lanes block + def-line X dynamics
- `actShoot` wide-miss gate + composure-based noise

---

## 5. Active environment

```
~/projects/kickoff-fm/.env
~/.fly/bin/flyctl   (deploy CLI)
```

Secrets in Fly (all rotated 2026-05-11):
- BETA_KEY, JWT_SECRET, MONGO_URI, TELEGRAM_BOT_TOKEN

Check: `~/.fly/bin/flyctl secrets list -a kickoff-fm`.

### Local dev

```bash
cd ~/projects/kickoff-fm
npm run server:dev               # live-reload server on :3000
# Engine sim:
node scripts/sim.js              # one match
node scripts/sim.js --benchmark 100   # 100-match bench
# Or use the wired-up Claude Preview:
# preview_start kickoff-fm
```

### Deploy

```bash
~/.fly/bin/flyctl deploy --remote-only -a kickoff-fm
```

### Watch prod

```bash
~/.fly/bin/flyctl logs -a kickoff-fm                 # tail
~/.fly/bin/flyctl logs -a kickoff-fm --no-tail       # snapshot
```

Useful greps:
- `grep "sched"` — match scheduler activity
- `grep "TG invite"` — friendly invite path
- `grep "tactics override"` — pre-match tactics save events
- `grep "re-sim"` — `resimulateFriendly` outcomes
- `grep "freed.*orphan"` — startup manager cleanup

---

## 6. URL routing map (deep-linkable since S58)

| View | URL pattern |
|---|---|
| Login | `/login` |
| Register | `/register` |
| 2FA challenge | `/2fa` |
| TG-link | `/telegram` |
| Onboarding | `/onboarding` |
| Dashboard | `/` |
| Squad | `/squad` |
| Team detail | `/team/:id` |
| Tactics (default) | `/tactics` |
| Tactics (pre-match friendly) | `/tactics/:friendlyId` |
| Friendlies list | `/friendlies` |
| Friendly wait | `/wait/:id` |
| Friendly live | `/match/:id` |
| Result | `/result/:id` |
| League | `/league/:slug` |
| Cups list | `/cups` |
| Cup detail | `/cup/:id` |
| Admin | `/admin` / `/admin/:tab` |
| Admin team form | `/admin/team/(:id\|new)` |
| Admin player form | `/admin/player/(:id\|new)?team=:id` |

Hard-refresh on any of these works (S75b fix: absolute paths in `index.html`).

---

## 7. Memory entries to load in a fresh session

The auto-memory under `~/.claude/projects/-Users-denyschupryn/memory/` contains:

- **project_kickoff_fm.md** — high-level concept + early-sprint summary
- **project_kickoff_fm_engine_polish.md** — full engine-tuning backlog with what shipped (S63, S64, S66-S72) and what's still deferred
- **project_kickoff_fm_security_followups.md** — six security items deferred after S61 baseline

These are auto-indexed via `MEMORY.md` in the same folder.

---

## 8. Open priorities for next session

### Most impact, smallest scope
1. **Offside spam** — engine still flags 13.6 offsides/match vs real ~2. After S72 anti-offside gates, suspect `isOffside` is too strict OR the run-target Y picks an offside lane. Plan: add log, snapshot which player + when, narrow to one cause.
2. **Corners/fouls under-count** — tackle physics resolve cleanly. Probably needs probabilistic fouls in `actTackle`.

### Medium scope
3. **Player movement still mechanical** — anchor-jitter helped but on-ball decisions are still tick-based. Next: micro-anticipation (carrier sees teammate's run-direction before pass).
4. **Engine in Web Worker** — biggest UI win, decouples sim from main thread. Hefty refactor: need a state-snapshot API for `MatchScreenUI`. See `project_kickoff_fm_engine_polish.md` for the architecture sketch.

### Lower priority / when asked
5. **Security follow-ups** — HttpOnly cookies, refresh tokens, revocation list, CSP. See `project_kickoff_fm_security_followups.md`.
6. **GK proactive #2** — claim crosses more reliably; currently relies on `command_of_area ≥ 60` so weaker keepers stay glued to line.

### Known live bugs / nice-to-haves
- **TG 409 polling warnings** in prod logs — both machines polling bot getUpdates. Harmless (sendMessage works on both) but noisy. Fix: lease-based leader election or scale to 1 machine.
- **Live `interceptions` metric** counts loose-ball pickups, not real interceptions. Engine-side metric definition needs tightening.

---

## 9. Quick-start for new Claude session

Paste this into the new chat:

> Working directory: `~/projects/kickoff-fm`. Read `CLAUDE.md` then `HANDOFF.md` (§10 has the latest S77 state). Memory entries in `~/.claude/projects/-Users-denyschupryn/memory/` cover engine-tuning + security backlogs. Live at https://kickoff-fm.fly.dev (deployed 2026-05-14). Deploy via `~/.fly/bin/flyctl deploy --remote-only -a kickoff-fm`. Bench with `npm run bench`. Knowledge base: https://github.com/justdes93/kickoff-fm-knowledge.

---

## 10. S77 — Full localisation + speed scale + visual pass (2026-05-14)

Single-session marathon. All deployed to prod, commit `c5734d0` on `main`. KB repo NOT yet updated to reflect S77 — flag this if revisiting documentation.

### 10.1 New engine-wide tunable

```js
// engine.js (top of file)
const PLAYER_SPEED_SCALE = 0.5;
```

Multiplies `baseSpeed` in `actMoveToTarget` AND `playerSpeed` in `_computeEta`. Single dial that scales **all outfield-player running speed** (sprint + walk) without touching match clock or attributes. User chose 0.5 after experimenting with 0.05–0.5. Set lower for slower-mo, higher (1.0 = original) for sprintier feel. Several downstream issues stem from this — see §10.4.

### 10.2 Full Ukrainian localisation

Every user-visible string in `app.js`, `legacy-ui.js`, `engine.js` (commentary), and admin tables. Only English remaining:
- Team / league / world / player names (fictional but English-style — intentional per user)
- Position abbreviations (GK, CB, FB, CM, DM, AM, ST, W)

Notable translation maps:
- `ATTR_META` (24 outfield + 22 GK attrs, label + description)
- Tactical dropdowns (mentality / tempo / press / def line / width / passing / corner / FK / time-wasting)
- Engine log events (40+ strings — goals, fouls, saves, set pieces, VAR, shootout)
- Stats labels (Possession, Shots, On target, etc.)
- AI mentality labels
- `describePayload` / `describeTacticalChange`

### 10.3 Tactics modal stability

Modal was disappearing after 10-20 sec — root cause: `pollActiveMatch` calls `render()` every poll cycle when score/minute changes, replacing DOM (including open modal). Fix: skip `render()` if `state.view ∈ {friendly-live, friendly-wait}` (top-bar pill is redundant inside the match anyway).

Also: backdrop-click close used `mousedown+mouseup` tracking so an accidental drag from inside (e.g. on a `<select>`) doesn't close the modal. Removed the obsolete capture-phase `stopImmediatePropagation` hack in `rebindLiveControls`.

### 10.4 Visual fixes batch — all in this session

| Symptom | Cause | Fix |
|---|---|---|
| Ball jumps with thrower to throw-in spot | `_beginThrowIn` snapped taker to (x,y) instantly | Hybrid: if taker > 4m away, snap to 4m radius then walk last bit |
| Same for goal kick (GK rushing back) | `_beginGoalKick` instant snap | Same hybrid pattern |
| Same for corner kicker | `awardCornerSetPiece` gave ball ownership to kicker → ball followed them | Ball stays at flag (ownerSide = null), kicker hybrid-snapped within 4m, walks rest. `processSetPiece` changed `action = IDLE` → `MOVE_TO_POSITION` for kicker |
| Throw-in often intercepted | Random AI pass choice — sometimes long forward, intercepted | After pause `onComplete`, force taker action='PASS' with `_passTargetNum = back receiver` |
| Halftime: players frozen | 100/80 tick walk with PLAYER_SPEED_SCALE=0.5 = ~16m progress, needed 33m | Bumped to 350/350 + sprint mode in halftime tick path |
| FK opponent next to keeper | 16-tick setup + push-out from S76 only inside `isDangerous` block — not enough time | Setup 16→70 ticks; attackers within 4.5m of opp GK moved to penalty edge |
| Players cluster 5-6 around ball | `willReachBallFirst` only compared vs opp ETAs — multiple teammates could all decide "I'm closest" | Now requires `myEta <= bestMyEta` too |
| Goals invisible in net + teleport at kickoff + scorers don't go to half | Ball reset to centre instantly (line 418); `tacticalUpdate` runs every 30t even during goal pause → overwrites scorer-at-corner target; `_retargetForKickoff` used full formation but `setupKickoff` snaps to compressed (× 0.4) → end-of-pause teleport | (a) Ball parked at goal mouth (`x = ±107`) during aftermath; moved to centre on `setup` phase. (b) Skip `tacticalUpdate` when `pause.type === 'goal' \|\| 'var_check'`. (c) Set BOTH `p.targetX/Y` AND `p.anchor.x/y` in `_beginGoalPauseInner` (executeAction reads from anchor each tick). (d) `_retargetForKickoff` now uses compressed positions matching `setupKickoff`. (e) `setupKickoff` only teleports stragglers (>3m from target) — others have already walked there. (f) aftermath 80→200t, setup 50→200t |
| Close shots fly wide | Wide-miss prob 30% base + 21° angular noise regardless of distance | New `distFactor` (0.45 at ≤4m → 1.0 at 26m+) scales BOTH wide-miss prob and angular noise. Close 8m shots: ~25% miss, ±5° angular |
| Reception "dead stop" | `HOLD` action set for 14 ticks after each touch (1.4 game-sec) + decel 0.7× per tick | timer 14→4, decel 0.7→0.88. Player keeps forward momentum, decideAction fires on next 4-tick cycle |
| Hopeful 30m shots flying out | `minScore` for SHOOT outside box = 0.05 — too easy for AI to take | 0.05 → 0.15. Long shots require stronger setup |
| Corner kicker takes before teammates arrive | 80-tick setup not enough with slow speed for midfield runs into box | Hybrid-snap attackers + defenders to within 8m of scripted spots |
| Corner delivery falls short of target | `power = clamp(dxy * 0.95, 12, 24)` — max 24 m/s, falls short on 30+m corners | Compute via trajectory: `power = dxy / flightTime` where flightTime depends on `vz`. Power range now [14, 38] for lofted, [8, 18] for short |
| Ball too big | r=1.215 | r=0.91 (-25%) + halo 2.7→2.0 proportional |
| Goals invisible on pitch | SVG had 3D goal-net rects at x=-2.6 / x=105.2 but viewBox was `0 0 105 68` (clipped them off) | Extended viewBox: `-3 -1 111 70` |

### 10.5 Bench after S77 fixes (16-match, 4-3-3 v 4-3-3)

| Per team | S72 baseline | After S77 | Real EPL |
|---|---|---|---|
| Shots | 13.0 | **13.69** | 13 |
| OT | 5.33 | 8.09 | 4.5 |
| OT% | 41% | 59% (↑ accuracy fix) | 35% |
| xG | 1.42 | 1.55 | 1.30 |
| Goals | 1.20 | **1.75** | 1.30 |
| Pass acc | 81.6% | 88.7% | 83% |
| Offsides | 13.6 | 2.13 ⭐ | 2.0 |
| Corners | 3.3 | **4.88** | 5.0 |
| Scoreless | 13% | 0% | 8% |

OT% high because shooting accuracy got tighter; conversion still ~13% (real ~11%) — within bounds. Pass-acc creep tracks slower defenders not getting to interception lines. **Acceptable for now** — user happy with feel.

### 10.6 Known carry-over / open

- **Corner waiting** still not perfect — kicker arrives, glances around, then kicks. Could extend setup further or wait for `attackersInBox` count to threshold.
- **`setupKickoff` facing snap** still slightly jarring (rotates all players to face opponent in one tick). Could ease over 5-10 ticks.
- **OT% 59%** above real-football 33%. Tightening would need either lower xG-per-shot OR higher save base. Both interact with other systems.
- **Engine in Web Worker** still open (biggest remaining UI win).
- **Goals scored from far still appear sometimes** because long shot bias still > 0 for high `long_shots` attribute. Could fully gate by attribute > 80.

### 10.7 Audit script

`scripts/audit.js` (new this session) runs N matches and surfaces distributions, outliers, xG-vs-actual gaps, spectacular-event frequencies. Use `node scripts/audit.js 100` for engine quality check.
