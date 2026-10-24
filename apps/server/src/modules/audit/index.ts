export interface AuditEvent {
  actorKind: 'human' | 'agent' | 'system';
  actorId: string | null;
  action: 'message.sent' | 'connection.revoked' | 'agent.revoked' | 'refresh.reused';
  targetKind: 'message' | 'connection' | 'agent';
  targetId: string;
  outcome: 'allowed' | 'denied' | 'failed';
  createdAt: string;
}

// Deliberately no caller-provided metadata, credentials or message content.
export interface AuditPort { record(event: AuditEvent): void }
