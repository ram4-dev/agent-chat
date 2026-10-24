import { describe, expect, it } from 'vitest';
import type { NativeStatusView } from '@agent-chat/contracts';
import { nativeJobLabel, nativeStatusLabel } from '../../apps/web/src/features/agents/NativeAutomationPanel';
const job: NativeStatusView['jobs'][number] = { eventId: 'event', state: 'running', started: true, providerStarted: false, input: 'Hello', output: null, decision: null, receipt: null, contentExpired: false, runRef: null, conversationRef: null, createdAt: 1, completedAt: null };
const state: NativeStatusView = { binding: { id: 'binding', revision: 1, enabled: true }, target: { provider: 'grok_bot', connectorId: 'connector', nativeRef: 'bot', contextMode: 'shared_bot_context', capabilities: { groupIsolation: 'unknown', durableResults: 'unknown', approvals: 'unknown', toolCatalog: 'unknown', nativeVisibility: 'unknown' }, verifiedAt: null }, group: { id: 'group', covered: true }, controller: { presence: 'recent', authorized: true, lastContactAt: 1 }, blockedElsewhere: false, observedAt: 1, jobs: [] };
describe('native status wording', () => {
  it('does not treat contact or accepted notification as completed processing', () => {
    expect(nativeStatusLabel(state)).toBe('Controlador con señal reciente');
    expect(nativeStatusLabel({ ...state, jobs: [job] })).toBe('Notificación aceptada; inicio del bot pendiente');
    expect(nativeStatusLabel({ ...state, jobs: [{ ...job, providerStarted: true }] })).toBe('Procesamiento autorizado; resultado pendiente');
  });
  it('keeps unknown starts and pauses visible', () => {
    expect(nativeStatusLabel({ ...state, jobs: [{ ...job, state: 'start_uncertain' }] })).toBe('Inicio pendiente de confirmar');
    expect(nativeStatusLabel({ ...state, binding: { ...state.binding, enabled: false } })).toBe('Respuestas nativas pausadas');
    expect(nativeStatusLabel({ ...state, group: { ...state.group, covered: false } })).toBe('Este grupo no está habilitado para este receptor');
  });
  it.each([
    ['start_uncertain', 'Inicio pendiente de confirmar'],
    ['running', 'Procesamiento autorizado; resultado pendiente'],
    ['cancel_requested', 'Cancelación pendiente de verificar'],
  ])('preserves %s while paused in both summary and activity', (pending, label) => {
    const active = { ...job, state: pending, providerStarted: true };
    expect(nativeStatusLabel({ ...state, binding: { ...state.binding, enabled: false }, jobs: [active] })).toBe(label);
    expect(nativeJobLabel(active)).toBe(label);
  });
  it('requires a publication receipt with a message id', () => {
    expect(nativeJobLabel({ ...job, state: 'done', decision: 'reply' })).toBe('Finalizado sin recibo disponible');
    expect(nativeJobLabel({ ...job, receipt: { disposition: 'published', messageId: null } })).not.toBe('Respuesta publicada');
    expect(nativeJobLabel({ ...job, receipt: { disposition: 'published', messageId: 'message' } })).toBe('Respuesta publicada');
    expect(nativeJobLabel({ ...job, receipt: { disposition: 'suppressed', messageId: null } })).toBe('Confirmado sin publicar');
    expect(nativeJobLabel({ ...job, receipt: { disposition: 'no_reply', messageId: null } })).toBe('Sin respuesta');
  });
});
