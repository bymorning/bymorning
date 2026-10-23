resource "azurerm_user_assigned_identity" "gateway" {
  name                = "id-${local.prefix}-gateway"
  location            = azurerm_resource_group.this.location
  resource_group_name = azurerm_resource_group.this.name
  tags                = local.tags
}

resource "azurerm_federated_identity_credential" "gateway" {
  name                      = "gateway"
  user_assigned_identity_id = azurerm_user_assigned_identity.gateway.id
  issuer                    = azurerm_kubernetes_cluster.this.oidc_issuer_url
  subject                   = "system:serviceaccount:${var.namespace}:${var.service_account}"
  audience                  = [local.federated_audience]
}

# Least privilege: the container, not the account; the key, not the vault.
resource "azurerm_role_assignment" "blob" {
  scope                = azurerm_storage_container.this.id
  role_definition_name = "Storage Blob Data Contributor"
  principal_id         = azurerm_user_assigned_identity.gateway.principal_id
}

resource "azurerm_role_assignment" "key" {
  scope                = azurerm_key_vault_key.cipher.resource_versionless_id
  role_definition_name = "Key Vault Crypto User"
  principal_id         = azurerm_user_assigned_identity.gateway.principal_id
}
