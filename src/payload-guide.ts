/**
 * A compact, static reference on how Payload's query API and document data
 * behave, injected into the agent's system prompt so it queries and shapes data
 * correctly instead of discovering the rules by trial, error, and oversized
 * reads.
 *
 * Every fact here is verified against the Payload 3.85 source, not memory:
 * - operators: `payload/dist/types/constants` (`validOperators`)
 * - depth (0 = id, default 2): `fields/hooks/afterRead/relationshipPopulationPromise`
 *   + `config/defaults` (`defaultDepth: 2`)
 * - select include/exclude: `types/index` (`SelectIncludeType`/`SelectExcludeType`)
 * - field shapes + `blockType` discriminator + named/unnamed tabs:
 *   `utilities/configToJSONSchema`
 * - sort + paginated result: `types/index` (`Sort`) + `database/types` (`PaginatedDocs`)
 *
 * It describes the plugin's own tools (find/findByID/create/update) -- e.g. find
 * returns only { docs, totalDocs, totalPages, page } -- not raw payload.* calls.
 *
 * Keep it tight: it rides in the prompt-cached prefix, so its cost is paid once
 * per conversation, but bloat still crowds the context window.
 */
export const PAYLOAD_REFERENCE = `Payload data & query reference (applies to the find, findByID, create, and update tools):
- where operators: equals, not_equals, in, not_in, all, exists, greater_than, greater_than_equal, less_than, less_than_equal, contains (case-insensitive substring match), like (all whitespace-separated words present), not_like, and near/within/intersects (point fields). One condition is { field: { operator: value } }; combine them with { and: [...] } and { or: [...] }; filter on a related or nested field with a dot path, e.g. { "author.role": { equals: "editor" } }.
- To find documents matching a condition, always pass a where filter (or use count for a total) instead of fetching a whole collection and filtering in code.
- select shapes the response: { title: true, price: true } returns only those fields plus id; { content: false } returns everything except content; omit select for all fields.
- depth controls relationship and upload population. Reads default to depth 0, where those fields are just the related document's id; raise depth (1 or 2) to get the related document inline, or read it separately by id. Oversized read results are rejected, so if that happens narrow the query with where, select, limit, or a lower depth.
- sort is a field name with a leading "-" for descending (e.g. "-createdAt"); pass an array for multi-sort, e.g. ["category", "-createdAt"]. find returns { docs, totalDocs, totalPages, page } -- page through with page and limit.
- Field shapes you read and write: a relationship or upload field is the related id at depth 0 and the full document when populated; a hasMany relationship is an array; a polymorphic relationship (relationTo is a list) is { relationTo, value }. An array field is an array of row objects. A blocks field is an array where each item sets blockType to the block's slug plus that block's own fields. A group is a nested object under its name. A named tab nests its fields under the tab's name; an unnamed tab's fields sit at the top level of the document. A select field is a string, or an array of strings when hasMany. checkbox is a boolean, number is a number, date is an ISO 8601 string (e.g. "2026-01-31T00:00:00.000Z"), and point is [longitude, latitude].
- When creating or updating, send only the fields you want to set, in these shapes and matching the collection's TypeScript type from getSchema; for relationship and upload fields pass ids, not whole documents.`;
