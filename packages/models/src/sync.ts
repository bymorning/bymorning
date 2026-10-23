import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import { copyFile, mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises"
import path from "node:path"
import { modelAliases, providerAliases } from "../policy/aliases.js"
import { legacyModels } from "../policy/legacy.js"
import { snapshotExpectations } from "../policy/snapshot-expectations.js"
import { models as previousAnthropic } from "../generated/providers/anthropic.generated.js"
import { models as previousBedrock } from "../generated/providers/amazon-bedrock.generated.js"
import { models as previousOpenAI } from "../generated/providers/openai.generated.js"
import { descriptors, type Adapter } from "./descriptors.js"
import { assertNoUnapprovedRemovals, localModelID } from "./identity.js"
import { sanitizeIcon } from "./icon.js"
import type { GeneratedModel } from "./normalized.js"
import { decodeProvider, decodeSourceBody, decodeSourcePin, type Model, type Provider } from "./source-schema.js"

export interface SyncOptions {
  readonly source: "live" | "cache" | "path"
  readonly path?: string
  readonly provider?: string
  readonly icons: boolean
  readonly updatePin: boolean
  readonly approveBody?: string
  readonly approveIconCommit?: string
  readonly approveIconDigests?: Readonly<Record<string, string>>
  readonly observedOn?: string
  readonly dryRun: boolean
  readonly check: boolean
}

const packageRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..")
const repositoryRoot = path.resolve(packageRoot, "../..")
const pinPath = path.join(packageRoot, "source/models-dev/pin.json")
const enabledProviders = descriptors.map((descriptor) => descriptor.localID)
const generatedIconPattern = /^.+\.[a-f0-9]{12}\.svg$/
const localIconID = (sourceID: string) => (sourceID === "fireworks-ai" ? "fireworks" : sourceID)

const digest = (bytes: Uint8Array | string) => createHash("sha256").update(bytes).digest("hex")
const compareCodePoints = (left: string, right: string) => {
  const leftPoints = Array.from(left, (value) => value.codePointAt(0)!)
  const rightPoints = Array.from(right, (value) => value.codePointAt(0)!)
  for (let index = 0; index < Math.min(leftPoints.length, rightPoints.length); index++) {
    if (leftPoints[index] !== rightPoints[index]) return leftPoints[index]! - rightPoints[index]!
  }
  return leftPoints.length - rightPoints.length
}
export const canonical = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`
  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value)
      .sort(([left], [right]) => compareCodePoints(left, right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
      .join(",")}}`
  }
  return JSON.stringify(value)
}
const json = (value: unknown) => JSON.stringify(value, null, 2) + "\n"

export async function sync(options: SyncOptions) {
  await recoverArtifactGraph()
  const selectedProvider =
    options.provider === undefined ? undefined : enabledProviders.find((provider) => provider === options.provider)
  if (options.provider !== undefined && selectedProvider === undefined)
    throw new Error(`unsupported provider target: ${options.provider}`)
  if (options.icons && options.provider !== undefined) throw new Error("--icons and --provider are independent targets")
  if ((options.updatePin || options.approveBody !== undefined) && options.provider !== undefined) {
    throw new Error("pin updates require the complete provider graph")
  }
  if (options.updatePin && options.icons) return updateIcons(options)
  if (
    options.icons &&
    (options.approveIconCommit !== undefined || Object.keys(options.approveIconDigests ?? {}).length > 0)
  )
    throw new Error("icon approvals require --icons --update-pin")

  const acquired = await acquire(options)
  const projected = await validateAndProject(acquired.bytes, acquired.pin, acquired.digest !== acquired.pin.bodyDigest)
  const pinChanged = acquired.digest !== acquired.pin.bodyDigest
  if (pinChanged && (!options.updatePin || options.approveBody !== acquired.digest)) {
    console.log(diffSummary(acquired.pin.bodyDigest, acquired.digest, projected))
    if (options.updatePin && options.approveBody === undefined) return
    throw new Error(
      `body ${acquired.pin.bodyDigest} -> ${acquired.digest}; write requires --update-pin --approve-body-sha256 ${acquired.digest} --observed-on YYYY-MM-DD`,
    )
  }
  if (options.approveBody !== undefined && !options.updatePin)
    throw new Error("--approve-body-sha256 requires --update-pin")
  if (pinChanged && options.observedOn === undefined) throw new Error("a changed pin requires --observed-on YYYY-MM-DD")
  if (!pinChanged && options.observedOn !== undefined) throw new Error("--observed-on is only valid for a changed pin")

  const outputs = buildTargetOutputs(
    options,
    selectedProvider,
    projected,
    acquired,
    options.observedOn ?? acquired.pin.observedOn,
  )
  const stale = await staleTargetPaths(options, outputs)
  if (options.dryRun) {
    console.log(summary(acquired.digest, projected.rows, outputs, stale))
    return
  }
  if (options.check) {
    const drift = [...stale]
    for (const [target, content] of outputs) {
      if (!(await exists(target)) || digest(await readFile(target)) !== digest(content)) drift.push(target)
    }
    if (drift.length > 0) {
      throw new Error(
        `generated drift:\n${drift
          .map((file) => path.relative(repositoryRoot, file))
          .sort(compareCodePoints)
          .join("\n")}`,
      )
    }
    console.log(summary(acquired.digest, projected.rows, outputs, stale))
    await clearCompletedRecoveries()
    return
  }

  if (pinChanged) {
    outputs.set(pinPath, json(projected.nextPin(options.observedOn!)))
    outputs.set(path.join(packageRoot, `source/models-dev/cache/body.${acquired.digest}.json`), acquired.bytes)
    for (const provider of projected.providerPins) {
      outputs.set(
        path.join(packageRoot, `source/models-dev/cache/providers/${provider.sourceID}.${provider.digest}.json`),
        provider.bytes,
      )
    }
    addSnapshotOutput(outputs, projected)
  }
  await writeArtifactGraph(outputs, stale)
  console.log(summary(acquired.digest, projected.rows, outputs, stale))
}

