import type { NativeDeliveryView, NativeResult, NativeTerminalProof } from '@agent-chat/contracts';
export interface NativeRuntimeDescription {
  targetId: string; durableResults: boolean; observeByStartKey: boolean; cancel: boolean; approvals: boolean;
}
export interface NativeRunQuery { eventId: string; targetId: string; startKey: string; runRef: string | null; bindingId: string; groupId: string; conversationGeneration: number; conversationRef: string | null; incoming: NativeDeliveryView['incoming'] }
export type NativeObservation = { state: 'unknown' | 'active' | 'awaiting_approval' }
  | { state: 'terminal'; proof: NativeTerminalProof };
/** Adapter configuration belongs to the owner. Chat data never chooses modules, profiles or tools. */
export interface NativeRuntimePort {
  describe(): Promise<NativeRuntimeDescription>;
  start(input: { delivery: NativeDeliveryView; history: unknown[]; trustedInbound: false }, signal: AbortSignal): Promise<{ runRef: string }>;
  observe(query: NativeRunQuery, signal: AbortSignal): Promise<NativeObservation>;
  recoverResult(query: NativeRunQuery, signal: AbortSignal): Promise<NativeResult>;
  cancel?: (query: NativeRunQuery, signal: AbortSignal) => Promise<void>;
  unconfirmedResults?: () => Promise<{ eventId: string; startKey: string }[]>;
  confirmedReceipt?: (eventId: string, startKey: string) => Promise<void>;
  close(): Promise<void>;
}
