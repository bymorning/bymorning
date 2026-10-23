import { AuthProvider } from "@bymorning/schema/auth-provider"
import { Option, Schema } from "effect"
import { Show, type JSX } from "solid-js"

import { Field } from "../ui/components/field"
import { Select } from "../ui/components/select"
import { TextInput } from "../ui/components/text-input"
import { createForm, FormDialog, FormFrame } from "../ui/form"
import { microsoftCloudLabels, microsoftClouds, microsoftTenantIssuer, parseMicrosoftIssuer, type MicrosoftCloud } from "./microsoft"
import type { SecurityProviderInfo } from "./route"

type Kind = SecurityProviderInfo["kind"]

const kinds: ReadonlyArray<Kind> = ["google", "okta", "microsoft", "auth0", "ping", "custom"]
const newKinds: ReadonlyArray<Kind> = ["google", "okta", "microsoft", "custom"]

export const kindLabels: Record<Kind, string> = {
  google: "Google Workspace",
  okta: "Okta",
  microsoft: "Microsoft Entra",
  auth0: "Auth0",
  ping: "Ping",
  custom: "Custom",
}

function parseDomain(value: string) {
  return Option.getOrUndefined(Schema.decodeUnknownOption(AuthProvider.Domain)(value))
}

type ProviderDialogProps = (
  | {
      readonly provider: SecurityProviderInfo
      readonly formID?: never
    }
  | {
      readonly provider?: undefined
      readonly formID: SecurityProviderInfo["id"]
    }
) & {
  readonly submit: (values: {
    readonly displayName: string
    readonly kind: Kind
    readonly issuer: string
    readonly clientID: string
    readonly clientSecret: string
    readonly domains: [string, ...Array<string>]
  }) => Promise<SecurityProviderInfo>
  readonly onSuccess?: (provider: SecurityProviderInfo) => void
}

