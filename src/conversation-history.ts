import type { ModelMessage } from "@tanstack/ai";
import type { StateAdapter } from "chat";

/** Newest messages retained per thread. */
const MAX_HISTORY_MESSAGES = 50;
/** Idle threads expire after this window; refreshed on every write. */
const HISTORY_TTL_MS = 1000 * 60 * 60 * 24 * 30; // 30 days

export interface ConversationHistory {
  append(threadId: string, message: ModelMessage): Promise<void>;
  get(threadId: string): Promise<ModelMessage[]>;
}

/**
 * Per-thread conversation history backed by the Chat state adapter. With a
 * persistent adapter (Redis/Postgres) history survives restarts and is shared
 * across instances; with the default in-memory adapter it is an in-process
 * cache.
 *
 * `appendToList` retains the newest `MAX_HISTORY_MESSAGES` and refreshes the
 * TTL on every write, and `getList` returns them in insertion order -- so the
 * most recent message is always last, as the model expects.
 */
export function createConversationHistory(
  state: StateAdapter
): ConversationHistory {
  const key = (threadId: string): string => `agent:history:${threadId}`;

  return {
    get: (threadId) => state.getList<ModelMessage>(key(threadId)),
    append: (threadId, message) =>
      state.appendToList(key(threadId), message, {
        maxLength: MAX_HISTORY_MESSAGES,
        ttlMs: HISTORY_TTL_MS,
      }),
  };
}
