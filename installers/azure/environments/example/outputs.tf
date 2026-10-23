output "resource_group" {
  value = module.bymorning.resource_group
}

output "cluster_name" {
  value = module.bymorning.cluster_name
}

output "oidc_issuer_url" {
  value = module.bymorning.oidc_issuer_url
}

output "azure_cloud" {
  value = module.bymorning.azure_cloud
}

output "tenant_id" {
  value = module.bymorning.tenant_id
}

output "gateway_client_id" {
  value = module.bymorning.gateway_client_id
}

output "federated_audience" {
  value = module.bymorning.federated_audience
}

output "namespace" {
  value = module.bymorning.namespace
}

output "service_account" {
  value = module.bymorning.service_account
}

output "storage_account_url" {
  value = module.bymorning.storage_account_url
}

output "storage_account_name" {
  value = module.bymorning.storage_account_name
}

output "storage_container" {
  value = module.bymorning.storage_container
}

output "key_vault_name" {
  value = module.bymorning.key_vault_name
}

output "key_vault_key" {
  value = module.bymorning.key_vault_key
}

output "postgres_fqdn" {
  value = module.bymorning.postgres_fqdn
}

output "acr_login_server" {
  value = module.bymorning.acr_login_server
}

output "database_url" {
  value     = module.bymorning.database_url
  sensitive = true
}

output "web_cookie_key" {
  value     = module.bymorning.web_cookie_key
  sensitive = true
}
