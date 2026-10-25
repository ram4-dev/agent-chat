import { describe, expect, it } from 'vitest';
import type { OwnedAgentView } from '@agent-chat/contracts';
import { agentSetupState, connectionName } from '../../apps/web/src/features/agents/setup-state';
import { notificationHostInstructions, notificationStatusLabel } from '../../apps/web/src/features/agents/NotificationSettings';

const connection = { id: 'connection', oauthClientId: 'oauth-12345678', clientName: 'Research Desktop', scopes: ['agent:read'], revokedAt: null, createdAt: '2026-10-25T10:00:00Z' };
const agent: OwnedAgentView = { id: 'agent', name: 'Scout', description: '', avatarUrl: null, status: 'active', receiverConnected: false, connections: [] };
describe('observed agent setup', () => {
  it('keeps identity, consent, receipt and group admission independent', () => {
    expect(agentSetupState()).toEqual({ identity: false, authorized: false, notifications: false, admitted: false });
    expect(agentSetupState(agent)).toEqual({ identity: true, authorized: false, notifications: false, admitted: false });
    expect(agentSetupState({ ...agent, receiverConnected: true, connections: [connection] })).toEqual({ identity: true, authorized: true, notifications: false, admitted: false });
    expect(agentSetupState({ ...agent, connections: [connection], notificationActive: true }, ['agent'])).toEqual({ identity: true, authorized: true, notifications: true, admitted: true });
    expect(agentSetupState({ ...agent, notificationActive: true, connections: [{ ...connection, revokedAt: 'now' }] }).notifications).toBe(false);
    expect(agentSetupState({ ...agent, status: 'revoked', connections: [connection], notificationActive: true }, ['agent'])).toEqual({ identity: false, authorized: false, notifications: false, admitted: false });
  });
  it('names actual applications and gives legacy connections a stable fallback', () => {
    expect(connectionName(connection)).toBe('Research Desktop');
    expect(connectionName({ ...connection, clientName: '  ' })).toBe('Aplicación MCP sin nombre (12345678)');
    expect(connectionName({ ...connection, clientName: null })).toContain('12345678');
  });
  it('uses host-specific instructions and requires a receipt before claiming active delivery', () => {
    expect(notificationHostInstructions('grokbot')).toContain('Grok Bot');
    expect(notificationHostInstructions('generic')).not.toContain('Grok');
    expect(notificationStatusLabel({ available: true, active: true, configured: true, receipt_confirmed: false })).toContain('esperando');
    expect(notificationStatusLabel({ available: true, active: true, receipt_confirmed: true })).toContain('recepción confirmada');
    expect(notificationStatusLabel({ available: true, active: false, reason: 'paused' })).toContain('pausados');
    expect(notificationStatusLabel({ available: true, active: false, needs_attention: true })).toContain('revisión');
    expect(notificationStatusLabel({ available: true, active: false, reason: 'authorization_required' })).toContain('Reconectá');
  });
});
