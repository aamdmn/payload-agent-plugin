import type { ServerTool } from "@tanstack/ai";
import { toolDefinition } from "@tanstack/ai";
import type { Attachment } from "chat";
import type { BasePayload, Field, SelectType, Where } from "payload";
import { z } from "zod";
import {
  type AccessControlConfig,
  assertCollectionAllowed,
  assertGlobalAllowed,
  resolveAccessibleCollections,
  resolveAccessibleGlobals,
  resolveOperations,
  type ServiceUser,
} from "./access.js";
import { fileFromAttachment, fileFromUrl, type ResolvedFile } from "./media.js";
import { markdownToRichText, richTextToMarkdown } from "./rich-text.js";
import type { TypesProvider } from "./schema-types.js";

/** Resolves an inbound chat attachment id to its registered attachment. */
export type AttachmentResolver = (id: string) => Attachment | undefined;

/**
 * Per-message cap on write operations. Created fresh for each user message and
 * shared across every Code Mode execution in that turn, so a single request
 * cannot run an unbounded number of mutations (e.g. an accidental or injected
 * bulk delete/update). Reads are never counted.
 */
export interface WriteBudget {
  /** Records one write; throws a recoverable error once the limit is reached. */
  consume: () => void;
  /** Number of writes recorded so far in this turn. */
  readonly used: number;
}

export function createWriteBudget(limit: number): WriteBudget {
  let used = 0;

  return {
    consume() {
      if (used >= limit) {
        throw new Error(
          `Write limit reached: this request already made ${used} change(s), which is the maximum of ${limit} allowed per message. Stop now, tell the user exactly what you changed, and let them know they can ask you to continue.`
        );
      }
      used += 1;
    },
    get used() {
      return used;
    },
  };
}

export interface PayloadToolsOptions {
  /**
   * Restricts which collections the agent can read or write. getSchema and
   * every operation are scoped to the resulting set. Defaults to secure
   * behavior: internal (`payload-*`) and auth collections are denied.
   */
  access?: AccessControlConfig;
  /** Looks up a file the user attached in the current message, by id. */
  resolveAttachment?: AttachmentResolver;
  /** How richText fields are exchanged with the agent (default: 'markdown'). */
  richText?: RichTextMode;
  /**
   * The resolved Payload user the agent acts as. When set, operations run with
   * `overrideAccess: false` against this user; when absent, with full access.
   */
  serviceUser?: null | ServiceUser;
  /**
   * Provides each collection's generated TypeScript type, surfaced by getSchema
   * so the agent writes `data` against real shapes (including block unions).
   */
  typesProvider?: null | TypesProvider;
  /**
   * Caps how many write operations (create/update/delete/upload) the tools may
   * perform before they start rejecting further writes. Reads are never capped.
   */
  writeBudget?: WriteBudget;
}

/**
 * How richText (Lexical) fields are exchanged with the agent.
 * - `markdown`: the agent reads and writes Markdown; the plugin converts to and
 *   from Lexical editor state using Payload's official converters.
 * - `lexical`: no conversion; the agent works with raw Lexical editor state.
 */
export type RichTextMode = "markdown" | "lexical";

interface FieldInfo {
  localized?: boolean;
  name: string;
  options?: string[];
  relationTo?: string;
  required?: boolean;
  type: string;
}

