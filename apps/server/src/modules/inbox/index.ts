import { DOMAIN_ERROR_CODES, LIMITS, type MessageView } from '@agent-chat/contracts';
import { DomainError } from '../errors.js';
import type { Clock } from '../identity/index.js';

/** One event as an agent sees it: enough to act, nothing about who else has it. */
export interface InboxEventView {
  eventId: string;
  sequence: number;
  groupId: string;
  createdAt: string;
  message: MessageView;
}

export interface InboxPage {
  events: InboxEventView[];
  nextCursor?: number;
}

export interface InboxRepository {
  /** Pending events only, oldest first. `after` is an exclusive sequence cursor. */
  listPending(agentId: string, limit: number, after?: number): InboxEventView[];
  findForMessage(messageId: string, agentId: string): InboxEventView | undefined;
  findPending(eventId: string, agentId: string): InboxEventView | undefined;
  /**
   * Looks an event up regardless of whether it was acknowledged.
   *
   * Acknowledgement has to see already-acknowledged events to answer a repeat
   * with success instead of pretending the event never existed.
   */
  findAny(eventId: string, agentId: string): InboxEventView | undefined;
  acknowledge(eventId: string, at: string): void;
}

/** The membership facts an inbox read must re-check before disclosing anything. */
export interface InboxAccessPort {
  agentRoleFor(groupId: string, agentId: string): 'admin' | 'member' | undefined;
}

export interface InboxModule {
  eventForMessage(agentId: string, messageId: string): InboxEventView | undefined;
  listPending(input: { agentId: string; limit?: number; after?: number }): InboxPage;
  acknowledge(input: { agentId: string; eventId: string }): { status: 'acknowledged' };
}

export interface InboxModuleDependencies {
  inbox: InboxRepository;
  access: InboxAccessPort;
  clock: Clock;
}

/**
 * Owns pending-event recovery and acknowledgement.
 *
 * Every read and every acknowledgement re-checks current membership first. An
 * event whose group the agent has left is treated as though it never existed:
 * confirming it would tell the agent that a group it can no longer reach still
 * holds messages, which is exactly the leak the privacy guarantee forbids.
 *
 * The cursor is the agent-local sequence rather than an offset, so acknowledging
 * a page can never make a later event skip past the reader.
 */
export function createInboxModule({
  inbox,
  access,
  clock,
}: InboxModuleDependencies): InboxModule {
  function visible(agentId: string, candidate: InboxEventView): boolean {
    return access.agentRoleFor(candidate.groupId, agentId) !== undefined;
  }

  return {
    eventForMessage(agentId, messageId) {
      const event = inbox.findForMessage(messageId, agentId);
      return event !== undefined && visible(agentId, event) ? event : undefined;
    },
    listPending({ agentId, limit, after }) {
      const bounded = Math.max(1, Math.min(limit ?? LIMITS.PAGE_SIZE_DEFAULT, LIMITS.PAGE_SIZE_MAX));
      // One extra row tells the caller whether an older page exists without a count.
      const rows = inbox.listPending(agentId, bounded + 1, after);
      const visibleRows = rows.filter((row) => visible(agentId, row));
      const page = visibleRows.slice(0, bounded);
      const last = page.at(-1);

      return rows.length > bounded && last !== undefined
        ? { events: page, nextCursor: last.sequence }
        : { events: page };
    },

    acknowledge({ agentId, eventId }) {
      const event = inbox.findAny(eventId, agentId);
      if (event === undefined || !visible(agentId, event)) {
        // An event outside this agent's reach is indistinguishable from one that
        // never existed, so neither answer can be used as a probe.
        throw new DomainError(
          DOMAIN_ERROR_CODES.not_found,
          404,
          'Inbox event is not available',
        );
      }

      // Repeating the call succeeds: acknowledgement only ever moves a pending
      // event forward, and the update itself is conditional on being pending.
      inbox.acknowledge(eventId, clock.now().toISOString());
      return { status: 'acknowledged' };
    },
  };
}
