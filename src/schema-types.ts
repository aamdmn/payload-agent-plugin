import { readFile } from "node:fs/promises";
import type { BasePayload } from "payload";

/**
 * Grounds the agent in the project's real types. Payload generates a committed
 * `payload-types.ts` (the same file the frontend is typed against); feeding the
 * agent the exact interface for a collection -- including its block unions --
 * lets it write `data` against real shapes instead of guessing. Code Mode
 * strips types before executing, so this is model grounding, not enforcement;
 * Payload still validates the write.
 */

/** Returns the TypeScript type text for a collection or global, or null. */
export interface TypesProvider {
  getCollectionType(slug: string): null | string;
  getGlobalType(slug: string): null | string;
}

const COLLECTIONS_MARKER = "collections: {";
const GLOBALS_MARKER = "globals: {";
const MAX_REFERENCED_INTERFACES = 40;
const MAX_TYPE_CHARS = 30_000;

// Payload emits hyphenated slugs quoted (single OR double quotes, e.g.
// `'payload-kv'` or `"site-settings"`) and simple slugs bare (`posts`).
const ENTITY_ENTRY =
  /(?:["']([\w-]+)["']|([A-Za-z_][\w-]*)):\s*([A-Za-z_]\w*)\s*;/g;
const PASCAL_WORD = /\b[A-Z][A-Za-z0-9]*\b/g;
const WORD_CHAR = /[A-Za-z0-9_]/;

// PascalCase tokens that are TS built-ins or the root config, never worth
// pulling in as a referenced interface.
const SKIP_NAMES = new Set([
  "Array",
  "Config",
  "Date",
  "Map",
  "Omit",
  "Partial",
  "Pick",
  "Promise",
  "Record",
  "Required",
  "Set",
]);

/** Index of the `}` matching the `{` at `openIndex` (-1 if unbalanced). */
function matchingBrace(source: string, openIndex: number): number {
  let depth = 0;
  for (let i = openIndex; i < source.length; i += 1) {
    const char = source[i];
    if (char === "{") {
      depth += 1;
    } else if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        return i;
      }
    }
  }
  return -1;
}

/**
 * Map each slug to its generated interface name within a `Config` sub-block
 * (e.g. `collections: { ... }` or `globals: { ... }`).
 */
function parseEntityMap(source: string, marker: string): Map<string, string> {
  const map = new Map<string, string>();
  const start = source.indexOf(marker);
  if (start === -1) {
    return map;
  }

  const open = source.indexOf("{", start);
  const close = matchingBrace(source, open);
  if (close === -1) {
    return map;
  }

  const block = source.slice(open + 1, close);
  for (const match of block.matchAll(ENTITY_ENTRY)) {
    const slug = match[1] ?? match[2];
    const typeName = match[3];
    if (slug && typeName) {
      map.set(slug, typeName);
    }
  }
  return map;
}

/** Slice `export interface <name> { ... }` with balanced braces. */
function sliceInterface(source: string, name: string): null | string {
  const header = `export interface ${name}`;
  let index = source.indexOf(header);

  // Skip prefix matches (e.g. `Post` inside `PostsSelect`): the char after the
  // name must not continue the identifier.
  while (index !== -1) {
    const after = source[index + header.length];
    if (after === undefined || !WORD_CHAR.test(after)) {
      break;
    }
    index = source.indexOf(header, index + 1);
  }
  if (index === -1) {
    return null;
  }

  const open = source.indexOf("{", index);
  if (open === -1) {
    return null;
  }
  const close = matchingBrace(source, open);
  if (close === -1) {
    return null;
  }

  return source.slice(index, close + 1);
}

function referencedNames(text: string): string[] {
  const names = new Set<string>();
  for (const match of text.matchAll(PASCAL_WORD)) {
    names.add(match[0]);
  }
  return [...names];
}

/**
 * Slice a collection's interface plus the interfaces it transitively
 * references (named blocks, nested groups), skipping the noisy `*Select` types.
 * Bounded by interface count and total size so a large schema stays sane.
 */
export function sliceCollectionType(
  source: string,
  rootName: string
): null | string {
  const root = sliceInterface(source, rootName);
  if (!root) {
    return null;
  }

  const parts = [root];
  const included = new Set([rootName]);
  const queue = referencedNames(root);
  let total = root.length;

  while (queue.length > 0 && parts.length <= MAX_REFERENCED_INTERFACES) {
    const name = queue.shift();
    if (
      !name ||
      included.has(name) ||
      name.endsWith("Select") ||
      SKIP_NAMES.has(name)
    ) {
      continue;
    }

    included.add(name);
    const slice = sliceInterface(source, name);
    if (!slice) {
      continue;
    }

    if (total + slice.length > MAX_TYPE_CHARS) {
      break;
    }
    parts.push(slice);
    total += slice.length;
    for (const ref of referencedNames(slice)) {
      if (!included.has(ref)) {
        queue.push(ref);
      }
    }
  }

  return parts.join("\n\n");
}

/** Build a provider from already-loaded generated-types source. */
export function createTypesProvider(source: string): TypesProvider {
  const collectionToName = parseEntityMap(source, COLLECTIONS_MARKER);
  const globalToName = parseEntityMap(source, GLOBALS_MARKER);
  return {
    getCollectionType(slug) {
      const name = collectionToName.get(slug);
      return name ? sliceCollectionType(source, name) : null;
    },
    getGlobalType(slug) {
      const name = globalToName.get(slug);
      return name ? sliceCollectionType(source, name) : null;
    },
  };
}

/**
 * Load the project's generated types from `config.typescript.outputFile`.
 * Returns null when the file is not configured or cannot be read, in which case
 * the agent falls back to the structural schema.
 */
export async function loadGeneratedTypes(
  payload: BasePayload
): Promise<null | TypesProvider> {
  const outputFile = payload.config.typescript?.outputFile;
  if (!outputFile) {
    return null;
  }

  try {
    const source = await readFile(outputFile, "utf8");
    return createTypesProvider(source);
  } catch {
    return null;
  }
}
