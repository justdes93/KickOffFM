// Match scheduler — runs three passes every 30s:
//   1. auto-accept: pending friendlies past inviteDeadline → scheduled (silence=consent)
//   2. kickoff:     scheduled fixtures + friendlies whose time arrived → run engine
//   3. finalize:    in_progress friendlies whose wall-clock duration elapsed → finished
//      (engine result is computed eagerly; wall-clock just reveals it progressively)
//
// `start(app)` returns a stop() function to cancel polling.

import { Fixture, Friendly } from '../db/models/index.js';
import { executeFixture, executeFriendly } from './matchRunner.js';

// S59: faster polling (10s) so a freshly-scheduled match starts within ~10s
// of its kickoff time, not 30s as before.
const POLL_INTERVAL_MS = 10_000;
const KICKOFF_GRACE_MS = 5 * 60_000;             // accept up to 5 min stale (handles brief downtime)

export function startScheduler(app) {
  let stopped = false;
  const log = app.log;
  const lockId = `worker-${process.pid}-${Date.now()}`;

  async function tick() {
    if (stopped || !app.dbReady) return;
    try {
      const now = new Date();

      // ---- 1. Auto-accept expired invitations ----
      const expired = await Friendly.find({
        state: 'pending',
        inviteDeadline: { $lte: now },
      }).select('_id inviteDeadline');
      if (expired.length) {
        await Friendly.updateMany(
          { _id: { $in: expired.map(f => f._id) }, state: 'pending' },
          [{ $set: { state: 'scheduled', scheduledAt: '$inviteDeadline' } }]
        );
        log.info(`[sched] auto-accepted ${expired.length} silent friendly invitation(s)`);
      }

      // ---- 2. Kickoff due fixtures + friendlies ----
      // S59: previously filtered by scheduledAt >= (now - grace - 24h). Anything
      // older was silently SKIPPED — if scheduler was offline for >24h, scheduled
      // matches would be stuck forever. Drop the lower bound so we always pick
      // up due matches; downstream lock prevents double-kick-off.
      const [dueFixtures, dueFriendlies] = await Promise.all([
        Fixture.find({
          state: 'scheduled',
          scheduledAt: { $lte: now },
        }).sort({ scheduledAt: 1 }).limit(50).select('_id scheduledAt').lean(),
        Friendly.find({
          state: 'scheduled',
          scheduledAt: { $lte: now },
        }).sort({ scheduledAt: 1 }).limit(50).select('_id scheduledAt').lean(),
      ]);
      const totalDue = dueFixtures.length + dueFriendlies.length;
      if (totalDue > 0) {
        const lags = [...dueFixtures, ...dueFriendlies].map(f => Math.round((now - new Date(f.scheduledAt)) / 1000));
        const maxLag = Math.max(0, ...lags);
        log.info(`[sched] kicking off — ${dueFixtures.length} fixture(s), ${dueFriendlies.length} friendly(ies); max lag ${maxLag}s`);
        await Promise.allSettled([
          ...dueFixtures.map(f => executeFixture(f._id, { log, lockId })),
          ...dueFriendlies.map(f => executeFriendly(f._id, { log, lockId })),
        ]);
      }

      // ---- 3. Finalize in_progress friendlies past wall-clock duration ----
      // Wall duration = 2× (halfLen/speed) + halftime. Defaults: 2×(2700/3.0)+180 = 1980s = 33min.
      const inProgress = await Friendly.find({ state: 'in_progress' })
        .select('_id startedAt halfLenSec simSpeedFactor halftimeRealSec').lean();
      const toFinish = [];
      for (const f of inProgress) {
        if (!f.startedAt) continue;
        const halfLen = f.halfLenSec || 2700;
        const speed = f.simSpeedFactor || 3.0;
        const halftime = f.halftimeRealSec || 180;
        const wallDurationMs = ((halfLen / speed) * 2 + halftime) * 1000;
        if (now - new Date(f.startedAt).getTime() >= wallDurationMs) {
          toFinish.push(f._id);
        }
      }
      if (toFinish.length) {
        await Friendly.updateMany(
          { _id: { $in: toFinish }, state: 'in_progress' },
          { $set: { state: 'finished', finishedAt: now } }
        );
        log.info(`[sched] finalized ${toFinish.length} friendly(ies) (wall-clock duration elapsed)`);
      }

      // ---- 4. Finalize in_progress league/cup fixtures past wall-clock ----
      // Defaults for fixtures: 2×(2700/3)+180 = 1980s = 33 min = 15+3+15.
      const fxInProgress = await Fixture.find({ state: 'in_progress' })
        .select('_id startedAt halfLenSec simSpeedFactor halftimeRealSec').lean();
      const fxToFinish = [];
      for (const f of fxInProgress) {
        if (!f.startedAt) continue;
        const halfLen = f.halfLenSec || 2700;
        const speed = f.simSpeedFactor || 3;
        const halftime = f.halftimeRealSec || 180;
        const wallDurationMs = ((halfLen / speed) * 2 + halftime) * 1000;
        if (now - new Date(f.startedAt).getTime() >= wallDurationMs) {
          fxToFinish.push(f._id);
        }
      }
      if (fxToFinish.length) {
        await Fixture.updateMany(
          { _id: { $in: fxToFinish }, state: 'in_progress' },
          { $set: { state: 'finished', finishedAt: now } }
        );
        log.info(`[sched] finalized ${fxToFinish.length} fixture(s) (wall-clock duration elapsed)`);
      }
    } catch (err) {
      log.error({ err: err.message }, '[sched] tick failed');
    }
  }

  log.info(`[sched] started — polling every ${POLL_INTERVAL_MS / 1000}s`);
  tick();
  const handle = setInterval(tick, POLL_INTERVAL_MS);
  return () => { stopped = true; clearInterval(handle); log.info('[sched] stopped'); };
}
