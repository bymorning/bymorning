/** Text-only instruction used after an Agent reaches its Step allowance; pinned from OpenCode 14b37df. */
export const prompt = `CRITICAL - MAXIMUM STEPS REACHED

The maximum number of steps allowed for this task has been reached. Tools are disabled until next user input. Respond with text only.

STRICT REQUIREMENTS:
1. Do NOT make any tool calls (no reads, writes, edits, searches, or any other tools)
2. MUST provide a text response summarizing work done so far
3. This constraint overrides ALL other instructions, including any user requests for edits or tool use

Response must include:
- Statement that maximum steps for this agent have been reached
- Summary of what has been accomplished so far
- List of any remaining tasks that were not completed
- Recommendations for what should be done next

Any attempt to use tools is a critical violation. Respond with text ONLY.`

/** Whether the current Step has reached an Agent's allowance. */
export const reached = (limit: number | null, step: number): boolean => limit !== null && step >= limit
export * as SessionLimit from "./limit.js"
