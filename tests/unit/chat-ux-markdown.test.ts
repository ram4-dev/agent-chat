import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { MessageMarkdown, safeMessageUrl } from '../../apps/web/src/features/chat/MessageMarkdown';
const require = createRequire(new URL('../../apps/web/package.json', import.meta.url));
const { createElement } = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const render = (text: string): string => renderToStaticMarkup(createElement(MessageMarkdown, { text }));

describe('safe chat Markdown for both message authors', () => {
  it('renders bare web URLs, emphasis, lists and copyable fenced code', () => {
    const html = render('https://example.com\n\n**Detalle**\n\n- uno\n- dos\n\n```js\nconst value = 1;\n```');
    expect(html).toContain('href="https://example.com/"');
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).toContain('<strong>Detalle</strong>');
    expect(html).toContain('<li>uno</li>');
    expect(html).toContain('Copiar código');
    expect(html).toContain('<pre');
    expect(html).toContain('const value = 1;');
  });
  it('keeps raw HTML inert and never renders active links or remote images', () => {
    const html = render('<img src=x onerror=alert(1)>\n\n<script>alert(1)</script>\n\n[bad](javascript:alert%281%29) [data](data:text/html,x) [relative](/api/auth/logout) ![external](https://tracker.example/pixel)');
    expect(html).not.toMatch(/<script|<img|href="(?:javascript|data|\/api)/);
    expect(html).toContain('&lt;img');
    expect(html).toContain('&lt;script');
    expect(html).toContain('external');
  });
  it('allows only absolute http(s) links, including encoded attacks', () => {
    for (const input of ['javascript:alert(1)', 'java\nscript:alert(1)', 'data:text/html,<script>', '//evil.test', '/relative', 'mailto:a@example.com', 'javascript&#58;alert(1)']) {
      expect(safeMessageUrl(input)).toBeUndefined();
    }
    expect(safeMessageUrl('https://example.com/path?q=1')).toBe('https://example.com/path?q=1');
  });
});
