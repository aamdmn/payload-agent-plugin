import config from "@payload-config";
import type { Payload } from "payload";
import { getPayload } from "payload";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

let payload: Payload;

afterAll(async () => {
  if (typeof payload?.db?.destroy === "function") {
    await payload.db.destroy();
  }
});

beforeAll(async () => {
  payload = await getPayload({ config });
});

describe("Plugin", () => {
  test("loads without errors", () => {
    expect(payload).toBeDefined();
    expect(payload.config).toBeDefined();
  });

  test("collections are accessible", async () => {
    const result = await payload.find({ collection: "posts", limit: 1 });
    expect(result.docs).toBeInstanceOf(Array);
  });
});
