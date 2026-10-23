# Effective Catalog execution

`Catalog.Service` is the shared execution authority for Sessions and LLM Gateway.
`Model.Service.list` and `Provider.Service.list` supply installation defaults only
when Catalog is constructed. Invocation never calls their static selectors.

The replayable Catalog rows retain installed package bindings, native settings,
options, and Variant overlays. The selected execution snapshots the effective
metadata, adapter, authentication choice, endpoint, and request defaults. Resolver
preparation consumes that snapshot; it does not rediscover a Provider or Model.
Credentials are still resolved through Integration at the outbound boundary.

## Compatibility details

- Gateway IDs follow `Model.publicID`: bare keys on the `direct` Providers
  (OpenAI, Anthropic, Google, Fireworks, Amazon Bedrock) and
  `<provider>/<key>` elsewhere, for bundled and custom Models alike.
  `<provider>/<key>` always resolves exactly.
- Workspace custom Models (`Config.Info.models`, managed through
  `Catalog.model.create`/`update`/`delete`) are applied when the Catalog is
  sealed, after every Plugin transform, so explicit configuration wins over
  contributed values. A new key that its Provider already uses is refused.
- Plugin `catalog.model.update` now upserts, including when the parent Provider
  is absent. An implicit parent starts disabled; the plugin must configure it.
- Provider and Model schema records add optional `execution` configuration.
  Provider authentication is explicit `none` or an Integration-backed key header
  with optional prefix. Runtime settings and options are JSON values, not secrets.
  A model's `package: null` records unsupported bundled transport; an explicit
  plugin replacement can supply an installed transport.
- Model format, endpoint, settings, and options override Provider defaults.
  A Variant overlays options only. Unknown Variants fail. Changing format through
  the editor drops an unchanged package binding so the prior adapter cannot
  silently retain authority over the new format.
- Unknown custom capability flags, open-weight metadata, and context limits are
  absent rather than false or zero. Existing required metadata containers remain;
  absent dates/descriptions use empty strings and unknown modality arrays are
  empty. Pricing is absent when unknown. Protocol and generated SDKs allow the
  corresponding optional metadata fields; discovery HTTP responses continue to
  project metadata rather than internal execution settings.
- Shared Model enablement remains Config-owned. Personal picker visibility is
  browser-local and has no effect on Catalog execution admission.
- Gateway uses the installed adapter to encode native request defaults, then
  preserves the caller's native envelope and explicit request values. Model ID,
  endpoint, and outbound authentication still come from the Catalog snapshot.

## Transport boundary

The complete nondeprecated pinned inventory is discoverable. It is not a claim
that every row supports conversational inference. Bundled execution requires
text input and output and an installed adapter with a registered authentication
contract. Audio-only/image-only rows and providers without those contracts remain
discoverable with typed unavailability. No package is installed or inferred as a
credential at request time. Bedrock keeps its regional credential/signing path.

Bedrock execution also checks the upstream model ID against the active
connection's Region (`region.ts`). In AWS GovCloud (US), `us-gov.` inference
profiles run; commercial geography profiles (`us.`, `global.`, `eu.`, ...) and
bare IDs whose `us.` profile is in the Catalog are `region-unsupported`.
Commercial Regions refuse only `us-gov.` profiles. The bundled `us-gov.` rows
are the GovCloud profiles AWS documents (`govCloudProfiles` in `model/direct.ts`),
each copied from its pinned `us.` row; the pinned source lists no `us-gov.`
profiles, and most `us.` profiles have no GovCloud counterpart.

Agent references and connected-model policy reconciliation consume effective
Catalog rows. Assistant, title, compaction, one-shot generation, and Gateway
selection all converge on `Catalog.model.requireExecution`.

The real application scenarios in `packages/testing/test/catalog.test.ts` cover
complete SDK discovery, Groq Tool execution, custom workspace-plugin and DeepSeek
SDK conversations, Gateway execution, native option/endpoint/upstream overrides,
and shared-disable refusal. Core seam tests also cover scoped upsert/removal,
immutable execution snapshots, Variant refusal, and restoration after disposal.
