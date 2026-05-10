// Match scheduler — every minute scans for fixtures whose scheduledAt has passed
// and kicks them off via matchRunner. MVP: batch mode, single Node process.
//
// `start(app)` returns a stop() function to cancel polling.

import { Fixture } from '../db/models/index.js';
import { executeFixture } from './matchRunner.js';

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
      // Pick fixtures: due and not yet started
      const due = await Fixture.find({
        state: 'scheduled',
        scheduledAt: { $lte: now, $gte: new Date(now - KICKOFF_GRACE_MS - 24 * 3600 * 1000) },
      }).sort({ scheduledAt: 1 }).limit(50).select('_id scheduledAt round homeTeamId awayTeamId').lean();
      if (due.length) {
        log.info(`[sched] ${due.length} fixture(s) due — kicking off`);
        // Run all in parallel; failures don't block siblings.
        await Promise.allSettled(due.map(f =>
          executeFixture(f._id, { log, lockId })
        ));
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
