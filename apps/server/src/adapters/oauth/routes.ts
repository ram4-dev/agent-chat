import type { FastifyInstance } from 'fastify';
import type Provider from 'oidc-provider';
import { OIDC_ROUTE_PATHS } from './provider.js';

type RawRequest = Parameters<ReturnType<Provider['callback']>>[0];

/**
 * Mounts the authorization server on the application server.
 *
 * Three constraints shape this registration, and each was observed rather than
 * assumed:
 *
 * 1. The provider expects its routes at the root of its issuer. A path-bearing
 *    issuer makes it publish endpoints under that path while still serving them
 *    at the root, so every request answers 404. The issuer is therefore the bare
 *    origin, and these exact routes are registered explicitly, before the static
 *    catch-all that serves the client bundle.
 *
 * 2. Fastify has no Express-style middleware, so each route hijacks the reply and
 *    passes the raw Node request and response to the provider, which writes its
 *    own status codes, headers, and redirects.
 *
 * 3. The provider reads the body itself only while it believes the stream is
 *    readable, and only otherwise falls back to `req.body`. An inherited content
 *    type parser consumes the stream, but the raw request keeps reporting
 *    `readable: true`, so the provider reads what is left, which is nothing, and
 *    answers `no client authentication mechanism provided` for every form post
 *    while JSON works. The request is therefore handed over with `readable`
 *    reflecting reality: untouched streams are passed through to be read, and
 *    anything Fastify already consumed is published as a parsed body instead.
 */
export async function registerOidcRoutes(
  app: FastifyInstance,
  provider: Provider,
): Promise<void> {
  const callback = provider.callback();

  await app.register(async (scope) => {
    scope.removeAllContentTypeParsers();
    // The body is kept as the exact bytes that arrived. The provider parses a
    // string directly, which is its most reliable path; handing it a stream it
    // believes is still readable, or an object it would re-encode, both lose the
    // client credentials.
    scope.addContentTypeParser(
      'application/x-www-form-urlencoded',
      { parseAs: 'string' },
      (_request, body, done) => done(null, body as string),
    );
    scope.addContentTypeParser(
      'application/json',
      { parseAs: 'string' },
      (_request, body, done) => done(null, body as string),
    );
    scope.addContentTypeParser('*', (_request, payload, done) => {
      // Not a body we know about: leave the stream untouched.
      done(null, payload);
    });

    for (const url of OIDC_ROUTE_PATHS) {
      scope.route({
        method: ['GET', 'POST'],
        url,
        handler: (request, reply) => {
          reply.hijack();
          // Koa has a boolean proxy setting. Enforce the narrower loopback trust
          // boundary before it sees forwarded headers from an external socket.
          const remote = request.raw.socket.remoteAddress;
          if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(remote ?? '')) {
            for (const name of ['x-forwarded-proto', 'x-forwarded-host', 'x-forwarded-for', 'x-forwarded-port']) delete request.raw.headers[name];
          }

          const body = request.body;
          if (isStream(body)) {
            // Nothing consumed the stream; give the provider the request as-is.
            return callback(request.raw, reply.raw);
          }

          // Fastify consumed it. The provider still reports the stream as
          // readable, so a proxy is handed over instead: same request through
          // its prototype, with `readable` corrected and the parsed body set.
          const delegated = Object.create(request.raw) as RawRequest & {
            readable: boolean;
            body?: unknown;
          };
          delegated.readable = false;
          delegated.body = toProviderBody(body);

          return callback(delegated, reply.raw);
        },
      });
    }
  });
}

function isStream(value: unknown): boolean {
  return typeof value === 'object' && value !== null && 'on' in value && 'pipe' in value;
}

/**
 * Restates whatever Fastify parsed into the shape the provider reconstructs from.
 *
 * The provider re-encodes an already-parsed body through querystring, so a
 * `URLSearchParams` instance would encode to nothing; a plain object of strings
 * survives that round trip, and JSON bodies are already what it expects.
 */
function toProviderBody(body: unknown): unknown {
  return body;
}
