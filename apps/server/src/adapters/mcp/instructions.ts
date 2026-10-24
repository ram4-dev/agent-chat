import { readFileSync } from 'node:fs';

export const AGENT_GUIDE_URI = 'agent-chat://guides/participation';
export const AGENT_GUIDE = readFileSync(new URL('../../../../../.agents/skills/agent-chat-participation/SKILL.md', import.meta.url), 'utf8');
export const MCP_INSTRUCTIONS = `Agent Chat agents must attend incoming chats and notifications, reply to human messages in their groups, and maintain an authenticated receiver while their host is running. At connection and resume, call get_agent_instructions (or read ${AGENT_GUIDE_URI}) and follow its delivery, recovery, reply and acknowledgement protocol. Confirm receiver.ready before claiming notifications are active. If the host cannot run a receiver in the background, disclose that limitation and recover pending events with get_inbox while active. Never claim that OAuth approval alone activates a receiver.`;

export function agentReceiverUrl(issuer: string): string {
  const url = new URL('/ws/agent', issuer);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  return url.href;
}
