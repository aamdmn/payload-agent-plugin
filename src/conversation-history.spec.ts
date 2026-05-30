import { createMemoryState } from "@chat-adapter/state-memory";
import type { StateAdapter } from "chat";
import { beforeEach, describe, expect, test } from "vitest";
import { createConversationHistory } from "./conversation-history.js";

let state: StateAdapter;

beforeEach(async () => {
  state = createMemoryState();
  await state.connect();
});

describe("createConversationHistory", () => {
  test("returns an empty history for an unknown thread", async () => {
    const history = createConversationHistory(state);
    expect(await history.get("new-thread")).toEqual([]);
  });

  test("appends in order so the latest message is last", async () => {
    const history = createConversationHistory(state);

    await history.append("t1", { role: "user", content: "hello" });
    await history.append("t1", { role: "assistant", content: "hi there" });

    expect(await history.get("t1")).toEqual([
      { role: "user", content: "hello" },
      { role: "assistant", content: "hi there" },
    ]);
  });

  test("keeps the newest messages once the cap is exceeded", async () => {
    const history = createConversationHistory(state);

    // MAX_HISTORY_MESSAGES is 50; append 52 to force trimming.
    for (let i = 0; i < 52; i++) {
      await history.append("t1", { role: "user", content: String(i) });
    }

    const messages = await history.get("t1");
    expect(messages).toHaveLength(50);
    // Oldest two (0 and 1) dropped; newest (51) is last.
    expect(messages.at(0)).toEqual({ role: "user", content: "2" });
    expect(messages.at(-1)).toEqual({ role: "user", content: "51" });
  });

  test("isolates history per thread", async () => {
    const history = createConversationHistory(state);

    await history.append("a", { role: "user", content: "for a" });
    await history.append("b", { role: "user", content: "for b" });

    expect(await history.get("a")).toEqual([
      { role: "user", content: "for a" },
    ]);
    expect(await history.get("b")).toEqual([
      { role: "user", content: "for b" },
    ]);
  });
});
