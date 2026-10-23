import { type Failure, message, retryAfter, status } from "../failure.js"
import type { Adapter } from "../protocol.js"
import { jsonHeaders } from "./body.js"

/** Ingress behavior shared by the OpenAI Chat Completions and Responses formats. */
export const openAI = {
  discovery: ["openai-chat", "openai-responses"],
  models: (entries, now) => {
    const created = Math.floor(now / 1000)
    return {
      object: "list",
      data: entries.map((entry) => ({ id: entry.id, object: "model", created, owned_by: "bymorning" })),
    }
  },
  error: (failure: Failure) => {
    const code = status(failure)
    const type =
      code === 401
        ? "authentication_error"
        : code === 403
          ? "permission_error"
          : code === 429
            ? "rate_limit_error"
            : code >= 500
              ? "server_error"
              : "invalid_request_error"
    return {
      status: code,
      headers: jsonHeaders(code, retryAfter(failure)),
      body: { error: { message: message(failure), type, code: code === 404 ? "model_not_found" : null } },
    }
  },
} as Pick<Adapter, "discovery" | "models" | "error">
