/** Presentation and projection failures must not turn a committed write into a retryable write error. */
export function postCommit(run: () => unknown): void {
  try {
    void Promise.resolve(run()).catch((cause) => console.error(cause))
  } catch (cause) {
    console.error(cause)
  }
}
