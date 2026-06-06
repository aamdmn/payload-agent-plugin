import type { BasePayload } from "payload";
import { describe, expect, test, vi } from "vitest";
import { createPayloadTools, createWriteBudget } from "./tools.js";

interface ServerToolLike {
  execute: (args: Record<string, unknown>) => Promise<unknown> | unknown;
  name: string;
}

interface StubCollection {
  auth?: unknown;
  fields: unknown[];
  slug: string;
  upload?: unknown;
}

interface StubGlobal {
  fields: unknown[];
  slug: string;
}

const NOT_ACCESSIBLE = /not accessible/;
const WRITE_LIMIT_REACHED = /Write limit reached/;
const RESULT_TOO_LARGE = /too large/i;

const collections: StubCollection[] = [
  { slug: "posts", fields: [] },
  { slug: "users", auth: {}, fields: [] },
  { slug: "media", upload: {}, fields: [] },
];

const globals: StubGlobal[] = [
  { slug: "settings", fields: [] },
  { slug: "payload-internal", fields: [] },
];

function stubPayload(): {
  find: ReturnType<typeof vi.fn>;
  findGlobal: ReturnType<typeof vi.fn>;
  payload: BasePayload;
  updateGlobal: ReturnType<typeof vi.fn>;
} {
  const find = vi
    .fn()
    .mockResolvedValue({ docs: [], page: 1, totalDocs: 0, totalPages: 0 });
  const findGlobal = vi.fn().mockResolvedValue({ siteName: "Acme" });
  const updateGlobal = vi.fn().mockResolvedValue({ siteName: "Acme" });

  const payload = {
    config: { collections, globals, localization: false },
    count: vi.fn(),
    create: vi.fn(),
    delete: vi.fn(),
    find,
    findByID: vi.fn(),
    findGlobal,
    update: vi.fn(),
    updateGlobal,
  } as unknown as BasePayload;

  return { find, findGlobal, payload, updateGlobal };
}

function getTool(tools: unknown[], name: string): ServerToolLike {
  const tool = (tools as ServerToolLike[]).find((item) => item.name === name);
  if (!tool) {
    throw new Error(`tool ${name} not found`);
  }
  return tool;
}

function hasTool(tools: unknown[], name: string): boolean {
  return (tools as ServerToolLike[]).some((item) => item.name === name);
}

describe("createPayloadTools collection scoping", () => {
  test("getSchema hides internal and auth collections by default", async () => {
    const { payload } = stubPayload();
    const tools = createPayloadTools(payload, { richText: "lexical" });

    const result = (await getTool(tools, "getSchema").execute({})) as {
      collections: { slug: string }[];
    };
    const slugs = result.collections.map((item) => item.slug);

    expect(slugs).toContain("posts");
    expect(slugs).toContain("media");
    expect(slugs).not.toContain("users");
  });

  test("an operation on a denied collection throws before reaching Payload", async () => {
    const { find, payload } = stubPayload();
    const tools = createPayloadTools(payload, { richText: "lexical" });

    await expect(
      getTool(tools, "find").execute({ collection: "users" })
    ).rejects.toThrow(NOT_ACCESSIBLE);
    expect(find).not.toHaveBeenCalled();
  });

  test("an operation on an allowed collection reaches Payload", async () => {
    const { find, payload } = stubPayload();
    const tools = createPayloadTools(payload, { richText: "lexical" });

    await getTool(tools, "find").execute({ collection: "posts" });

    expect(find).toHaveBeenCalledTimes(1);
  });

  test("allow whitelist hides everything not listed, including uploads", async () => {
    const { payload } = stubPayload();
    const tools = createPayloadTools(payload, {
      access: { collections: { allow: ["posts"] } },
      richText: "lexical",
    });

    const result = (await getTool(tools, "getSchema").execute({})) as {
      collections: { slug: string }[];
    };

    expect(result.collections.map((item) => item.slug)).toEqual(["posts"]);
    expect(hasTool(tools, "uploadFile")).toBe(false);
  });

  test("uploadFile is exposed only when an accessible upload collection exists", () => {
    const { payload } = stubPayload();

    const withMedia = createPayloadTools(payload, { richText: "lexical" });
    expect(hasTool(withMedia, "uploadFile")).toBe(true);

    const withoutMedia = createPayloadTools(payload, {
      access: { collections: { deny: ["media"] } },
      richText: "lexical",
    });
    expect(hasTool(withoutMedia, "uploadFile")).toBe(false);
  });
});