async function acquire(options: SyncOptions) {
  const pin = decodeSourcePin(JSON.parse(await readFile(pinPath, "utf8")))
  if (new Set(pin.providers.map((provider) => provider.localID)).size !== pin.providers.length) {
    throw new Error("duplicate local provider IDs in pin")
  }
  if (new Set(pin.providers.map((provider) => provider.sourceID)).size !== pin.providers.length) {
    throw new Error("duplicate source provider IDs in pin")
  }
  const bytes =
    options.source === "live"
      ? new Uint8Array(await (await fetch(pin.url)).arrayBuffer())
      : await readFile(
          options.source === "path"
            ? path.resolve(options.path!)
            : path.join(packageRoot, `source/models-dev/cache/body.${pin.bodyDigest}.json`),
        )
  const acquiredDigest = digest(bytes)
  if (options.source === "cache" && acquiredDigest !== pin.bodyDigest) throw new Error("cache body does not match pin")
  if (acquiredDigest === pin.bodyDigest && bytes.byteLength !== pin.bodyBytes)
    throw new Error("pinned body byte count mismatch")
  return { pin, bytes, digest: acquiredDigest }
}

async function updateIcons(options: SyncOptions) {
  if (options.approveBody !== undefined || options.observedOn !== undefined || options.provider !== undefined) {
    throw new Error("icon pin updates cannot update the model body")
  }
  if (options.approveIconCommit === undefined) throw new Error("icon update requires --approve-icon-commit <40-hex>")
  const approved = options.approveIconDigests ?? {}
  const sourceIDs = Object.keys(approved).sort(compareCodePoints)
  if (sourceIDs.length === 0) throw new Error("icon update requires at least one --approve-icon-sha256 source=digest")
  const pin = decodeSourcePin(JSON.parse(await readFile(pinPath, "utf8")))
  const rawIcons = new Map<string, Uint8Array>()
  for (const sourceID of sourceIDs) {
    const bytes =
      options.source === "path"
        ? await readFile(path.join(path.resolve(options.path!), `${sourceID}.svg`))
        : new Uint8Array(
            await (
              await fetch(
                `https://raw.githubusercontent.com/${pin.icons.repository}/${options.approveIconCommit}/providers/${sourceID}/logo.svg`,
              )
            ).arrayBuffer(),
          )
    if (digest(bytes) !== approved[sourceID]) throw new Error(`approved raw icon digest mismatch: ${sourceID}`)
    sanitizeIcon(new TextDecoder().decode(bytes))
    rawIcons.set(sourceID, bytes)
  }
  const nextPin = {
    ...pin,
    icons: { ...pin.icons, commit: options.approveIconCommit, digests: approved },
  }
  const outputs = new Map<string, string | Uint8Array>([[pinPath, json(nextPin)]])
  for (const [sourceID, bytes] of rawIcons) {
    outputs.set(path.join(packageRoot, `source/models-dev/cache/icons/${sourceID}.svg`), bytes)
  }
  addIconOutputs(outputs, nextPin, rawIcons)
  const acquired = await acquire({ ...options, source: "cache", updatePin: false })
  const projected = await validateAndProject(acquired.bytes, acquired.pin)
  outputs.set(
    path.join(packageRoot, "generated/provenance.json"),
    json({
      schemaVersion: 1,
      packageVersion: "0.0.0",
      source: {
        url: pin.url,
        observedOn: pin.observedOn,
        bodyDigest: pin.bodyDigest,
        bodyBytes: pin.bodyBytes,
        description: "Metadata projected from the pinned, fully resolved API response body",
      },
      providers: projected.providerPins.map(({ bytes: _, ...provider }) => provider),
      icons: { ...nextPin.icons, description: "Logos copied from the pinned Git commit" },
    }),
  )
  const stale = await staleTargetPaths({ ...options, updatePin: false }, outputs)
  if (options.dryRun) {
    console.log(`icons commit=${pin.icons.commit} -> ${options.approveIconCommit}`)
    return
  }
  if (options.check) throw new Error("--check cannot update an icon pin")
  await writeArtifactGraph(outputs, stale)
  console.log(`icons commit=${pin.icons.commit} -> ${options.approveIconCommit}`)
}

