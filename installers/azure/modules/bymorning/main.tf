data "azurerm_client_config" "current" {}

resource "random_string" "suffix" {
  length  = 5
  lower   = true
  upper   = false
  numeric = true
  special = false
}

locals {
  suffix = random_string.suffix.result
  prefix = var.name
  # Global-name resources drop hyphens (storage, ACR).
  compact = replace(var.name, "-", "")

  cloud = {
    public = {
      azure_cloud  = "AzureCloud"
      dns_blob     = "privatelink.blob.core.windows.net"
      dns_vault    = "privatelink.vaultcore.azure.net"
      dns_acr      = "privatelink.azurecr.io"
      dns_postgres = "private.postgres.database.azure.com"
    }
    usgovernment = {
      azure_cloud  = "AzureUSGovernment"
      dns_blob     = "privatelink.blob.core.usgovcloudapi.net"
      dns_vault    = "privatelink.vaultcore.usgovcloudapi.net"
      dns_acr      = "privatelink.azurecr.us"
      dns_postgres = "private.postgres.database.usgovcloudapi.net"
    }
  }[var.environment]

  federated_audience = var.federated_audience
  deployer_access    = length(var.deployer_ip_ranges) > 0
  # Storage and Key Vault firewalls reject /31 and /32 prefixes; single hosts are plain addresses.
  deployer_ip_rules = [for r in var.deployer_ip_ranges : trimsuffix(r, "/32")]
  tags              = merge({ application = "bymorning" }, var.tags)
}

resource "azurerm_resource_group" "this" {
  name     = "rg-${local.prefix}"
  location = var.location
  tags     = local.tags
}
