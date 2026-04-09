import path from "node:path";
import { fileURLToPath } from "node:url";
import { mongooseAdapter } from "@payloadcms/db-mongodb";
import { lexicalEditor } from "@payloadcms/richtext-lexical";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import { buildConfig } from "payload";
import { payloadAgentPlugin } from "payload-agent-plugin";
import sharp from "sharp";

import { testEmailAdapter } from "./helpers/test-email-adapter.js";
import { seed } from "./seed.js";

const filename = fileURLToPath(import.meta.url);
const dirname = path.dirname(filename);

if (!process.env.ROOT_DIR) {
  process.env.ROOT_DIR = dirname;
}

const buildConfigWithMemoryDB = async () => {
  if (process.env.NODE_ENV === "test") {
    const memoryDB = await MongoMemoryReplSet.create({
      replSet: {
        count: 1,
        dbName: "payloadmemory",
      },
    });

    process.env.DATABASE_URL = `${memoryDB.getUri()}&retryWrites=true`;
  }

  return buildConfig({
    admin: {
      importMap: {
        baseDir: path.resolve(dirname),
      },
    },
    collections: [
      {
        slug: "posts",
        fields: [],
      },
      {
        slug: "media",
        fields: [],
        upload: {
          staticDir: path.resolve(dirname, "media"),
        },
      },
    ],
    db: mongooseAdapter({
      ensureIndexes: true,
      url: process.env.DATABASE_URL || "",
    }),
    editor: lexicalEditor(),
    email: testEmailAdapter,
    onInit: async (payload) => {
      await seed(payload);
    },
    plugins: [
      payloadAgentPlugin({
        collections: {
          posts: true,
        },
      }),
    ],
    secret: process.env.PAYLOAD_SECRET || "test-secret_key",
    sharp,
    typescript: {
      outputFile: path.resolve(dirname, "payload-types.ts"),
    },
  });
};

export default buildConfigWithMemoryDB();
