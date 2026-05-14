# Kick-Off FM — Project Guide for Claude

> Concise onboarding card. For a full deep-dive load [`HANDOFF.md`](HANDOFF.md). External knowledge base lives at https://github.com/justdes93/kickoff-fm-knowledge (private).

---

## 1. What this project is

**Kick-Off FM** is an online live-PvP football manager — players claim a fictional club in a multi-league world, manage tactics + roster, and watch matches play out via a deterministic physical-agent simulation engine (10 Hz tick, real coordinates, utility-AI players). Both sides can submit pre-match tactics and mid-match live commands; matches are paced in wall-clock time so two managers can experience the same fixture simultaneously.

**Status (2026-05-12):** Sprints S1–S76 shipped. Live in production at https://kickoff-fm.fly.dev with Telegram bot @KickOffFMBot. Engine bench is close to real EPL (shots 13/team, goals 1.2/team, pass acc 81.6 %, draws 24 %); offsides spam (13.6 vs real 2) is the main outstanding engine flaw.

**Repo:** https://github.com/justdes93/KickOffFM (private). Main branch only.

---

## 2. Tech stack

| Layer | Tech |
|---|---|
| Match engine | Pure ES modules (`engine.js`, ~2300 lines, runs in browser **and** Node — see `scripts/sim.js`) |
| Frontend SPA | Vanilla JS single-file router (`app.js`), no framework, hand-rolled history.pushState + view registry |
| Server | Fastify 4 + Mongoose + JWT + argon2 |
| DB | MongoDB Atlas M0 free cluster (`kickoff.emvrjsz.mongodb.net/kickoff`) |
| Auth | email + password + Telegram 2FA (mandatory since S75) |
| Hosting | Fly.io app `kickoff-fm` (Frankfurt, 2 × 512 MB shared-CPU machines) |
| Bot | `node-telegram-bot-api` long-polling (both machines poll → harmless 409s in logs) |

No build step. ES modules straight to the browser; cache-bust via `?cb=…` query string.

---

## 3. Repo layout

```
~/projects/kickoff-fm/
├── index.html          SPA shell (5 lines real markup)
├── app.js              SPA router + views + state (~370+ lines)
├── styles.css          dark theme, mobile aware
├── engine.js           Match engine v2 (~2300 lines) — physical-agent sim
├── engine_v1.js        Legacy event-lottery engine (reference only)
├── ai.js               In-match AI manager (tactical adjustments)
├── data.js             Formations, roles, attribute generator (`genPlayer`)
├── legacy-*.{js,html,css}   Old prototype, kept for engine R&D
├── scripts/
│   ├── sim.js          CLI runner: `node scripts/sim.js [--benchmark N]`
│   └── seed.js         Idempotent DB reset + populate
├── server/
│   ├── index.js        Fastify boot, helmet+rate-limit, SPA fallback, startup cleanup
│   ├── db/
│   │   ├── connection.js
│   │   └── models/     User · World · League · Season · Team · Player · Fixture · MatchResult · Friendly · Cup
│   ├── plugins/        authPlugin (authenticate + requireAdmin)
│   ├── routes/         auth · world · league · friendly · admin
│   ├── services/       matchRunner · scheduler · telegram
│   └── seed/           teamCatalog · playerNames · fixtures generator
├── deploy/             Oracle deploy notes (superseded by Fly, kept as reference)
├── fly.toml            Fly.io app config
├── Dockerfile          Multi-stage (deps with build-tools for argon2 → alpine runtime)
├── HANDOFF.md          Latest snapshot — load this first for any non-trivial work
└── CLAUDE.md           This file
```

---

## 4. How to run

```bash
cd ~/projects/kickoff-fm
npm run server:dev               # live-reload Fastify on :3000
node scripts/sim.js              # single headless match
node scripts/sim.js --benchmark 100   # 100-match aggregate stats
npm run bench                    # 16-match shortcut
npm run seed                     # reset + populate Mongo from team/player catalog
```

`.claude/launch.json` wires `preview_start` to the dev server (`name: "kickoff-fm"`).

---

## 5. Deploy

```bash
~/.fly/bin/flyctl deploy --remote-only -a kickoff-fm
~/.fly/bin/flyctl logs -a kickoff-fm                 # tail
~/.fly/bin/flyctl logs -a kickoff-fm --no-tail       # snapshot
~/.fly/bin/flyctl secrets list -a kickoff-fm         # rotated 2026-05-11
```

Secrets (set via `flyctl secrets set`): `BETA_KEY`, `JWT_SECRET`, `MONGO_URI`, `TELEGRAM_BOT_TOKEN`.

Local `.env` mirrors prod keys. Beta key for new registrations: `letmein`. Admin login: `justdes1993@gmail.com`.

