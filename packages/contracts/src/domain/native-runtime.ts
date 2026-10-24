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
