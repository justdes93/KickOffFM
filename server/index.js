// Kick-Off FM — server entry. Fastify app + Mongo connection + static client.
//
// Boot order:
//   1. Connect to Mongo (fail-fast if unreachable)
//   2. Register plugins (cors, jwt, websocket, static)
//   3. Mount routes (auth, teams, fixtures, ws)
//   4. Listen on PORT
//
// Run with:  npm run server:dev

import Fastify from 'fastify';
import cors from '@fastify/cors';
import jwt from '@fastify/jwt';
import staticPlugin from '@fastify/static';
import websocket from '@fastify/websocket';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { connectDb } from './db/connection.js';
import * as Models from './db/models/index.js';
import authPlugin from './plugins/authPlugin.js';
import authRoutes from './routes/auth.js';
import worldRoutes from './routes/world.js';
import { initTelegramService } from './services/telegram.js';
import { startScheduler } from './services/scheduler.js';
import { executeFixture } from './services/matchRunner.js';
import { Fixture } from './db/models/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');

async function build() {
  // pino-pretty is a devDependency; only use it if it's actually installed in
  // node_modules (i.e. local dev). In production Docker image we omit dev deps,
  // so the conditional check on NODE_ENV alone is not enough — we also probe.
  let transport;
  if (process.env.NODE_ENV !== 'production') {
    try {
      await import('pino-pretty');
      transport = { target: 'pino-pretty', options: { translateTime: 'HH:MM:ss', ignore: 'pid,hostname' } };
    } catch { /* not installed — fall back to plain JSON logs */ }
  }
  const app = Fastify({
    logger: {
      level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
      transport,
    },
  });

  // ---- Plugins ----
  await app.register(cors, {
    origin: true,
    credentials: true,
  });
  await app.register(jwt, {
    secret: process.env.JWT_SECRET || 'dev-only-insecure-secret-CHANGE-ME',
    sign: { expiresIn: '7d' },
  });
  await app.register(authPlugin);
  await app.register(websocket);

  // Serve client static files (index.html, main.js, etc.) at root.
  await app.register(staticPlugin, {
    root: ROOT,
    prefix: '/',
    index: 'index.html',
    // Allow main.js / engine.js / etc. to be served as ESM modules
    setHeaders: (res, filePath) => {
      if (filePath.endsWith('.js')) res.setHeader('Content-Type', 'application/javascript');
    },
  });

  // ---- Routes ----
  await app.register(authRoutes);
  await app.register(worldRoutes);

  app.get('/api/health', async () => {
    return {
      ok: true,
      env: process.env.NODE_ENV || 'development',
      mongo: app.dbReady ? 'up' : 'down',
      modelsLoaded: Object.keys(Models),
      timestamp: new Date().toISOString(),
    };
  });

  // Sanity probe: count records in each collection. Returns 503 if DB not yet ready.
  app.get('/api/_debug/counts', async (req, reply) => {
    if (!app.dbReady) {
      return reply.code(503).send({ error: 'db_not_ready' });
    }
    const out = {};
    for (const [name, M] of Object.entries(Models)) {
      try { out[name] = await M.countDocuments(); }
      catch (e) { out[name] = `error: ${e.message}`; }
    }
    return out;
  });

  // Admin/debug — force-run a specific fixture immediately (bypasses scheduledAt).
  // Useful for friend-test before season starts. Production should require admin auth.
  app.post('/api/_debug/run-fixture/:id', async (req, reply) => {
    if (!app.dbReady) return reply.code(503).send({ error: 'db_not_ready' });
    // Override scheduledAt to "now" so the lock query succeeds.
    const f = await Fixture.findById(req.params.id);
    if (!f) return reply.code(404).send({ error: 'fixture_not_found' });
    if (f.state !== 'scheduled') return reply.code(409).send({ error: 'fixture_state', state: f.state });
    const result = await executeFixture(f._id, { log: app.log });
    return result || { error: 'race_lost' };
  });

  return app;
}

async function start() {
  const app = await build();
  app.dbReady = false;

  // Listen first — server is responsive immediately even if DB is slow / down.
  const port = parseInt(process.env.PORT || '3000', 10);
  const host = process.env.HOST || '0.0.0.0';
  try {
    await app.listen({ port, host });
    app.log.info(`Kick-Off FM server listening on ${host}:${port}`);
  } catch (err) {
    app.log.error({ err }, 'Failed to start server');
    process.exit(1);
  }

  // Connect to DB in background — endpoints that need it can check `app.dbReady`.
  connectDb()
    .then(() => { app.dbReady = true; app.log.info('DB ready'); })
    .catch((err) => {
      app.log.warn({ err: err.message }, 'Mongo connection failed — endpoints requiring DB will 503 until reconnected.');
    });

  // Telegram bot (S35) — sets app.tgService for /api/auth/* to use.
  initTelegramService(app)
    .then((svc) => { app.tgService = svc; })
    .catch((err) => app.log.error({ err: err.message }, 'tg init failed'));

  // Match scheduler (S38) — start once DB is ready.
  const tryStartScheduler = () => {
    if (app.dbReady) {
      app.stopScheduler = startScheduler(app);
    } else {
      setTimeout(tryStartScheduler, 1000);
    }
  };
  tryStartScheduler();
}

start();
