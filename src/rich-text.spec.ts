import type { Field } from "payload";
import { describe, expect, test } from "vitest";
import { transformRichTextValues } from "./rich-text.js";

// The walker only reads `type`, `name`, `fields`, `blocks`, `blockReferences`,
// and `tabs`, so minimal field mocks are enough to exercise traversal.
const asFields = (fields: unknown[]): Field[] => fields as Field[];

const upper = (value: unknown): unknown =>
  typeof value === "string" ? value.toUpperCase() : value;

describe("transformRichTextValues", () => {
  test("transforms a top-level richText field and leaves others alone", () => {
    const data: Record<string, unknown> = { content: "hello", title: "x" };

    transformRichTextValues(
      asFields([
        { name: "content", type: "richText" },
        { name: "title", type: "text" },
      ]),
      data,
      upper
    );

    expect(data.content).toBe("HELLO");
    expect(data.title).toBe("x");
  });

  test("recurses into named groups", () => {
    const data: Record<string, unknown> = { meta: { body: "hi" } };

    transformRichTextValues(
      asFields([
        {
          name: "meta",
          type: "group",
          fields: [{ name: "body", type: "richText" }],
        },
      ]),
      data,
      upper
    );

    expect(data.meta).toEqual({ body: "HI" });
  });

  test("flattens rows and unnamed containers", () => {
    const data: Record<string, unknown> = { body: "hi" };

    transformRichTextValues(
      asFields([{ type: "row", fields: [{ name: "body", type: "richText" }] }]),
      data,
      upper
    );

    expect(data.body).toBe("HI");
  });

  test("recurses into every array item", () => {
    const data: Record<string, unknown> = {
      items: [{ body: "a" }, { body: "b" }, { other: 1 }],
    };

    transformRichTextValues(
      asFields([
        {
          name: "items",
          type: "array",
          fields: [{ name: "body", type: "richText" }],
        },
      ]),
      data,
      upper
    );

    expect(data.items).toEqual([{ body: "A" }, { body: "B" }, { other: 1 }]);
  });

  test("recurses into blocks matched by blockType", () => {
    const data: Record<string, unknown> = {
      layout: [
        { blockType: "hero", body: "a" },
        { blockType: "unknown", body: "b" },
      ],
    };

    transformRichTextValues(
      asFields([
        {
          name: "layout",
          type: "blocks",
          blocks: [
            { slug: "hero", fields: [{ name: "body", type: "richText" }] },
          ],
        },
      ]),
      data,
      upper
    );

    expect(data.layout).toEqual([
      { blockType: "hero", body: "A" },
      { blockType: "unknown", body: "b" },
    ]);
  });

  test("handles named and unnamed tabs", () => {
    const data: Record<string, unknown> = {
      seo: { body: "a" },
      intro: "b",
    };

    transformRichTextValues(
      asFields([
        {
          type: "tabs",
          tabs: [
            { name: "seo", fields: [{ name: "body", type: "richText" }] },
            { label: "Content", fields: [{ name: "intro", type: "richText" }] },
          ],
        },
      ]),
      data,
      upper
    );

    expect(data.seo).toEqual({ body: "A" });
    expect(data.intro).toBe("B");
  });

  test("passes the richText field to the transform", () => {
    const seen: string[] = [];

    transformRichTextValues(
      asFields([{ name: "content", type: "richText" }]),
      { content: "x" },
      (value, field) => {
        seen.push(field.name);
        return value;
      }
    );

    expect(seen).toEqual(["content"]);
  });

  test("skips missing and non-object values safely", () => {
    const data: Record<string, unknown> = { meta: null, items: "not-array" };

    expect(() =>
      transformRichTextValues(
        asFields([
          {
            name: "meta",
            type: "group",
            fields: [{ name: "body", type: "richText" }],
          },
          {
            name: "items",
            type: "array",
            fields: [{ name: "body", type: "richText" }],
          },
        ]),
        data,
        upper
      )
    ).not.toThrow();

    expect(data.meta).toBeNull();
    expect(data.items).toBe("not-array");
  });
});