export function ProviderDialog(props: ProviderDialogProps): JSX.Element {
  const provider = props.provider
  const form = createForm({
    values: {
      kind: provider?.kind ?? ("custom" as Kind),
      issuer: provider?.issuer ?? "",
      cloud: (provider?.kind === "microsoft" ? (parseMicrosoftIssuer(provider.issuer)?.cloud ?? "commercial") : "commercial") as MicrosoftCloud,
      tenantID: provider?.kind === "microsoft" ? (parseMicrosoftIssuer(provider.issuer)?.tenantID ?? "") : "",
      clientID: provider?.clientID ?? "",
      clientSecret: "",
      domain: provider?.domains.length === 1 ? provider.domains[0] : "",
    },
    validate: (values) => {
      const domain = parseDomain(values.domain)
      if (!domain) {
        if (provider && provider.domains.length > 1 && values.domain.trim() === "") {
          return "Choose one domain before saving this provider."
        }
        return values.domain.trim() === ""
          ? "Domain is required."
          : "Enter one valid email domain, such as example.com."
      }
      if (!provider) {
        const issuer = values.kind === "microsoft" ? values.tenantID : values.issuer
        if (!issuer.trim() || !values.clientID.trim() || !values.clientSecret) {
          return values.kind === "microsoft"
            ? "Tenant ID, client ID, and client secret are required."
            : "Issuer, client ID, and client secret are required."
        }
        return undefined
      }
      return undefined
    },
    submit: (values) => {
      const domain = parseDomain(values.domain)
      if (!domain) throw new Error("Enter one valid email domain, such as example.com.")
      return props.submit({
        displayName: provider?.displayName ?? kindLabels[values.kind],
        kind: values.kind,
        issuer:
          values.kind === "microsoft" && values.tenantID
            ? microsoftTenantIssuer(values.cloud, values.tenantID)
            : values.issuer,
        clientID: values.clientID,
        clientSecret: values.clientSecret,
        domains: [domain],
      })
    },
    fallback: provider ? "The Auth Provider could not be saved." : "The Auth Provider could not be created.",
  })
  const usesMicrosoftIssuerFallback = () =>
    provider?.kind === "microsoft" && form.values.kind === "microsoft" && form.values.tenantID === ""
  return (
    <FormDialog
      form={form}
      title={provider ? "Edit Auth Provider" : "Add Auth Provider"}
      {...(provider
        ? {
            description: `Issuer and client ID cannot change. Saving creates revision ${provider.revision + 1} and invalidates pending login attempts.`,
          }
        : {})}
      onSuccess={(result, entry) => {
        entry.close()
        props.onSuccess?.(result)
      }}
      actions={
        <FormFrame.Actions
          submitLabel={provider ? "Save provider" : "Create provider"}
          pendingLabel="Saving…"
        />
      }
    >
      <FormFrame.Fields>
        <Field>
          <Field.Label>OpenID Connect (OIDC) Provider</Field.Label>
          <Select
            aria-label="OpenID Connect (OIDC) Provider"
            appearance="full-width"
            options={[...(provider ? kinds : newKinds)]}
            current={form.values.kind}
            disabled={!!provider || form.pending}
            label={(kind) => kindLabels[kind]}
            onSelect={(kind) => kind && form.set("kind", kind)}
          />
        </Field>
        <Show
          when={form.values.kind === "microsoft"}
          fallback={
            <Field>
              <Field.Label>Issuer</Field.Label>
              <TextInput
                required
                type="url"
                appearance="full-width"
                placeholder="https://accounts.example.com"
                value={form.values.issuer}
                disabled={!!provider || form.pending}
                aria-label="Issuer"
                onInput={(event) => form.set("issuer", event.currentTarget.value)}
              />
            </Field>
          }
        >
          <Show
            when={!usesMicrosoftIssuerFallback()}
            fallback={
              <Field>
                <Field.Label>Issuer</Field.Label>
                <TextInput
                  readOnly
                  appearance="full-width"
                  value={form.values.issuer}
                  disabled={form.pending}
                  aria-label="Issuer"
                />
              </Field>
            }
          >
            <Field>
              <Field.Label>Microsoft Entra cloud</Field.Label>
              <Select
                aria-label="Microsoft Entra cloud"
                appearance="full-width"
                options={[...microsoftClouds]}
                current={form.values.cloud}
                disabled={!!provider || form.pending}
                label={(cloud) => microsoftCloudLabels[cloud]}
                onSelect={(cloud) => cloud && form.set("cloud", cloud)}
              />
            </Field>
            <Field>
              <Field.Label>Microsoft Entra tenant ID</Field.Label>
              <TextInput
                required
                appearance="full-width"
                placeholder="00000000-0000-0000-0000-000000000000"
                value={form.values.tenantID}
                disabled={!!provider || form.pending}
                aria-label="Microsoft Entra tenant ID"
                onInput={(event) => form.set("tenantID", event.currentTarget.value)}
              />
              <Field.Suffix>Use the Directory (tenant) ID from Microsoft Entra.</Field.Suffix>
            </Field>
          </Show>
        </Show>
        <Field>
          <Field.Label>Client ID</Field.Label>
          <TextInput
            required
            appearance="full-width"
            value={form.values.clientID}
            disabled={!!provider || form.pending}
            aria-label="Client ID"
            onInput={(event) => form.set("clientID", event.currentTarget.value)}
          />
        </Field>
        <Field>
          <Field.Label>Client secret</Field.Label>
          <TextInput
            type="password"
            appearance="full-width"
            required={!provider}
            autocomplete="new-password"
            value={form.values.clientSecret}
            disabled={form.pending}
            onInput={(event) => form.set("clientSecret", event.currentTarget.value)}
          />
          <Show when={provider}>
            <Field.Suffix>Leave empty to keep the stored value.</Field.Suffix>
          </Show>
        </Field>
        <Field>
          <Field.Label>Domain</Field.Label>
          <TextInput
            required={!(provider && provider.domains.length > 1)}
            appearance="full-width"
            placeholder="example.com"
            value={form.values.domain}
            disabled={form.pending}
            onInput={(event) => form.set("domain", event.currentTarget.value)}
          />
          <Show when={provider && provider.domains.length > 1}>
            <Field.Suffix>
              This provider currently has multiple domains ({provider?.domains.join(", ")}). Enter the single domain to use.
            </Field.Suffix>
          </Show>
        </Field>
      </FormFrame.Fields>
    </FormDialog>
  )
}
