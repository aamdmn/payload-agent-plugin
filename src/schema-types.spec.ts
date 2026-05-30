import type { BasePayload } from "payload";
import { describe, expect, test } from "vitest";
import {
  createTypesProvider,
  loadGeneratedTypes,
  sliceCollectionType,
} from "./schema-types.js";

// Mirrors the shape Payload generates in payload-types.ts: a Config.collections
// map, a collection interface with a block union, referenced block/group
// interfaces, and a noisy *Select helper that must be excluded.
const TYPES = `export interface Config {
  collections: {
    products: Product;
    media: Media;
    "payload-preferences": PayloadPreference;
  };
  collectionsSelect: {
    products: ProductsSelect<false> | ProductsSelect<true>;
  };
}
export interface Product {
  id: string;
  title: string;
  layout: (HeroBlock | FeatureGridBlock)[];
  seo?: Seo;
}
export interface HeroBlock {
  heading: string;
  image: string | Media;
  blockType: "hero";
}
export interface FeatureGridBlock {
  products: (string | Product)[];
  blockType: "featureGrid";
}
export interface Seo {
  title?: string | null;
  description?: string | null;
}
export interface Media {
  id: string;
  url?: string | null;
}
export interface ProductsSelect<T extends boolean = true> {
  title?: T;
  layout?: T;
}
export interface PayloadPreference {
  id: string;
}
`;

describe("createTypesProvider", () => {
  const provider = createTypesProvider(TYPES);

  test("returns a collection's interface with its referenced blocks and groups", () => {
    const type = provider.getCollectionType("products") ?? "";

    expect(type).toContain("export interface Product");
    expect(type).toContain("export interface HeroBlock");
    expect(type).toContain("export interface FeatureGridBlock");
    expect(type).toContain("export interface Seo");
    expect(type).toContain("export interface Media");
  });

  test("excludes Select helpers and unreferenced interfaces", () => {
    const type = provider.getCollectionType("products") ?? "";

    expect(type).not.toContain("ProductsSelect");
    expect(type).not.toContain("PayloadPreference");
  });

  test("resolves quoted slugs from the Config map", () => {
    const type = provider.getCollectionType("payload-preferences") ?? "";

    expect(type).toContain("export interface PayloadPreference");
  });

  test("returns null for an unknown collection", () => {
    expect(provider.getCollectionType("unknown")).toBeNull();
  });
});

describe("sliceCollectionType", () => {
  test("returns null when the root interface is absent", () => {
    expect(sliceCollectionType(TYPES, "Missing")).toBeNull();
  });

  test("does not pull in a prefix-matching interface", () => {
    // Slicing "Product" must not capture "ProductsSelect".
    const sliced = sliceCollectionType(TYPES, "Product") ?? "";
    const header = sliced.slice(0, sliced.indexOf("\n"));

    expect(header).toBe("export interface Product {");
  });
});

describe("loadGeneratedTypes", () => {
  test("returns null when no outputFile is configured", async () => {
    const payload = { config: {} } as unknown as BasePayload;

    expect(await loadGeneratedTypes(payload)).toBeNull();
  });

  test("returns null when the file cannot be read", async () => {
    const payload = {
      config: { typescript: { outputFile: "/no/such/payload-types.ts" } },
    } as unknown as BasePayload;

    expect(await loadGeneratedTypes(payload)).toBeNull();
  });
});
