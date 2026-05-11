// Match scheduler — every minute scans for fixtures whose scheduledAt has passed
// and kicks them off via matchRunner. MVP: batch mode, single Node process.
//
// `start(app)` returns a stop() function to cancel polling.

import { Fixture, Friendly } from '../db/models/index.js';
import { executeFixture, executeFriendly } from './matchRunner.js';

const POLL_INTERVAL_MS = 30_000;             // 30s — balanced for friend-test
const KICKOFF_GRACE_MS = 60_000;              // start matches up to 60s late if missed

export function startScheduler(app) {
  let stopped = false;
  const log = app.log;
  const lockId = `worker-${process.pid}-${Date.now()}`;

  async function tick() {
    if (stopped || !app.dbReady) return;
    try {
      const now = new Date();
      const fromDate = new Date(now - KICKOFF_GRACE_MS - 24 * 3600 * 1000);
      // Pick league fixtures + friendlies in parallel
      const [dueFixtures, dueFriendlies] = await Promise.all([
        Fixture.find({
          state: 'scheduled',
          scheduledAt: { $lte: now, $gte: fromDate },
        }).sort({ scheduledAt: 1 }).limit(50).select('_id').lean(),
        Friendly.find({
          state: 'scheduled',
          scheduledAt: { $lte: now, $gte: fromDate },
        }).sort({ scheduledAt: 1 }).limit(50).select('_id').lean(),
      ]);
      const totalDue = dueFixtures.length + dueFriendlies.length;
      if (totalDue > 0) {
        log.info(`[sched] kicking off — ${dueFixtures.length} fixture(s), ${dueFriendlies.length} friendly(ies)`);
        await Promise.allSettled([
          ...dueFixtures.map(f => executeFixture(f._id, { log, lockId })),
          ...dueFriendlies.map(f => executeFriendly(f._id, { log, lockId })),
        ]);
      }
    } catch (err) {
      log.error({ err: err.message }, '[sched] tick failed');
    }
  }

  log.info(`[sched] started — polling every ${POLL_INTERVAL_MS / 1000}s`);
  tick();                                     // run once immediately
  const handle = setInterval(tick, POLL_INTERVAL_MS);
  return () => { stopped = true; clearInterval(handle); log.info('[sched] stopped'); };
}
