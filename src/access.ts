/**
 * Access control for the agent's Payload operations.
 *
 * The agent reaches Payload through the Local API, so by default it could touch
 * every collection -- including Payload's internal collections and any
 * auth-enabled collection holding credentials. This module narrows that surface
 * to an explicit, secure-by-default set of collections.
 */

import type { Message, Thread } from "chat";
import type { BasePayload } from "payload";

// biome-ignore lint/suspicious/noExplicitAny: Payload's collection slug type requires generic inference
type AnyCollection = any;

/** A collection shape we can scope; matches Payload's sanitized collections. */
interface ScopeableCollection {
  auth?: unknown;
  slug: string;
}

/** Controls which collections the agent may read or write. */
export interface CollectionAccessConfig {
  /**
   * If set, the agent may access ONLY these collections. Listing a collection
   * here overrides the secure-by-default denial, so an internal or auth
   * collection can be exposed deliberately.
   */
  allow?: string[];
  /** Collections to deny on top of the secure-by-default set. */
  deny?: string[];
}

/** Controls which globals the agent may read or update. */
export interface GlobalAccessConfig {
  /**
   * If set, the agent may access ONLY these globals. Listing a global here
   * overrides the secure-by-default denial of internal (`payload-*`) globals.
   */
  allow?: string[];
  /** Globals to deny on top of the secure-by-default set. */
  deny?: string[];
}

/** Controls which write operations the agent may perform. Reads are always allowed. */
export interface OperationAccessConfig {
  /**
   * Allow creating documents, including uploading files (default: true).
   * `uploadFile` is a create, so it is governed by this flag too.
   */
  create?: boolean;
  /** Allow deleting documents (default: false). */
  delete?: boolean;
  /** Allow updating documents (default: true). */
  update?: boolean;
}

/**
 * The Payload user the agent acts as. Either a reference resolved at startup,
 * or a function that returns the user (which must carry its `collection`).
 */
export type ServiceUserConfig =
  | ((payload: BasePayload) => Promise<ServiceUser> | ServiceUser)
  | { collection: string; id: number | string };

/** A resolved service user, carrying the auth `collection` Payload needs. */
export type ServiceUser = Record<string, unknown> & { collection: string };

/** Context passed to `authorize` for each inbound message. */
export interface AuthorizeContext {
  /** The raw inbound message. */
  message: Message;
  /** Chat platform name (e.g. "telegram"). */
  platform: string;
  /** The thread the message arrived on. */
  thread: Thread;
  /** Stable thread identifier. */
  threadId: string;
  /** The sender's platform user id. */
  userId: string;
  /** The sender's username/handle. */
  userName: string;
}

/** Decides whether an inbound message may be handled by the agent. */
export type Authorize = (ctx: AuthorizeContext) => boolean | Promise<boolean>;

/** Access-control configuration for the agent. */
export interface AccessControlConfig {
  /**
   * Gate which inbound chat messages the agent answers. Runs before the agent
   * for every message; return false to refuse. Without it, the agent answers
   * everyone who can reach the bot.
   */
  authorize?: Authorize;
  /**
   * Restrict which collections the agent can read or write. By default the
   * agent can access every collection except Payload's internal collections
   * (slugs starting with `payload-`) and auth-enabled collections.
   */
  collections?: CollectionAccessConfig;
  /**
   * Restrict which globals the agent can read or update. By default the agent
   * can access every global except Payload's internal ones (`payload-*`).
   */
  globals?: GlobalAccessConfig;
  /**
   * Restrict which write operations the agent may perform. By default the agent
   * can create and update but NOT delete. Reads are always allowed.
   */
  operations?: OperationAccessConfig;
  /**
   * The Payload user the agent acts as. When set, every operation runs with
   * `overrideAccess: false` so Payload's own access control and field-level
   * access apply. When omitted, operations run with full access, bounded only
   * by `collections` and `operations` scoping.
   */
  serviceUser?: ServiceUserConfig;
  /**
   * Message posted when `authorize` denies a sender. Defaults to a short
   * refusal; set to `null` to stay silent.
   */
  unauthorizedMessage?: null | string;
}

/** Operation permissions with secure defaults applied. */
export interface ResolvedOperations {
  create: boolean;
  delete: boolean;
  update: boolean;
}

/**
 * Resolve operation permissions. Writes are opt-out except `delete`, which is
 * opt-in (off by default) because it is the most destructive and the easiest
 * for prompt injection to weaponize.
 */
export function resolveOperations(
  config: AccessControlConfig = {}
): ResolvedOperations {
  const operations = config.operations ?? {};

  return {
    create: operations.create !== false,
    delete: operations.delete === true,
    update: operations.update !== false,
  };
}

const INTERNAL_SLUG_PREFIX = "payload-";

