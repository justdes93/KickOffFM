# Kick-Off FM — Handoff (2026-05-12)

Snapshot at end of S55-S76 sprint block. Continues from the original 2026-05-11 handoff which covered S1-S54. Reusable for a fresh Claude session — everything needed to keep building is in this file + the linked memory entries.

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

> Working directory: `~/projects/kickoff-fm`. Read `HANDOFF.md` first. Memory entries in `~/.claude/projects/-Users-denyschupryn/memory/` cover engine-tuning + security backlogs. Live at https://kickoff-fm.fly.dev. Deploy via `~/.fly/bin/flyctl deploy --remote-only -a kickoff-fm`. Bench with `npm run bench`. I want to continue with [next priority from §8].
