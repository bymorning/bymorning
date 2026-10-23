output "resource_group" {
  value = azurerm_resource_group.this.name
}

output "cluster_name" {
  value = azurerm_kubernetes_cluster.this.name
}

output "oidc_issuer_url" {
  value = azurerm_kubernetes_cluster.this.oidc_issuer_url
}

output "azure_cloud" {
  description = "Value of AZURE_CLOUD for the Gateway (AzureCloud or AzureUSGovernment)."
  value       = local.cloud.azure_cloud
}

output "tenant_id" {
  value = data.azurerm_client_config.current.tenant_id
}

output "gateway_client_id" {
  description = "Client ID for the azure.workload.identity/client-id service account annotation."
  value       = azurerm_user_assigned_identity.gateway.client_id
}

output "federated_audience" {
  value = local.federated_audience
}

output "namespace" {
  value = var.namespace
}

output "service_account" {
  value = var.service_account
}

output "storage_account_url" {
  description = "STORAGE_ACCOUNT_URL."
  value       = trimsuffix(azurerm_storage_account.this.primary_blob_endpoint, "/")
}

output "storage_account_name" {
  value = azurerm_storage_account.this.name
}

output "storage_container" {
  description = "STORAGE_CONTAINER."
  value       = azurerm_storage_container.this.name
}

output "key_vault_name" {
  value = azurerm_key_vault.this.name
}

output "key_vault_key" {
  description = "KEY_VAULT_KEY: versionless key URL (resolves to the latest version at startup)."
  value       = azurerm_key_vault_key.cipher.versionless_id
}

output "postgres_fqdn" {
  value = azurerm_postgresql_flexible_server.this.fqdn
}

output "database_url" {
  description = "DATABASE_URL. Requires DATABASE_CA."
  sensitive   = true
  value       = "postgresql://${azurerm_postgresql_flexible_server.this.administrator_login}:${random_password.postgres.result}@${azurerm_postgresql_flexible_server.this.fqdn}:5432/${azurerm_postgresql_flexible_server_database.this.name}"
}

output "web_cookie_key" {
  description = "WEB_COOKIE_KEY."
  sensitive   = true
  value       = random_id.cookie_key.b64_url
}

output "acr_login_server" {
  description = "Registry host for the image; null when acr_enabled is false."
  value       = var.acr_enabled ? azurerm_container_registry.this[0].login_server : null
}

output "log_analytics_workspace_id" {
  value = var.log_analytics ? azurerm_log_analytics_workspace.this[0].id : null
}

output "sandbox_node_pool" {
  description = "Whether the Kata sandbox pool exists."
  value       = var.sandbox_node_pool
}
