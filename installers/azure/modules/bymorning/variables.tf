variable "name" {
  description = "Base name for resources (lowercase letters, digits, hyphens; at most 16 characters)."
  type        = string
  default     = "bymorning"

  validation {
    condition     = can(regex("^[a-z][a-z0-9-]{1,14}[a-z0-9]$", var.name))
    error_message = "name must be 3-16 characters: lowercase letters, digits, hyphens, starting with a letter."
  }
}

variable "environment" {
  description = "Azure cloud the provider targets. Selects private DNS zone names and the workload identity token audience. Must match the azurerm provider `environment` argument."
  type        = string
  default     = "usgovernment"

  validation {
    condition     = contains(["public", "usgovernment"], var.environment)
    error_message = "environment must be \"public\" or \"usgovernment\"."
  }
}

variable "location" {
  description = "Azure region, for example usgovvirginia (Government) or eastus2 (public)."
  type        = string
}

variable "tags" {
  description = "Tags applied to every resource that accepts tags."
  type        = map(string)
  default     = {}
}

variable "deployer_ip_ranges" {
  description = "Public IPv4 addresses/CIDRs of the machine running Terraform. Needed so Terraform can reach the Key Vault (and Storage) data plane, which are otherwise private-endpoint only. Empty means Terraform must run from inside the VNet or a peered network."
  type        = list(string)
  default     = []
}

variable "grant_deployer_access" {
  description = "Grant the identity running Terraform Key Vault Crypto Officer and Secrets Officer on the vault so it can create the key and secrets under Azure RBAC."
  type        = bool
  default     = true
}

# ── Network ─────────────────────────────────────────────────────────────

variable "vnet_cidr" {
  type    = string
  default = "10.40.0.0/16"
}

variable "aks_subnet_cidr" {
  type    = string
  default = "10.40.0.0/22"
}

variable "postgres_subnet_cidr" {
  type    = string
  default = "10.40.4.0/24"
}

variable "private_endpoint_subnet_cidr" {
  type    = string
  default = "10.40.5.0/24"
}

variable "service_cidr" {
  description = "Kubernetes service CIDR. Must not overlap the VNet or peered networks."
  type        = string
  default     = "10.41.0.0/16"
}

variable "dns_service_ip" {
  type    = string
  default = "10.41.0.10"
}

variable "pod_cidr" {
  description = "Pod CIDR for Azure CNI Overlay. Must not overlap the VNet or peered networks."
  type        = string
  default     = "10.244.0.0/16"
}

# ── AKS ────────────────────────────────────────────────────────────────

variable "kubernetes_version" {
  description = "AKS Kubernetes version; null uses the region default."
  type        = string
  default     = null
}

variable "private_cluster" {
  description = "Private API server (no public endpoint). When false, restrict the API server with api_authorized_ip_ranges."
  type        = bool
  default     = true
}

variable "api_authorized_ip_ranges" {
  description = "CIDRs allowed to reach the API server when private_cluster is false."
  type        = list(string)
  default     = []

  validation {
    condition     = length(var.api_authorized_ip_ranges) == 0 || !contains(var.api_authorized_ip_ranges, "0.0.0.0/0")
    error_message = "api_authorized_ip_ranges must not contain 0.0.0.0/0."
  }
}

variable "admin_group_object_ids" {
  description = "Entra group object IDs granted cluster admin. When non-empty, Azure RBAC for Kubernetes is enabled and local accounts are disabled."
  type        = list(string)
  default     = []
}

variable "network_policy" {
  description = "Network policy engine: cilium (Azure CNI Powered by Cilium; recommended), azure (Azure NPM; Linux support ends 2028-09-30), or calico."
  type        = string
  default     = "cilium"

  validation {
    condition     = contains(["cilium", "azure", "calico"], var.network_policy)
    error_message = "network_policy must be cilium, azure, or calico."
  }
}

variable "outbound_type" {
  description = "AKS outbound type: loadBalancer or userDefinedRouting (customer firewall/NVA route table)."
  type        = string
  default     = "loadBalancer"

  validation {
    condition     = contains(["loadBalancer", "userDefinedRouting", "managedNATGateway"], var.outbound_type)
    error_message = "outbound_type must be loadBalancer, userDefinedRouting, or managedNATGateway."
  }
}

variable "sku_tier" {
  type    = string
  default = "Standard"
}

variable "node_os_sku" {
  description = "OS SKU for system and user pools. FIPS pools support Ubuntu 22.04 or Azure Linux 3.0."
  type        = string
  default     = "AzureLinux"
}

variable "system_vm_size" {
  type    = string
  default = "Standard_D2s_v5"
}

variable "system_node_count" {
  type    = number
  default = 2
}

