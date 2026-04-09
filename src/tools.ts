import type { ServerTool } from "@tanstack/ai";
import { toolDefinition } from "@tanstack/ai";
import type { BasePayload, Field, Where } from "payload";
import { z } from "zod";

interface FieldInfo {
  name: string;
  options?: string[];
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

    if (field.type === "select" && "options" in field && field.options) {
      info.options = field.options.map((option) =>
        typeof option === "string" ? option : option.value
      );
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

const getSchemaDefinition = toolDefinition({
  name: "getSchema",
  description:
    "Get the schema (field names and types) for one or all Payload CMS collections. Call this first to understand what data is available.",
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
        fields: z.array(
          z.object({
            name: z.string(),
            type: z.string(),
            required: z.boolean().optional(),
            options: z.array(z.string()).optional(),
          })
        ),
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
  }),
  outputSchema: z.record(z.string(), z.unknown()),
});

const createDefinition = toolDefinition({
  name: "create",
  description: "Create a new document in a Payload CMS collection.",
  inputSchema: z.object({
    collection: z.string().describe("Collection slug"),
    data: z.record(z.string(), z.unknown()).describe("Document data"),
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
  }),
  outputSchema: z.object({
    totalDocs: z.number(),
  }),
});

// biome-ignore lint/suspicious/noExplicitAny: Payload's collection slug type requires generic inference
type AnyCollection = any;

export function createPayloadTools(payload: BasePayload): ServerTool[] {
  return [
    getSchemaDefinition.server(({ collection }) => {
      const collections = collection
        ? payload.config.collections.filter((item) => item.slug === collection)
        : payload.config.collections;

      return {
        collections: collections.map((item) => ({
          slug: item.slug,
          fields: extractFields(item.fields),
        })),
      };
    }),

    findDefinition.server(
      async ({ collection, where, limit, page, sort, select }) => {
        try {
          const result = await payload.find({
            collection: collection as AnyCollection,
            where: where as Where | undefined,
            limit,
            page,
            sort,
            select,
            overrideAccess: true,
          });

          return {
            docs: result.docs as Record<string, unknown>[],
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

    findByIDDefinition.server(async ({ collection, id, select }) => {
      try {
        const doc = await payload.findByID({
          collection: collection as AnyCollection,
          id,
          select,
          overrideAccess: true,
        });

        return doc as Record<string, unknown>;
      } catch (error) {
        throwPayloadToolError(
          "findByID",
          { collection, hasSelect: Boolean(select), id },
          error
        );
      }
    }),

    createDefinition.server(async ({ collection, data }) => {
      try {
        const doc = await payload.create({
          collection: collection as AnyCollection,
          data,
          overrideAccess: true,
        });

        return doc as Record<string, unknown>;
      } catch (error) {
        throwPayloadToolError(
          "create",
          { collection, dataKeys: Object.keys(data) },
          error
        );
      }
    }),

    updateDefinition.server(async ({ collection, id, data }) => {
      try {
        const doc = await payload.update({
          collection: collection as AnyCollection,
          id,
          data,
          overrideAccess: true,
        });

        return doc as Record<string, unknown>;
      } catch (error) {
        throwPayloadToolError(
          "update",
          { collection, id, dataKeys: Object.keys(data) },
          error
        );
      }
    }),

    deleteDocDefinition.server(async ({ collection, id }) => {
      try {
        const doc = await payload.delete({
          collection: collection as AnyCollection,
          id,
          overrideAccess: true,
        });

        return doc as Record<string, unknown>;
      } catch (error) {
        throwPayloadToolError("delete", { collection, id }, error);
      }
    }),

    countDefinition.server(async ({ collection, where }) => {
      try {
        const result = await payload.count({
          collection: collection as AnyCollection,
          where: where as Where | undefined,
          overrideAccess: true,
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
}

export function buildSchemaDescription(payload: BasePayload): string {
  const lines: string[] = [];

  for (const collection of payload.config.collections) {
    const fields = extractFields(collection.fields);
    const fieldDescriptions = fields
      .map((field) => {
        let description = `${field.name} (${field.type}`;

        if (field.required) {
          description += ", required";
        }

        if (field.options) {
          description += `, options: ${field.options.join(" | ")}`;
        }

        description += ")";
        return description;
      })
      .join(", ");

    lines.push(`- ${collection.slug}: ${fieldDescriptions}`);
  }

  return lines.join("\n");
}