async function validateAndProject(bytes: Uint8Array, pin: ReturnType<typeof decodeSourcePin>, updating = false) {
  const resolvedDigest = digest(bytes)
  const body = decodeSourceBody(new TextDecoder().decode(bytes))
  const providerIDs = Object.keys(body).sort(compareCodePoints)
  for (const providerID of providerIDs) {
    const provider = body[providerID]!
    if (provider.id !== providerID) throw new Error(`provider ID does not match catalog key: ${providerID}`)
    for (const [modelID, model] of Object.entries(provider.models)) {
      if (model.id !== modelID) throw new Error(`model ID does not match catalog key: ${providerID}/${modelID}`)
    }
  }
  const modelInventory = digest(
    JSON.stringify(
      Object.fromEntries(
        providerIDs.map((provider) => [provider, Object.keys(body[provider]!.models).sort(compareCodePoints)]),
      ),
    ),
  )
  if (
    !updating &&
    (providerIDs.length !== snapshotExpectations.sourceInventory.providers.count ||
      digest(JSON.stringify(providerIDs)) !== snapshotExpectations.sourceInventory.providers.digest ||
      modelInventory !== snapshotExpectations.sourceInventory.models)
  ) {
    throw new Error("source catalog inventory changed")
  }

  const providers = new Map<string, Provider>(Object.entries(body))
  const previousSourceRows = new Map<string, Array<GeneratedModel>>()
  const providerPins: Array<{
    readonly localID: (typeof descriptors)[number]["localID"]
    readonly sourceID: (typeof descriptors)[number]["sourceID"]
    readonly digest: string
    readonly modelCount: number
    readonly bytes: string
  }> = []
  for (const descriptor of descriptors) {
    const current = pin.providers.find((provider) => provider.sourceID === descriptor.sourceID)
    if (current === undefined && !updating) throw new Error(`missing provider pin: ${descriptor.sourceID}`)
    const canonicalProvider = canonical(body[descriptor.sourceID])
    const providerDigest = digest(canonicalProvider)
    if (resolvedDigest === pin.bodyDigest && providerDigest !== current!.digest) {
      throw new Error(`provider cache digest mismatch: ${descriptor.sourceID}`)
    }
    if (resolvedDigest === pin.bodyDigest) {
      const cached = await readFile(
        path.join(packageRoot, `source/models-dev/cache/providers/${descriptor.sourceID}.${current!.digest}.json`),
        "utf8",
      )
      if (digest(cached) !== current!.digest || cached !== canonicalProvider) {
        throw new Error(`provider cache content mismatch: ${descriptor.sourceID}`)
      }
    }
    let provider: Provider
    try {
      provider = decodeProvider(body[descriptor.sourceID])
    } catch (error) {
      throw new Error(`invalid provider ${descriptor.sourceID}: ${String(error)}`)
    }
    if (provider.id !== descriptor.sourceID || provider.npm !== descriptor.expectedNpm) {
      throw new Error(`provider assertion failed: ${descriptor.sourceID}`)
    }
    const modelIDs = Object.keys(provider.models).sort(compareCodePoints)
    providers.set(descriptor.sourceID, provider)
    if (updating && current !== undefined) {
      const previousPin = current
      const previousProvider = decodeProvider(
        JSON.parse(
          await readFile(
            path.join(
              packageRoot,
              `source/models-dev/cache/providers/${descriptor.sourceID}.${previousPin.digest}.json`,
            ),
            "utf8",
          ),
        ),
      )
      previousSourceRows.set(
        descriptor.sourceID,
        Object.keys(previousProvider.models)
          .sort(compareCodePoints)
          .map((id) =>
            normalize(
              descriptor.localID,
              descriptor.sourceID,
              descriptor.adapter,
              previousProvider.npm,
              id,
              previousProvider.models[id]!,
            ),
          ),
      )
    }
    if (updating && current === undefined) previousSourceRows.set(descriptor.sourceID, [])
    providerPins.push({
      localID: descriptor.localID,
      sourceID: descriptor.sourceID,
      digest: providerDigest,
      modelCount: modelIDs.length,
      bytes: canonicalProvider,
    })
  }

  const rows = new Map<string, Array<GeneratedModel>>()
  for (const descriptor of descriptors) {
    const provider = providers.get(descriptor.sourceID)!
    rows.set(
      descriptor.sourceID,
      Object.keys(provider.models)
        .sort(compareCodePoints)
        .map((id) => {
          try {
            return normalize(
              descriptor.localID,
              descriptor.sourceID,
              descriptor.adapter,
              provider.npm,
              id,
              provider.models[id]!,
            )
          } catch (error) {
            throw new Error(`invalid model ${descriptor.sourceID}/${id}: ${String(error)}`)
          }
        }),
    )
  }
  assertSnapshot(rows, updating, previousSourceRows)
  return {
    rows,
    providers,
    sourceProviderIDs: providerIDs,
    previousSourceRows,
    providerPins,
    nextPin: (observedOn: string) => ({
      ...pin,
      observedOn,
      bodyDigest: resolvedDigest,
      bodyBytes: bytes.byteLength,
      providers: providerPins.map(({ bytes: _, ...provider }) => provider),
    }),
  }
}

