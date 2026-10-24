import {
  MESSAGE_PATHS,
  parseMessagePage,
  parseMessageView,
  type MessageView,
} from "@agent-chat/contracts";
import { errorCodeOf, JSON_HEADERS, type JsonFetch } from "../../shared/http";

export type ChatState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; messages: MessageView[]; nextCursor?: string }
  | { status: "error"; httpStatus: number };

export interface SendOutcome {
  ok: boolean;
  code?: string;
}

export async function loadMessages(
  groupId: string,
  fetchImpl: JsonFetch = fetch,
  before?: string,
): Promise<ChatState> {
  try {
    const response = await fetchImpl(
      MESSAGE_PATHS.collection(groupId) +
        (before ? `?before=${encodeURIComponent(before)}` : ""),
    );
    if (!response.ok) {
      return { status: "error", httpStatus: response.status };
    }

    const parsed = parseMessagePage(await response.json());
    return parsed.ok
      ? {
          status: "ready",
          messages: parsed.value.messages,
          ...(parsed.value.nextCursor === undefined
            ? {}
            : { nextCursor: parsed.value.nextCursor }),
        }
      : { status: "error", httpStatus: response.status };
  } catch {
    return { status: "error", httpStatus: 0 };
  }
}

export async function sendMessage(
  groupId: string,
  text: string,
  fetchImpl: JsonFetch = fetch,
  idempotencyKey: string = crypto.randomUUID(),
): Promise<SendOutcome> {
  try {
    const response = await fetchImpl(MESSAGE_PATHS.collection(groupId), {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({ text, idempotencyKey }),
    });

    if (response.ok) {
      return { ok: true };
    }
    return { ok: false, code: errorCodeOf(await response.json()) ?? "unknown" };
  } catch {
    return { ok: false, code: "unreachable" };
  }
}

/**
 * Merges a live message into the list.
 *
 * A message that already arrived through the socket must not be duplicated by a
 * later page read, and an older page must not be reordered by a new frame, so
 * the merge is by id and keeps the newest first.
 */
export function mergeMessage(
  messages: MessageView[],
  incoming: MessageView,
): MessageView[] {
  if (messages.some((message) => message.id === incoming.id)) {
    return messages;
  }
  return [incoming, ...messages];
}

export function parseIncomingFrame(raw: unknown): MessageView | undefined {
  if (typeof raw !== "object" || raw === null) {
    return undefined;
  }
  const frame = raw as { type?: unknown; message?: unknown };
  if (frame.type !== "message.created") {
    return undefined;
  }
  const parsed = parseMessageView(frame.message);
  return parsed.ok ? parsed.value : undefined;
}
