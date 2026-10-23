/** Project plugin entrypoint recognition shared by the Project File Tools. */

/** Exactly `plugin/<slug>.ts` or `plugin/<slug>/index.ts`; deeper files are support modules, not plugins. */
const pattern = /^plugin\/[^/]+(?:\.ts|\/index\.ts)$/

/** Whether a Project-relative path is a Project plugin entrypoint the host loads on its own. */
export const isEntrypoint = (path: string) => pattern.test(path)

/** Appended to a successful write or edit of an entrypoint so the model verifies activation instead of assuming it. */
export const activationNote =
  'This is a Project plugin entrypoint: it activates before the next assistant turn, so call `toolkit.plugin.list` then to confirm `status: "active"` for it or read its `error`.'
