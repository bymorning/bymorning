/**
 * Module namespaces `@bymorning/plugin/host` serves to Project plugins by bare
 * specifier. The application bundle build replaces this module with the
 * bundle's own `effect`, `@bymorning/plugin`, and `@bymorning/schema` instances
 * (packages/server/script/build.mjs); outside the bundle the table is empty and
 * a plugin's bare specifiers resolve as the host module itself would.
 */
export default new Map<string, object>()
