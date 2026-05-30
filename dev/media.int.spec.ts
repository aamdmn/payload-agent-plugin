import config from "@payload-config";
import type { Attachment } from "chat";
import type { Payload } from "payload";
import { getPayload } from "payload";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { fileFromAttachment } from "../src/media.js";

let payload: Payload;

// A 1x1 PNG, the smallest valid image Payload/sharp will accept.
const PNG_1X1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64"
);

afterAll(async () => {
  if (typeof payload?.db?.destroy === "function") {
    await payload.db.destroy();
  }
});

beforeAll(async () => {
  payload = await getPayload({ config });
});

describe("media upload", () => {
  test("uploads an inbound attachment to the media collection", async () => {
    const attachment = {
      type: "image",
      name: "pixel.png",
      mimeType: "image/png",
      size: PNG_1X1.length,
      fetchData: () => Promise.resolve(PNG_1X1),
    } as Attachment;

    const file = await fileFromAttachment(attachment);

    const doc = await payload.create({
      collection: "media",
      data: { alt: "a test pixel" },
      file,
      overrideAccess: true,
    });

    expect(doc.id).toBeDefined();
    expect(doc.mimeType).toBe("image/png");
    expect(doc.filename).toContain("pixel");
    expect(doc.alt).toBe("a test pixel");

    // The uploaded id can then be referenced from other documents.
    const found = await payload.findByID({
      collection: "media",
      id: doc.id,
      overrideAccess: true,
    });
    expect(found.id).toBe(doc.id);

    await payload.delete({
      collection: "media",
      id: doc.id,
      overrideAccess: true,
    });
  });

  test("attaches an uploaded image to a post via its upload field", async () => {
    const file = await fileFromAttachment({
      type: "image",
      name: "hero.png",
      mimeType: "image/png",
      size: PNG_1X1.length,
      fetchData: () => Promise.resolve(PNG_1X1),
    } as Attachment);

    const media = await payload.create({
      collection: "media",
      data: { alt: "hero" },
      file,
      overrideAccess: true,
    });

    const post = await payload.create({
      collection: "posts",
      data: { title: "Post with hero", heroImage: media.id },
      overrideAccess: true,
    });

    const populated = await payload.findByID({
      collection: "posts",
      id: post.id,
      depth: 1,
      overrideAccess: true,
    });
    const hero = populated.heroImage as { id: number | string } | null;
    expect(hero?.id).toBe(media.id);

    await payload.delete({
      collection: "posts",
      id: post.id,
      overrideAccess: true,
    });
    await payload.delete({
      collection: "media",
      id: media.id,
      overrideAccess: true,
    });
  });
});
