// Auth helpers — wraps @fastify/jwt with an `app.authenticate` preHandler.
// fastify-plugin lifts the decorator into the parent scope so all routes can use it.

import fastifyPlugin from 'fastify-plugin';

async function authPluginImpl(app) {
  app.decorate('authenticate', async function (request, reply) {
    try {
      await request.jwtVerify();
    } catch (err) {
      return reply.code(401).send({ error: 'unauthenticated' });
    }
  });

  // S45: admin guard — JWT-verifies then checks DB isAdmin flag.
  // Usage:  { preHandler: [app.authenticate, app.requireAdmin] }
  app.decorate('requireAdmin', async function (request, reply) {
    if (request.user?.purpose !== 'session') return reply.code(401).send({ error: 'invalid_token_purpose' });
    const { User } = await import('../db/models/index.js');
    const u = await User.findById(request.user.sub).select('isAdmin').lean();
    if (!u?.isAdmin) return reply.code(403).send({ error: 'admin_only' });
  });
}

export default fastifyPlugin(authPluginImpl, { name: 'authPlugin' });
