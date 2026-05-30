import { describe, expect, test } from "vitest";
import {
  assertPublicUrl,
  isPrivateAddress,
  readBodyCapped,
  safeFetch,
} from "./safe-fetch.js";

const PRIVATE_ERROR = /private or reserved/;
const SCHEME_ERROR = /scheme/;
const REDIRECTS_ERROR = /redirects/;
const SIZE_ERROR = /limit/;

const publicLookup = (): Promise<string[]> =>
  Promise.resolve(["93.184.216.34"]);

describe("isPrivateAddress", () => {
  test("flags loopback, private, link-local, reserved, and mapped addresses", () => {
    const blocked = [
      "127.0.0.1",
      "10.1.2.3",
      "192.168.0.1",
      "172.16.5.4",
      "169.254.169.254",
      "0.0.0.0",
      "::1",
      "fe80::1",
      "fc00::1",
      "fd12:3456::1",
      "::ffff:127.0.0.1",
      "not-an-ip",
    ];

    for (const ip of blocked) {
      expect(isPrivateAddress(ip)).toBe(true);
    }
  });

  test("allows publicly routable addresses", () => {
    const allowed = [
      "8.8.8.8",
      "1.1.1.1",
      "93.184.216.34",
      "2606:4700:4700::1111",
    ];

    for (const ip of allowed) {
      expect(isPrivateAddress(ip)).toBe(false);
    }
  });
});

describe("assertPublicUrl", () => {
  test("rejects non-http(s) schemes", async () => {
    await expect(assertPublicUrl("file:///etc/passwd")).rejects.toThrow(
      SCHEME_ERROR
    );
    await expect(assertPublicUrl("ftp://example.com/x")).rejects.toThrow(
      SCHEME_ERROR
    );
  });

  test("rejects a literal private address with no lookup needed", async () => {
    await expect(assertPublicUrl("http://169.254.169.254/")).rejects.toThrow(
      PRIVATE_ERROR
    );
  });

  test("rejects a hostname that resolves to a private address", async () => {
    const lookup = (): Promise<string[]> => Promise.resolve(["10.0.0.5"]);

    await expect(
      assertPublicUrl("https://intranet.example/", lookup)
    ).rejects.toThrow(PRIVATE_ERROR);
  });

  test("accepts a public hostname", async () => {
    const parsed = await assertPublicUrl("https://example.com/a", publicLookup);

    expect(parsed.host).toBe("example.com");
  });
});

describe("safeFetch", () => {
  test("returns the response for a direct 200", async () => {
    const fetchImpl = (() =>
      Promise.resolve(new Response("body", { status: 200 }))) as typeof fetch;

    const response = await safeFetch("https://example.com/", {
      fetchImpl,
      lookup: publicLookup,
    });

    expect(response.status).toBe(200);
  });

  test("follows a redirect to another public URL", async () => {
    const calls: string[] = [];
    const fetchImpl = ((input: string) => {
      calls.push(input);
      if (calls.length === 1) {
        return Promise.resolve(
          Response.redirect("https://cdn.example.com/file", 302)
        );
      }
      return Promise.resolve(new Response("data", { status: 200 }));
    }) as unknown as typeof fetch;

    const response = await safeFetch("https://example.com/", {
      fetchImpl,
      lookup: publicLookup,
    });

    expect(response.status).toBe(200);
    expect(calls).toHaveLength(2);
  });

  test("rejects a redirect that targets a private address", async () => {
    const fetchImpl = ((input: string) => {
      if (input.includes("example.com")) {
        return Promise.resolve(
          Response.redirect("http://169.254.169.254/", 302)
        );
      }
      return Promise.resolve(new Response("secret", { status: 200 }));
    }) as unknown as typeof fetch;

    await expect(
      safeFetch("https://example.com/", { fetchImpl, lookup: publicLookup })
    ).rejects.toThrow(PRIVATE_ERROR);
  });

  test("throws after too many redirects", async () => {
    let count = 0;
    const fetchImpl = (() => {
      count += 1;
      return Promise.resolve(
        Response.redirect(`https://example.com/${count}`, 302)
      );
    }) as unknown as typeof fetch;

    await expect(
      safeFetch("https://example.com/", {
        fetchImpl,
        lookup: publicLookup,
        maxRedirects: 2,
      })
    ).rejects.toThrow(REDIRECTS_ERROR);
  });
});

describe("readBodyCapped", () => {
  test("returns the buffer when under the cap", async () => {
    const buffer = await readBodyCapped(
      new Response(Buffer.from("hello")),
      1024
    );

    expect(buffer.toString()).toBe("hello");
  });

  test("throws when the body exceeds the cap", async () => {
    await expect(
      readBodyCapped(new Response(Buffer.alloc(2048)), 1024)
    ).rejects.toThrow(SIZE_ERROR);
  });
});