/**
 * A collection Payload manages internally (slug `payload-*`) or one with auth
 * enabled (holds password hashes, sessions, API keys). Denied unless the
 * consumer opts in via `allow`. Payload only sets `auth` on the sanitized
 * config for auth-enabled collections, so its truthiness is the discriminator.
 */
function isSensitiveCollection(collection: ScopeableCollection): boolean {
  return (
    collection.slug.startsWith(INTERNAL_SLUG_PREFIX) || Boolean(collection.auth)
  );
}

/**
 * Resolve the set of collection slugs the agent may access.
 *
 * - `deny` always wins.
 * - With `allow`, only the listed collections are accessible (a whitelist that
 *   overrides the secure-by-default denial).
 * - Without `allow`, every collection is accessible except sensitive ones.
 */
export function resolveAccessibleCollections(
  collections: ScopeableCollection[],
  config: AccessControlConfig = {}
): Set<string> {
  const { allow, deny } = config.collections ?? {};
  const denied = new Set(deny ?? []);

  const slugs = collections
    .filter((collection) => {
      if (denied.has(collection.slug)) {
        return false;
      }
      if (allow) {
        return allow.includes(collection.slug);
      }
      return !isSensitiveCollection(collection);
    })
    .map((collection) => collection.slug);

  return new Set(slugs);
}

/**
 * Throw a clear, agent-recoverable error when an operation targets a collection
 * outside the accessible set.
 */
export function assertCollectionAllowed(
  slug: string,
  accessible: Set<string>
): void {
  if (!accessible.has(slug)) {
    throw new Error(
      `Collection "${slug}" is not accessible to the agent. Call getSchema to see the collections you can use.`
    );
  }
}

/** A global shape we can scope; matches Payload's sanitized globals. */
interface ScopeableGlobal {
  slug: string;
}

/**
 * Resolve the set of global slugs the agent may access. Mirrors collection
 * scoping: `deny` always wins, `allow` is a whitelist that overrides the
 * secure-by-default denial, and without `allow` every global is accessible
 * except internal (`payload-*`) ones. Globals never hold credentials, so there
 * is no auth concept here.
 */
export function resolveAccessibleGlobals(
  globals: ScopeableGlobal[],
  config: AccessControlConfig = {}
): Set<string> {
  const { allow, deny } = config.globals ?? {};
  const denied = new Set(deny ?? []);

  const slugs = globals
    .filter((global) => {
      if (denied.has(global.slug)) {
        return false;
      }
      if (allow) {
        return allow.includes(global.slug);
      }
      return !global.slug.startsWith(INTERNAL_SLUG_PREFIX);
    })
    .map((global) => global.slug);

  return new Set(slugs);
}

/**
 * Throw a clear, agent-recoverable error when an operation targets a global
 * outside the accessible set.
 */
export function assertGlobalAllowed(
  slug: string,
  accessible: Set<string>
): void {
  if (!accessible.has(slug)) {
    throw new Error(
      `Global "${slug}" is not accessible to the agent. Call getSchema to see the globals you can use.`
    );
  }
}

/**
 * Resolve the configured service user to a Payload user object usable as the
 * `user` on operations. Loaded once at startup with `overrideAccess: true`
 * (trusted bootstrap of the configured identity). Returns null when no service
 * user is configured, in which case the agent runs with full access.
 */
export async function resolveServiceUser(
  payload: BasePayload,
  config: AccessControlConfig = {}
): Promise<null | ServiceUser> {
  const { serviceUser } = config;
  if (!serviceUser) {
    return null;
  }

  if (typeof serviceUser === "function") {
    return await serviceUser(payload);
  }

  const { collection, id } = serviceUser;
  const user = await payload.findByID({
    collection: collection as AnyCollection,
    depth: 0,
    disableErrors: true,
    id,
    overrideAccess: true,
  });

  if (!user) {
    throw new Error(
      `access.serviceUser: no document with id "${id}" in collection "${collection}".`
    );
  }

  return { ...(user as Record<string, unknown>), collection };
}

/** Outcome of an authorization check; carries the error so the caller can log it. */
export type AuthorizationResult =
  | { error: unknown; status: "error" }
  | { status: "allow" }
  | { status: "deny" };

/**
 * Run the `authorize` gate, failing closed: a missing gate allows, a thrown
 * gate yields "error" (the caller logs and refuses) rather than allowing.
 */
export async function runAuthorize(
  authorize: Authorize | undefined,
  ctx: AuthorizeContext
): Promise<AuthorizationResult> {
  if (!authorize) {
    return { status: "allow" };
  }

  try {
    const allowed = await authorize(ctx);
    return { status: allowed ? "allow" : "deny" };
  } catch (error) {
    return { error, status: "error" };
  }
}
