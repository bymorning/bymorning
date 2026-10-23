terraform {
  required_version = ">= 1.9.0"

  required_providers {
    azurerm = {
      source  = "hashicorp/azurerm"
      version = ">= 4.81.0, < 5.0.0"
    }
    random = {
      source  = "hashicorp/random"
      version = ">= 3.6.0, < 4.0.0"
    }
  }

  # Terraform state holds the database password and cookie key. Use a private,
  # encrypted backend, for example an azurerm backend on a storage account with
  # `environment = "usgovernment"`:
  #
  # backend "azurerm" {
  #   environment          = "usgovernment"
  #   resource_group_name  = "rg-tfstate"
  #   storage_account_name = "sttfstate..."
  #   container_name       = "tfstate"
  #   key                  = "bymorning.tfstate"
  #   use_azuread_auth     = true
  # }
}

provider "azurerm" {
  # "usgovernment" for Azure Government, "public" for global Azure.
  environment     = var.environment
  subscription_id = var.subscription_id

  # Storage has shared keys disabled; use Entra ID for data-plane calls.
  storage_use_azuread = true

  features {
    key_vault {
      purge_soft_delete_on_destroy    = false
      recover_soft_deleted_key_vaults = true
    }
    resource_group {
      prevent_deletion_if_contains_resources = true
    }
  }
}

module "bymorning" {
  source = "../../modules/bymorning"

  name               = var.name
  environment        = var.environment
  location           = var.location
  tags               = var.tags
  deployer_ip_ranges = var.deployer_ip_ranges

  private_cluster           = var.private_cluster
  api_authorized_ip_ranges  = var.api_authorized_ip_ranges
  admin_group_object_ids    = var.admin_group_object_ids
  fips_node_pools           = var.fips_node_pools
  sandbox_node_pool         = var.sandbox_node_pool
  network_policy            = var.network_policy
  acr_enabled               = var.acr_enabled
  log_analytics             = var.log_analytics
  federated_audience        = var.federated_audience
  key_vault_sku             = var.key_vault_sku
  system_vm_size            = var.system_vm_size
  user_vm_size              = var.user_vm_size
  user_node_min             = var.user_node_min
  user_node_max             = var.user_node_max
  outbound_type             = var.outbound_type
  acr_public_network_access = var.acr_public_network_access
  postgres_sku              = var.postgres_sku
}
