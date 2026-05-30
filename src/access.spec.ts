import type { BasePayload } from "payload";
import { describe, expect, test, vi } from "vitest";
import {
  type AccessControlConfig,
  type AuthorizeContext,
  assertCollectionAllowed,
  resolveAccessibleCollections,
  resolveOperations,
  resolveServiceUser,
  runAuthorize,
} from "./access.js";

interface TestCollection {
  auth?: unknown;
  slug: string;
}

const collections: TestCollection[] = [
  { slug: "posts" },
  { slug: "media" },
  { slug: "users", auth: {} },
  { slug: "payload-preferences" },
  { slug: "payload-migrations" },
  { slug: "payload-locked-documents" },
];

const resolve = (config?: AccessControlConfig): Set<string> =>
  resolveAccessibleCollections(collections, config);

const NOT_ACCESSIBLE = /not accessible/;

describe("resolveAccessibleCollections", () => {
  test("allows ordinary collections and denies internal + auth by default", () => {
    const accessible = resolve();

    expect(accessible.has("posts")).toBe(true);
    expect(accessible.has("media")).toBe(true);
    expect(accessible.has("users")).toBe(false);
    expect(accessible.has("payload-preferences")).toBe(false);
    expect(accessible.has("payload-migrations")).toBe(false);
    expect(accessible.has("payload-locked-documents")).toBe(false);
  });

  test("allow acts as a whitelist", () => {
    const accessible = resolve({ collections: { allow: ["posts"] } });

    expect([...accessible]).toEqual(["posts"]);
  });

  test("allow can expose an otherwise-denied auth collection", () => {
    const accessible = resolve({ collections: { allow: ["users"] } });

    expect(accessible.has("users")).toBe(true);
    expect(accessible.has("posts")).toBe(false);
  });

  test("deny removes a collection that is otherwise allowed", () => {
    const accessible = resolve({ collections: { deny: ["posts"] } });

    expect(accessible.has("posts")).toBe(false);
    expect(accessible.has("media")).toBe(true);
  });

  test("deny wins over allow", () => {
    const accessible = resolve({
      collections: { allow: ["posts", "media"], deny: ["posts"] },
    });

    expect(accessible.has("posts")).toBe(false);
    expect(accessible.has("media")).toBe(true);
  });
});

describe("assertCollectionAllowed", () => {
  test("passes for an accessible collection", () => {
    expect(() =>
      assertCollectionAllowed("posts", new Set(["posts"]))
    ).not.toThrow();
  });

  test("throws a recoverable error for a denied collection", () => {
    expect(() => assertCollectionAllowed("users", new Set(["posts"]))).toThrow(
      NOT_ACCESSIBLE
    );
  });
});

describe("resolveOperations", () => {
  test("creates and updates by default, never deletes", () => {
    expect(resolveOperations()).toEqual({
      create: true,
      delete: false,
      update: true,
    });
  });

  test("delete is opt-in", () => {
    expect(resolveOperations({ operations: { delete: true } }).delete).toBe(
      true
    );
  });

  test("create and update are opt-out", () => {
    const operations = resolveOperations({
      operations: { create: false, update: false },
    });

    expect(operations.create).toBe(false);
    expect(operations.update).toBe(false);
  });
});

const NO_DOCUMENT = /no document/;

describe("resolveServiceUser", () => {
  test("returns null when no service user is configured", async () => {
    const payload = {} as unknown as BasePayload;

    expect(await resolveServiceUser(payload)).toBeNull();
  });

  test("loads the descriptor user with overrideAccess and tags its collection", async () => {
    const findByID = vi.fn().mockResolvedValue({ id: 7, roles: ["editor"] });
    const payload = { findByID } as unknown as BasePayload;

    const user = await resolveServiceUser(payload, {
      serviceUser: { collection: "users", id: 7 },
    });

    expect(user).toMatchObject({
      collection: "users",
      id: 7,
      roles: ["editor"],
    });
    expect(findByID).toHaveBeenCalledWith(
      expect.objectContaining({
        collection: "users",
        id: 7,
        overrideAccess: true,
      })
    );
  });

  test("throws when the descriptor user does not exist", async () => {
    const findByID = vi.fn().mockResolvedValue(null);
    const payload = { findByID } as unknown as BasePayload;

    await expect(
      resolveServiceUser(payload, {
        serviceUser: { collection: "users", id: 99 },
      })
    ).rejects.toThrow(NO_DOCUMENT);
  });

  test("supports a resolver function", async () => {
    const payload = {} as unknown as BasePayload;

    const user = await resolveServiceUser(payload, {
      serviceUser: () => ({ collection: "users", id: 1 }),
    });

    expect(user).toEqual({ collection: "users", id: 1 });
  });
});

describe("runAuthorize", () => {
  const ctx = {
    platform: "telegram",
    threadId: "t1",
    userId: "u1",
    userName: "alice",
  } as unknown as AuthorizeContext;

  test("allows when no authorize is configured", async () => {
    expect(await runAuthorize(undefined, ctx)).toEqual({ status: "allow" });
  });

  test("allows or denies based on the return value", async () => {
    expect(await runAuthorize(() => true, ctx)).toEqual({ status: "allow" });
    expect(await runAuthorize(() => false, ctx)).toEqual({ status: "deny" });
  });

  test("fails closed and carries the error when authorize throws", async () => {
    const boom = new Error("db down");

    const result = await runAuthorize(() => {
      throw boom;
    }, ctx);

    expect(result).toEqual({ error: boom, status: "error" });
  });
});