function buildTargetOutputs(
  options: SyncOptions,
  selectedProvider: (typeof enabledProviders)[number] | undefined,
  projected: Awaited<ReturnType<typeof validateAndProject>>,
  acquired: Awaited<ReturnType<typeof acquire>>,
  observedOn: string,
) {
  const outputs = new Map<string, string | Uint8Array>()
  const targets = options.icons ? [] : selectedProvider === undefined ? enabledProviders : [selectedProvider]
  for (const provider of targets) {
    const report = projected.rows.get(descriptors.find((descriptor) => descriptor.localID === provider)!.sourceID)!
    const generated = report
    outputs.set(
      path.join(packageRoot, `generated/providers/${provider}.generated.ts`),
      `import type { GeneratedModel } from "../../src/normalized.js"\n\nexport const models = ${json(generated).trim()} as const satisfies ReadonlyArray<GeneratedModel>\n`,
    )
    outputs.set(
      path.join(packageRoot, `generated/reports/${provider}.json`),
      json({ provider, sourceCandidates: report.length, generated: generated.length, rows: report }),
    )
  }
  if (!options.icons && options.provider === undefined) {
    outputs.set(
      path.join(packageRoot, "generated/catalog.generated.ts"),
      `import source from "../source/models-dev/cache/body.${acquired.digest}.json" with { type: "json" }\nimport type { Catalog } from "../src/source-schema.js"\n\n/** Complete pinned models.dev catalog. No provider or model rows are filtered. */\nexport const catalog = source as Catalog\n`,
    )
    outputs.set(
      path.join(packageRoot, "generated/legacy.generated.ts"),
      `export const legacyModels = ${json(legacyModels).trim()} as const\n`,
    )
    outputs.set(
      path.join(packageRoot, "generated/reports/removals.json"),
      json({ schemaVersion: 1, dispositions: legacyModels }),
    )
    outputs.set(
      path.join(packageRoot, "generated/provenance.json"),
      json({
        schemaVersion: 1,
        packageVersion: "0.0.0",
        source: {
          url: acquired.pin.url,
          observedOn,
          bodyDigest: acquired.digest,
          bodyBytes: acquired.bytes.byteLength,
          description: "Metadata projected from the pinned, fully resolved API response body",
        },
        providers: projected.providerPins.map(({ bytes: _, ...provider }) => provider),
        icons: { ...acquired.pin.icons, description: "Logos copied from the pinned Git commit" },
      }),
    )
  }
  if (options.icons) addIconOutputs(outputs, acquired.pin)
  return outputs
}

