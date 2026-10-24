import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { ReceiverJournal, type PendingEvent } from '../../apps/bridge/src/managed/journal';
import { ManagedProcessor } from '../../apps/bridge/src/managed/processor';
import type { CallPort } from '../../apps/bridge/src/receiver';

const event: PendingEvent = { eventId: 'event-1', groupId: 'group-1', sequence: 1, message: { text: 'Hello', author: { kind: 'human' } } };
async function fixture(run: (journal: ReceiverJournal, directory: string) => Promise<void>) {
  const directory = await mkdtemp(join(tmpdir(), 'managed-journal-'));
  const journal = new ReceiverJournal(directory, 'agent-one');
  try { await run(journal, directory); } finally { journal.close(); await rm(directory, { recursive: true, force: true }); }
}

it('recovers a lost publication response from disk without repeating generation, then ACKs', async () => {
  await fixture(async (journal, directory) => {
    let generations = 0; let sends = 0; let acks = 0;
    const keys: string[] = [];
    const control: CallPort = { async call<T>(name: string, args: object): Promise<T> {
      if (name === 'read_messages') return { messages: [] } as T;
      if (name === 'send_message') {
        keys.push((args as { idempotency_key: string }).idempotency_key);
        if (++sends === 1) throw new Error('response lost after publication');
      }
      if (name === 'ack_inbox') acks++;
      return {} as T;
    } };
    const worker = { async run() { generations++; return { decision: 'reply' as const, text: 'Hello back', threadId: 'thread-one' }; } };
    await expect(new ManagedProcessor(control, worker, journal).process(event)).rejects.toThrow('response lost');
    expect(acks).toBe(0);
    const resumed = new ReceiverJournal(directory, 'agent-one');
    try {
      expect(await new ManagedProcessor(control, worker, resumed).process(event)).toBe('acked');
      expect(resumed.thread(event.groupId)).toBe('thread-one');
    } finally { resumed.close(); }
    expect(generations).toBe(1); expect(sends).toBe(2); expect(acks).toBe(1);
    expect(keys[0]).toBe(keys[1]);
  });
});

it('does not regenerate or ACK an interrupted generation and holds later messages in that group', async () => {
  await fixture(async (journal) => {
    journal.start(event);
    const control: CallPort = { async call() { throw new Error('No network call should occur'); } };
    const worker = { async run(): Promise<never> { throw new Error('No generation should occur'); } };
    const processor = new ManagedProcessor(control, worker, journal);
    expect(await processor.process(event)).toBe('blocked');
    expect(await processor.process({ ...event, eventId: 'event-2', sequence: 2 })).toBe('blocked');
    expect(journal.get(event.eventId)?.phase).toBe('blocked');
  });
});

it('does not answer other agents or acknowledge a human turn without a reply', async () => {
  await fixture(async (journal) => {
    let acks = 0;
    const control: CallPort = { async call<T>(name: string): Promise<T> {
      if (name === 'ack_inbox') acks++;
      return { messages: [] } as T;
    } };
    let generations = 0;
    const worker = { async run() { generations++; return { decision: 'no_reply' as const, text: '', threadId: 'thread-one' }; } };
    const processor = new ManagedProcessor(control, worker, journal);
    expect(await processor.process({ ...event, message: { text: 'Agent output', author: { kind: 'agent' } } })).toBe('acked');
    expect(generations).toBe(0); expect(acks).toBe(1);
    expect(await processor.process({ ...event, eventId: 'human-event' })).toBe('blocked');
    expect(acks).toBe(1);
  });
});

it('keeps a history fetch failure retryable and separates journals by agent identity', async () => {
  await fixture(async (journal, directory) => {
    const control: CallPort = { async call(): Promise<never> { throw new Error('network unavailable'); } };
    const worker = { async run(): Promise<never> { throw new Error('No generation should occur'); } };
    await expect(new ManagedProcessor(control, worker, journal).process(event)).rejects.toThrow('network unavailable');
    expect(journal.get(event.eventId)).toBeUndefined();
    expect(() => new ReceiverJournal(directory, 'another-agent')).toThrow('different agent');
  });
});

it('publishes an explicit operator resolution without repeating the uncertain model turn', async () => {
  await fixture(async (journal) => {
    journal.start(event); journal.phase(event.eventId, 'blocked');
    journal.resolve(event.eventId, 'Respuesta revisada por el operador.');
    const published: string[] = [];
    const control: CallPort = { async call<T>(name: string, args: object): Promise<T> {
      if (name === 'send_message') published.push((args as { text: string }).text);
      return {} as T;
    } };
    const worker = { async run(): Promise<never> { throw new Error('No generation should occur'); } };
    expect(await new ManagedProcessor(control, worker, journal).process(event)).toBe('acked');
    expect(published).toEqual(['Respuesta revisada por el operador.']);
    expect(() => journal.resolve(event.eventId, 'Duplicate')).toThrow('uncertain event');
  });
});
