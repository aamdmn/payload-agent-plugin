import type {
  ArrayField,
  Block,
  BlocksField,
  Field,
  GroupField,
  RichTextField,
  TabsField,
} from "payload";

/**
 * Markdown <-> Lexical translation for Payload richText fields.
 *
 * The agent speaks Markdown; Payload stores Lexical editor state. We translate
 * at the tool boundary using Payload's own field-aware converters from
 * `@payloadcms/richtext-lexical`, so the result always respects the field's
 * enabled features (headings, lists, links, uploads, blocks, ...) rather than
 * a hand-rolled approximation.
 *
 * That package is an optional peer dependency, loaded lazily: apps without it
 * (or using a non-Lexical editor) simply skip conversion and pass values
 * through untouched.
 */

type LexicalModule = typeof import("@payloadcms/richtext-lexical");
type LexicalEditorState = Parameters<
  LexicalModule["convertLexicalToMarkdown"]
>[0]["data"];

let lexicalModulePromise: Promise<LexicalModule | null> | null = null;

function loadLexicalModule(): Promise<LexicalModule | null> {
  if (!lexicalModulePromise) {
    lexicalModulePromise = import("@payloadcms/richtext-lexical").catch(
      () => null
    );
  }

  return lexicalModulePromise;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isLexicalState(value: unknown): value is LexicalEditorState {
  return isRecord(value) && isRecord((value as { root?: unknown }).root);
}

/** Transform applied to every richText value reachable from a data object. */
export type RichTextTransform = (
  value: unknown,
  field: RichTextField
) => unknown;

/**
 * Walk `fields` alongside `data`, applying `transform` to every richText value
 * -- including those nested inside groups, arrays, blocks, tabs, rows, and
 * collapsibles. Mutates `data` in place. Pure (no Lexical dependency) so it can
 * be unit-tested on its own.
 */
export function transformRichTextValues(
  fields: Field[],
  data: Record<string, unknown>,
  transform: RichTextTransform
): void {
  for (const field of fields) {
    visitField(field, data, transform);
  }
}

function visitField(
  field: Field,
  data: Record<string, unknown>,
  transform: RichTextTransform
): void {
  if (field.type === "richText") {
    if (field.name in data) {
      data[field.name] = transform(data[field.name], field);
    }
    return;
  }

  if (field.type === "group") {
    visitGroup(field, data, transform);
    return;
  }

  if (field.type === "array") {
    visitArray(field, data, transform);
    return;
  }

  if (field.type === "blocks") {
    visitBlocks(field, data, transform);
    return;
  }

  if (field.type === "tabs") {
    visitTabs(field, data, transform);
    return;
  }

  if (field.type === "row" || field.type === "collapsible") {
    transformRichTextValues(field.fields, data, transform);
  }
}

function visitGroup(
  field: GroupField,
  data: Record<string, unknown>,
  transform: RichTextTransform
): void {
  // Named groups nest their data under the group name; unnamed groups (and
  // presentational rows/collapsibles) keep their fields at the current level.
  if ("name" in field && typeof field.name === "string") {
    const nested = data[field.name];
    if (isRecord(nested)) {
      transformRichTextValues(field.fields, nested, transform);
    }
    return;
  }

  transformRichTextValues(field.fields, data, transform);
}

function visitArray(
  field: ArrayField,
  data: Record<string, unknown>,
  transform: RichTextTransform
): void {
  const items = data[field.name];
  if (!Array.isArray(items)) {
    return;
  }

  for (const item of items) {
    if (isRecord(item)) {
      transformRichTextValues(field.fields, item, transform);
    }
  }
}

function visitBlocks(
  field: BlocksField,
  data: Record<string, unknown>,
  transform: RichTextTransform
): void {
  const items = data[field.name];
  if (!Array.isArray(items)) {
    return;
  }

  const blocksBySlug = indexBlocks(field);

  for (const item of items) {
    if (!isRecord(item)) {
      continue;
    }

    const blockType = item.blockType;
    if (typeof blockType !== "string") {
      continue;
    }

    const block = blocksBySlug.get(blockType);
    if (block) {
      transformRichTextValues(block.fields, item, transform);
    }
  }
}

function indexBlocks(field: BlocksField): Map<string, Block> {
  const map = new Map<string, Block>();

  for (const block of field.blocks) {
    map.set(block.slug, block);
  }

  // Blocks defined via `blockReferences` may be inline objects or bare slugs;
  // only the inline objects carry the fields we need to recurse into.
  for (const ref of field.blockReferences ?? []) {
    if (typeof ref !== "string") {
      map.set(ref.slug, ref);
    }
  }

  return map;
}

function visitTabs(
  field: TabsField,
  data: Record<string, unknown>,
  transform: RichTextTransform
): void {
  for (const tab of field.tabs) {
    if ("name" in tab && typeof tab.name === "string") {
      const nested = data[tab.name];
      if (isRecord(nested)) {
        transformRichTextValues(tab.fields, nested, transform);
      }
    } else {
      transformRichTextValues(tab.fields, data, transform);
    }
  }
}

/**
 * Convert Markdown strings to Lexical editor state for every richText field in
 * `data`. Non-string values pass through untouched -- the escape hatch that
 * lets callers supply raw Lexical objects for structured content Markdown
 * cannot express (e.g. custom blocks). Mutates `data` in place.
 */
export async function markdownToRichText(
  fields: Field[],
  data: Record<string, unknown>
): Promise<void> {
  const lexical = await loadLexicalModule();
  if (!lexical) {
    return;
  }

  transformRichTextValues(fields, data, (value, field) => {
    if (typeof value === "string") {
      const editorConfig = resolveEditorConfig(lexical, field);
      return editorConfig
        ? lexical.convertMarkdownToLexical({ editorConfig, markdown: value })
        : value;
    }

    // Raw Lexical editor state passes through -- the escape hatch for
    // structured content Markdown cannot express (e.g. custom blocks).
    if (isLexicalState(value)) {
      return value;
    }

    // A localized richText field is written one locale per call. A per-locale
    // object (e.g. from a `locale: 'all'` read) would be stored as a single
    // locale's value and corrupt the field, so reject it with a message the
    // agent can act on.
    if (field.localized && isRecord(value)) {
      throw new Error(
        `richText field "${field.name}" received a per-locale object. Write one locale per call: set a single \`locale\` and pass a plain Markdown string.`
      );
    }

    return value;
  });
}

/**
 * Convert Lexical editor state to Markdown for every richText field in `doc`.
 * Values that are not Lexical editor state pass through untouched. Mutates
 * `doc` in place.
 */
export async function richTextToMarkdown(
  fields: Field[],
  doc: Record<string, unknown>
): Promise<void> {
  const lexical = await loadLexicalModule();
  if (!lexical) {
    return;
  }

  transformRichTextValues(fields, doc, (value, field) => {
    const editorConfig = resolveEditorConfig(lexical, field);
    if (!editorConfig) {
      return value;
    }

    if (isLexicalState(value)) {
      return lexical.convertLexicalToMarkdown({ data: value, editorConfig });
    }

    // A `locale: 'all'` read returns a localized field as a per-locale map;
    // convert each locale's editor state to Markdown, leaving empty locales
    // (null/undefined) as-is.
    if (field.localized && isRecord(value)) {
      const byLocale: Record<string, unknown> = {};
      for (const [locale, localeValue] of Object.entries(value)) {
        byLocale[locale] = isLexicalState(localeValue)
          ? lexical.convertLexicalToMarkdown({
              data: localeValue,
              editorConfig,
            })
          : localeValue;
      }
      return byLocale;
    }

    return value;
  });
}

function resolveEditorConfig(lexical: LexicalModule, field: RichTextField) {
  try {
    return lexical.editorConfigFactory.fromField({ field });
  } catch {
    return null;
  }
}
