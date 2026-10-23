# Offline security assertions. No Azure credentials are used: the azurerm
# provider is mocked, so these tests check what the module *asks for*, not what
# Azure does with it.

mock_provider "azurerm" {
  override_data {
    target = data.azurerm_client_config.current
    values = {
      tenant_id = "11111111-1111-1111-1111-111111111111"
      object_id = "22222222-2222-2222-2222-222222222222"
    }
  }

  mock_resource "azurerm_kubernetes_cluster" {
    defaults = {
      id               = "/subscriptions/33333333-3333-3333-3333-333333333333/resourceGroups/rg-bymorning/providers/Microsoft.ContainerService/managedClusters/aks-bymorning"
      oidc_issuer_url  = "https://usgovvirginia.oic.prod-aks.azure.us/tenant/guid/"
      kubelet_identity = [{ client_id = "c", object_id = "00000000-0000-0000-0000-0000000000aa", user_assigned_identity_id = "u" }]
    }
  }
  mock_resource "azurerm_subnet" {
    defaults = {
      id = "/subscriptions/33333333-3333-3333-3333-333333333333/resourceGroups/rg-bymorning/providers/Microsoft.Network/virtualNetworks/vnet-bymorning/subnets/snet-mock"
    }
  }

  mock_resource "azurerm_virtual_network" {
    defaults = {
      id = "/subscriptions/33333333-3333-3333-3333-333333333333/resourceGroups/rg-bymorning/providers/Microsoft.Network/virtualNetworks/vnet-bymorning"
    }
  }

  mock_resource "azurerm_key_vault" {
    defaults = {
      id = "/subscriptions/33333333-3333-3333-3333-333333333333/resourceGroups/rg-bymorning/providers/Microsoft.KeyVault/vaults/kv-mock"
    }
  }

  mock_resource "azurerm_storage_account" {
    defaults = {
      id = "/subscriptions/33333333-3333-3333-3333-333333333333/resourceGroups/rg-bymorning/providers/Microsoft.Storage/storageAccounts/stmock"
    }
  }

  mock_resource "azurerm_storage_container" {
    defaults = {
      id = "/subscriptions/33333333-3333-3333-3333-333333333333/resourceGroups/rg-bymorning/providers/Microsoft.Storage/storageAccounts/stmock/blobServices/default/containers/bymorning"
    }
  }

  mock_resource "azurerm_key_vault_key" {
    defaults = {
      id                      = "/subscriptions/33333333-3333-3333-3333-333333333333/resourceGroups/rg-bymorning/providers/Microsoft.KeyVault/vaults/kv-mock/keys/bymorning-cipher/versions/abc"
      resource_versionless_id = "/subscriptions/33333333-3333-3333-3333-333333333333/resourceGroups/rg-bymorning/providers/Microsoft.KeyVault/vaults/kv-mock/keys/bymorning-cipher"
    }
  }

  mock_resource "azurerm_postgresql_flexible_server" {
    defaults = {
      id = "/subscriptions/33333333-3333-3333-3333-333333333333/resourceGroups/rg-bymorning/providers/Microsoft.DBforPostgreSQL/flexibleServers/psql-mock"
    }
  }

  mock_resource "azurerm_user_assigned_identity" {
    defaults = {
      id           = "/subscriptions/33333333-3333-3333-3333-333333333333/resourceGroups/rg-bymorning/providers/Microsoft.ManagedIdentity/userAssignedIdentities/id-mock"
      principal_id = "44444444-4444-4444-4444-444444444444"
      client_id    = "55555555-5555-5555-5555-555555555555"
    }
  }

  mock_resource "azurerm_private_dns_zone" {
    defaults = {
      id = "/subscriptions/33333333-3333-3333-3333-333333333333/resourceGroups/rg-bymorning/providers/Microsoft.Network/privateDnsZones/mock"
    }
  }

  mock_resource "azurerm_container_registry" {
    defaults = {
      id = "/subscriptions/33333333-3333-3333-3333-333333333333/resourceGroups/rg-bymorning/providers/Microsoft.ContainerRegistry/registries/acrmock"
    }
  }

  mock_resource "azurerm_log_analytics_workspace" {
    defaults = {
      id = "/subscriptions/33333333-3333-3333-3333-333333333333/resourceGroups/rg-bymorning/providers/Microsoft.OperationalInsights/workspaces/log-mock"
    }
  }
}

variables {
  location    = "usgovvirginia"
  acr_enabled = false
}

