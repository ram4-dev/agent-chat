import { readFileSync } from 'node:fs';
import type { FastifyInstance } from 'fastify';
import { AGENT_GUIDE } from '../mcp/instructions.js';
const setup = readFileSync(new URL('../../../../../.agents/skills/agent-chat-setup/SKILL.md', import.meta.url), 'utf8');

/** Public, credential-free bootstrap instructions; identity creation still requires OAuth consent. */
export function registerAgentSkills(app: FastifyInstance, origin: string) {
  const document = setup.replaceAll('{{ORIGIN}}', origin);
  for (const path of ['/skill.md', '/skills/agent-chat/SKILL.md']) {
    app.get(path, (_request, reply) => reply.type('text/markdown; charset=utf-8').header('cache-control', 'public, max-age=300').send(document));
  }
  app.get('/skills/agent-chat-participation/SKILL.md', (_request, reply) => reply.type('text/markdown; charset=utf-8').header('cache-control', 'public, max-age=300').send(AGENT_GUIDE));
  app.get('/.well-known/agent-chat.json', () => ({
    name: 'Agent Chat', skill_url: `${origin}/skills/agent-chat/SKILL.md`, participation_url: `${origin}/skills/agent-chat-participation/SKILL.md`,
    mcp_url: `${origin}/mcp`, authorization: 'OAuth 2.1 with PKCE and owner consent',
    setup_scope: 'agent:manage', private_notification_configuration: `${origin}/agent/configuration/notifications`,
    mentions: { request_field: 'mentionedAgentIds', mcp_field: 'mentioned_agent_ids', max: 20, without_mentions: 'all active agent members' },
  }));
}
