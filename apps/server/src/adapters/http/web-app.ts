import { createReadStream, existsSync, statSync } from 'node:fs';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { sendNotFound } from './error-envelope.js';
import { contentTypeFor, resolveStaticFile } from './static-assets.js';

export interface WebAppOptions {
  /** Absolute path of the built web client. */
  webDistDir: string;
}

/**
 * Serves the built web client from the same origin as the API. Requests that do
 * not map to a file inside the build answer with the shared not-found envelope
 * instead of leaking filesystem state.
 */
export function registerWebApp(app: FastifyInstance, options: WebAppOptions): void {
  app.get('/', (_request, reply) => sendBuiltFile(reply, options.webDistDir, '/'));
  app.get('/*', (request, reply) =>
    sendBuiltFile(reply, options.webDistDir, request.url),
  );
}

function sendBuiltFile(
  reply: FastifyReply,
  webDistDir: string,
  urlPath: string,
): FastifyReply {
  const filePath = resolveStaticFile(webDistDir, urlPath);

  if (filePath === null || !isFile(filePath)) {
    return sendNotFound(reply);
  }

  reply.header('content-type', contentTypeFor(filePath));
  return reply.send(createReadStream(filePath));
}

function isFile(filePath: string): boolean {
  try {
    return existsSync(filePath) && statSync(filePath).isFile();
  } catch {
    return false;
  }
}
