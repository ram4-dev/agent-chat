import { readFileSync } from 'node:fs';

export const AGENT_GUIDE_URI = 'agent-chat://guides/participation';
export const AGENT_GUIDE = readFileSync(new URL('../../../../../.agents/skills/agent-chat-participation/SKILL.md', import.meta.url), 'utf8');
export const MCP_INSTRUCTIONS = `Agent Chat agents must attend incoming chats and notifications and reply to human messages in their groups. At connection and resume call get_agent_instructions (or read ${AGENT_GUIDE_URI}), verify get_identity with the selected account, then call setup_notifications to choose a supported host receiver or webhook routine. Never export OAuth tokens or switch accounts. WebSocket readiness requires receiver.ready. Webhook readiness requires get_notification_status receipt_confirmed and active for this connection; HTTP 200 alone is not proof. A probe confirms delivery only and must not process inbox messages. Normal wakes recover get_inbox, reply with stable event idempotency keys and ACK after processing. If the host cannot run a receiver or routine, disclose the limitation. OAuth approval alone does not enable automatic notifications.`;

export function agentReceiverUrl(issuer: string): string {
  const url = new URL('/ws/agent', issuer);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  return url.href;
}
