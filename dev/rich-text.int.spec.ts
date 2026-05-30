import config from "@payload-config";
import type { Field, Payload } from "payload";
import { getPayload } from "payload";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { markdownToRichText, richTextToMarkdown } from "../src/rich-text.js";

let payload: Payload;

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

describe("richText markdown conversion", () => {
  const markdown = "## Hello\n\nWorld **bold** text.\n\n- one\n- two";

  test("converts a Markdown string into Lexical editor state", async () => {
    const data: Record<string, unknown> = { content: markdown };
    await markdownToRichText(getPostsFields(), data);

    expect(isLexicalState(data.content)).toBe(true);
  });

  test("Payload accepts the converted content (the original failure)", async () => {
    const data: Record<string, unknown> = {
      title: "RichText Conversion Test",
      content: markdown,
    };
    await markdownToRichText(getPostsFields(), data);

    const created = await payload.create({
      collection: "posts",
      data: data as { title: string },
      overrideAccess: true,
    });

    expect(isLexicalState(created.content)).toBe(true);

    // Round-trips back to Markdown for the agent.
    const doc = created as unknown as Record<string, unknown>;
    await richTextToMarkdown(getPostsFields(), doc);

    expect(typeof doc.content).toBe("string");
    expect(doc.content).toContain("Hello");
    expect(doc.content).toContain("**bold**");
    expect(doc.content).toContain("- one");

    await payload.delete({
      collection: "posts",
      id: created.id,
      overrideAccess: true,
    });
  });

  test("leaves raw Lexical objects untouched on write (escape hatch)", async () => {
    const lexical = {
      root: {
        type: "root",
        children: [],
        direction: null,
        format: "",
        indent: 0,
        version: 1,
      },
    };
    const data: Record<string, unknown> = { content: lexical };
    await markdownToRichText(getPostsFields(), data);

    expect(data.content).toBe(lexical);
  });
});
