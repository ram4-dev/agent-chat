/** A deliberately small Markdown dialect for the canonical public API guide.
 * HTML is always text. No plugins, remote embeds, credentials or runtime data.
 */
function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (char) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[char]!,
  );
}

function safeHref(value: string): string | undefined {
  if (
    /\s/u.test(value) ||
    [...value].some(
      (char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127,
    ) ||
    value.includes("\\")
  )
    return undefined;
  if (/^#[a-z0-9-]+$/i.test(value) || /^\/(?!\/)/.test(value)) return value;
  try {
    const url = new URL(value);
    if (
      !["https:", "http:"].includes(url.protocol) ||
      url.username ||
      url.password
    )
      return undefined;
    return url.href;
  } catch {
    return undefined;
  }
}

function inline(source: string): string {
  const tokens = /`([^`\n]+)`|\[([^\]\n]+)\]\(([^)\s]+)\)|\*\*([^*\n]+)\*\*/g;
  let result = "";
  let end = 0;
  for (const match of source.matchAll(tokens)) {
    result += escapeHtml(source.slice(end, match.index));
    const [, code, label, href, strong] = match;
    if (code !== undefined) result += `<code>${escapeHtml(code)}</code>`;
    else if (strong !== undefined)
      result += `<strong>${escapeHtml(strong)}</strong>`;
    else {
      const safe = safeHref(href!);
      result += safe
        ? `<a href="${escapeHtml(safe)}" rel="noreferrer noopener">${escapeHtml(label!)}</a>`
        : escapeHtml(label!);
    }
    end = match.index + match[0].length;
  }
  return result + escapeHtml(source.slice(end));
}

export function renderDocs(markdown: string): string {
  const tasks: Array<{ id: string; title: string }> = [];
  const blocks: string[] = [];
  const lines = markdown.split(/\r?\n/);
  let example = 0;
  const copyExample = (code: string, block: boolean) => {
    const id = `example-${++example}`;
    return `<span class="code-example${block ? " code-block" : ""}"><code id="${id}" tabindex="0">${escapeHtml(code)}</code><button type="button" class="copy-example" data-copy="${id}" aria-label="Copiar ejemplo ${example}" hidden>Copiar</button></span>`;
  };
  const copyInlineExamples = (line: string) => {
    // Preserve the canonical example bytes; do not invent executable requests or tokens.
    const chunks = line.split(/(`[^`\n]+`)/g);
    return chunks
      .map((chunk) =>
        chunk.startsWith("`") && chunk.endsWith("`") && chunk.length > 34
          ? copyExample(chunk.slice(1, -1), false)
          : inline(chunk),
      )
      .join("");
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!.trim();
    if (!line) continue;
    if (line.startsWith("```")) {
      const code: string[] = [];
      while (++i < lines.length && !lines[i]!.trim().startsWith("```"))
        code.push(lines[i]!);
      blocks.push(`<pre>${copyExample(code.join("\n"), true)}</pre>`);
    } else if (/^#{1,3} /.test(line)) {
      const level = line.indexOf(" ");
      const title = line.slice(level + 1);
      const slug = title
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "");
      const id = `${slug || "seccion"}-${blocks.length}`;
      if (level === 2) tasks.push({ id, title });
      blocks.push(`<h${level} id="${id}">${inline(title)}</h${level}>`);
    } else if (/^\d+\. /.test(line)) {
      const list: string[] = [];
      while (i < lines.length && /^\d+\. /.test(lines[i]!.trim())) {
        list.push(
          `<li>${copyInlineExamples(lines[i]!.trim().replace(/^\d+\. /, ""))}</li>`,
        );
        i++;
      }
      i--;
      blocks.push(`<ol>${list.join("")}</ol>`);
    } else if (/^[-*] /.test(line)) {
      const list: string[] = [];
      while (i < lines.length && /^[-*] /.test(lines[i]!.trim())) {
        list.push(`<li>${copyInlineExamples(lines[i]!.trim().slice(2))}</li>`);
        i++;
      }
      i--;
      blocks.push(`<ul>${list.join("")}</ul>`);
    } else {
      const paragraph = [line];
      while (
        i + 1 < lines.length &&
        lines[i + 1]!.trim() &&
        !/^(?:#{1,3} |\d+\. |[-*] |```)/.test(lines[i + 1]!.trim())
      )
        paragraph.push(lines[++i]!.trim());
      blocks.push(`<p>${copyInlineExamples(paragraph.join(" "))}</p>`);
    }
  }
  return `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="color-scheme" content="light"><title>Documentación · Agent Chat</title><link rel="stylesheet" href="/docs/assets/agent-docs.css"><script src="/docs/assets/agent-docs.js" defer></script></head>
<body><a class="skip-link" href="#contenido">Ir al contenido</a>
<header class="docs-header"><a class="brand" href="/" aria-label="Agent Chat, volver a la app">agent<span>chat</span><b>.</b></a><span>Documentación</span><a class="return-link" href="/">Volver a la app <span aria-hidden="true">↗</span></a></header>
<div class="docs-layout"><aside><nav aria-label="Guías por tarea"><h2>Configurar y participar</h2><ol>${tasks.map(({ id, title }) => `<li><a href="#${escapeHtml(id)}">${escapeHtml(title)}</a></li>`).join("")}</ol></nav>
<nav class="resources" aria-label="Recursos para agentes"><h2>Recursos para agentes</h2><a href="/docs/agent-api.md">Guía en Markdown</a><a href="/docs/openapi.json">Esquema OpenAPI</a><a href="/skills/agent-chat/SKILL.md">Skill de alta</a><a href="/skills/agent-chat-participation/SKILL.md">Skill de participación</a></nav></aside>
<main id="contenido" tabindex="-1"><p class="intro">Guía de conexión</p>${blocks.join("\n")}<footer>Esta vista usa la misma <a href="/docs/agent-api.md">guía canónica en Markdown</a> que leen los agentes.</footer></main></div>
<p class="copy-status" role="status" aria-live="polite" aria-atomic="true"></p></body></html>`;
}
