import type { ServerTool } from "@tanstack/ai";
import { toolDefinition } from "@tanstack/ai";
import type { Attachment } from "chat";
import type { BasePayload, Field, SelectType, Where } from "payload";
import { z } from "zod";
import {
  type AccessControlConfig,
  assertCollectionAllowed,
  resolveAccessibleCollections,
  resolveOperations,
  type ServiceUser,
} from "./access.js";
import { fileFromAttachment, fileFromUrl, type ResolvedFile } from "./media.js";
import { markdownToRichText, richTextToMarkdown } from "./rich-text.js";
import type { TypesProvider } from "./schema-types.js";

/** Resolves an inbound chat attachment id to its registered attachment. */
export type AttachmentResolver = (id: string) => Attachment | undefined;

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

const writeLocaleInput = z
  .string()
  .optional()
  .describe("Locale to write to (omit to use the default locale)");

const getSchemaDefinition = toolDefinition({
  name: "getSchema",
  description:
    "Get the schema for one or all Payload CMS collections. Call with a specific collection before creating or editing it: the result includes that collection's TypeScript type (with block unions) to build `data` against. Omit the collection to list all.",
  inputSchema: z.object({
    collection: z
      .string()
      .optional()
      .describe("Collection slug. Omit to list all collections."),
  }),
  outputSchema: z.object({
    collections: z.array(
      z.object({
        slug: z.string(),
        upload: z.boolean().optional(),
        fields: z.array(
          z.object({
            name: z.string(),
            type: z.string(),
            required: z.boolean().optional(),
            localized: z.boolean().optional(),
            relationTo: z.string().optional(),
            options: z.array(z.string()).optional(),
          })
        ),
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

// biome-ignore lint/suspicious/noExplicitAny: Payload's collection slug type requires generic inference
type AnyCollection = any;

function getCollectionFields(
  payload: BasePayload,
  slug: string
): Field[] | null {
  const collection = payload.config.collections.find(
    (item) => item.slug === slug
  );

  return collection ? collection.fields : null;
}

export function createPayloadTools(
  payload: BasePayload,
  options: PayloadToolsOptions = {}
): ServerTool[] {
  const richText = options.richText ?? "markdown";
  const { resolveAttachment, typesProvider } = options;
  const localizationEnabled = Boolean(payload.config.localization);
  const accessible = resolveAccessibleCollections(
    payload.config.collections,
    options.access
  );
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
  const encodeRichText = async (
    collection: string,
    data: Record<string, unknown>
  ): Promise<void> => {
    if (richText !== "markdown") {
      return;
    }

    const fields = getCollectionFields(payload, collection);
    if (fields) {
      await markdownToRichText(fields, data);
    }
  };

  // Decode stored Lexical editor state into Markdown before returning to agent.
  const decodeRichText = async (
    collection: string,
    doc: Record<string, unknown>
  ): Promise<void> => {
    if (richText !== "markdown") {
      return;
    }

    const fields = getCollectionFields(payload, collection);
    if (fields) {
      await richTextToMarkdown(fields, doc);
    }
  };

  const tools = [
    getSchemaDefinition.server(({ collection }) => {
      const collections = payload.config.collections.filter((item) => {
        if (!accessible.has(item.slug)) {
          return false;
        }
        return collection ? item.slug === collection : true;
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
            select: select as SelectType | undefined,
            ...localeArgs(locale, fallbackLocale),
            ...accessArgs,
          });

          const docs = result.docs as Record<string, unknown>[];
          for (const doc of docs) {
            await decodeRichText(collection, doc);
          }

          return {
            docs,
            totalDocs: result.totalDocs,
            totalPages: result.totalPages,
            page: result.page ?? 1,
          };
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
      async ({ collection, id, select, locale, fallbackLocale }) => {
        assertCollectionAllowed(collection, accessible);
        try {
          const doc = await payload.findByID({
            collection: collection as AnyCollection,
            id,
            select: select as SelectType | undefined,
            ...localeArgs(locale, fallbackLocale),
            ...accessArgs,
          });

          const result = doc as Record<string, unknown>;
          await decodeRichText(collection, result);
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
      try {
        await encodeRichText(collection, data);

        const doc = await payload.create({
          collection: collection as AnyCollection,
          data,
          ...localeArgs(locale),
          ...accessArgs,
        });

        const result = doc as Record<string, unknown>;
        await decodeRichText(collection, result);
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
      try {
        await encodeRichText(collection, data);

        const doc = await payload.update({
          collection: collection as AnyCollection,
          id,
          data,
          ...localeArgs(locale),
          ...accessArgs,
        });

        const result = doc as Record<string, unknown>;
        await decodeRichText(collection, result);
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
            await decodeRichText(collection, result);
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
  }
  if (!operations.delete) {
    disabledTools.add("deleteDoc");
  }

  return tools.filter((tool) => !disabledTools.has(tool.name));
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

    const fields = extractFields(collection.fields);
    const fieldDescriptions = fields
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

    const uploadMarker = collection.upload ? " (upload collection)" : "";
    lines.push(`- ${collection.slug}${uploadMarker}: ${fieldDescriptions}`);
  }

  return lines.join("\n");
}