describe("createPayloadTools global scoping", () => {
  test("getSchema lists accessible globals and hides internal ones", async () => {
    const { payload } = stubPayload();
    const tools = createPayloadTools(payload, { richText: "lexical" });

    const result = (await getTool(tools, "getSchema").execute({})) as {
      globals: { slug: string }[];
    };
    const slugs = result.globals.map((item) => item.slug);

    expect(slugs).toContain("settings");
    expect(slugs).not.toContain("payload-internal");
  });

  test("exposes findGlobal and updateGlobal when a global is accessible", () => {
    const { payload } = stubPayload();
    const tools = createPayloadTools(payload, { richText: "lexical" });

    expect(hasTool(tools, "findGlobal")).toBe(true);
    expect(hasTool(tools, "updateGlobal")).toBe(true);
  });

  test("hides global tools when no global is accessible", () => {
    const { payload } = stubPayload();
    const tools = createPayloadTools(payload, {
      access: { globals: { deny: ["settings"] } },
      richText: "lexical",
    });

    expect(hasTool(tools, "findGlobal")).toBe(false);
    expect(hasTool(tools, "updateGlobal")).toBe(false);
  });

  test("an operation on a denied global throws before reaching Payload", async () => {
    const { findGlobal, payload } = stubPayload();
    const tools = createPayloadTools(payload, {
      access: { globals: { allow: ["settings"] } },
      richText: "lexical",
    });

    await expect(
      getTool(tools, "findGlobal").execute({ slug: "payload-internal" })
    ).rejects.toThrow(NOT_ACCESSIBLE);
    expect(findGlobal).not.toHaveBeenCalled();
  });

  test("findGlobal and updateGlobal reach Payload for an accessible global", async () => {
    const { findGlobal, payload, updateGlobal } = stubPayload();
    const tools = createPayloadTools(payload, { richText: "lexical" });

    await getTool(tools, "findGlobal").execute({ slug: "settings" });
    await getTool(tools, "updateGlobal").execute({
      slug: "settings",
      data: { siteName: "New" },
    });

    expect(findGlobal).toHaveBeenCalledTimes(1);
    expect(updateGlobal).toHaveBeenCalledTimes(1);
    expect((findGlobal.mock.calls[0][0] as Record<string, unknown>).slug).toBe(
      "settings"
    );
  });

  test("updateGlobal is removed when update is disabled, findGlobal stays", () => {
    const { payload } = stubPayload();
    const tools = createPayloadTools(payload, {
      access: { operations: { update: false } },
      richText: "lexical",
    });

    expect(hasTool(tools, "findGlobal")).toBe(true);
    expect(hasTool(tools, "updateGlobal")).toBe(false);
  });

  test("updateGlobal consumes the write budget", async () => {
    const { payload } = stubPayload();
    const tools = createPayloadTools(payload, {
      richText: "lexical",
      writeBudget: createWriteBudget(1),
    });

    await getTool(tools, "updateGlobal").execute({
      slug: "settings",
      data: {},
    });

    await expect(
      getTool(tools, "updateGlobal").execute({ slug: "settings", data: {} })
    ).rejects.toThrow(WRITE_LIMIT_REACHED);
  });
});

describe("createPayloadTools operation scoping", () => {
  test("exposes create and update but not delete by default", () => {
    const { payload } = stubPayload();
    const tools = createPayloadTools(payload, { richText: "lexical" });

    expect(hasTool(tools, "create")).toBe(true);
    expect(hasTool(tools, "update")).toBe(true);
    expect(hasTool(tools, "deleteDoc")).toBe(false);
    expect(hasTool(tools, "find")).toBe(true);
  });

  test("exposes delete only when explicitly enabled", () => {
    const { payload } = stubPayload();
    const tools = createPayloadTools(payload, {
      access: { operations: { delete: true } },
      richText: "lexical",
    });

    expect(hasTool(tools, "deleteDoc")).toBe(true);
  });

  test("disabling create also removes uploadFile, leaving reads", () => {
    const { payload } = stubPayload();
    const tools = createPayloadTools(payload, {
      access: { operations: { create: false } },
      richText: "lexical",
    });

    expect(hasTool(tools, "create")).toBe(false);
    expect(hasTool(tools, "uploadFile")).toBe(false);
    expect(hasTool(tools, "find")).toBe(true);
    expect(hasTool(tools, "getSchema")).toBe(true);
  });
});

