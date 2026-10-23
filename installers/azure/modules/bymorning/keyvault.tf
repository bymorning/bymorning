resource "azurerm_key_vault" "this" {
  name                          = "kv-${local.compact}-${local.suffix}"
  location                      = azurerm_resource_group.this.location
  resource_group_name           = azurerm_resource_group.this.name
  tenant_id                     = data.azurerm_client_config.current.tenant_id
  sku_name                      = var.key_vault_sku
  rbac_authorization_enabled    = true
  purge_protection_enabled      = true
  soft_delete_retention_days    = 90
  public_network_access_enabled = local.deployer_access
  tags                          = local.tags

  network_acls {
    default_action = "Deny"
    bypass         = "AzureServices"
    ip_rules       = local.deployer_ip_rules
  }
}

# The deployer needs data-plane roles to create the key and secrets under RBAC.
resource "azurerm_role_assignment" "deployer_crypto" {
  count                = var.grant_deployer_access ? 1 : 0
  scope                = azurerm_key_vault.this.id
  role_definition_name = "Key Vault Crypto Officer"
  principal_id         = data.azurerm_client_config.current.object_id
}

resource "azurerm_role_assignment" "deployer_secrets" {
  count                = var.grant_deployer_access ? 1 : 0
  scope                = azurerm_key_vault.this.id
  role_definition_name = "Key Vault Secrets Officer"
  principal_id         = data.azurerm_client_config.current.object_id
}

# RSA key for RSA-OAEP-256 wrapping of Cipher data keys (KEY_VAULT_KEY).
resource "azurerm_key_vault_key" "cipher" {
  name         = "bymorning-cipher"
  key_vault_id = azurerm_key_vault.this.id
  key_type     = var.key_vault_sku == "premium" ? "RSA-HSM" : "RSA"
  key_size     = var.key_size
  key_opts     = ["wrapKey", "unwrapKey"]

  rotation_policy {
    expire_after         = var.key_expire_after
    notify_before_expiry = "P30D"

    automatic {
      time_after_creation = var.key_rotate_after
    }
  }

  depends_on = [azurerm_role_assignment.deployer_crypto, azurerm_private_endpoint.vault]
}

resource "azurerm_key_vault_secret" "postgres_password" {
  name         = "postgres-password"
  key_vault_id = azurerm_key_vault.this.id
  value        = random_password.postgres.result

  depends_on = [azurerm_role_assignment.deployer_secrets, azurerm_private_endpoint.vault]
}

resource "azurerm_key_vault_secret" "web_cookie_key" {
  name         = "web-cookie-key"
  key_vault_id = azurerm_key_vault.this.id
  value        = random_id.cookie_key.b64_url

  depends_on = [azurerm_role_assignment.deployer_secrets, azurerm_private_endpoint.vault]
}
