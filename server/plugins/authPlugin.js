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
}

export default fastifyPlugin(authPluginImpl, { name: 'authPlugin' });