function addSnapshotOutput(
  outputs: Map<string, string | Uint8Array>,
  projected: Awaited<ReturnType<typeof validateAndProject>>,
) {
  const providerIDs = projected.sourceProviderIDs
  const modelInventory = digest(
    JSON.stringify(
      Object.fromEntries(
        providerIDs.map((provider) => [
          provider,
          Object.keys(projected.providers.get(provider)?.models ?? {}).sort(compareCodePoints),
        ]),
      ),
    ),
  )
  const expectations = {
    sourceInventory: {
      providers: { count: providerIDs.length, digest: digest(JSON.stringify(providerIDs.sort(compareCodePoints))) },
      models: modelInventory,
    },
  }
  outputs.set(
    path.join(packageRoot, "policy/snapshot-expectations.ts"),
    `export const snapshotExpectations = ${json(expectations).trim()} as const\n`,
  )
}

function addIconOutputs(
  outputs: Map<string, string | Uint8Array>,
  pin: ReturnType<typeof decodeSourcePin>,
  updated?: ReadonlyMap<string, Uint8Array>,
) {
  const iconIndex: Record<string, { url: string; sourceDigest: string }> = {}
  const css = []
  for (const sourceID of Object.keys(pin.icons.digests).sort(compareCodePoints)) {
    const localID = localIconID(sourceID)
    const raw =
      updated?.get(sourceID) === undefined
        ? readFileSync(path.join(packageRoot, `source/models-dev/cache/icons/${sourceID}.svg`), "utf8")
        : new TextDecoder().decode(updated.get(sourceID)!)
    if (digest(raw) !== pin.icons.digests[sourceID]) throw new Error(`raw icon digest mismatch: ${sourceID}`)
    const sanitized = sanitizeIcon(raw)
    const file = `${localID}.${sanitized.digest.slice(0, 12)}.svg`
    outputs.set(path.join(repositoryRoot, `packages/web/public/assets/provider-icons/${file}`), sanitized.svg)
    iconIndex[localID] = {
      url: `/assets/provider-icons/${file}`,
      sourceDigest: pin.icons.digests[sourceID]!,
    }
    css.push(`[data-provider-icon="${localID}"]{--provider-icon:url("/assets/provider-icons/${file}")}`)
  }
  outputs.set(
    path.join(repositoryRoot, "packages/web/src/integration/provider-icons.generated.ts"),
    `export const providerIcons = ${json(iconIndex).trim()} as const\n`,
  )
  outputs.set(
    path.join(repositoryRoot, "packages/web/src/integration/provider-icons.generated.css"),
    css.join("\n") + "\n",
  )
}

function normalize(
  localProvider: (typeof descriptors)[number]["localID"],
  sourceProvider: (typeof descriptors)[number]["sourceID"],
  adapter: (typeof descriptors)[number]["adapter"],
  providerNpm: string,
  sourceID: string,
  model: Model,
): GeneratedModel {
  return {
    source: {
      provider: sourceProvider,
      path: `providers/${sourceProvider}/models/${sourceID}`,
      digest: digest(canonical(model)),
    },
    local: { provider: localProvider, id: localModelID(sourceProvider, sourceID, model.id) },
    apiID: model.id,
    format: modelFormat(adapter, model.provider?.npm, providerNpm),
    lifecycle: model.status ?? "active",
    ...(sourceProvider === "amazon-bedrock"
      ? {
          transport:
            model.provider?.npm === "@ai-sdk/amazon-bedrock/mantle" ? "mantle-responses" : ("converse" as const),
        }
      : {}),
    metadata: {
      name: model.name,
      description: model.description ?? "",
      ...(model.family === undefined ? {} : { family: model.family }),
      releaseDate: model.release_date,
      lastUpdated: model.last_updated,
      openWeights: model.open_weights,
      capabilities: {
        attachment: model.attachment,
        reasoning: model.reasoning,
        tools: model.tool_call,
        ...(model.structured_output === undefined ? {} : { structuredOutput: model.structured_output }),
        temperature: model.temperature ?? false,
        input: model.modalities.input,
        output: model.modalities.output,
      },
      limit: model.limit,
      ...(model.cost === undefined ? {} : { cost: model.cost }),
    },
    unsupported: {
      ...(model.reasoning_options === undefined ? {} : { reasoningOptions: model.reasoning_options }),
      ...(model.experimental === undefined ? {} : { experimentalModes: model.experimental.modes }),
      ...(model.interleaved === undefined ? {} : { interleaved: model.interleaved }),
      ...(model.provider === undefined ? {} : { sourceProviderOptions: model.provider }),
    },
  }
}

