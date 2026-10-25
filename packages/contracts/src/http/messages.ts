import { LIMITS } from '../domain/limits.js';
import { isPlainObject, type Parsed } from '../domain/auth.js';

/**
 * The public message projection shared by HTTP, both WebSockets, the tests,
 * and the UI.
 *
 * It carries the effective author and, for an agent, the visible owner, because
 * the PRD requires every reader to see who wrote a message and which human owns
 * an agent. Nothing else about the row is exposed.
 */
export interface MessageView {
  id: string;
  groupId: string;
  author: MessageAuthor;
  text: string;
  mentionedAgentIds?: string[];
  createdAt: string;
}

export type MessageAuthor =
  | { kind: 'human'; id: string; displayName: string }
  | { kind: 'agent'; id: string; displayName: string; ownerDisplayName: string };

export const MESSAGE_PATHS = {
  collection: (groupId: string) => `/api/groups/${groupId}/messages`,
} as const;

export interface SendMessageRequest {
  mentionedAgentIds?: string[];
  text: string;
  idempotencyKey: string;
}

export interface MessagePage {
  /** Newest first, so the UI can prepend without reversing. */
  messages: MessageView[];
  /** Opaque cursor for the next older page, or omitted at the end. */
  nextCursor?: string;
}

/** Bounded idempotency key: it is stored per author, so it must stay small. */
export const IDEMPOTENCY_KEY_MAX_LENGTH = 128;

/** Bytes are what the limit is about, not characters. */
export function utf8Length(value: string): number {
  return new TextEncoder().encode(value).length;
}

export function validateMessageText(raw: unknown): Parsed<string> {
  if (typeof raw !== 'string') {
    return { ok: false, reason: 'text:not_text' };
  }
  if (raw.trim() === '') {
    return { ok: false, reason: 'text:required' };
  }
  if (utf8Length(raw) > LIMITS.MESSAGE_TEXT_BYTES) {
    return { ok: false, reason: 'text:too_large' };
  }
  return { ok: true, value: raw };
}

export function validateIdempotencyKey(raw: unknown): Parsed<string> {
  if (typeof raw !== 'string') {
    return { ok: false, reason: 'idempotencyKey:not_text' };
  }
  const key = raw.trim();
  if (key === '') {
    return { ok: false, reason: 'idempotencyKey:required' };
  }
  if (key.length > IDEMPOTENCY_KEY_MAX_LENGTH) {
    return { ok: false, reason: 'idempotencyKey:too_long' };
  }
  return { ok: true, value: key };
}

export function parseSendMessageRequest(body: unknown): Parsed<SendMessageRequest> {
  if (!isPlainObject(body)) {
    return { ok: false, reason: 'body:not_object' };
  }

  const text = validateMessageText(body['text']);
  if (!text.ok) {
    return text;
  }

  const key = validateIdempotencyKey(body['idempotencyKey']);
  if (!key.ok) {
    return key;
  }

  const mentions = parseMentionedAgentIds(body['mentionedAgentIds']);
  if (!mentions.ok) return mentions;
  return { ok: true, value: { text: text.value, idempotencyKey: key.value,
    ...(mentions.value.length ? { mentionedAgentIds: mentions.value } : {}) } };
}

/** Explicit recipient IDs avoid ambiguous display names and incidental email addresses. */
export function parseMentionedAgentIds(raw: unknown): Parsed<string[]> {
  if (raw === undefined) return { ok: true, value: [] };
  if (!Array.isArray(raw) || raw.length > 20 || raw.some(id => typeof id !== 'string' || !id.trim() || id.length > 128)) {
    return { ok: false, reason: 'mentionedAgentIds:invalid' };
  }
  return { ok: true, value: [...new Set(raw as string[])].sort() };
}

/** Bounded page size: a caller cannot ask for the whole conversation. */
export function parsePageSize(raw: unknown): Parsed<number> {
  if (raw === undefined) {
    return { ok: true, value: LIMITS.PAGE_SIZE_DEFAULT };
  }
  const value = typeof raw === 'string' ? Number(raw) : raw;
  if (!Number.isInteger(value) || (value as number) < 1) {
    return { ok: false, reason: 'limit:invalid' };
  }
  return { ok: true, value: Math.min(value as number, LIMITS.PAGE_SIZE_MAX) };
}

export function parseMessagePage(body: unknown): Parsed<MessagePage> {
  if (!isPlainObject(body) || !Array.isArray(body['messages'])) {
    return { ok: false, reason: 'messages:not_array' };
  }

  const messages: MessageView[] = [];
  for (const candidate of body['messages']) {
    const message = parseMessageView(candidate);
    if (!message.ok) {
      return message;
    }
    messages.push(message.value);
  }

  const nextCursor = body['nextCursor'];
  if (nextCursor !== undefined && typeof nextCursor !== 'string') {
    return { ok: false, reason: 'nextCursor:not_text' };
  }

  return {
    ok: true,
    value: nextCursor === undefined ? { messages } : { messages, nextCursor },
  };
}

export function parseMessageView(raw: unknown): Parsed<MessageView> {
  if (!isPlainObject(raw)) {
    return { ok: false, reason: 'message:not_object' };
  }
  for (const field of ['id', 'groupId', 'text', 'createdAt'] as const) {
    if (typeof raw[field] !== 'string') {
      return { ok: false, reason: `message.${field}:not_text` };
    }
  }

  const mentions = parseMentionedAgentIds(raw['mentionedAgentIds']);
  if (!mentions.ok) return mentions;
  const author = parseMessageAuthor(raw['author']);
  if (!author.ok) {
    return author;
  }

  return {
    ok: true,
    value: {
      id: raw['id'] as string,
      groupId: raw['groupId'] as string,
      author: author.value,
      text: raw['text'] as string,
      ...(mentions.value.length ? { mentionedAgentIds: mentions.value } : {}),
      createdAt: raw['createdAt'] as string,
    },
  };
}

function parseMessageAuthor(raw: unknown): Parsed<MessageAuthor> {
  if (!isPlainObject(raw)) {
    return { ok: false, reason: 'author:not_object' };
  }

  const kind = raw['kind'];
  if (kind !== 'human' && kind !== 'agent') {
    return { ok: false, reason: 'author.kind:invalid' };
  }

  const required =
    kind === 'human'
      ? (['id', 'displayName'] as const)
      : (['id', 'displayName', 'ownerDisplayName'] as const);

  for (const field of required) {
    if (typeof raw[field] !== 'string') {
      return { ok: false, reason: `author.${field}:not_text` };
    }
  }

  if (kind === 'human') {
    return {
      ok: true,
      value: {
        kind: 'human',
        id: raw['id'] as string,
        displayName: raw['displayName'] as string,
      },
    };
  }

  return {
    ok: true,
    value: {
      kind: 'agent',
      id: raw['id'] as string,
      displayName: raw['displayName'] as string,
      ownerDisplayName: raw['ownerDisplayName'] as string,
    },
  };
}
