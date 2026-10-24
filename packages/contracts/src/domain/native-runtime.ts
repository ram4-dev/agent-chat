import type { MessageView } from '../http/messages.js';
export const NATIVE_PROVIDERS = ['legacy_codex', 'codex', 'hermes', 'grok_bot'] as const;
export type NativeProvider = typeof NATIVE_PROVIDERS[number];
export type NativeContextMode = 'native_per_group' | 'shared_bot_context' | 'unsupported';
export type CapabilityStatus = 'unknown' | 'verified' | 'unsupported';
export interface NativeCapabilities {
  groupIsolation: CapabilityStatus;
  durableResults: CapabilityStatus;
  approvals: CapabilityStatus;
  toolCatalog: CapabilityStatus;
  nativeVisibility: CapabilityStatus;
}
export interface NativeRuntimeTarget {
  id: string; ownerUserId: string; provider: NativeProvider; connectorId: string;
  nativeRef: string; contextMode: NativeContextMode; capabilities: NativeCapabilities; verifiedAt: number | null;
}
export interface NativeBinding {
  id: string; agentId: string; ownerUserId: string; targetId: string; revision: number;
  enabled: boolean; legacyProjection: boolean;
}
export const UNKNOWN_NATIVE_CAPABILITIES: Readonly<NativeCapabilities> = Object.freeze({
  groupIsolation: 'unknown', durableResults: 'unknown', approvals: 'unknown', toolCatalog: 'unknown', nativeVisibility: 'unknown',
});

export const NATIVE_READ_SCOPE = 'native:read' as const;
export const NATIVE_AUTOMATIC_SCOPES = ['native:read', 'native:claim', 'native:start', 'native:complete'] as const;
export const NATIVE_INTERACTIVE_SCOPES = ['native:read', 'native:send'] as const;
export type NativeScope = typeof NATIVE_AUTOMATIC_SCOPES[number] | typeof NATIVE_INTERACTIVE_SCOPES[number];
export interface NativeSelection { agentId: string; groupIds: string[] }
export type NativeConsent = {
  connectionId: string; scopes: NativeScope[];
} & ({ kind: 'automatic'; bindingId: string; revision: number; targetId: string }
  | { kind: 'interactive'; selections: NativeSelection[] });
export interface NativeGrant {
  id: string; connectionId: string; ownerUserId: string; kind: 'automatic' | 'interactive';
  bindingId: string | null; revision: number | null; targetId: string | null;
  scopes: NativeScope[]; selections: NativeSelection[];
}

export interface NativeResult { decision: 'reply' | 'no_reply'; text: string; conversationRef: string }
export interface NativeTerminalData {
  eventId: string; targetId: string; startKey: string; runRef: string;
  terminal: 'completed' | 'cancelled'; resultHash: string | null;
}
export interface NativeTerminalProof { data: NativeTerminalData; signature: string }
export const nativeResultPayload = (r: NativeResult): string => JSON.stringify([r.decision, r.text, r.conversationRef]);
export const nativeProofPayload = (d: NativeTerminalData): string => JSON.stringify([1, d.eventId, d.targetId, d.startKey, d.runRef, d.terminal, d.resultHash]);
export interface NativeTicket { eventId: string; claim: string; epoch: number; controllerId: string }
export interface NativeDeliveryView {
  ticket: NativeTicket; bindingRevision: number; bindingId: string; targetId: string; groupId: string; agentId: string;
  conversationGeneration: number; state: string; started: boolean; cancelStarted: boolean; startKey: string; runRef: string | null; conversationRef: string | null;
  incoming: MessageView | null; result: NativeResult | null; receipt: { disposition: 'published' | 'no_reply' | 'suppressed'; messageId: string | null } | null;
}

export interface NativeAgentSummary { bindingId: string; revision: number; provider: NativeProvider; enabled: boolean }
export interface NativeStatusView {
  binding: { id: string; revision: number; enabled: boolean };
  target: Pick<NativeRuntimeTarget, 'provider' | 'connectorId' | 'nativeRef' | 'contextMode' | 'capabilities' | 'verifiedAt'>;
  group: { id: string; covered: boolean };
  controller: { presence: 'recent' | 'stale' | 'unknown'; authorized: boolean; lastContactAt: number | null };
  blockedElsewhere: boolean;
  observedAt: number;
  jobs: { eventId: string; state: string; started: boolean; providerStarted: boolean; input: string | null; output: string | null;
    decision: NativeResult['decision'] | null; receipt: NativeDeliveryView['receipt']; contentExpired: boolean;
    runRef: string | null; conversationRef: string | null; createdAt: number; completedAt: number | null }[];
}