describe("createPayloadTools type grounding", () => {
  const typesProvider = {
    getCollectionType: (slug: string): null | string =>
      slug === "posts" ? "type Post = { title: string };" : null,
    getGlobalType: (slug: string): null | string =>
      slug === "settings" ? "type Settings = { siteName: string };" : null,
  };

  const getSchema = async (
    tools: unknown[],
    args: Record<string, unknown>
  ): Promise<{
    collections: { types?: string }[];
    globals: { types?: string }[];
  }> =>
    (await getTool(tools, "getSchema").execute(args)) as {
      collections: { types?: string }[];
      globals: { types?: string }[];
    };

  test("getSchema includes the collection type when a provider is set", async () => {
    const { payload } = stubPayload();
    const tools = createPayloadTools(payload, {
      richText: "lexical",
      typesProvider,
    });

    const result = await getSchema(tools, { collection: "posts" });

    expect(result.collections[0].types).toContain("type Post");
  });

  test("getSchema omits types when listing all collections", async () => {
    const { payload } = stubPayload();
    const tools = createPayloadTools(payload, {
      richText: "lexical",
      typesProvider,
    });

    const result = await getSchema(tools, {});

    expect(result.collections.every((item) => item.types === undefined)).toBe(
      true
    );
  });

  test("getSchema omits types without a provider", async () => {
    const { payload } = stubPayload();
    const tools = createPayloadTools(payload, { richText: "lexical" });

    const result = await getSchema(tools, { collection: "posts" });

    expect(result.collections[0].types).toBeUndefined();
  });

  test("getSchema includes the global type when a provider is set", async () => {
    const { payload } = stubPayload();
    const tools = createPayloadTools(payload, {
      richText: "lexical",
      typesProvider,
    });

    const result = await getSchema(tools, { global: "settings" });

    expect(result.globals[0].types).toContain("type Settings");
  });
});

describe("createPayloadTools service user", () => {
  test("uses overrideAccess true and no user without a service user", async () => {
    const { find, payload } = stubPayload();
    const tools = createPayloadTools(payload, { richText: "lexical" });

    await getTool(tools, "find").execute({ collection: "posts" });

    const args = find.mock.calls[0][0] as Record<string, unknown>;
    expect(args.overrideAccess).toBe(true);
    expect(args.user).toBeUndefined();
  });

  test("uses overrideAccess false and the user with a service user", async () => {
    const { find, payload } = stubPayload();
    const serviceUser = { collection: "users", id: 1 };
    const tools = createPayloadTools(payload, {
      richText: "lexical",
      serviceUser,
    });

    await getTool(tools, "find").execute({ collection: "posts" });

    const args = find.mock.calls[0][0] as Record<string, unknown>;
    expect(args.overrideAccess).toBe(false);
    expect(args.user).toBe(serviceUser);
  });
});

describe("createPayloadTools read shaping", () => {
  test("find defaults to depth 0 so relationships come back as ids", async () => {
    const { find, payload } = stubPayload();
    const tools = createPayloadTools(payload, { richText: "lexical" });

    await getTool(tools, "find").execute({ collection: "posts" });

    const args = find.mock.calls[0][0] as Record<string, unknown>;
    expect(args.depth).toBe(0);
  });

  test("find forwards an explicit depth", async () => {
    const { find, payload } = stubPayload();
    const tools = createPayloadTools(payload, { richText: "lexical" });

    await getTool(tools, "find").execute({ collection: "posts", depth: 2 });

    const args = find.mock.calls[0][0] as Record<string, unknown>;
    expect(args.depth).toBe(2);
  });

  test("find rejects an oversized result with a recoverable error", async () => {
    const { find, payload } = stubPayload();
    const huge = "x".repeat(200_000);
    find.mockResolvedValueOnce({
      docs: [{ blob: huge, id: "1" }],
      page: 1,
      totalDocs: 1,
      totalPages: 1,
    });
    const tools = createPayloadTools(payload, { richText: "lexical" });

    await expect(
      getTool(tools, "find").execute({ collection: "posts" })
    ).rejects.toThrow(RESULT_TOO_LARGE);
  });
});

describe("createPayloadTools write budget", () => {
  test("createWriteBudget allows up to the limit, then throws", () => {
    const budget = createWriteBudget(2);

    budget.consume();
    budget.consume();

    expect(budget.used).toBe(2);
    expect(() => budget.consume()).toThrow(WRITE_LIMIT_REACHED);
  });

  test("writes share one budget and stop once it is exhausted", async () => {
    const { payload } = stubPayload();
    const tools = createPayloadTools(payload, {
      access: { operations: { delete: true } },
      richText: "lexical",
      writeBudget: createWriteBudget(2),
    });

    await getTool(tools, "create").execute({ collection: "posts", data: {} });
    await getTool(tools, "update").execute({
      collection: "posts",
      data: {},
      id: "1",
    });

    await expect(
      getTool(tools, "deleteDoc").execute({ collection: "posts", id: "1" })
    ).rejects.toThrow(WRITE_LIMIT_REACHED);
  });

  test("reads never consume the budget", async () => {
    const { find, payload } = stubPayload();
    const tools = createPayloadTools(payload, {
      richText: "lexical",
      writeBudget: createWriteBudget(1),
    });

    await getTool(tools, "find").execute({ collection: "posts" });
    await getTool(tools, "find").execute({ collection: "posts" });

    expect(find).toHaveBeenCalledTimes(2);
    // The one allowed write is still available because reads did not consume it.
    await getTool(tools, "create").execute({ collection: "posts", data: {} });
  });
});
