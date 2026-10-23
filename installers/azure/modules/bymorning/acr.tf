resource "azurerm_container_registry" "this" {
  count                         = var.acr_enabled ? 1 : 0
  name                          = "${local.compact}${local.suffix}"
  location                      = azurerm_resource_group.this.location
  resource_group_name           = azurerm_resource_group.this.name
  sku                           = "Premium"
  admin_enabled                 = false
  public_network_access_enabled = var.acr_public_network_access
  tags                          = local.tags
}

resource "azurerm_role_assignment" "kubelet_acr_pull" {
  count                            = var.acr_enabled && var.acr_pull ? 1 : 0
  scope                            = azurerm_container_registry.this[0].id
  role_definition_name             = "AcrPull"
  principal_id                     = azurerm_kubernetes_cluster.this.kubelet_identity[0].object_id
  skip_service_principal_aad_check = true
}
