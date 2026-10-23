# Models Package Agent Guide

## Purpose and source of truth

`@bymorning/models` mirrors the complete provider and model catalog from `https://models.dev/api.json`. The API response is not fetched at runtime: its SHA-256 digest, byte count, compatibility projections, and icon source commit are recorded in `source/models-dev/pin.json`, with exact source bytes under `source/models-dev/cache/`. `@bymorning/models/catalog` exports every pinned provider and model without an allowlist, modality filter, or admission policy.

Generated files are never hand-edited. Change source schemas, descriptors, identity rules, or policy, then regenerate.

## Commands

From the repository root:

```sh
bun sync:models --source cache
bun sync:models --source live --dry-run
bun sync:models --source live --update-pin --approve-body-sha256 <digest> --observed-on YYYY-MM-DD
bun check:models
```

A live dry run prints the observed body digest and provider-level changes. Review them before approving the body with `--update-pin --approve-body-sha256 <digest> --observed-on YYYY-MM-DD`. Icon updates instead require `--icons --update-pin`, `--approve-icon-commit <commit>`, and one `--approve-icon-sha256 <source>=<digest>` for every descriptor.

Run package checks from `packages/models`:

```sh
bun typecheck
bun test
```

## Adding a compatibility projection

Every source provider is already present in the complete catalog. The steps below add a provider to the normalized runtime projections used by Core.

1. Add its local/source mapping, adapter, and expected npm package to `src/descriptors.ts`.
2. Add the provider mapping to `policy/aliases.ts`; add model aliases or an identity transform only when source IDs cannot be local IDs.
3. Pin and cache available provider icons using the explicit icon approvals described above. Icon coverage follows the
   complete pinned models.dev provider IDs independently of runtime compatibility projections; providers whose upstream
   logo is absent or rejected by the SVG sanitizer retain the generic fallback.
4. Regenerate catalogs, reports, provenance, and icon indexes.
5. Complete downstream integration: add the constant in `packages/schema/src/provider.ts`; add the definition, including `catalog: "direct" | "aggregator"`, in `packages/core/src/provider/registry.ts`; wire `packages/core/src/model/direct.ts` and `packages/core/src/model/registry.ts`; and add the icon row in `packages/web/src/integration/provider-icon-registry.ts`.
6. Extend focused identity, format, schema, and snapshot tests as needed; provider ID types are derived from the descriptor table.

## Catalog policy

The package does not classify, approve, quarantine, or filter catalog rows. Generated compatibility projections contain every model published for that provider, including non-language and deprecated models. Lifecycle, modality, capability, and transport fields are descriptive source metadata; consumers own any execution compatibility decisions.

Each generated model has a model-level `format`: `openai`, `anthropic`, `google`, or `oa-compat` identifies its wire protocol from the model npm override (falling back to the provider npm package); `bedrock-converse` identifies the Bedrock adapter transport.

Local model IDs must be unique. Direct catalogs keep their local IDs; when an aggregator collides with one, its public ID is namespaced as `provider/<id>` downstream.

Provider projection reports live in `generated/reports/`. Source and icon lineage lives in `generated/provenance.json`.