variable "user_vm_size" {
  type    = string
  default = "Standard_D4s_v5"
}

variable "user_node_min" {
  type    = number
  default = 1
}

variable "user_node_max" {
  type    = number
  default = 3
}

variable "availability_zones" {
  description = "Availability zones for node pools; empty for regions/SKUs without zones."
  type        = list(string)
  default     = []
}

variable "fips_node_pools" {
  description = "Use FIPS-enabled node images for the system and user pools. Cannot apply to the sandbox pool (pod sandboxing does not support FIPS)."
  type        = bool
  default     = false
}

variable "sandbox_node_pool" {
  description = "Create a Kata VM-isolation node pool (workload_runtime = KataVmIsolation, Azure Linux only, no FIPS). Availability in Azure Government is not confirmed by Microsoft documentation; validate on the subscription first."
  type        = bool
  default     = false
}

variable "sandbox_vm_size" {
  description = "VM size for the sandbox pool. Must support nested virtualization (Dsv3 per Microsoft documentation)."
  type        = string
  default     = "Standard_D4s_v3"
}

variable "sandbox_node_max" {
  type    = number
  default = 3
}

variable "csi_secrets_provider" {
  description = "Enable the Key Vault Secrets Store CSI driver add-on (optional alternative to Kubernetes Secrets)."
  type        = bool
  default     = false
}

variable "log_analytics" {
  description = "Create a Log Analytics workspace and enable Container Insights."
  type        = bool
  default     = false
}

variable "log_retention_days" {
  type    = number
  default = 90
}

# ── Workload identity ──────────────────────────────────────────────────

variable "namespace" {
  description = "Kubernetes namespace of the Gateway."
  type        = string
  default     = "bymorning"
}

variable "service_account" {
  description = "Kubernetes service account name of the Gateway."
  type        = string
  default     = "bymorning-gateway"
}

variable "federated_audience" {
  description = "Audience of the federated identity credential. Must equal the audience of the projected service-account token. Defaults to api://AzureADTokenExchange in both clouds (Microsoft documents no Government-specific value: https://learn.microsoft.com/en-us/entra/workload-id/workload-identity-federation-create-trust). smoke.sh prints the actual token `aud`; set this variable if the Government workload-identity webhook injects a different one."
  type        = string
  default     = "api://AzureADTokenExchange"
}

# ── Container registry ─────────────────────────────────────────────────

variable "acr_enabled" {
  description = "Create an Azure Container Registry (Premium, private endpoint). Disable to use the customer's registry."
  type        = bool
  default     = true
}

variable "acr_pull" {
  description = "Grant the AKS kubelet identity AcrPull on the registry. Disable if pull access is granted another way."
  type        = bool
  default     = true
}

variable "acr_public_network_access" {
  description = "Allow public network access to the registry (for pushing images from outside the VNet)."
  type        = bool
  default     = false
}

# ── PostgreSQL ─────────────────────────────────────────────────────────

variable "postgres_sku" {
  type    = string
  default = "GP_Standard_D2ds_v5"
}

variable "postgres_storage_mb" {
  type    = number
  default = 65536
}

variable "postgres_backup_days" {
  type    = number
  default = 14
}

variable "postgres_high_availability" {
  description = "Zone-redundant HA (requires zones in the region)."
  type        = bool
  default     = false
}

variable "database_name" {
  type    = string
  default = "bymorning"
}

# ── Storage and Key Vault ──────────────────────────────────────────────

variable "storage_replication" {
  description = "Storage account replication type (LRS, ZRS, GRS, GZRS)."
  type        = string
  default     = "GRS"
}

variable "container_name" {
  type    = string
  default = "bymorning"
}

variable "tool_output_days" {
  description = "Days before objects under tool-output/ expire."
  type        = number
  default     = 7
}

variable "key_vault_sku" {
  description = "standard (software RSA keys) or premium (RSA-HSM keys)."
  type        = string
  default     = "standard"

  validation {
    condition     = contains(["standard", "premium"], var.key_vault_sku)
    error_message = "key_vault_sku must be standard or premium."
  }
}

variable "key_size" {
  description = "RSA key size for RSA-OAEP-256 data-key wrapping."
  type        = number
  default     = 3072

  validation {
    condition     = contains([2048, 3072, 4096], var.key_size)
    error_message = "key_size must be 2048, 3072, or 4096."
  }
}

variable "key_rotate_after" {
  description = "ISO 8601 age at which Key Vault creates a new key version. Restart the Gateway to use it; old versions stay enabled."
  type        = string
  default     = "P18M"
}

variable "key_expire_after" {
  description = "ISO 8601 lifetime set on each rotated key version. Expired versions still unwrap but cannot wrap, so keep this well above key_rotate_after."
  type        = string
  default     = "P2Y"
}
