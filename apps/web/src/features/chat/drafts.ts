import { useSyncExternalStore } from 'react';
import type { Mention } from './mentions';

export interface ChatDraft {
  text: string;
  mentions: readonly Mention[];
  revision: number;
  sending: boolean;
}
interface PendingSend { text: string; ids: string[]; key: string }
interface Entry { value: ChatDraft; pending?: PendingSend }
const empty: ChatDraft = { text: '', mentions: [], revision: 0, sending: false };
const users = new Map<string, Map<string, Entry>>();
const listeners = new Set<() => void>();
function notify() { for (const listener of listeners) listener(); }
function entry(userId: string, groupId: string): Entry {
  let groups = users.get(userId);
  if (!groups) { groups = new Map(); users.set(userId, groups); }
  let draft = groups.get(groupId);
  if (!draft) { draft = { value: empty }; groups.set(groupId, draft); }
  return draft;
}
export function getDraft(userId: string, groupId: string): ChatDraft {
  return users.get(userId)?.get(groupId)?.value ?? empty;
}
export function updateDraft(userId: string, groupId: string, text: string, mentions: readonly Mention[]) {
  const draft = entry(userId, groupId);
  draft.value = { ...draft.value, text, mentions, revision: draft.value.revision + 1 };
  notify();
}
export function discardDraft(userId: string, groupId: string) {
  const draft = entry(userId, groupId);
  delete draft.pending;
  draft.value = { ...empty, sending: draft.value.sending, revision: draft.value.revision + 1 };
  notify();
}
/** Call after confirmed logout, and when an authenticated session expires. */
export function clearUserDrafts(userId: string) {
  users.delete(userId);
  notify();
}
export function useChatDraft(userId: string, groupId: string): ChatDraft {
  return useSyncExternalStore(
    listener => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    () => getDraft(userId, groupId),
    () => empty,
  );
}

/** A failed or uncertain send retains its key across route unmounts. */
export async function submitDraft(
  userId: string, groupId: string, ids: string[],
  send: (text: string, ids: string[], key: string) => Promise<boolean>,
): Promise<boolean> {
  const draft = entry(userId, groupId);
  const snapshot = draft.value;
  if (snapshot.sending || !snapshot.text.trim()) return false;
  const same = draft.pending?.text === snapshot.text && JSON.stringify(draft.pending.ids) === JSON.stringify(ids);
  const pending = same ? draft.pending! : { text: snapshot.text, ids, key: crypto.randomUUID() };
  draft.pending = pending;
  draft.value = { ...snapshot, sending: true };
  notify();
  let sent = false;
  try { sent = await send(snapshot.text, ids, pending.key); return sent; }
  catch { return false; }
  finally {
    // Clearing a session invalidates this entry, including late network responses.
    if (users.get(userId)?.get(groupId) === draft) {
      if (sent) delete draft.pending;
      const unchanged = draft.value.revision === snapshot.revision;
      draft.value = sent && unchanged
        ? { ...empty, revision: snapshot.revision + 1 }
        : { ...draft.value, sending: false };
      notify();
    }
  }
}
