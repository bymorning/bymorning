import type { IntegrationMethod, IntegrationMethodRegistration } from "./integration.js"

type VisibleMethodType = IntegrationMethod["type"]
type RegistrableMethodType = IntegrationMethodRegistration["method"]["type"]
type GroupedEnvMethod = Extract<IntegrationMethod, { type: "env-group" }>

export const awsMethodsAreVisible: "aws-sigv4" extends VisibleMethodType ? true : false = true
export const groupedEnvMethodsAreVisible: "env-group" extends VisibleMethodType ? true : false = true
export const awsMethodsAreHostOwned: "aws-sigv4" extends RegistrableMethodType ? false : true = true
export const groupedEnvMethodsAreHostOwned: "env-group" extends RegistrableMethodType ? false : true = true
export const groupedEnvVariableNamesAreRedacted: "required" extends keyof GroupedEnvMethod ? false : true = true