run "government_defaults" {
  command = apply

  # Storage
  assert {
    condition     = azurerm_storage_account.this.shared_access_key_enabled == false
    error_message = "storage shared key access must be disabled"
  }
  assert {
    condition     = azurerm_storage_account.this.https_traffic_only_enabled == true
    error_message = "storage must require HTTPS"
  }
  assert {
    condition     = azurerm_storage_account.this.min_tls_version == "TLS1_2"
    error_message = "storage minimum TLS must be 1.2"
  }
  assert {
    condition     = azurerm_storage_account.this.allow_nested_items_to_be_public == false
    error_message = "public blob access must be off"
  }
  assert {
    condition     = azurerm_storage_account.this.public_network_access_enabled == false
    error_message = "storage must be private-endpoint only without deployer IPs"
  }
  assert {
    condition     = azurerm_storage_account.this.network_rules[0].default_action == "Deny"
    error_message = "storage firewall must default to Deny"
  }
  assert {
    condition     = azurerm_storage_container.this.container_access_type == "private"
    error_message = "container must be private"
  }
  assert {
    condition     = azurerm_private_endpoint.blob.private_service_connection[0].subresource_names[0] == "blob"
    error_message = "blob private endpoint missing"
  }

  # Key Vault
  assert {
    condition     = azurerm_key_vault.this.purge_protection_enabled == true
    error_message = "Key Vault purge protection must be on"
  }
  assert {
    condition     = azurerm_key_vault.this.rbac_authorization_enabled == true
    error_message = "Key Vault must use Azure RBAC"
  }
  assert {
    condition     = azurerm_key_vault.this.public_network_access_enabled == false
    error_message = "Key Vault must be private-endpoint only without deployer IPs"
  }
  assert {
    condition     = azurerm_key_vault_key.cipher.key_type == "RSA" && azurerm_key_vault_key.cipher.key_size == 3072
    error_message = "cipher key must be RSA 3072 by default"
  }
  assert {
    condition     = toset(azurerm_key_vault_key.cipher.key_opts) == toset(["wrapKey", "unwrapKey"])
    error_message = "cipher key must allow only wrapKey and unwrapKey"
  }
  assert {
    condition     = azurerm_key_vault_key.cipher.rotation_policy[0].automatic[0].time_after_creation == "P18M"
    error_message = "cipher key must have an automatic rotation policy"
  }

  # Least-privilege role assignments
  assert {
    condition     = azurerm_role_assignment.blob.role_definition_name == "Storage Blob Data Contributor" && azurerm_role_assignment.blob.scope == azurerm_storage_container.this.id
    error_message = "blob role must be scoped to the container"
  }
  assert {
    condition     = azurerm_role_assignment.blob.scope != azurerm_storage_account.this.id
    error_message = "blob role must not be account-wide"
  }
  assert {
    condition     = azurerm_role_assignment.key.role_definition_name == "Key Vault Crypto User" && azurerm_role_assignment.key.scope == azurerm_key_vault_key.cipher.resource_versionless_id
    error_message = "crypto role must be scoped to the key"
  }
  assert {
    condition     = azurerm_role_assignment.key.scope != azurerm_key_vault.this.id
    error_message = "crypto role must not be vault-wide"
  }
  assert {
    condition     = azurerm_role_assignment.blob.principal_id == azurerm_user_assigned_identity.gateway.principal_id && azurerm_role_assignment.key.principal_id == azurerm_user_assigned_identity.gateway.principal_id
    error_message = "roles must go to the Gateway identity only"
  }

  # Federated credential
  assert {
    condition     = azurerm_federated_identity_credential.gateway.subject == "system:serviceaccount:bymorning:bymorning-gateway"
    error_message = "federated subject must be the Gateway service account"
  }
  assert {
    condition     = azurerm_federated_identity_credential.gateway.audience[0] == "api://AzureADTokenExchange"
    error_message = "Government audience defaults to the documented common value"
  }
  assert {
    condition     = azurerm_federated_identity_credential.gateway.issuer == azurerm_kubernetes_cluster.this.oidc_issuer_url
    error_message = "federated issuer must be the AKS OIDC issuer"
  }

  # PostgreSQL
  assert {
    condition     = azurerm_postgresql_flexible_server.this.version == "17"
    error_message = "PostgreSQL 17 expected"
  }
  assert {
    condition     = azurerm_postgresql_flexible_server.this.public_network_access_enabled == false
    error_message = "PostgreSQL must not be public"
  }
  assert {
    condition     = azurerm_postgresql_flexible_server.this.delegated_subnet_id == azurerm_subnet.postgres.id
    error_message = "PostgreSQL must be VNet-integrated"
  }
  assert {
    condition     = azurerm_postgresql_flexible_server_configuration.require_tls.value == "on" && azurerm_postgresql_flexible_server_configuration.min_tls.value == "TLSv1.2"
    error_message = "PostgreSQL must require TLS 1.2+"
  }
  assert {
    condition     = endswith(azurerm_private_dns_zone.postgres.name, ".postgres.database.usgovcloudapi.net")
    error_message = "Government PostgreSQL DNS zone expected"
  }

  # AKS
  assert {
    condition     = azurerm_kubernetes_cluster.this.oidc_issuer_enabled == true && azurerm_kubernetes_cluster.this.workload_identity_enabled == true
    error_message = "OIDC issuer and workload identity must be enabled"
  }
  assert {
    condition     = azurerm_kubernetes_cluster.this.private_cluster_enabled == true
    error_message = "private cluster by default"
  }
  assert {
    condition     = azurerm_kubernetes_cluster.this.network_profile[0].network_policy == "cilium" && azurerm_kubernetes_cluster.this.network_profile[0].network_data_plane == "cilium"
    error_message = "Cilium network policy expected"
  }
  assert {
    condition     = azurerm_kubernetes_cluster.this.default_node_pool[0].only_critical_addons_enabled == true
    error_message = "system pool must be tainted for critical add-ons"
  }
  assert {
    condition     = length(azurerm_kubernetes_cluster_node_pool.sandbox) == 0
    error_message = "sandbox pool is opt-in"
  }
  assert {
    condition     = output.azure_cloud == "AzureUSGovernment"
    error_message = "azure_cloud output must match the app AZURE_CLOUD value"
  }
}

