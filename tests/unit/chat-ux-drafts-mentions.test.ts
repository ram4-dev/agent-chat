import { afterEach, describe, expect, it } from 'vitest';
import { clearUserDrafts, discardDraft, getDraft, submitDraft, updateDraft } from '../../apps/web/src/features/chat/drafts';
import { mentionQuery, mentionStarts, reconcileMentions, unresolvedMentions, type Mention } from '../../apps/web/src/features/chat/mentions';

const mention: Mention = { id: 'bot-exact-id', name: 'Analista', start: 0, end: 9 };
afterEach(() => { clearUserDrafts('ada'); clearUserDrafts('grace'); });
describe('session drafts with exact mention identity', () => {
  it('isolates group and user snapshots and restores text plus selected IDs', () => {
    updateDraft('ada', 'one', '@Analista propuesta', [mention]);
    updateDraft('ada', 'two', 'Otro grupo', []);
    expect(getDraft('grace', 'one').text).toBe('');
    expect(getDraft('ada', 'one').mentions).toEqual([mention]);
    expect(getDraft('ada', 'two').text).toBe('Otro grupo');
    clearUserDrafts('ada');
    expect(getDraft('ada', 'one').text).toBe('');
  });
  it('retains failed text and the same idempotency key when retried after navigation', async () => {
    updateDraft('ada', 'one', '@Analista propuesta', [mention]);
    const keys: string[] = [];
    await submitDraft('ada', 'one', [mention.id], async (text, ids, key) => {
      expect(text).toBe('@Analista propuesta'); expect(ids).toEqual([mention.id]); keys.push(key); return false;
    });
    expect(getDraft('ada', 'one').text).toBe('@Analista propuesta');
    await submitDraft('ada', 'one', [mention.id], async (_text, _ids, key) => { keys.push(key); return true; });
    expect(keys[0]).toBe(keys[1]);
    expect(getDraft('ada', 'one').text).toBe('');
  });
  it('starts a new intentional send after explicitly discarding an uncertain snapshot', async () => {
    const keys: string[] = [];
    const send = async (_text: string, _ids: string[], key: string) => { keys.push(key); return false; };
    updateDraft('ada', 'one', 'Igual contenido', []);
    await submitDraft('ada', 'one', [], send);
    discardDraft('ada', 'one'); updateDraft('ada', 'one', 'Igual contenido', []);
    await submitDraft('ada', 'one', [], send);
    expect(keys[0]).not.toBe(keys[1]);
  });
  it('preserves edits made during an async send, even when edited back to the sent text', async () => {
    updateDraft('ada', 'one', 'Snapshot', []);
    let finish!: (sent: boolean) => void;
    const sending = submitDraft('ada', 'one', [], () => new Promise(resolve => { finish = resolve; }));
    expect(getDraft('ada', 'one').sending).toBe(true);
    updateDraft('ada', 'one', 'Nueva edición', []);
    updateDraft('ada', 'one', 'Snapshot', []);
    finish(true); await sending;
    expect(getDraft('ada', 'one').text).toBe('Snapshot');
    expect(getDraft('ada', 'one').sending).toBe(false);
  });
  it('does not resurrect a cleared session on late completion or overwrite a new session', async () => {
    updateDraft('ada', 'one', 'Vieja sesión', []);
    let finish!: (sent: boolean) => void;
    const sending = submitDraft('ada', 'one', [], () => new Promise(resolve => { finish = resolve; }));
    clearUserDrafts('ada'); updateDraft('ada', 'one', 'Nueva sesión', []);
    finish(true); await sending;
    expect(getDraft('ada', 'one').text).toBe('Nueva sesión');
  });
  it('keeps failed exceptions and rejects concurrent submissions', async () => {
    updateDraft('ada', 'one', 'Texto', []);
    await submitDraft('ada', 'one', [], async () => { throw new Error('offline'); });
    let finish!: (sent: boolean) => void;
    const sending = submitDraft('ada', 'one', [], () => new Promise(resolve => { finish = resolve; }));
    let called = false;
    expect(await submitDraft('ada', 'one', [], async () => { called = true; return true; })).toBe(false);
    expect(called).toBe(false); finish(false); await sending;
    expect(getDraft('ada', 'one').text).toBe('Texto');
  });
});

describe('mention intent and identity after edits', () => {
  it('does not guess an ID from a typed name or a second identical occurrence', () => {
    expect(unresolvedMentions('@Analista revisá esto', [])).toEqual([0]);
    expect(unresolvedMentions('@Analista @Analista', [mention])).toEqual([10]);
    expect(mentionQuery('@Analista', 9, [])?.text).toBe('Analista');
    expect(mentionQuery('@Analista hola', 14, [mention])).toBeUndefined();
  });
  it('retains the chosen duplicate-name IDs only for unchanged spans', () => {
    const second = { ...mention, id: 'second-id', start: 10, end: 19 };
    const before = '@Analista @Analista';
    expect(reconcileMentions(before, before + ' hola', [mention, second]).map(item => item.id)).toEqual([mention.id, second.id]);
    expect(reconcileMentions(before, 'Analista @Analista', [second])).toEqual([{ ...second, start: 9, end: 18 }]);
    expect(reconcileMentions('Analista @Analista ', '@Analista solo el segundo', [{ ...second, start: 9, end: 18 }])).toEqual([{ ...second, start: 0, end: 9 }]);
    expect(reconcileMentions('@Analista', '@AnalistaOther', [mention])).toEqual([]);
    expect(reconcileMentions('@Analista', '@Otro', [mention])).toEqual([]);
    expect(reconcileMentions('@Analista', 'hola @Analista', [mention])).toEqual([{ ...mention, start: 5, end: 14 }]);
  });
  it('treats emails, URLs, escaped @ and Markdown code as ordinary content', () => {
    const text = 'ana@example.com https://example.com/@ana \\@literal\n`@inline`\n```js\n@code\n```\n\n    @indented\n\n@Real';
    expect(mentionStarts(text)).toEqual([text.lastIndexOf('@Real')]);
    expect(mentionStarts('~~~\n@unfinished')).toEqual([]);
    expect(mentionStarts('[site](https://example.com/@name)')).toEqual([]);
    expect(mentionStarts('(@Analista)')).toEqual([1]);
  });
});
