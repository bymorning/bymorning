import { Form } from "@bymorning/schema/form"
import { Integration } from "@bymorning/schema/integration"
import { expect, test } from "vitest"

test("reusable public Form schemas have stable unique identifiers", () => {
  const identifiers = [
    Form.Metadata,
    Form.Option,
    Form.When,
    Form.StringField,
    Form.NumberField,
    Form.IntegerField,
    Form.BooleanField,
    Form.MultiselectField,
    Form.ExternalField,
    Form.Field,
    Form.Fields,
    Form.Value,
    Form.Answer,
    Form.Info,
    Form.State,
    Form.Reply,
    Integration.MethodFormFields,
    Integration.OAuthClientConfiguration,
  ].map((schema) => schema.ast.annotations?.identifier)

  expect(identifiers.every((identifier) => typeof identifier === "string")).toBe(true)
  expect(new Set(identifiers).size).toBe(identifiers.length)
  expect(Form.Fields.ast.annotations?.identifier).toBe("Form.Fields")
  expect(Integration.OAuthClientConfiguration.fields.fields.ast).toBe(Form.Fields.ast)
})
