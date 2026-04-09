import type { ServerTool } from "@tanstack/ai";
import { toolDefinition } from "@tanstack/ai";
import type { BasePayload, Field, Where } from "payload";
import { z } from "zod";

// ---------------------------------------------------------------------------
// Field info helpers
// ---------------------------------------------------------------------------

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
      info.options = field.options.map((o) =>
        typeof o === "string" ? o : o.value
      );
    }

    result.push(info);
  }

  return result;
}

// ---------------------------------------------------------------------------
// Markdown -> Lexical conversion
// ---------------------------------------------------------------------------

const HEADING_RE = /^(#{1,6})\s+(.+)$/;
const UNORDERED_RE = /^[-*]\s+(.*)/;
const ORDERED_RE = /^\d+\.\s+(.*)/;
const RULE_RE = /^---+$/;
const QUOTE_RE = /^>\s?(.*)/;
const BOLD_RE = /\*\*(.+?)\*\*/;
const ITALIC_RE = /(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/;
const CODE_RE = /`(.+?)`/;
const BOLD_SEARCH_RE = /\*\*/;
const ITALIC_SEARCH_RE = /(?<!\*)\*(?!\*)/;

function textNode(text: string, format = 0): Record<string, unknown> {
  return {
    type: "text",
    text,
    format,
    style: "",
    detail: 0,
    mode: "normal",
    version: 1,
  };
}

const BLOCK_PROPS = {
  direction: "ltr",
  format: "",
  indent: 0,
  version: 1,
};

function findEarliestMarker(text: string): number {
  const boldIdx = text.search(BOLD_SEARCH_RE);
  const italicIdx = text.search(ITALIC_SEARCH_RE);
  const codeIdx = text.indexOf("`");

  return Math.min(
    boldIdx >= 0 ? boldIdx : Number.POSITIVE_INFINITY,
    codeIdx >= 0 ? codeIdx : Number.POSITIVE_INFINITY,
    italicIdx >= 0 ? italicIdx : Number.POSITIVE_INFINITY
  );
}

function tryParseMarker(
  text: string
): { format: number; length: number; match: string } | null {
  const boldMatch = BOLD_RE.exec(text);
  if (boldMatch && text.startsWith("**")) {
    return { match: boldMatch[1], format: 1, length: boldMatch[0].length };
  }
  const codeMatch = CODE_RE.exec(text);
  if (codeMatch && text.startsWith("`")) {
    return { match: codeMatch[1], format: 16, length: codeMatch[0].length };
  }
  const italicMatch = ITALIC_RE.exec(text);
  if (italicMatch && text.startsWith("*")) {
    return { match: italicMatch[1], format: 2, length: italicMatch[0].length };
  }
  return null;
}

/**
 * Parse inline markdown formatting into Lexical text nodes.
 * Handles **bold**, *italic*, and `code`.
 */
function parseInline(text: string): Record<string, unknown>[] {
  const nodes: Record<string, unknown>[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    const earliest = findEarliestMarker(remaining);

    if (earliest === Number.POSITIVE_INFINITY) {
      nodes.push(textNode(remaining));
      break;
    }

    if (earliest > 0) {
      nodes.push(textNode(remaining.slice(0, earliest)));
      remaining = remaining.slice(earliest);
    }

    const parsed = tryParseMarker(remaining);
    if (parsed) {
      nodes.push(textNode(parsed.match, parsed.format));
      remaining = remaining.slice(parsed.length);
    } else {
      nodes.push(textNode(remaining[0]));
      remaining = remaining.slice(1);
    }
  }

  return nodes.length > 0 ? nodes : [textNode(text)];
}

function paragraphNode(text: string): Record<string, unknown> {
  return {
    type: "paragraph",
    children: parseInline(text),
    ...BLOCK_PROPS,
    textFormat: 0,
    textStyle: "",
  };
}

function headingNode(tag: string, text: string): Record<string, unknown> {
  return {
    type: "heading",
    tag,
    children: parseInline(text),
    ...BLOCK_PROPS,
  };
}

function listNode(
  listType: string,
  tag: string,
  items: string[]
): Record<string, unknown> {
  return {
    type: "list",
    listType,
    tag,
    start: 1,
    children: items.map((item, i) => ({
      type: "listitem",
      children: parseInline(item),
      ...BLOCK_PROPS,
      value: i + 1,
    })),
    ...BLOCK_PROPS,
  };
}

function quoteNode(text: string): Record<string, unknown> {
  return {
    type: "quote",
    children: parseInline(text),
    ...BLOCK_PROPS,
  };
}

function isBlockStart(line: string): boolean {
  return (
    HEADING_RE.test(line) ||
    UNORDERED_RE.test(line) ||
    ORDERED_RE.test(line) ||
    RULE_RE.test(line.trim()) ||
    QUOTE_RE.test(line)
  );
}

function collectWhile(
  lines: string[],
  start: number,
  pattern: RegExp
): { items: string[]; end: number } {
  const items: string[] = [];
  let i = start;
  while (i < lines.length && pattern.test(lines[i])) {
    const m = pattern.exec(lines[i]);
    items.push(m ? m[1] : "");
    i++;
  }
  return { items, end: i };
}

function collectParagraph(
  lines: string[],
  start: number
): { text: string; end: number } {
  let text = "";
  let i = start;
  while (
    i < lines.length &&
    lines[i].trim() !== "" &&
    !isBlockStart(lines[i])
  ) {
    text += (text ? " " : "") + lines[i];
    i++;
  }
  return { text, end: i };
}

function parseLine(
  lines: string[],
  i: number,
  nodes: Record<string, unknown>[]
): number {
  const line = lines[i];

  if (line.trim() === "") {
    return i + 1;
  }

  if (RULE_RE.test(line.trim())) {
    nodes.push({ type: "horizontalrule", version: 1 });
    return i + 1;
  }

  const headingMatch = HEADING_RE.exec(line);
  if (headingMatch) {
    nodes.push(headingNode(`h${headingMatch[1].length}`, headingMatch[2]));
    return i + 1;
  }

  if (QUOTE_RE.test(line)) {
    const { items, end } = collectWhile(lines, i, QUOTE_RE);
    nodes.push(quoteNode(items.join(" ")));
    return end;
  }

  if (UNORDERED_RE.test(line)) {
    const { items, end } = collectWhile(lines, i, UNORDERED_RE);
    nodes.push(listNode("bullet", "ul", items));
    return end;
  }

  if (ORDERED_RE.test(line)) {
    const { items, end } = collectWhile(lines, i, ORDERED_RE);
    nodes.push(listNode("number", "ol", items));
    return end;
  }

  const { text, end } = collectParagraph(lines, i);
  if (text) {
    nodes.push(paragraphNode(text));
  }
  return end;
}

/**
 * Convert a markdown string to Lexical editor state JSON.
 * Supports headings, bold, italic, code, lists, blockquotes, and horizontal rules.
 */
function markdownToLexical(markdown: string): Record<string, unknown> {
  const lines = markdown.split("\n");
  const nodes: Record<string, unknown>[] = [];
  let i = 0;

  while (i < lines.length) {
    i = parseLine(lines, i, nodes);
  }

  if (nodes.length === 0) {
    nodes.push(paragraphNode(markdown));
  }

  return {
    root: {
      type: "root",
      children: nodes,
      direction: "ltr",
      format: "",
      indent: 0,
      version: 1,
    },
  };
}

// ---------------------------------------------------------------------------
// Rich text field coercion
// ---------------------------------------------------------------------------

/**
 * Auto-convert string values to Lexical JSON for richText fields.
 * Parses the string as markdown: headings, lists, bold, italic, etc.
 */
function coerceRichTextFields(
  payload: BasePayload,
  collection: string,
  data: Record<string, unknown>
): Record<string, unknown> {
  const config = payload.config.collections.find((c) => c.slug === collection);
  if (!config) {
    return data;
  }

  const coerced = { ...data };

  for (const field of config.fields) {
    if (
      "name" in field &&
      field.type === "richText" &&
      field.name in coerced &&
      typeof coerced[field.name] === "string"
    ) {
      coerced[field.name] = markdownToLexical(coerced[field.name] as string);
    }
  }

  return coerced;
}

// ---------------------------------------------------------------------------
// Tool definitions
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Tool factory
// ---------------------------------------------------------------------------

export function createPayloadTools(payload: BasePayload): ServerTool[] {
  return [
    getSchemaDefinition.server(({ collection }) => {
      const configs = payload.config.collections;
      const filtered = collection
        ? configs.filter((c) => c.slug === collection)
        : configs;

      return {
        collections: filtered.map((c) => ({
          slug: c.slug,
          fields: extractFields(c.fields),
        })),
      };
    }),

    findDefinition.server(async ({ collection, where, limit, page, sort }) => {
      const result = await payload.find({
        collection: collection as AnyCollection,
        where: where as Where | undefined,
        limit,
        page,
        sort,
        overrideAccess: true,
      });
      return {
        docs: result.docs as Record<string, unknown>[],
        totalDocs: result.totalDocs,
        totalPages: result.totalPages,
        page: result.page ?? 1,
      };
    }),

    findByIDDefinition.server(async ({ collection, id }) => {
      const doc = await payload.findByID({
        collection: collection as AnyCollection,
        id,
        overrideAccess: true,
      });
      return doc as Record<string, unknown>;
    }),

    createDefinition.server(async ({ collection, data }) => {
      const coerced = coerceRichTextFields(payload, collection, data);
      try {
        const doc = await payload.create({
          collection: collection as AnyCollection,
          data: coerced,
          overrideAccess: true,
        });
        return doc as Record<string, unknown>;
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        throw new Error(
          `${msg}. Hint: for richText fields, pass a markdown string (e.g. "# Heading\\n\\nParagraph text\\n\\n- list item"). It is auto-converted to the correct format.`
        );
      }
    }),

    updateDefinition.server(async ({ collection, id, data }) => {
      const coerced = coerceRichTextFields(payload, collection, data);
      try {
        const doc = await payload.update({
          collection: collection as AnyCollection,
          id,
          data: coerced,
          overrideAccess: true,
        });
        return doc as Record<string, unknown>;
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        throw new Error(
          `${msg}. Hint: for richText fields, pass a markdown string (e.g. "# Heading\\n\\nParagraph text\\n\\n- list item"). It is auto-converted to the correct format.`
        );
      }
    }),

    deleteDocDefinition.server(async ({ collection, id }) => {
      const doc = await payload.delete({
        collection: collection as AnyCollection,
        id,
        overrideAccess: true,
      });
      return doc as Record<string, unknown>;
    }),

    countDefinition.server(async ({ collection, where }) => {
      const result = await payload.count({
        collection: collection as AnyCollection,
        where: where as Where | undefined,
        overrideAccess: true,
      });
      return { totalDocs: result.totalDocs };
    }),
  ] as ServerTool[];
}

// ---------------------------------------------------------------------------
// Schema description for system prompt
// ---------------------------------------------------------------------------

export function buildSchemaDescription(payload: BasePayload): string {
  const lines: string[] = [];

  for (const collection of payload.config.collections) {
    const fields = extractFields(collection.fields);
    const fieldDescriptions = fields
      .map((f) => {
        let desc = `${f.name} (${f.type}`;
        if (f.required) {
          desc += ", required";
        }
        if (f.options) {
          desc += `, options: ${f.options.join(" | ")}`;
        }
        if (f.type === "richText") {
          desc += ", pass a markdown string";
        }
        desc += ")";
        return desc;
      })
      .join(", ");

    lines.push(`- ${collection.slug}: ${fieldDescriptions}`);
  }

  return lines.join("\n");
}
