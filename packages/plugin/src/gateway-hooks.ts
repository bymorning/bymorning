import type { LLMGateway } from "@bymorning/schema/llm-gateway"

/** Mutable caller-native request before destination resolution. */
export interface GatewayRequest {
  readonly protocol: LLMGateway.Protocol
  readonly requestedModel: string
  readonly stream: boolean
  model: string
  body: LLMGateway.Body
}