const formatByNpm: Readonly<Record<string, GeneratedModel["format"]>> = {
  "@ai-sdk/openai": "openai",
  "@ai-sdk/anthropic": "anthropic",
  "@ai-sdk/google": "google",
  "@ai-sdk/openai-compatible": "oa-compat",
}

export function modelFormat(adapter: Adapter, modelNpm: string | undefined, providerNpm: string) {
  if (adapter === "bedrock-converse") return "bedrock-converse" as const
  const npm = modelNpm ?? providerNpm
  const format = formatByNpm[npm]
  if (format === undefined) throw new Error(`unsupported model format npm: ${npm}`)
  return format
}

function assertSnapshot(
  rows: Map<string, Array<GeneratedModel>>,
  updating: boolean,
  previousSourceRows: Map<string, Array<GeneratedModel>>,
) {
  const openai = rows.get("openai")!
  const anthropic = rows.get("anthropic")!
  const bedrock = rows.get("amazon-bedrock")!
  for (const [provider, providerRows] of rows) assertUnique(providerRows, provider)
  for (const descriptor of descriptors) {
    if (providerAliases[descriptor.localID] !== descriptor.sourceID) {
      throw new Error(`provider alias mismatch: ${descriptor.localID} -> ${descriptor.sourceID}`)
    }
  }
  const allRows = [...rows.values()].flat()
  for (const [source, localID] of Object.entries(modelAliases)) {
    const row = allRows.find(
      (candidate) => `${candidate.source.provider}/${candidate.source.path.split("/").at(-1)}` === source,
    )
    if (row === undefined || row.local.id !== localID)
      throw new Error(`stale or mismatched model alias: ${source} -> ${localID}`)
  }
  assertNoUnapprovedRemovals(
    (updating ? previousSourceRows.get("openai")! : previousOpenAI).map((row) => row.apiID),
    openai.map((row) => row.apiID),
    legacyModels.filter((model) => model.provider === "openai").map((model) => model.id),
  )
  assertNoUnapprovedRemovals(
    (updating ? previousSourceRows.get("anthropic")! : previousAnthropic).map((row) => row.apiID),
    anthropic.map((row) => row.apiID),
    legacyModels.filter((model) => model.provider === "anthropic").map((model) => model.id),
  )
  assertNoUnapprovedRemovals(
    (updating ? previousSourceRows.get("amazon-bedrock")! : previousBedrock).map((row) => row.apiID),
    bedrock.map((row) => row.apiID),
    legacyModels.filter((model) => model.provider === "amazon-bedrock").map((model) => model.id),
  )
  assertRemovalLedger(rows, previousSourceRows)
}

function assertRemovalLedger(
  rows: Map<string, Array<GeneratedModel>>,
  previousSourceRows: Map<string, Array<GeneratedModel>>,
) {
  const keys = legacyModels.map((entry) => `${entry.provider}/${entry.sourceID}`)
  if (new Set(keys).size !== keys.length) throw new Error("duplicate removal ledger disposition")
  for (const entry of legacyModels) {
    if (entry.previous.metadata === undefined || entry.previous.provenance === undefined) {
      throw new Error(`removal disposition lacks retained metadata/provenance: ${entry.provider}/${entry.sourceID}`)
    }
    if (rows.get(entry.provider)?.some((row) => row.apiID === entry.sourceID)) {
      throw new Error(`stale removal disposition for present model: ${entry.provider}/${entry.sourceID}`)
    }
    if (
      entry.disposition === "alias-to" &&
      (entry.target === undefined ||
        modelAliases[`${entry.provider}/${entry.target}`] !== entry.id ||
        !rows.get(entry.provider)?.some((row) => row.apiID === entry.target && row.local.id === entry.id))
    ) {
      throw new Error(`alias removal disposition lacks matching alias: ${entry.provider}/${entry.sourceID}`)
    }
    const previous = previousSourceRows.get(entry.provider)?.find((row) => row.apiID === entry.sourceID)
    if (
      previous !== undefined &&
      (previous.local.id !== entry.id ||
        previous.apiID !== entry.previous.apiID ||
        canonical(previous.metadata) !== canonical(entry.previous.metadata))
    ) {
      throw new Error(`removal disposition does not retain exact previous row: ${entry.provider}/${entry.sourceID}`)
    }
  }
}

function assertUnique(rows: ReadonlyArray<GeneratedModel>, provider: string) {
  for (const key of ["apiID", "localID"] as const) {
    const values = rows.map((row) => (key === "apiID" ? row.apiID : row.local.id))
    const duplicates = values.filter((value, index) => values.indexOf(value) !== index)
    if (duplicates.length > 0)
      throw new Error(`duplicate ${key} for ${provider}: ${[...new Set(duplicates)].join(", ")}`)
  }
}

