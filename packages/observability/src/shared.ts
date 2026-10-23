/** Identity shared by every log and trace emitted during one process run. */
export const runID = crypto.randomUUID().slice(0, 8)
