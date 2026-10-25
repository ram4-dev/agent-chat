import { readFileSync } from "node:fs";
import Fastify from "fastify";
import { describe, expect, it } from "vitest";
import { registerAgentSkills } from "../../apps/server/src/adapters/http/agent-skills";

const origin = "https://chat.example.com";

describe("HTML docs alongside public agent contracts", () => {
  it("preserves canonical raw docs, schema, skills and discovery URLs byte for byte", async () => {
    const app = Fastify();
    registerAgentSkills(app, origin);
    try {
      const markdown = await app.inject("/docs/agent-api.md");
      expect(markdown.headers["content-type"]).toContain("text/markdown");
      expect(markdown.body).toBe(
        readFileSync("docs/agent-api.md", "utf8").replaceAll(
          "{{ORIGIN}}",
          origin,
        ),
      );
      const schema = await app.inject("/docs/openapi.json");
      expect(schema.headers["content-type"]).toContain("application/json");
      expect(schema.body).toBe(
        readFileSync("docs/openapi.json", "utf8").replaceAll(
          "{{ORIGIN}}",
          origin,
        ),
      );
      const skill = await app.inject("/skills/agent-chat/SKILL.md");
      expect(skill.body).toBe(
        readFileSync(
          ".agents/skills/agent-chat-setup/SKILL.md",
          "utf8",
        ).replaceAll("{{ORIGIN}}", origin),
      );
      expect((await app.inject("/skill.md")).body).toBe(skill.body);
      const participation = await app.inject(
        "/skills/agent-chat-participation/SKILL.md",
      );
      expect(participation.statusCode).toBe(200);
      expect(participation.headers["content-type"]).toContain("text/markdown");
      const discovery = (
        await app.inject("/.well-known/agent-chat.json")
      ).json();
      expect(discovery.docs_url).toBe(`${origin}/docs`);
      expect(discovery.api_docs_url).toBe(`${origin}/docs/agent-api.md`);
      expect(discovery.openapi_url).toBe(`${origin}/docs/openapi.json`);
      expect(discovery.mcp_url).toBe(`${origin}/mcp`);
    } finally {
      await app.close();
    }
  });

  it("serves a branded human guide and locally bundled assets under a restrictive CSP", async () => {
    const app = Fastify();
    registerAgentSkills(app, origin);
    try {
      const response = await app.inject("/docs");
      expect(response.statusCode).toBe(200);
      expect(response.headers["content-type"]).toContain("text/html");
      expect(response.headers["content-security-policy"]).toContain(
        "script-src 'self'",
      );
      expect(response.headers["content-security-policy"]).not.toContain(
        "unsafe-inline",
      );
      expect(response.body).toContain("Guías por tarea");
      expect(response.body).toContain("Volver a la app");
      for (const heading of readFileSync("docs/agent-api.md", "utf8").matchAll(
        /^## (.+)$/gm,
      )) {
        expect(response.body).toContain(`>${heading[1]}</h2>`);
        expect(response.body).toContain(`>${heading[1]}</a>`);
      }
      expect(response.body).not.toContain("{{ORIGIN}}");
      expect(response.body).toContain(`${origin}/mcp`);
      for (const [asset, contentType] of [
        ["css", "text/css"],
        ["js", "text/javascript"],
      ]) {
        const result = await app.inject(`/docs/assets/agent-docs.${asset}`);
        expect(result.statusCode).toBe(200);
        expect(result.headers["content-type"]).toContain(contentType);
        expect(result.headers["x-content-type-options"]).toBe("nosniff");
        expect(result.body).toBe(
          readFileSync(`docs/assets/agent-docs.${asset}`, "utf8"),
        );
      }
    } finally {
      await app.close();
    }
  });
});
