import { describe, expect, it } from "vitest";
import { renderDocs } from "../../apps/server/src/adapters/http/docs-renderer";

describe("public docs rendering", () => {
  it("renders task navigation, lists and code from the same source with unique anchors", () => {
    const result = renderDocs(
      '# Guía\n\n## Perfil\n\n1. `PATCH /agent/configuration/profile`: { nombre }.\n2. Guardar.\n\n## Perfil\n\n```json\n{"text":"<clave privada>"}\n```',
    );
    expect(result).toContain('<h1 id="guia-0">Guía</h1>');
    expect(result).toContain('<h2 id="perfil-1">Perfil</h2>');
    expect(result).toContain('<h2 id="perfil-3">Perfil</h2>');
    expect(result).toContain('<a href="#perfil-1">Perfil</a>');
    expect(result).toContain("PATCH /agent/configuration/profile</code>");
    expect(result).toContain("<li>Guardar.</li></ol>");
    expect(result).toContain(
      "{&quot;text&quot;:&quot;&lt;clave privada&gt;&quot;}",
    );
    expect(result).toContain('aria-label="Copiar ejemplo 1" hidden');
    expect(result).not.toContain("```");
  });

  it("keeps raw HTML, scripts, attributes and unsafe URLs inert in every content position", () => {
    const result = renderDocs(
      "# <img src=x onerror=alert(1)>\n\n<script>alert(1)</script>\n\n[bad](javascript:alert) [data](data:text/html,evil) [escaped](java&#x73;cript:alert) [protocol](//evil.example) [private](https://user:pass@example.com) [good](https://example.com/docs?q=a&v=b)\n\n1. `<svg onload=alert(1)>`\n\n```\n</code><script>alert(2)</script>\n```",
    );
    expect(result).not.toMatch(/<img|<svg|<script>alert/);
    expect(result).not.toMatch(
      /href="(?:javascript:|data:|\/\/evil|https:\/\/user:pass)/,
    );
    expect(result).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(result).toContain(
      "&lt;/code&gt;&lt;script&gt;alert(2)&lt;/script&gt;",
    );
    expect(result).toContain('href="https://example.com/docs?q=a&amp;v=b"');
  });

  it("does not fetch images or execute HTML from Markdown and stays readable without script", () => {
    const result = renderDocs(
      "# Doc\n\n![tracking](https://example.com/pixel)\n\n**Permisos** y `get_identity`.",
    );
    expect(result).not.toContain("<img");
    expect(result).toContain(
      "<strong>Permisos</strong> y <code>get_identity</code>",
    );
    expect(result).toContain('href="/docs/agent-api.md"');
    expect(result).not.toContain("https://cdn");
  });
});
