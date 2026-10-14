import { isAbsolute, relative, resolve } from 'node:path';

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

const DEFAULT_CONTENT_TYPE = 'application/octet-stream';

/**
 * Maps a request path to a file inside the built web client.
 *
 * Returns `null` for anything that would leave the client directory: parent
 * segments, backslashes, embedded null bytes, and malformed percent-encoding.
 * The caller answers a rejected path with a plain not-found response.
 */
export function resolveStaticFile(root: string, urlPath: string): string | null {
  const pathOnly = urlPath.split('?')[0]?.split('#')[0] ?? '';

  let decoded: string;
  try {
    decoded = decodeURIComponent(pathOnly);
  } catch {
    return null;
  }

  if (decoded.includes('\\') || decoded.includes('\0')) {
    return null;
  }

  const segments = decoded.split('/').filter((segment) => segment.length > 0);
  if (segments.some((segment) => segment === '..' || segment === '.')) {
    return null;
  }

  const candidate = segments.length === 0 ? resolve(root, 'index.html') : resolve(root, ...segments);

  const relativePath = relative(root, candidate);
  if (relativePath === '' || relativePath.startsWith('..') || isAbsolute(relativePath)) {
    return null;
  }

  return candidate;
}

/** Content type for a built asset, defaulting to a non-executable type. */
export function contentTypeFor(fileName: string): string {
  const extension = fileName.slice(fileName.lastIndexOf('.')).toLowerCase();
  return CONTENT_TYPES[extension] ?? DEFAULT_CONTENT_TYPE;
}
