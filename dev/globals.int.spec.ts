import config from "@payload-config";
import type { Payload } from "payload";
import { getPayload } from "payload";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { loadGeneratedTypes } from "../src/schema-types.js";
import { createPayloadTools } from "../src/tools.js";

let payload: Payload;

interface ServerToolLike {
  execute: (args: Record<string, unknown>) => Promise<unknown>;
  name: string;
}

const getTool = (tools: unknown[], name: string): ServerToolLike => {
  const tool = (tools as ServerToolLike[]).find((item) => item.name === name);
  if (!tool) {
    throw new Error(`tool ${name} not found`);
  }
  return tool;
};

afterAll(async () => {
  if (typeof payload?.db?.destroy === "function") {
    await payload.db.destroy();
  }
});

beforeAll(async () => {
  payload = await getPayload({ config });
});

describe("globals via agent tools", () => {
  test("getSchema surfaces the global with its generated type", async () => {
    const typesProvider = await loadGeneratedTypes(payload);
    const tools = createPayloadTools(payload, {
      richText: "markdown",
      typesProvider,
    });

    const all = (await getTool(tools, "getSchema").execute({})) as {
      globals: { slug: string }[];
    };
    expect(all.globals.map((g) => g.slug)).toContain("site-settings");

    const detail = (await getTool(tools, "getSchema").execute({
      global: "site-settings",
    })) as { globals: { slug: string; types?: string }[] };
    expect(detail.globals[0].types).toContain("export interface SiteSetting");
  });

  test("updateGlobal/findGlobal round-trip Markdown and per-locale values", async () => {
    const tools = createPayloadTools(payload, { richText: "markdown" });

    // Write the default locale: `about` arrives as Markdown, stored as Lexical.
    await getTool(tools, "updateGlobal").execute({
      slug: "site-settings",
      data: { siteName: "Acme", about: "## Welcome\n\nTo **Acme**." },
    });

    // Write a second locale -- one locale per call, scalar values.
    await getTool(tools, "updateGlobal").execute({
      slug: "site-settings",
      locale: "es",
      data: { siteName: "Acme ES", about: "## Bienvenido" },
    });

    // Read the default locale: `about` comes back as Markdown.
    const en = (await getTool(tools, "findGlobal").execute({
      slug: "site-settings",
    })) as Record<string, unknown>;
    expect(en.siteName).toBe("Acme");
    expect(en.about).toContain("## Welcome");
    expect(en.about).toContain("**Acme**");

    // Read every locale with fallback off: localized fields are per-locale maps.
    // Assert the locales we wrote rather than the whole object -- the global is
    // a singleton in the shared dev DB and may carry values for other locales.
    const all = (await getTool(tools, "findGlobal").execute({
      slug: "site-settings",
      locale: "all",
      fallbackLocale: "false",
    })) as Record<string, Record<string, unknown>>;
    expect(all.siteName.en).toBe("Acme");
    expect(all.siteName.es).toBe("Acme ES");
    expect(all.about.es).toContain("## Bienvenido");
  });
});