run "public_cloud" {
  command = apply

  variables {
    environment = "public"
    location    = "eastus2"
  }

  assert {
    condition     = azurerm_federated_identity_credential.gateway.audience[0] == "api://AzureADTokenExchange"
    error_message = "public audience expected"
  }
  assert {
    condition     = azurerm_private_dns_zone.blob.name == "privatelink.blob.core.windows.net" && azurerm_private_dns_zone.vault.name == "privatelink.vaultcore.azure.net"
    error_message = "public DNS zones expected"
  }
  assert {
    condition     = output.azure_cloud == "AzureCloud"
    error_message = "AzureCloud expected"
  }
}

run "government_dns_zones" {
  command = apply

  assert {
    condition     = azurerm_private_dns_zone.blob.name == "privatelink.blob.core.usgovcloudapi.net" && azurerm_private_dns_zone.vault.name == "privatelink.vaultcore.usgovcloudapi.net"
    error_message = "Government private DNS zones expected"
  }
}

run "audience_override" {
  command = apply

  variables {
    federated_audience = "api://example-audience"
  }

  assert {
    condition     = azurerm_federated_identity_credential.gateway.audience[0] == "api://example-audience"
    error_message = "override must win"
  }
}

run "restricted_public_api" {
  command = apply

  variables {
    private_cluster          = false
    api_authorized_ip_ranges = ["203.0.113.0/24"]
    deployer_ip_ranges       = ["203.0.113.10/32"]
  }

  assert {
    condition     = azurerm_kubernetes_cluster.this.api_server_access_profile[0].authorized_ip_ranges == toset(["203.0.113.0/24"])
    error_message = "API server must be restricted"
  }
  assert {
    condition     = one(azurerm_storage_account.this.network_rules[0].ip_rules) == "203.0.113.10" && one(azurerm_key_vault.this.network_acls[0].ip_rules) == "203.0.113.10"
    error_message = "single-host deployer ranges must be plain addresses"
  }
  assert {
    condition     = azurerm_storage_account.this.network_rules[0].default_action == "Deny" && azurerm_key_vault.this.network_acls[0].default_action == "Deny"
    error_message = "firewalls stay Deny even with deployer IPs"
  }
}

run "fips_and_sandbox" {
  command = apply

  variables {
    fips_node_pools   = true
    sandbox_node_pool = true
  }

  assert {
    condition     = azurerm_kubernetes_cluster.this.default_node_pool[0].fips_enabled == true && azurerm_kubernetes_cluster_node_pool.user.fips_enabled == true
    error_message = "FIPS flag must reach system and user pools"
  }
  assert {
    condition     = azurerm_kubernetes_cluster_node_pool.sandbox[0].workload_runtime == "KataVmIsolation" && azurerm_kubernetes_cluster_node_pool.sandbox[0].os_sku == "AzureLinux"
    error_message = "sandbox pool must use Kata on Azure Linux"
  }
  assert {
    condition     = azurerm_kubernetes_cluster_node_pool.sandbox[0].fips_enabled == false
    error_message = "sandbox pool cannot be FIPS"
  }
  assert {
    condition     = contains(azurerm_kubernetes_cluster_node_pool.sandbox[0].node_taints, "bymorning.dev/sandbox=true:NoSchedule")
    error_message = "sandbox pool must be tainted"
  }
}

run "rejects_open_api_range" {
  command = plan

  variables {
    private_cluster          = false
    api_authorized_ip_ranges = ["0.0.0.0/0"]
  }

  expect_failures = [var.api_authorized_ip_ranges]
}

run "rejects_unknown_cloud" {
  command = plan

  variables {
    environment = "china"
  }

  expect_failures = [var.environment]
}

# The mock cannot populate the computed kubelet_identity block, so the AcrPull
# assignment itself is not exercised offline; it is skipped here.
run "acr_private" {
  command = apply

  variables {
    acr_enabled = true
    acr_pull    = false
  }

  assert {
    condition     = azurerm_container_registry.this[0].sku == "Premium" && azurerm_container_registry.this[0].admin_enabled == false && azurerm_container_registry.this[0].public_network_access_enabled == false
    error_message = "ACR must be Premium, no admin user, private"
  }
  assert {
    condition     = azurerm_private_dns_zone.acr[0].name == "privatelink.azurecr.us"
    error_message = "Government ACR private DNS zone expected"
  }
}