---

## 6. Key concepts (quick reference)

### Engine (`engine.js`)
- 4 layers per tick: **strategic** (tactical change w/ 3-5 min lag) → **tactical** (phase + role anchors, every 30 ticks) → **decision** (utility AI per player, every 4 ticks) → **physical** (integrate ball + 22 players, every tick).
- 10 Hz, Δt = 0.1 s. Full match = 54 000 ticks. Pitch 105 × 68 m, top-left origin.
- Determinism: `rngSeed` stored on every fixture/friendly → server `/replay` re-simulates so playback always matches current engine code.
- Pause system (`engine.pause`) handles goal/throw-in/goal-kick/corner/FK/penalty/half-time/full-time/shootout/VAR with phase machine (setup → ready → execute → aftermath).
- Bench numbers and balance journal: see [`HANDOFF.md` §3](HANDOFF.md).

### SPA (`app.js`)
- Per-view URL paths since S58. `viewToPath` / `pathToView`. Hard-refresh on any view works (S75b — absolute paths in `index.html`).
- Views: login · register · 2fa · telegram-link · onboarding · dashboard · squad · team-detail · tactics · friendlies · friendly-wait · friendly-live · result · league · cups · cup-detail · admin.
- Live match catch-up runs in chunks (600 ticks + `setTimeout(0)`) with overlay before mount — see `bootstrapFriendlyLive` (S74).

### Server (`server/`)
- Match scheduler (`services/scheduler.js`) polls every 10 s, picks `scheduledAt <= now AND state==='scheduled'`, runs via `services/matchRunner.js`.
- `resimulateFriendly` (S73) re-runs sim before any `/replay` GET so saved state never drifts from engine code.
- Friendly invite flow (S55, S59): pending → accepted/declined within 5 min, +5 min prep, inline Telegram accept/decline buttons.
- Mid-match commands (S60): `liveCommands[]` on Friendly doc; submit tactics / sub → server re-sims with command embedded at `simTime`.
- Startup task (S76) frees `Team.managerUserId` references pointing at deleted users. Manual trigger: `POST /api/admin/cleanup-orphan-managers`.

### URL routing map
See [`HANDOFF.md` §6](HANDOFF.md) for the full table.

---

## 7. Open priorities (next session pick from here)

1. **Offside spam** (13.6 / match vs real ~2) — `isOffside` likely too strict OR run-target Y picks an offside lane. Plan in [`HANDOFF.md` §8](HANDOFF.md).
2. **Corners/fouls under-count** — tackle physics resolve too cleanly. Needs probabilistic fouls in `actTackle`.
3. **Engine in Web Worker** — biggest UI win, needs state-snapshot API for `MatchScreenUI`. Sketch in `project_kickoff_fm_engine_polish.md` memory.
4. **Security follow-ups** — HttpOnly cookies, refresh tokens, revocation list, CSP. See `project_kickoff_fm_security_followups.md`.

---

## 8. Memory pointers for new Claude sessions

Auto-memory lives at `~/.claude/projects/-Users-denyschupryn/memory/`:

- `project_kickoff_fm.md` — concept + early-sprint summary (S1–S38)
- `project_kickoff_fm_engine_polish.md` — engine-tuning backlog + bench tables
- `project_kickoff_fm_security_followups.md` — six deferred security items

`MEMORY.md` indexes them. Always cross-check memory against current code — entries can lag reality.

---

## 9. Conventions worth knowing

- **No build step.** Edit code → reload. ES modules use `?cb=…` cache-bust in dev.
- **Determinism first.** Anything that affects match outcome must be seeded from `rngSeed`. Never `Math.random()` in the engine path.
- **No backwards-compat hacks.** Schema can evolve freely; seeded data is reset via `npm run seed`.
- **Mongoose Mixed fields** (`tactics`, `attrs`, `liveCommands`) require explicit `markModified(path)` before `save()` — bit them more than once.
- **Two-machine Fly footprint** means both machines run the Telegram poller → expect 409 warnings in logs. Fix is leader election or scale to 1.
- **Telegram is mandatory** since S75 — login refuses session JWT if `telegramChatId` is missing; client auto-polls `/api/auth/check-tg` on the tg-link page.

---

## 10. Quick-start prompt for a fresh Claude session

> Working directory: `~/projects/kickoff-fm`. Read `CLAUDE.md`, then `HANDOFF.md` if doing engine/server work. Memory in `~/.claude/projects/-Users-denyschupryn/memory/` covers engine-tuning + security backlogs. Live at https://kickoff-fm.fly.dev. Deploy via `~/.fly/bin/flyctl deploy --remote-only -a kickoff-fm`. Bench with `npm run bench`. External knowledge base: https://github.com/justdes93/kickoff-fm-knowledge.