async function staleTargetPaths(options: SyncOptions, outputs: Map<string, string | Uint8Array>) {
  const stale = []
  const expected = new Set(outputs.keys())
  const targets = options.icons ? [] : options.provider === undefined ? enabledProviders : [options.provider]
  if (!options.icons && options.provider === undefined) {
    for (const [directory, suffix] of [
      [path.join(packageRoot, "generated/providers"), ".generated.ts"],
      [path.join(packageRoot, "generated/reports"), ".json"],
    ] as const) {
      for (const file of await readdir(directory)) {
        const target = path.join(directory, file)
        if (file.endsWith(suffix) && !expected.has(target)) stale.push(target)
      }
    }
    return stale
  }
  for (const provider of targets) {
    for (const [directory, pattern] of [
      [path.join(packageRoot, "generated/providers"), new RegExp(`^${provider}(?:\\..*)?\\.generated\\.ts$`)],
      [path.join(packageRoot, "generated/reports"), new RegExp(`^${provider}(?:\\..*)?\\.json$`)],
    ] as const) {
      for (const file of await readdir(directory)) {
        const target = path.join(directory, file)
        if (pattern.test(file) && !expected.has(target)) stale.push(target)
      }
    }
  }
  if (options.icons) {
    const directory = path.join(repositoryRoot, "packages/web/public/assets/provider-icons")
    for (const file of await readdir(directory)) {
      const target = path.join(directory, file)
      if (generatedIconPattern.test(file) && !expected.has(target)) stale.push(target)
    }
  }
  return stale
}

export async function writeArtifactGraph(
  outputs: Map<string, string | Uint8Array>,
  stale: ReadonlyArray<string>,
  afterReplace?: (count: number) => void | Promise<void>,
) {
  const recoveryRoot = path.join(packageRoot, ".tmp")
  const temporary = path.join(recoveryRoot, "artifact-recovery-active")
  const staged = path.join(temporary, "staged")
  const backup = path.join(temporary, "backup")
  if (await exists(temporary)) {
    await rename(temporary, path.join(recoveryRoot, `artifact-recovery-complete-${Date.now()}`))
  }
  const entries = [...outputs.entries()]
  for (const [index, [target, content]] of entries.entries()) {
    if (!target.startsWith(repositoryRoot + path.sep)) throw new Error(`output escaped repository: ${target}`)
    await mkdir(staged, { recursive: true })
    await writeFile(path.join(staged, String(index)), content)
    if (digest(await readFile(path.join(staged, String(index)))) !== digest(content))
      throw new Error(`staging failed: ${target}`)
  }
  const changed = [...new Set([...entries.map(([target]) => target), ...stale])]
  const journal = []
  for (const [index, target] of changed.entries()) {
    const existed = await exists(target)
    journal.push({ target, backup: path.join(backup, String(index)), existed })
    if (!existed) continue
    await mkdir(backup, { recursive: true })
    await copyFile(target, path.join(backup, String(index)))
  }
  await writeFile(path.join(temporary, "journal.json"), json({ state: "pending", entries: journal }))
  for (const [index, [target]] of entries.entries()) {
    await mkdir(path.dirname(target), { recursive: true })
    await rename(path.join(staged, String(index)), target)
    await afterReplace?.(index + 1)
  }
  for (const target of stale) await rm(target, { force: true })
  await writeFile(path.join(temporary, "journal.json"), json({ state: "complete", entries: journal }))
}

export async function recoverArtifactGraph() {
  const temporary = path.join(packageRoot, ".tmp/artifact-recovery-active")
  if (!(await exists(path.join(temporary, "journal.json")))) return
  const journal = decodeRecoveryJournal(JSON.parse(await readFile(path.join(temporary, "journal.json"), "utf8")))
  if (journal.state === "complete") return
  for (const entry of journal.entries) {
    if (!entry.target.startsWith(repositoryRoot + path.sep)) throw new Error("recovery target escaped repository")
    if (!entry.backup.startsWith(path.join(temporary, "backup") + path.sep)) {
      throw new Error("recovery backup escaped recovery directory")
    }
    if (!entry.existed) {
      await rm(entry.target, { force: true })
      continue
    }
    if (!(await exists(entry.backup))) throw new Error(`incomplete artifact recovery backup: ${entry.target}`)
    await mkdir(path.dirname(entry.target), { recursive: true })
    const restore = `${entry.target}.recovery-${process.pid}`
    await copyFile(entry.backup, restore)
    await rename(restore, entry.target)
  }
  await writeFile(path.join(temporary, "journal.json"), json({ ...journal, state: "complete" }))
}

