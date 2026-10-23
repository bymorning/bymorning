locals {
  data_plane = var.network_policy == "cilium" ? "cilium" : "azure"
  sandbox    = var.sandbox_node_pool
}

resource "azurerm_log_analytics_workspace" "this" {
  count               = var.log_analytics ? 1 : 0
  name                = "log-${local.prefix}"
  location            = azurerm_resource_group.this.location
  resource_group_name = azurerm_resource_group.this.name
  sku                 = "PerGB2018"
  retention_in_days   = var.log_retention_days
  tags                = local.tags
}

resource "azurerm_kubernetes_cluster" "this" {
  name                = "aks-${local.prefix}"
  location            = azurerm_resource_group.this.location
  resource_group_name = azurerm_resource_group.this.name
  dns_prefix          = "${local.prefix}-${local.suffix}"
  kubernetes_version  = var.kubernetes_version
  sku_tier            = var.sku_tier
  tags                = local.tags

  private_cluster_enabled             = var.private_cluster
  private_cluster_public_fqdn_enabled = false
  oidc_issuer_enabled                 = true
  workload_identity_enabled           = true
  role_based_access_control_enabled   = true
  local_account_disabled              = length(var.admin_group_object_ids) > 0
  automatic_upgrade_channel           = "patch"
  node_os_upgrade_channel             = "NodeImage"

  identity {
    type = "SystemAssigned"
  }

  default_node_pool {
    name                         = "system"
    vm_size                      = var.system_vm_size
    node_count                   = var.system_node_count
    vnet_subnet_id               = azurerm_subnet.aks.id
    os_sku                       = var.node_os_sku
    fips_enabled                 = var.fips_node_pools
    zones                        = var.availability_zones
    only_critical_addons_enabled = true
    temporary_name_for_rotation  = "systemtmp"

    upgrade_settings {
      max_surge = "10%"
    }
  }

  network_profile {
    network_plugin      = "azure"
    network_plugin_mode = "overlay"
    network_policy      = var.network_policy
    network_data_plane  = local.data_plane
    outbound_type       = var.outbound_type
    service_cidr        = var.service_cidr
    dns_service_ip      = var.dns_service_ip
    pod_cidr            = var.pod_cidr
  }

  dynamic "api_server_access_profile" {
    for_each = !var.private_cluster && length(var.api_authorized_ip_ranges) > 0 ? [1] : []
    content {
      authorized_ip_ranges = var.api_authorized_ip_ranges
    }
  }

  dynamic "azure_active_directory_role_based_access_control" {
    for_each = length(var.admin_group_object_ids) > 0 ? [1] : []
    content {
      azure_rbac_enabled     = true
      admin_group_object_ids = var.admin_group_object_ids
      tenant_id              = data.azurerm_client_config.current.tenant_id
    }
  }

  dynamic "oms_agent" {
    for_each = var.log_analytics ? [1] : []
    content {
      log_analytics_workspace_id      = azurerm_log_analytics_workspace.this[0].id
      msi_auth_for_monitoring_enabled = true
    }
  }

  dynamic "key_vault_secrets_provider" {
    for_each = var.csi_secrets_provider ? [1] : []
    content {
      secret_rotation_enabled = true
    }
  }
}

resource "azurerm_kubernetes_cluster_node_pool" "user" {
  name                  = "user"
  kubernetes_cluster_id = azurerm_kubernetes_cluster.this.id
  mode                  = "User"
  vm_size               = var.user_vm_size
  vnet_subnet_id        = azurerm_subnet.aks.id
  os_sku                = var.node_os_sku
  fips_enabled          = var.fips_node_pools
  zones                 = var.availability_zones
  auto_scaling_enabled  = true
  min_count             = var.user_node_min
  max_count             = var.user_node_max
  node_labels           = { "bymorning.dev/pool" = "user" }
  tags                  = local.tags

  upgrade_settings {
    max_surge = "10%"
  }
}

# Optional Kata VM-isolation pool for code execution. Pod sandboxing runs only on
# Azure Linux and cannot be combined with FIPS or Trusted Launch.
resource "azurerm_kubernetes_cluster_node_pool" "sandbox" {
  count                 = local.sandbox ? 1 : 0
  name                  = "sandbox"
  kubernetes_cluster_id = azurerm_kubernetes_cluster.this.id
  mode                  = "User"
  vm_size               = var.sandbox_vm_size
  vnet_subnet_id        = azurerm_subnet.aks.id
  os_sku                = "AzureLinux"
  workload_runtime      = "KataVmIsolation"
  fips_enabled          = false
  zones                 = var.availability_zones
  auto_scaling_enabled  = true
  min_count             = 0
  max_count             = var.sandbox_node_max
  node_labels           = { "bymorning.dev/pool" = "sandbox" }
  node_taints           = ["bymorning.dev/sandbox=true:NoSchedule"]
  tags                  = local.tags

  upgrade_settings {
    max_surge = "10%"
  }
}