function extractFields(fields: Field[]): FieldInfo[] {
  const result: FieldInfo[] = [];

  for (const field of fields) {
    if (!("name" in field)) {
      continue;
    }

    const info: FieldInfo = { name: field.name, type: field.type };

    if ("required" in field && field.required) {
      info.required = true;
    }

    if ("localized" in field && field.localized) {
      info.localized = true;
    }

    if (field.type === "select" && "options" in field && field.options) {
      info.options = field.options.map((option) =>
        typeof option === "string" ? option : option.value
      );
    }

    if ("relationTo" in field && typeof field.relationTo === "string") {
      info.relationTo = field.relationTo;
    }

    result.push(info);
  }

  return result;
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

function throwPayloadToolError(
  operation: string,
  context: Record<string, unknown>,
  error: unknown
): never {
  const message = getErrorMessage(error);
  const serializedContext = JSON.stringify(context);

  throw new Error(
    `[payload.${operation}] ${message}. Context: ${serializedContext}`
  );
}

const BYTES_PER_KB = 1000;

/**
 * Cap on the serialized size of a single read result handed back to the model.
 * A wide read with populated relationships can balloon to megabytes -- hundreds
 * of thousands of tokens -- which stalls the turn and runs up cost. Past this we
 * reject with a recoverable error telling the agent to narrow the query.
 */
const MAX_READ_RESULT_BYTES = 100_000;

/**
 * Default relationship depth for the agent's reads. 0 returns relationship and
 * upload fields as ids instead of populating the related documents, keeping
 * results small; the agent can raise `depth` per call when it needs related
 * fields inline.
 */
const DEFAULT_READ_DEPTH = 0;

/** Reject a read whose serialized result is too large to feed back to the model. */
function assertReadResultSize(value: unknown, narrowHint: string): void {
  const size = JSON.stringify(value)?.length ?? 0;
  if (size <= MAX_READ_RESULT_BYTES) {
    return;
  }
  const sizeKb = Math.round(size / BYTES_PER_KB);
  const limitKb = Math.round(MAX_READ_RESULT_BYTES / BYTES_PER_KB);
  throw new Error(
    `Result too large (${sizeKb}KB, limit ${limitKb}KB). ${narrowHint}`
  );
}

const readLocaleInput = z
  .string()
  .optional()
  .describe("Locale code, or 'all' to read every locale at once");

const fallbackLocaleInput = z
  .string()
  .optional()
  .describe(
    "Pass 'false' to disable fallback and read only this locale's own values"
  );

const depthInput = z
  .number()
  .optional()
  .describe(
    "Relationship depth to populate (default 0: relationship and upload fields come back as ids). Raise only when you need related fields inline."
  );

const writeLocaleInput = z
  .string()
  .optional()
  .describe("Locale to write to (omit to use the default locale)");

const schemaFields = z.array(
  z.object({
    name: z.string(),
    type: z.string(),
    required: z.boolean().optional(),
    localized: z.boolean().optional(),
    relationTo: z.string().optional(),
    options: z.array(z.string()).optional(),
  })
);

const getSchemaDefinition = toolDefinition({
  name: "getSchema",
  description:
    "Get the schema for Payload CMS collections and globals. Call with a specific collection (or global) before creating or editing it: the result includes that entity's TypeScript type (with block unions) to build `data` against. Omit both to list everything.",
  inputSchema: z.object({
    collection: z
      .string()
      .optional()
      .describe("Collection slug. Omit (with global) to list all."),
    global: z
      .string()
      .optional()
      .describe("Global slug. Omit (with collection) to list all."),
  }),
  outputSchema: z.object({
    collections: z.array(
      z.object({
        slug: z.string(),
        upload: z.boolean().optional(),
        fields: schemaFields,
        types: z.string().optional(),
      })
    ),
    globals: z.array(
      z.object({
        slug: z.string(),
        fields: schemaFields,
        types: z.string().optional(),
      })
    ),
  }),
});

const findDefinition = toolDefinition({
  name: "find",
  description: "Query documents from a Payload CMS collection.",
  inputSchema: z.object({
    collection: z.string().describe("Collection slug"),
    where: z
      .record(z.string(), z.unknown())
      .optional()
      .describe("Payload where query"),
    limit: z.number().optional().describe("Max documents to return"),
    page: z.number().optional().describe("Page number"),
    sort: z
      .string()
      .optional()
      .describe("Field to sort by, prefix with - for descending"),
    select: z
      .record(z.string(), z.boolean())
      .optional()
      .describe("Select specific fields to reduce payload size"),
    depth: depthInput,
    locale: readLocaleInput,
    fallbackLocale: fallbackLocaleInput,
  }),
  outputSchema: z.object({
    docs: z.array(z.record(z.string(), z.unknown())),
    totalDocs: z.number(),
    totalPages: z.number(),
    page: z.number(),
  }),
});

const findByIDDefinition = toolDefinition({
  name: "findByID",
  description: "Get a single document by its ID from a Payload CMS collection.",
  inputSchema: z.object({
    collection: z.string().describe("Collection slug"),
    id: z.string().describe("Document ID"),
    select: z
      .record(z.string(), z.boolean())
      .optional()
      .describe("Select specific fields to reduce payload size"),
    depth: depthInput,
    locale: readLocaleInput,
    fallbackLocale: fallbackLocaleInput,
  }),
  outputSchema: z.record(z.string(), z.unknown()),
});

const createDefinition = toolDefinition({
  name: "create",
  description: "Create a new document in a Payload CMS collection.",
  inputSchema: z.object({
    collection: z.string().describe("Collection slug"),
    data: z.record(z.string(), z.unknown()).describe("Document data"),
    locale: writeLocaleInput,
  }),
  outputSchema: z.record(z.string(), z.unknown()),
});

const updateDefinition = toolDefinition({
  name: "update",
  description: "Update a document by ID in a Payload CMS collection.",
  inputSchema: z.object({
    collection: z.string().describe("Collection slug"),
    id: z.string().describe("Document ID"),
    data: z.record(z.string(), z.unknown()).describe("Fields to update"),
    locale: writeLocaleInput,
  }),
  outputSchema: z.record(z.string(), z.unknown()),
});

const deleteDocDefinition = toolDefinition({
  name: "deleteDoc",
  description: "Delete a document by ID from a Payload CMS collection.",
  inputSchema: z.object({
    collection: z.string().describe("Collection slug"),
    id: z.string().describe("Document ID"),
  }),
  outputSchema: z.record(z.string(), z.unknown()),
});

const countDefinition = toolDefinition({
  name: "count",
  description:
    "Count documents in a Payload CMS collection, optionally filtered by a where query.",
  inputSchema: z.object({
    collection: z.string().describe("Collection slug"),
    where: z
      .record(z.string(), z.unknown())
      .optional()
      .describe("Payload where query"),
    locale: readLocaleInput,
  }),
  outputSchema: z.object({
    totalDocs: z.number(),
  }),
});

const uploadFileDefinition = toolDefinition({
  name: "uploadFile",
  description:
    "Upload a file to a Payload upload collection (e.g. media). Provide either attachmentId (a file the user attached in this message) or url (to fetch the file from). Returns the created document; use its id in upload or relationship fields.",
  inputSchema: z.object({
    collection: z
      .string()
      .describe("Upload-enabled collection slug (e.g. media)"),
    attachmentId: z
      .string()
      .optional()
      .describe("Id of a file the user attached in this message"),
    url: z
      .string()
      .optional()
      .describe("URL to fetch the file from (alternative to attachmentId)"),
    data: z
      .record(z.string(), z.unknown())
      .optional()
      .describe("Other document fields, e.g. { alt: 'A red bicycle' }"),
    locale: writeLocaleInput,
  }),
  outputSchema: z.record(z.string(), z.unknown()),
});

const findGlobalDefinition = toolDefinition({
  name: "findGlobal",
  description:
    "Read a Payload CMS global -- a singleton document such as site settings or a header. Globals have no id and cannot be created or deleted.",
  inputSchema: z.object({
    slug: z.string().describe("Global slug"),
    select: z
      .record(z.string(), z.boolean())
      .optional()
      .describe("Select specific fields to reduce payload size"),
    depth: depthInput,
    locale: readLocaleInput,
    fallbackLocale: fallbackLocaleInput,
  }),
  outputSchema: z.record(z.string(), z.unknown()),
});

const updateGlobalDefinition = toolDefinition({
  name: "updateGlobal",
  description:
    "Update a Payload CMS global (a singleton document). Pass only the fields you want to change.",
  inputSchema: z.object({
    slug: z.string().describe("Global slug"),
    data: z.record(z.string(), z.unknown()).describe("Fields to update"),
    locale: writeLocaleInput,
  }),
  outputSchema: z.record(z.string(), z.unknown()),
});

// biome-ignore lint/suspicious/noExplicitAny: Payload's collection slug type requires generic inference
type AnyCollection = any;

// biome-ignore lint/suspicious/noExplicitAny: Payload's global slug type requires generic inference
type AnyGlobal = any;

function getCollectionFields(
  payload: BasePayload,
  slug: string
): Field[] | null {
  const collection = payload.config.collections.find(
    (item) => item.slug === slug
  );

  return collection ? collection.fields : null;
}

function getGlobalFields(payload: BasePayload, slug: string): Field[] | null {
  const global = payload.config.globals?.find((item) => item.slug === slug);

  return global ? global.fields : null;
}

export function createPayloadTools(
  payload: BasePayload,
  options: PayloadToolsOptions = {}
): ServerTool[] {
  const richText = options.richText ?? "markdown";
  const { resolveAttachment, typesProvider, writeBudget } = options;
  const localizationEnabled = Boolean(payload.config.localization);
  const accessible = resolveAccessibleCollections(
    payload.config.collections,
    options.access
  );
  const accessibleGlobals = resolveAccessibleGlobals(
    payload.config.globals ?? [],
    options.access
  );
  const hasGlobals = accessibleGlobals.size > 0;
  const hasUploadCollections = payload.config.collections.some(
    (item) => accessible.has(item.slug) && Boolean(item.upload)
  );

  // With a service user, enforce Payload access control against it; otherwise
  // fall back to full access (still bounded by collection/operation scoping).
  const accessArgs = options.serviceUser
    ? { overrideAccess: false, user: options.serviceUser }
    : { overrideAccess: true };

  // Resolve a file to upload from either a registered chat attachment or a URL.
  const resolveFile = (
    attachmentId?: string,
    url?: string
  ): Promise<ResolvedFile> => {
    if (attachmentId) {
      const attachment = resolveAttachment?.(attachmentId);
      if (!attachment) {
        throw new Error(
          `No attachment with id "${attachmentId}" in this message`
        );
      }
      return fileFromAttachment(attachment);
    }

    if (url) {
      return fileFromUrl(url);
    }

    throw new Error("Provide either attachmentId or url to upload a file");
  };

  // Only forward locale options when localization is configured. Payload
  // normalizes a `fallbackLocale` of 'false'/'none'/'null' to no fallback.
  const localeArgs = (
    locale?: string,
    fallbackLocale?: string
  ): { fallbackLocale?: string; locale?: string } => {
    if (!localizationEnabled) {
      return {};
    }

    return {
      ...(locale ? { locale } : {}),
      ...(fallbackLocale === undefined ? {} : { fallbackLocale }),
    };
  };

  // Encode agent-supplied Markdown into Lexical editor state before writing.
  // Takes the entity's resolved fields so it serves both collections and globals.
  const encodeRichText = async (
    fields: Field[] | null,
    data: Record<string, unknown>
  ): Promise<void> => {
    if (richText !== "markdown" || !fields) {
      return;
    }

    await markdownToRichText(fields, data);
  };

  // Decode stored Lexical editor state into Markdown before returning to agent.
  const decodeRichText = async (
    fields: Field[] | null,
    doc: Record<string, unknown>
  ): Promise<void> => {
    if (richText !== "markdown" || !fields) {
      return;
    }

    await richTextToMarkdown(fields, doc);
  };

  const tools = [
    getSchemaDefinition.server(({ collection, global }) => {
      // A targeted call (collection or global named) returns only that side;
      // a bare call lists every accessible collection and global.
      const targeted = Boolean(collection) || Boolean(global);

      const collections = payload.config.collections.filter((item) => {
        if (!accessible.has(item.slug)) {
          return false;
        }
        if (collection) {
          return item.slug === collection;
        }
        return !targeted;
      });

      const globals = (payload.config.globals ?? []).filter((item) => {
        if (!accessibleGlobals.has(item.slug)) {
          return false;
        }
        if (global) {
          return item.slug === global;
        }
        return !targeted;
      });

      return {
        collections: collections.map((item) => ({
          slug: item.slug,
          upload: item.upload ? true : undefined,
          fields: extractFields(item.fields),
          types:
            collection && typesProvider
              ? (typesProvider.getCollectionType(item.slug) ?? undefined)
              : undefined,
        })),
        globals: globals.map((item) => ({
          slug: item.slug,
          fields: extractFields(item.fields),
          types:
            global && typesProvider
              ? (typesProvider.getGlobalType(item.slug) ?? undefined)
              : undefined,
        })),
      };
    }),

    findDefinition.server(
      async ({
        collection,
        where,
        limit,
        page,
        sort,
        select,
        depth,
        locale,
        fallbackLocale,
      }) => {
        assertCollectionAllowed(collection, accessible);
        try {
          const result = await payload.find({
            collection: collection as AnyCollection,
            where: where as Where | undefined,
            limit,
            page,
            sort,
            depth: depth ?? DEFAULT_READ_DEPTH,
            select: select as SelectType | undefined,
            ...localeArgs(locale, fallbackLocale),
            ...accessArgs,
          });

          const docs = result.docs as Record<string, unknown>[];
          const fields = getCollectionFields(payload, collection);
          for (const doc of docs) {
            await decodeRichText(fields, doc);
          }

          const output = {
            docs,
            totalDocs: result.totalDocs,
            totalPages: result.totalPages,
            page: result.page ?? 1,
          };
          assertReadResultSize(
            output,
            "Narrow it: add a where filter, keep depth at 0 so relationships stay as ids, select fewer fields, or lower limit and page through."
          );
          return output;
        } catch (error) {
          throwPayloadToolError(
            "find",
            {
              collection,
              hasSelect: Boolean(select),
              hasWhere: Boolean(where),
              limit,
              page,
              sort,
            },
            error
          );
        }
      }
    ),

    findByIDDefinition.server(
      async ({ collection, id, select, depth, locale, fallbackLocale }) => {
        assertCollectionAllowed(collection, accessible);
        try {
          const doc = await payload.findByID({
            collection: collection as AnyCollection,
            id,
            depth: depth ?? DEFAULT_READ_DEPTH,
            select: select as SelectType | undefined,
            ...localeArgs(locale, fallbackLocale),
            ...accessArgs,
          });

          const result = doc as Record<string, unknown>;
          await decodeRichText(
            getCollectionFields(payload, collection),
            result
          );
          assertReadResultSize(
            result,
            "Reduce it: select fewer fields, or keep depth at 0 so relationships stay as ids."
          );
          return result;
        } catch (error) {
          throwPayloadToolError(
            "findByID",
            { collection, hasSelect: Boolean(select), id },
            error
          );
        }
      }
    ),

    createDefinition.server(async ({ collection, data, locale }) => {
      assertCollectionAllowed(collection, accessible);
      writeBudget?.consume();
      try {
        const fields = getCollectionFields(payload, collection);
        await encodeRichText(fields, data);

        const doc = await payload.create({
          collection: collection as AnyCollection,
          data,
          ...localeArgs(locale),
          ...accessArgs,
        });

        const result = doc as Record<string, unknown>;
        await decodeRichText(fields, result);
        return result;
      } catch (error) {
        throwPayloadToolError(
          "create",
          { collection, dataKeys: Object.keys(data) },
          error
        );
      }
    }),

    updateDefinition.server(async ({ collection, id, data, locale }) => {
      assertCollectionAllowed(collection, accessible);
      writeBudget?.consume();
      try {
        const fields = getCollectionFields(payload, collection);
        await encodeRichText(fields, data);

        const doc = await payload.update({
          collection: collection as AnyCollection,
          id,
          data,
          ...localeArgs(locale),
          ...accessArgs,
        });

        const result = doc as Record<string, unknown>;
        await decodeRichText(fields, result);
        return result;
      } catch (error) {
        throwPayloadToolError(
          "update",
          { collection, id, dataKeys: Object.keys(data) },
          error
        );
      }
    }),

    deleteDocDefinition.server(async ({ collection, id }) => {
      assertCollectionAllowed(collection, accessible);
      writeBudget?.consume();
      try {
        const doc = await payload.delete({
          collection: collection as AnyCollection,
          id,
          ...accessArgs,
        });

        return doc as Record<string, unknown>;
      } catch (error) {
        throwPayloadToolError("delete", { collection, id }, error);
      }
    }),

    countDefinition.server(async ({ collection, where, locale }) => {
      assertCollectionAllowed(collection, accessible);
      try {
        const result = await payload.count({
          collection: collection as AnyCollection,
          where: where as Where | undefined,
          ...localeArgs(locale),
          ...accessArgs,
        });

        return { totalDocs: result.totalDocs };
      } catch (error) {
        throwPayloadToolError(
          "count",
          { collection, hasWhere: Boolean(where) },
          error
        );
      }
    }),
  ] as ServerTool[];

  // Only expose uploadFile when at least one upload-enabled collection exists.
  if (hasUploadCollections) {
    tools.push(
      uploadFileDefinition.server(
        async ({ collection, attachmentId, url, data, locale }) => {
          assertCollectionAllowed(collection, accessible);
          writeBudget?.consume();
          try {
            const file = await resolveFile(attachmentId, url);

            const doc = await payload.create({
              collection: collection as AnyCollection,
              data: data ?? {},
              file,
              ...localeArgs(locale),
              ...accessArgs,
            });

            const result = doc as Record<string, unknown>;
            await decodeRichText(
              getCollectionFields(payload, collection),
              result
            );
            return result;
          } catch (error) {
            throwPayloadToolError(
              "uploadFile",
              {
                collection,
                hasAttachment: Boolean(attachmentId),
                hasUrl: Boolean(url),
              },
              error
            );
          }
        }
      ) as ServerTool
    );
  }

  // Only expose global tools when at least one global is accessible.
  if (hasGlobals) {
    tools.push(
      findGlobalDefinition.server(
        async ({ slug, select, depth, locale, fallbackLocale }) => {
          assertGlobalAllowed(slug, accessibleGlobals);
          try {
            const doc = await payload.findGlobal({
              slug: slug as AnyGlobal,
              depth: depth ?? DEFAULT_READ_DEPTH,
              select: select as SelectType | undefined,
              ...localeArgs(locale, fallbackLocale),
              ...accessArgs,
            });

            const result = doc as Record<string, unknown>;
            await decodeRichText(getGlobalFields(payload, slug), result);
            assertReadResultSize(
              result,
              "Reduce it: select fewer fields, or keep depth at 0 so relationships stay as ids."
            );
            return result;
          } catch (error) {
            throwPayloadToolError(
              "findGlobal",
              { slug, hasSelect: Boolean(select) },
              error
            );
          }
        }
      ) as ServerTool,
      updateGlobalDefinition.server(async ({ slug, data, locale }) => {
        assertGlobalAllowed(slug, accessibleGlobals);
        writeBudget?.consume();
        try {
          const fields = getGlobalFields(payload, slug);
          await encodeRichText(fields, data);

          const doc = await payload.updateGlobal({
            slug: slug as AnyGlobal,
            data,
            ...localeArgs(locale),
            ...accessArgs,
          });

          const result = doc as Record<string, unknown>;
          await decodeRichText(fields, result);
          return result;
        } catch (error) {
          throwPayloadToolError(
            "updateGlobal",
            { slug, dataKeys: Object.keys(data) },
            error
          );
        }
      }) as ServerTool
    );
  }

  // Drop the tools for disabled write operations so the agent never sees them.
  // Reads stay; delete is off unless explicitly enabled. uploadFile is a create.
  const operations = resolveOperations(options.access);
  const disabledTools = new Set<string>();
  if (!operations.create) {
    disabledTools.add("create");
    disabledTools.add("uploadFile");
  }
  if (!operations.update) {
    disabledTools.add("update");
    disabledTools.add("updateGlobal");
  }
  if (!operations.delete) {
    disabledTools.add("deleteDoc");
  }

  return tools.filter((tool) => !disabledTools.has(tool.name));
}

function describeFields(fields: FieldInfo[], richText: RichTextMode): string {
  return fields
    .map((field) => {
      let description = `${field.name} (${field.type}`;

      if (field.required) {
        description += ", required";
      }

      if (field.localized) {
        description += ", localized";
      }

      if (richText === "markdown" && field.type === "richText") {
        description += ", markdown";
      }

      if (field.relationTo) {
        description += ` -> ${field.relationTo}`;
      }

      if (field.options) {
        description += `, options: ${field.options.join(" | ")}`;
      }

      description += ")";
      return description;
    })
    .join(", ");
}

export function buildSchemaDescription(
  payload: BasePayload,
  richText: RichTextMode = "markdown",
  access?: AccessControlConfig
): string {
  const lines: string[] = [];
  const accessible = resolveAccessibleCollections(
    payload.config.collections,
    access
  );

  for (const collection of payload.config.collections) {
    if (!accessible.has(collection.slug)) {
      continue;
    }

    const fieldDescriptions = describeFields(
      extractFields(collection.fields),
      richText
    );
    const uploadMarker = collection.upload ? " (upload collection)" : "";
    lines.push(`- ${collection.slug}${uploadMarker}: ${fieldDescriptions}`);
  }

  return lines.join("\n");
}

/**
 * A one-line-per-global summary of accessible globals, mirroring
 * buildSchemaDescription. Returns "" when no globals are accessible.
 */
export function buildGlobalsDescription(
  payload: BasePayload,
  richText: RichTextMode = "markdown",
  access?: AccessControlConfig
): string {
  const globals = payload.config.globals ?? [];
  const accessible = resolveAccessibleGlobals(globals, access);
  const lines: string[] = [];

  for (const global of globals) {
    if (!accessible.has(global.slug)) {
      continue;
    }

    const fieldDescriptions = describeFields(
      extractFields(global.fields),
      richText
    );
    lines.push(`- ${global.slug}: ${fieldDescriptions}`);
  }

  return lines.join("\n");
}
