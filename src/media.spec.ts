import type { Attachment } from "chat";
import { describe, expect, test } from "vitest";
import { fileFromAttachment, fileFromUrl } from "./media.js";

const asAttachment = (value: Partial<Attachment>): Attachment =>
  value as Attachment;

const NO_DATA_ERROR = /no data/;
const STATUS_404_ERROR = /404/;
const PRIVATE_ADDRESS_ERROR = /private or reserved/;
const SIZE_LIMIT_ERROR = /limit/;

describe("fileFromAttachment", () => {
  test("uses fetchData when available", async () => {
    const buffer = Buffer.from("hello");
    const file = await fileFromAttachment(
      asAttachment({
        type: "file",
        name: "note.txt",
        mimeType: "text/plain",
        size: 5,
        fetchData: () => Promise.resolve(buffer),
      })
    );

    expect(file).toEqual({
      data: buffer,
      mimetype: "text/plain",
      name: "note.txt",
      size: 5,
    });
  });

  test("falls back to inline data and derives size", async () => {
    const buffer = Buffer.from("image-bytes");
    const file = await fileFromAttachment(
      asAttachment({ type: "image", mimeType: "image/png", data: buffer })
    );

    expect(file.data).toBe(buffer);
    expect(file.size).toBe(buffer.length);
  });

  test("synthesizes a name with a conventional extension from the mime type", async () => {
    const file = await fileFromAttachment(
      asAttachment({
        type: "image",
        mimeType: "image/jpeg",
        data: Buffer.from("x"),
      })
    );

    expect(file.name).toBe("upload.jpg");
  });

  test("sniffs the type when the platform sends no name or mime", async () => {
    // A real PNG header; mirrors how Telegram delivers a photo.
    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
      "base64"
    );
    const file = await fileFromAttachment(
      asAttachment({ type: "image", data: png })
    );

    expect(file.mimetype).toBe("image/png");
    expect(file.name).toBe("upload.png");
  });

  test("sniffs past a generic octet-stream mime", async () => {
    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
      "base64"
    );
    const file = await fileFromAttachment(
      asAttachment({
        type: "image",
        mimeType: "application/octet-stream",
        data: png,
      })
    );

    expect(file.mimetype).toBe("image/png");
  });

  test("throws when there is no data", async () => {
    await expect(
      fileFromAttachment(asAttachment({ type: "file", name: "x" }))
    ).rejects.toThrow(NO_DATA_ERROR);
  });
});

describe("fileFromUrl", () => {
  const fetchReturning = (response: Response): typeof fetch =>
    (() => Promise.resolve(response)) as typeof fetch;
  // Avoid real DNS in tests; pretend every host resolves to a public address.
  const publicLookup = (): Promise<string[]> =>
    Promise.resolve(["93.184.216.34"]);

  test("fetches bytes and reads the content type and filename", async () => {
    const body = Buffer.from("png-bytes");
    const file = await fileFromUrl("https://example.com/photos/cat.png?v=2", {
      fetchImpl: fetchReturning(
        new Response(body, { headers: { "content-type": "image/png" } })
      ),
      lookup: publicLookup,
    });

    expect(file.mimetype).toBe("image/png");
    expect(file.name).toBe("cat.png");
    expect(file.size).toBe(body.length);
  });

  test("strips content-type parameters", async () => {
    const file = await fileFromUrl("https://example.com/data", {
      fetchImpl: fetchReturning(
        new Response(Buffer.from("x"), {
          headers: { "content-type": "text/plain; charset=utf-8" },
        })
      ),
      lookup: publicLookup,
    });

    expect(file.mimetype).toBe("text/plain");
    expect(file.name).toBe("data.txt");
  });

  test("throws on a non-ok response", async () => {
    await expect(
      fileFromUrl("https://example.com/missing", {
        fetchImpl: fetchReturning(new Response("nope", { status: 404 })),
        lookup: publicLookup,
      })
    ).rejects.toThrow(STATUS_404_ERROR);
  });

  test("rejects a private address before fetching", async () => {
    const fetchImpl = fetchReturning(new Response("secret"));
    await expect(
      fileFromUrl("http://169.254.169.254/latest/meta-data/", { fetchImpl })
    ).rejects.toThrow(PRIVATE_ADDRESS_ERROR);
  });

  test("enforces the size cap on an oversized body", async () => {
    const body = Buffer.alloc(2048);
    await expect(
      fileFromUrl("https://example.com/big.bin", {
        fetchImpl: fetchReturning(new Response(body)),
        lookup: publicLookup,
        maxBytes: 1024,
      })
    ).rejects.toThrow(SIZE_LIMIT_ERROR);
  });
});
