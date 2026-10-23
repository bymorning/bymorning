variable "subscription_id" {
  type = string
}

variable "environment" {
  description = "public or usgovernment."
  type        = string
  default     = "usgovernment"
}

variable "location" {
  type    = string
  default = "usgovvirginia"
}

variable "name" {
  type    = string
  default = "bymorning"
}

variable "tags" {
  type    = map(string)
  default = {}
}

variable "deployer_ip_ranges" {
  type    = list(string)
  default = []
}

variable "private_cluster" {
  type    = bool
  default = true
}

variable "api_authorized_ip_ranges" {
  type    = list(string)
  default = []
}

variable "admin_group_object_ids" {
  type    = list(string)
  default = []
}

variable "fips_node_pools" {
  type    = bool
  default = false
}

variable "sandbox_node_pool" {
  type    = bool
  default = false
}

variable "network_policy" {
  type    = string
  default = "cilium"
}

variable "acr_enabled" {
  type    = bool
  default = true
}

variable "log_analytics" {
  type    = bool
  default = false
}

variable "federated_audience" {
  type    = string
  default = "api://AzureADTokenExchange"
}

variable "key_vault_sku" {
  type    = string
  default = "standard"
}

variable "system_vm_size" {
  description = "AKS system node VM size."
  type        = string
  default     = "Standard_D2s_v5"
}

variable "user_vm_size" {
  description = "AKS user node VM size."
  type        = string
  default     = "Standard_D4s_v5"
}

variable "user_node_min" {
  description = "Minimum user nodes (autoscaler)."
  type        = number
  default     = 1
}

variable "user_node_max" {
  description = "Maximum user nodes (autoscaler)."
  type        = number
  default     = 3
}

variable "outbound_type" {
  description = "AKS outbound type: loadBalancer, userDefinedRouting or managedNATGateway."
  type        = string
  default     = "loadBalancer"
}

variable "acr_public_network_access" {
  description = "Allow pushing to the registry from outside the VNet."
  type        = bool
  default     = false
}

variable "postgres_sku" {
  description = "PostgreSQL Flexible Server SKU."
  type        = string
  default     = "GP_Standard_D2ds_v5"
}
