import config from "@payload-config";
import type { Field, Payload } from "payload";
import { getPayload } from "payload";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { markdownToRichText, richTextToMarkdown } from "../src/rich-text.js";

let payload: Payload;

const PER_LOCALE_ERROR = /per-locale object/;

const getPostsFields = (): Field[] => {
  const posts = payload.config.collections.find((c) => c.slug === "posts");
  if (!posts) {
    throw new Error("posts collection not found");
  }
  return posts.fields;
};

const isLexicalState = (value: unknown): boolean =>
  typeof value === "object" &&
  value !== null &&
  typeof (value as { root?: unknown }).root === "object";

afterAll(async () => {
  if (typeof payload?.db?.destroy === "function") {
    await payload.db.destroy();
  }
});

beforeAll(async () => {
  payload = await getPayload({ config });
});

describe("localization translate workflow", () => {
  test("read all locales, translate, write one locale per call", async () => {
    const fields = getPostsFields();

    // 1. Create in the default locale (en). content is Markdown -> Lexical.
    const createData: Record<string, unknown> = {
      title: "Localized Post",
      summary: "An English summary",
      content: "## Hello\n\nWorld in **English**.",
    };
    await markdownToRichText(fields, createData);
    const created = await payload.create({
      collection: "posts",
      data: createData as { title: string },
      overrideAccess: true,
    });

    // 2. Read every locale with fallback off: localized fields are per-locale
    //    maps, and the untranslated locales are absent (not the English value).
    const all = (await payload.findByID({
      collection: "posts",
      id: created.id,
      locale: "all",
      fallbackLocale: false,
      overrideAccess: true,
    })) as unknown as Record<string, Record<string, unknown>>;

    expect(isLexicalState(all.content.en)).toBe(true);
    expect(all.content.es).toBeUndefined();
    expect(all.summary).toEqual({ en: "An English summary" });

    // 3. The richText converter turns each locale's editor state into Markdown.
    const decoded = all as unknown as Record<string, unknown>;
    await richTextToMarkdown(fields, decoded);
    const contentByLocale = decoded.content as Record<string, unknown>;
    expect(contentByLocale.en).toContain("## Hello");
    expect(contentByLocale.es).toBeUndefined();

    // 4. Write the Spanish translation -- one locale, scalar values.
    const esData: Record<string, unknown> = {
      summary: "Un resumen en espanol",
      content: "## Hola\n\nMundo en **espanol**.",
    };
    await markdownToRichText(fields, esData);
    await payload.update({
      collection: "posts",
      id: created.id,
      locale: "es",
      data: esData,
      overrideAccess: true,
    });

    // 5. Both locales now present.
    const afterEs = (await payload.findByID({
      collection: "posts",
      id: created.id,
      locale: "all",
      fallbackLocale: false,
      overrideAccess: true,
    })) as unknown as Record<string, Record<string, unknown>>;

    expect(isLexicalState(afterEs.content.en)).toBe(true);
    expect(isLexicalState(afterEs.content.es)).toBe(true);
    expect(afterEs.summary).toEqual({
      en: "An English summary",
      es: "Un resumen en espanol",
    });

    await payload.delete({
      collection: "posts",
      id: created.id,
      overrideAccess: true,
    });
  });

  test("rejects a per-locale object written to a richText field", async () => {
    const fields = getPostsFields();
    const data: Record<string, unknown> = {
      content: { en: "## Hello", es: "## Hola" },
    };

    await expect(markdownToRichText(fields, data)).rejects.toThrow(
      PER_LOCALE_ERROR
    );
  });
});
