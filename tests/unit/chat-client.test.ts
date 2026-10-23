import { describe, expect, it } from "vitest";
import { MESSAGE_PATHS, type MessageView } from "@agent-chat/contracts";
import {
  loadMessages,
  mergeMessage,
  parseIncomingFrame,
  sendMessage,
} from "../../apps/web/src/features/chat/transport";
import {
  describeAuthor,
  describeChat,
} from "../../apps/web/src/features/chat/ChatPanel";
import type { JsonFetch, JsonFetchInit } from "../../apps/web/src/shared/http";

const MESSAGE: MessageView = {
  id: "message-1",
  groupId: "group-1",
  author: { kind: "human", id: "user-1", displayName: "Ada" },
  text: "Hello",
  createdAt: "2026-01-01T00:00:00.000Z",
};

function fakeFetch(responses: Array<{ status: number; body: unknown }>): {
  calls: Array<{ url: string; init: JsonFetchInit | undefined }>;
  fetch: JsonFetch;
} {
  const calls: Array<{ url: string; init: JsonFetchInit | undefined }> = [];
  let index = 0;

  return {
    calls,
    fetch: async (url, init) => {
      calls.push({ url, init });
      const response = responses[Math.min(index, responses.length - 1)]!;
      index += 1;
      return {
        ok: response.status >= 200 && response.status < 300,
        status: response.status,
        json: async () => response.body,
      };
    },
  };
}

describe("loadMessages", () => {
  it("reads the shared path and keeps the cursor when an older page exists", async () => {
    const client = fakeFetch([
      { status: 200, body: { messages: [MESSAGE], nextCursor: MESSAGE.id } },
    ]);

    await expect(loadMessages("group-1", client.fetch)).resolves.toEqual({
      status: "ready",
      messages: [MESSAGE],
      nextCursor: MESSAGE.id,
    });
    expect(client.calls[0]!.url).toBe(MESSAGE_PATHS.collection("group-1"));
  });

  it("reports a body that is not the shared page shape as an error", async () => {
    const client = fakeFetch([
      { status: 200, body: { messages: [{ id: "x" }] } },
    ]);

    await expect(loadMessages("group-1", client.fetch)).resolves.toEqual({
      status: "error",
      httpStatus: 200,
    });
  });

  it("reports an unreachable server without throwing", async () => {
    const fetchImpl: JsonFetch = () => Promise.reject(new Error("offline"));

    await expect(loadMessages("group-1", fetchImpl)).resolves.toEqual({
      status: "error",
      httpStatus: 0,
    });
  });
});

describe("sendMessage", () => {
  it("posts the text with a per-send key and preserves an explicit retry key", async () => {
    const client = fakeFetch([{ status: 201, body: { message: MESSAGE } }]);

    await expect(
      sendMessage("group-1", "Hello", client.fetch, "retry-key"),
    ).resolves.toEqual({ ok: true });

    const body = JSON.parse(client.calls[0]!.init?.body ?? "{}");
    expect(body.text).toBe("Hello");
    expect(body.idempotencyKey).toBe("retry-key");
  });

  it("keeps the shared refusal code", async () => {
    const client = fakeFetch([
      { status: 400, body: { error: { code: "invalid_input" } } },
    ]);

    await expect(sendMessage("group-1", "   ", client.fetch)).resolves.toEqual({
      ok: false,
      code: "invalid_input",
    });
  });

  it("reports an unreachable server as a failure rather than a success", async () => {
    const fetchImpl: JsonFetch = () => Promise.reject(new Error("offline"));

    await expect(sendMessage("group-1", "Hello", fetchImpl)).resolves.toEqual({
      ok: false,
      code: "unreachable",
    });
  });
});

describe("mergeMessage", () => {
  it("puts a new message first and never duplicates an id", () => {
    const older: MessageView = { ...MESSAGE, id: "message-0", text: "Earlier" };

    expect(mergeMessage([older], MESSAGE).map((message) => message.id)).toEqual(
      ["message-1", "message-0"],
    );
    expect(mergeMessage([MESSAGE], MESSAGE)).toHaveLength(1);
  });
});

describe("parseIncomingFrame", () => {
  it("accepts only a well-formed message.created frame", () => {
    expect(
      parseIncomingFrame({ type: "message.created", message: MESSAGE }),
    ).toEqual(MESSAGE);
    expect(parseIncomingFrame({ type: "ready", groupIds: [] })).toBeUndefined();
    expect(
      parseIncomingFrame({ type: "message.created", message: { id: "x" } }),
    ).toBeUndefined();
    expect(parseIncomingFrame("not json at all")).toBeUndefined();
  });
});

describe("labels", () => {
  it("always shows an agent with its owner and never as its owner", () => {
    expect(
      describeAuthor({
        ...MESSAGE,
        author: {
          kind: "agent",
          id: "agent-1",
          displayName: "Scout",
          ownerDisplayName: "Ada",
        },
      }),
    ).toBe("Scout (agente de Ada)");
    expect(describeAuthor(MESSAGE)).toBe("Ada");
  });

  it("describes an empty conversation honestly", () => {
    expect(describeChat({ status: "ready", messages: [] })).toBe(
      "Todavía no hay mensajes.",
    );
    expect(describeChat({ status: "error", httpStatus: 500 })).toBe(
      "No pudimos cargar los mensajes.",
    );
  });
});
