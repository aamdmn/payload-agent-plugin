import type { CollectionSlug, Config } from "payload";

import { customEndpointHandler } from "./endpoints/custom-endpoint-handler.js";

export interface PayloadAgentPluginConfig {
  /**
   * List of collections to add a custom field
   */
  collections?: Partial<Record<CollectionSlug, true>>;
  disabled?: boolean;
}

const addPluginFieldsToCollections = (
  config: Config,
  collections: Partial<Record<CollectionSlug, true>>
) => {
  for (const collectionSlug of Object.keys(collections)) {
    const collection = config.collections?.find(
      (c) => c.slug === collectionSlug
    );

    if (collection) {
      collection.fields.push({
        name: "addedByPlugin",
        type: "text",
        admin: {
          position: "sidebar",
        },
      });
    }
  }
};

export const payloadAgentPlugin =
  (pluginOptions: PayloadAgentPluginConfig) =>
  (config: Config): Config => {
    if (!config.collections) {
      config.collections = [];
    }

    config.collections.push({
      slug: "plugin-collection",
      fields: [
        {
          name: "id",
          type: "text",
        },
      ],
    });

    if (pluginOptions.collections) {
      addPluginFieldsToCollections(config, pluginOptions.collections);
    }

    /**
     * If the plugin is disabled, we still want to keep added collections/fields so the database schema is consistent which is important for migrations.
     * If your plugin heavily modifies the database schema, you may want to remove this property.
     */
    if (pluginOptions.disabled) {
      return config;
    }

    if (!config.endpoints) {
      config.endpoints = [];
    }

    if (!config.admin) {
      config.admin = {};
    }

    if (!config.admin.components) {
      config.admin.components = {};
    }

    if (!config.admin.components.beforeDashboard) {
      config.admin.components.beforeDashboard = [];
    }

    config.admin.components.beforeDashboard.push(
      "payload-agent-plugin/client#BeforeDashboardClient"
    );
    config.admin.components.beforeDashboard.push(
      "payload-agent-plugin/rsc#BeforeDashboardServer"
    );

    config.endpoints.push({
      handler: customEndpointHandler,
      method: "get",
      path: "/my-plugin-endpoint",
    });

    const incomingOnInit = config.onInit;

    config.onInit = async (payload) => {
      if (incomingOnInit) {
        await incomingOnInit(payload);
      }

      const { totalDocs } = await payload.count({
        collection: "plugin-collection",
        where: {
          id: {
            equals: "seeded-by-plugin",
          },
        },
      });

      if (totalDocs === 0) {
        await payload.create({
          collection: "plugin-collection",
          data: {
            id: "seeded-by-plugin",
          },
        });
      }
    };

    return config;
  };
