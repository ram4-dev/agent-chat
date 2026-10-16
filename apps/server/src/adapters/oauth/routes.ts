import type { FastifyInstance } from 'fastify';
import type Provider from 'oidc-provider';
import { OIDC_ROUTE_PATHS } from './provider.js';

/**
 * Mounts the authorization server on the application server.
 *
 * Three constraints shape this registration, and each one was observed rather
 * than assumed:
 *
 * 1. The provider expects its routes at the root of its issuer. A path-bearing
 *    issuer makes it publish endpoints under that path while still serving them
 *    at the root, so every request answers 404. The issuer is therefore the bare
 *    origin, and these exact routes are registered explicitly, before the static
 *    catch-all that serves the client bundle.
 *
 * 2. Fastify parses request bodies before a handler runs, which would leave the
 *    provider reading an already-drained stream. The routes are registered in an
 *    encapsulated scope whose only content type parser hands the payload through
 *    untouched, so the provider reads the request itself. Encapsulation keeps the
 *    application's own JSON and form parsing intact.
 *
 * 3. Fastify has no Express-style middleware, so each route hijacks the reply and
 *    passes the raw Node request and response to the provider, which writes its
 *    own status codes, headers, and redirects.
 */
export async function registerOidcRoutes(
  app: FastifyInstance,
  provider: Provider,
): Promise<void> {
  const callback = provider.callback();

  await app.register(async (scope) => {
    scope.removeAllContentTypeParsers();
    scope.addContentTypeParser('*', (_request, payload, done) => {
      // Passing the stream through is the whole point: nothing is consumed here.
      done(null, payload);
    });

    for (const url of OIDC_ROUTE_PATHS) {
      scope.route({
        method: ['GET', 'POST'],
        url,
        handler: (request, reply) => {
          reply.hijack();
          return callback(request.raw, reply.raw);
        },
      });
    }
  });
}
