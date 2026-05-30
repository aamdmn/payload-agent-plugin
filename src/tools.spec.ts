import type { BasePayload } from "payload";
import { describe, expect, test, vi } from "vitest";
import { createPayloadTools } from "./tools.js";

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

const NOT_ACCESSIBLE = /not accessible/;

const collections: StubCollection[] = [
  { slug: "posts", fields: [] },
  { slug: "users", auth: {}, fields: [] },
  { slug: "media", upload: {}, fields: [] },
];

function stubPayload(): {
  find: ReturnType<typeof vi.fn>;
  payload: BasePayload;
} {
  const find = vi
    .fn()
    .mockResolvedValue({ docs: [], page: 1, totalDocs: 0, totalPages: 0 });

  const payload = {
    config: { collections, localization: false },
    count: vi.fn(),
    create: vi.fn(),
    delete: vi.fn(),
    find,
    findByID: vi.fn(),
    update: vi.fn(),
  } as unknown as BasePayload;

  return { find, payload };
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
  };

  const getSchema = async (
    tools: unknown[],
    args: Record<string, unknown>
  ): Promise<{ collections: { types?: string }[] }> =>
    (await getTool(tools, "getSchema").execute(args)) as {
      collections: { types?: string }[];
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
