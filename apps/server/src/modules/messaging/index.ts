import { createHash } from 'node:crypto';
import { parseMentionedAgentIds, type GroupRole, type MessageView } from '@agent-chat/contracts';
import type { Clock } from '../identity/index.js';
import { DomainError } from '../errors.js';
import { GroupNotFoundError } from '../groups/index.js';

/** Who a message is attributed to. Only the server decides this. */
export type MessageAuthorRef =
  | { kind: 'human'; id: string }
  | { kind: 'agent'; id: string };

/** What the persistence layer needs to store one message plus its key claim. */
export interface InsertMessageInput {
  id: string;
  groupId: string;
  author: MessageAuthorRef;
  text: string;
  createdAt: string;
  idempotencyKey: string;
  requestDigest: string;
  /**
   * Agent members of the group to notify.
   *
   * Resolved before the transaction and written inside it, so a message and the
   * events it creates for agents either both exist or neither does.
   */
  eligibleAgentIds: string[];
  mentionedAgentIds?: string[];
}

export type InsertMessageOutcome =
  | { outcome: 'created'; messageId: string }
  | { outcome: 'replayed'; messageId: string }
  | { outcome: 'conflict' };

export interface MessageRepository {
  /** Claims the key and inserts the message in one transaction. */
  insertWithIdempotency(input: InsertMessageInput): InsertMessageOutcome;
  /** Newest first. `before` is an exclusive cursor. */
  listViews(input: { groupId: string; limit: number; before?: string }): MessageView[];
  viewById(messageId: string): MessageView | undefined;
}

/** The membership facts messaging needs, and nothing more. */
export interface MembershipReader {
  humanRoleFor(groupId: string, userId: string): GroupRole | undefined;
  /**
   * Resolves an agent's standing in a group.
   *
   * An agent credential is authorized exactly as a member would be: the same
   * membership test decides whether it may read or post, so there is no path
   * that reaches messages by holding a token alone.
   */
  agentRoleFor(groupId: string, agentId: string): GroupRole | undefined;
  /** Agent members of a group; these are the agents notified of its messages. */
  agentRecipientsOf(groupId: string): string[];
}

export interface MessagePage {
  messages: MessageView[];
  nextCursor?: string;
}

export interface MessagingModule {
  send(input: {
    author: MessageAuthorRef;
    groupId: string;
    text: string;
    mentionedAgentIds?: string[];
    idempotencyKey: string;
  }): { message: MessageView; replayed: boolean };
  list(input: { author: MessageAuthorRef; groupId: string; limit: number; before?: string }): MessagePage;
}

export interface MessagingModuleDependencies {
  messages: MessageRepository;
  membership: MembershipReader;
  clock: Clock;
  generateId(): string;
}

/**
 * Owns message authorship, membership checks, and send idempotency.
 *
 * Authorization is resolved from server-owned membership state on every call,
 * so an author name supplied by a caller can never change who wrote a message,
 * and a removed member stops being able to read or post immediately.
 */
export function createMessagingModule({
  messages,
  membership,
  clock,
  generateId,
}: MessagingModuleDependencies): MessagingModule {
  function requireMembership(author: MessageAuthorRef, groupId: string): GroupRole {
    const role =
      author.kind === 'human'
        ? membership.humanRoleFor(groupId, author.id)
        : membership.agentRoleFor(groupId, author.id);
    if (role === undefined) {
      // A non-member and a missing group are indistinguishable on purpose.
      throw new GroupNotFoundError();
    }
    return role;
  }

  return {
    send({ author, groupId, text, idempotencyKey, mentionedAgentIds }) {
      requireMembership(author, groupId);

      const parsed = parseMentionedAgentIds(mentionedAgentIds);
      if (!parsed.ok) throw new DomainError('invalid_input', 400, 'Invalid mentions');
      const recipients = membership.agentRecipientsOf(groupId);
      if (parsed.value.some(id => !recipients.includes(id))) throw new DomainError('invalid_input', 400, 'Mentioned agent is not an active group member');
      const result = messages.insertWithIdempotency({
        id: generateId(),
        groupId,
        author,
        text,
        createdAt: clock.now().toISOString(),
        idempotencyKey,
        requestDigest: digestOf(groupId, text, parsed.value),
        mentionedAgentIds: parsed.value,
        eligibleAgentIds: parsed.value.length ? parsed.value : recipients,
      });

      if (result.outcome === 'conflict') {
        // Same key, different payload: the caller is reusing a key, and
        // answering with the old message would silently drop the new text.
        throw new DomainError('conflict', 409, 'Idempotency key reused with a different payload');
      }

      const message = messages.viewById(result.messageId);
      if (message === undefined) {
        throw new DomainError('temporarily_unavailable', 500, 'Message vanished after insert');
      }

      return { message, replayed: result.outcome === 'replayed' };
    },

    list({ author, groupId, limit, before }) {
      requireMembership(author, groupId);

      // One extra row tells us whether an older page exists without counting.
      const rows = messages.listViews({ groupId, limit: limit + 1, ...(before === undefined ? {} : { before }) });
      const page = rows.slice(0, limit);
      const last = page.at(-1);

      return rows.length > limit && last !== undefined
        ? { messages: page, nextCursor: last.id }
        : { messages: page };
    },
  };
}

/**
 * Digest of the payload a key is bound to.
 *
 * Only the server computes it, and it never leaves the process: it exists so a
 * retried request is recognized as the same request and a reused key with new
 * content is refused.
 */
export function digestOf(groupId: string, text: string, mentionedAgentIds: string[] = []): string {
  const suffix = mentionedAgentIds.length ? `\u0000${JSON.stringify([...new Set(mentionedAgentIds)].sort())}` : '';
  return createHash('sha256').update(`${groupId}\u0000${text}${suffix}`, 'utf8').digest('hex');
}