async function clearCompletedRecoveries() {
  const temporary = path.join(packageRoot, ".tmp")
  if (!(await exists(temporary))) return
  for (const name of await readdir(temporary)) {
    if (!name.startsWith("artifact-recovery-")) continue
    const journalPath = path.join(temporary, name, "journal.json")
    if (!(await exists(journalPath))) continue
    const journal = decodeRecoveryJournal(JSON.parse(await readFile(journalPath, "utf8")))
    if (journal.state === "complete") await rm(path.join(temporary, name), { recursive: true, force: true })
  }
}

function decodeRecoveryJournal(input: unknown) {
  if (input === null || typeof input !== "object" || Array.isArray(input)) throw new Error("invalid recovery journal")
  const record = Object.fromEntries(Object.entries(input))
  if (record.state !== "pending" && record.state !== "complete") throw new Error("invalid recovery journal state")
  if (!Array.isArray(record.entries)) throw new Error("invalid recovery journal entries")
  const entries = record.entries.map((entry) => {
    if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
      throw new Error("invalid recovery journal entry")
    }
    const fields = Object.fromEntries(Object.entries(entry))
    if (typeof fields.target !== "string" || typeof fields.backup !== "string" || typeof fields.existed !== "boolean") {
      throw new Error("invalid recovery journal entry")
    }
    return { target: fields.target, backup: fields.backup, existed: fields.existed }
  })
  return { state: record.state, entries }
}

function diffSummary(
  previousDigest: string,
  nextDigest: string,
  projected: Awaited<ReturnType<typeof validateAndProject>>,
) {
  const previous = projected.previousSourceRows
  const providers = projected.providerPins
    .map((provider) => {
      const before = previous.get(provider.sourceID)!
      const after = projected.rows.get(provider.sourceID)!
      const beforeByID = new Map(before.map((row) => [row.apiID, row]))
      const afterByID = new Map(after.map((row) => [row.apiID, row]))
      const added = after.filter((row) => !beforeByID.has(row.apiID)).map((row) => row.apiID)
      const removed = before.filter((row) => !afterByID.has(row.apiID)).map((row) => row.apiID)
      const transport = after
        .filter((row) => {
          const old = beforeByID.get(row.apiID)
          return old !== undefined && (old.lifecycle !== row.lifecycle || old.transport !== row.transport)
        })
        .map((row) => row.apiID)
      const fields = after
        .filter((row) => {
          const old = beforeByID.get(row.apiID)
          return old !== undefined && canonical(old) !== canonical(row)
        })
        .map((row) => `${row.apiID}[${changedFieldPaths(beforeByID.get(row.apiID)!, row).join(",")}]`)
      return `${provider.sourceID}: digest=${provider.digest} rows=${provider.modelCount} addedIDs=${added.join(",") || "none"} removedIDs=${removed.join(",") || "none"} transportChanges=${transport.join(",") || "none"} fieldChanges=${fields.join(",") || "none"}`
    })
    .join("\n")
  return `body: ${previousDigest} -> ${nextDigest}\n${providers}`
}

function changedFieldPaths(before: unknown, after: unknown, prefix = ""): ReadonlyArray<string> {
  if (canonical(before) === canonical(after)) return []
  if (
    before === null ||
    after === null ||
    typeof before !== "object" ||
    typeof after !== "object" ||
    Array.isArray(before) ||
    Array.isArray(after)
  ) {
    return [prefix || "value"]
  }
  const beforeRecord = Object.fromEntries(Object.entries(before))
  const afterRecord = Object.fromEntries(Object.entries(after))
  return [...new Set([...Object.keys(beforeRecord), ...Object.keys(afterRecord)])]
    .sort(compareCodePoints)
    .flatMap((key) => changedFieldPaths(beforeRecord[key], afterRecord[key], prefix === "" ? key : `${prefix}.${key}`))
}

function summary(
  bodyDigest: string,
  rows: Map<string, Array<GeneratedModel>>,
  outputs: Map<string, string | Uint8Array>,
  stale: ReadonlyArray<string>,
) {
  return `body=${bodyDigest} openai=${rows.get("openai")!.length} anthropic=${rows.get("anthropic")!.length} bedrock=${rows.get("amazon-bedrock")!.length} outputs=${outputs.size} stale=${stale.length}`
}

async function exists(file: string) {
  return stat(file).then(
    () => true,
    () => false,
  )
}
