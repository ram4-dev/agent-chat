import { describe, expect, it } from 'vitest';
import {
  contentTypeFor,
  resolveStaticFile,
} from '../../apps/server/src/adapters/http/static-assets';

const root = '/srv/web/dist';

describe('resolveStaticFile', () => {
  it('resolves a nested asset inside the built client', () => {
    expect(resolveStaticFile(root, '/assets/index-abc123.js')).toBe(
      '/srv/web/dist/assets/index-abc123.js',
    );
  });

  it('maps the root request to the built index.html', () => {
    expect(resolveStaticFile(root, '/')).toBe('/srv/web/dist/index.html');
  });

  it('decodes percent-encoded segments before resolving', () => {
    expect(resolveStaticFile(root, '/assets/a%20b.js')).toBe('/srv/web/dist/assets/a b.js');
  });

  it('ignores a query string and a fragment', () => {
    expect(resolveStaticFile(root, '/assets/app.js?v=2#top')).toBe(
      '/srv/web/dist/assets/app.js',
    );
  });

  it.each([
    '/../secrets.env',
    '/assets/../../secrets.env',
    '/%2e%2e/secrets.env',
    '/assets/%2e%2e%2fsecrets.env',
    '/..\\secrets.env',
    '/assets/./../../secrets.env',
  ])('refuses to escape the built client for %s', (urlPath) => {
    expect(resolveStaticFile(root, urlPath)).toBeNull();
  });

  it('rejects malformed percent-encoding instead of guessing', () => {
    expect(resolveStaticFile(root, '/assets/%ZZ.js')).toBeNull();
  });

  it('rejects an embedded null byte', () => {
    expect(resolveStaticFile(root, '/assets/app%00.js')).toBeNull();
  });
});

describe('contentTypeFor', () => {
  it.each([
    ['index.html', 'text/html; charset=utf-8'],
    ['app-abc123.js', 'text/javascript; charset=utf-8'],
    ['app-abc123.css', 'text/css; charset=utf-8'],
    ['manifest.json', 'application/json; charset=utf-8'],
    ['logo.svg', 'image/svg+xml'],
    ['logo.png', 'image/png'],
    ['font.woff2', 'font/woff2'],
  ])('serves %s as %s', (fileName, expected) => {
    expect(contentTypeFor(fileName)).toBe(expected);
  });

  it('falls back to a non-executable type for an unknown extension', () => {
    expect(contentTypeFor('samples.sqlite')).toBe('application/octet-stream');
  });
});
