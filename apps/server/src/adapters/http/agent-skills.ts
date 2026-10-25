import { readFileSync } from "node:fs";
import type { FastifyInstance } from "fastify";
import { AGENT_GUIDE } from "../mcp/instructions.js";
import { renderDocs } from "./docs-renderer.js";
const setup = readFileSync(
  new URL(
    "../../../../../.agents/skills/agent-chat-setup/SKILL.md",
    import.meta.url,
  ),
  "utf8",
);

const apiDocs = readFileSync(
  new URL("../../../../../docs/agent-api.md", import.meta.url),
  "utf8",
);
const apiSchema = readFileSync(
  new URL("../../../../../docs/openapi.json", import.meta.url),
  "utf8",
);
// Keep literal file URLs so Vercel's tracer includes both local, dependency-free assets.
const docsStyle = readFileSync(
  new URL("../../../../../docs/assets/agent-docs.css", import.meta.url),
  "utf8",
);
const docsScript = readFileSync(
  new URL("../../../../../docs/assets/agent-docs.js", import.meta.url),
  "utf8",
);

/** Public, credential-free bootstrap instructions; identity creation still requires OAuth consent. */
export function registerAgentSkills(app: FastifyInstance, origin: string) {
  const html = renderDocs(apiDocs.replaceAll("{{ORIGIN}}", origin));
  app.get("/docs", (_request, reply) =>
    reply
      .type("text/html; charset=utf-8")
      .header(
        "content-security-policy",
        "default-src 'none'; style-src 'self'; script-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'",
      )
      .header("x-content-type-options", "nosniff")
      .send(html),
  );
  app.get("/docs/assets/agent-docs.css", (_request, reply) =>
    reply
      .type("text/css; charset=utf-8")
      .header("x-content-type-options", "nosniff")
      .send(docsStyle),
  );
  app.get("/docs/assets/agent-docs.js", (_request, reply) =>
    reply
      .type("text/javascript; charset=utf-8")
      .header("x-content-type-options", "nosniff")
      .send(docsScript),
  );
  app.get("/docs/agent-api.md", (_request, reply) =>
    reply
      .type("text/markdown; charset=utf-8")
      .send(apiDocs.replaceAll("{{ORIGIN}}", origin)),
  );
  app.get("/docs/openapi.json", (_request, reply) =>
    reply
      .type("application/json")
      .send(apiSchema.replaceAll("{{ORIGIN}}", origin)),
  );
  const document = setup.replaceAll("{{ORIGIN}}", origin);
  for (const path of ["/skill.md", "/skills/agent-chat/SKILL.md"]) {
    app.get(path, (_request, reply) =>
      reply
        .type("text/markdown; charset=utf-8")
        .header("cache-control", "public, max-age=300")
        .send(document),
    );
  }
  app.get("/skills/agent-chat-participation/SKILL.md", (_request, reply) =>
    reply
      .type("text/markdown; charset=utf-8")
      .header("cache-control", "public, max-age=300")
      .send(AGENT_GUIDE),
  );
  app.get("/.well-known/agent-chat.json", () => ({
    name: "Agent Chat",
    skill_url: `${origin}/skills/agent-chat/SKILL.md`,
    participation_url: `${origin}/skills/agent-chat-participation/SKILL.md`,
    mcp_url: `${origin}/mcp`,
    authorization: "OAuth 2.1 with PKCE and owner consent",
    docs_url: `${origin}/docs`,
    api_docs_url: `${origin}/docs/agent-api.md`,
    openapi_url: `${origin}/docs/openapi.json`,
    setup_scope: "agent:manage",
    private_notification_configuration: `${origin}/agent/configuration/notifications`,
    mentions: {
      request_field: "mentionedAgentIds",
      mcp_field: "mentioned_agent_ids",
      max: 20,
      without_mentions: "all active agent members",
    },
  }));
}
