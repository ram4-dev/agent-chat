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
