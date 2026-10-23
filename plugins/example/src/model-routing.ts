import { Plugin, Provider } from "@bymorning/plugin"
import type { Model } from "@bymorning/schema/model"

type ModelRouteOptions = Readonly<{
  requested: string
  target: string
  destination: Model.Ref
}>

// A requested resource is a whole-reference pattern, so it may use `*` and `?`.
const requestedPattern = /^(?!prv_)[^/#\s]+\/[^/#\s]+(?:#[^/#\s]+)?$/
// A route target must name one concrete catalog Model, never a wildcard pattern.
const targetResource = /^(?!prv_)[^/*?#\s]+\/[^/*?#\s]+(?:#[^/*?#\s]+)?$/

const match = (value: string, pattern: string) => {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, ".*")
    .replace(/\?/g, ".")
  return new RegExp(`^${escaped}$`).test(value)
}

const parseRef = (value: string): Model.Ref => {
  const slash = value.indexOf("/")
  const hash = value.indexOf("#", slash + 1)
  const provider = Provider.Name.make(value.slice(0, slash))
  const id = hash < 0 ? value.slice(slash + 1) : value.slice(slash + 1, hash)
  const variant = hash < 0 ? undefined : value.slice(hash + 1)
  return variant === undefined || variant === "default" ? { provider, id } : { provider, id, variant }
}

const resource = (model: Model.Ref) =>
  `${model.provider}/${model.id}${model.variant === undefined || model.variant === "default" ? "" : `#${model.variant}`}`

const options = (value: Readonly<Record<string, unknown>>): ModelRouteOptions => {
  const requested = value.requested
  const target = value.target
  if (
    typeof requested !== "string" ||
    typeof target !== "string" ||
    !requestedPattern.test(requested) ||
    !targetResource.test(target)
  ) {
    throw new Error("Model route configuration is invalid")
  }
  return { requested, target, destination: parseRef(target) }
}

/** Route one requested Model pattern to an approved, configured catalog Model. */
export default Plugin.define({
  id: "example.model-routing",
  scope: "workspace",
  configuration: {
    title: "Approved model route",
    description: "Route a requested Model pattern to an approved Model already configured in this Workspace catalog.",
    fields: [
      {
        key: "requested",
        type: "string",
        title: "Requested model pattern",
        description: "Use provider/model[#variant] with * or ?. Example: requested-provider/requested-model.",
        placeholder: "requested-provider/requested-model",
        default: "requested-provider/requested-model",
        required: true,
        pattern: "^(?!prv_)[^/#\\s]+/[^/#\\s]+(?:#[^/#\\s]+)?$",
      },
      {
        key: "target",
        type: "string",
        title: "Approved target model",
        description:
          "Use a concrete provider/model[#variant] already configured in the catalog. Example: approved-provider/approved-model.",
        placeholder: "approved-provider/approved-model",
        default: "approved-provider/approved-model",
        required: true,
        pattern: "^(?!prv_)[^/*?#\\s]+/[^/*?#\\s]+(?:#[^/*?#\\s]+)?$",
      },
    ],
  },
  async setup(context) {
    const { requested, target, destination } = options(context.options)
    const route = (source: string, apply: (value: string) => void) => {
      if (match(source, requested)) apply(target)
    }
    await Promise.all([
      context.session.hook("model.request", (input) => {
        route(resource(input.requestedModel), () => {
          input.model = { ...destination }
        })
      }),
      context.gateway.hook("model.request", (input) => {
        route(input.requestedModel, (value) => {
          input.model = value
        })
      }),
    ])
  },
})
