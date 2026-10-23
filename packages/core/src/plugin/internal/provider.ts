import { define } from "@bymorning/plugin/effect/plugin"
import type { Integration as IntegrationSchema } from "@bymorning/schema/integration"
import type { Effect, Scope } from "effect"
import { Integration } from "../../integration.js"
import { nativeRegistry, registry, type Definition } from "../../provider/registry.js"

interface Editor {
  readonly update: (id: string, update: (integration: { name: string }) => void) => void
  readonly method: {
    readonly update: (input: { readonly integrationID: string; readonly method: IntegrationSchema.Method }) => void
  }
}

/** Register one bundled Provider's Integration methods. */
const activate = (
  definition: Definition,
  transform: (callback: (editor: Editor) => void) => Effect.Effect<void, never, Scope.Scope>,
) =>
  transform((editor) => {
    const integrationID = Integration.ID.make(definition.info.name)
    editor.update(
      integrationID,
      (integration) => (integration.name = definition.info.displayName ?? definition.info.name),
    )
    for (const method of definition.integration.methods) editor.method.update({ integrationID, method })
  })

/** Individually selectable built-in Provider Integration plugins. */
export const ProviderPlugins = [...registry, ...nativeRegistry].map((definition) =>
  define({
    id: `core.provider.${definition.info.name}`,
    effect: (context) =>
      activate(definition, (callback) =>
        context.integration.transform((editor) =>
          callback({
            update: editor.update,
            method: {
              update: (input) => {
                const update = editor.method.update as unknown as Editor["method"]["update"]
                update({ integrationID: input.integrationID, method: input.method })
              },
            },
          }),
        ),
      ),
  }),
)
