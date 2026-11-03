variable "name" {
  description = "Prefix for every resource. Lowercase letters, digits, and hyphens; at most 20 characters."
  type        = string
  default     = "bymorning"
  validation {
    condition     = can(regex("^[a-z][a-z0-9-]{0,19}$", var.name))
    error_message = "name must start with a letter and use at most 20 lowercase letters, digits, and hyphens."
  }
}

variable "image" {
  description = "The Gateway image pinned by digest: ghcr.io/bymorning/bymorning@sha256:... or your ECR mirror of it."
  type        = string
  validation {
    condition     = can(regex("^[^\\s@]+@sha256:[0-9a-f]{64}$", var.image))
    error_message = "image must be pinned by digest (<repository>@sha256:<64 hex>), never by tag alone."
  }
}

variable "hostname" {
  description = "The DNS name people use to reach ByMorning, for example bymorning.example.com. Point it at the load balancer."
  type        = string
  validation {
    condition     = can(regex("^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$", var.hostname))
    error_message = "hostname must be a lowercase DNS name with no scheme, port, or path."
  }
}

variable "certificate_arn" {
  description = "ACM certificate for hostname, in the same Region."
  type        = string
}

variable "vpc_id" {
  description = "The existing VPC to deploy into."
  type        = string
}

variable "service_subnet_ids" {
  description = "Private subnets for the ByMorning task (and the Code Interpreter). They need a route to the AWS service endpoints and your identity provider: a NAT gateway or VPC endpoints."
  type        = list(string)
  validation {
    condition     = length(var.service_subnet_ids) > 0
    error_message = "service_subnet_ids needs at least one subnet."
  }
}

variable "load_balancer_subnet_ids" {
  description = "Subnets for the load balancer, in at least two Availability Zones. Private subnets for an internal load balancer, public ones for an internet-facing one."
  type        = list(string)
  validation {
    condition     = length(var.load_balancer_subnet_ids) >= 2
    error_message = "load_balancer_subnet_ids needs subnets in at least two Availability Zones."
  }
}

variable "database_subnet_ids" {
  description = "Subnets for PostgreSQL, in at least two Availability Zones. Defaults to service_subnet_ids."
  type        = list(string)
  default     = null
}

variable "internal" {
  description = "Whether the load balancer is internal (reachable only from inside your network)."
  type        = bool
  default     = true
}

variable "allowed_cidrs" {
  description = "CIDR ranges allowed to reach the load balancer on ports 80 and 443, for example your VPN or office ranges."
  type        = list(string)
  validation {
    condition     = length(var.allowed_cidrs) > 0 && alltrue([for cidr in var.allowed_cidrs : can(cidrhost(cidr, 0))])
    error_message = "allowed_cidrs needs at least one valid CIDR range."
  }
}

variable "assign_public_ip" {
  description = "Give the task a public IP. Only for subnets that reach the internet through an internet gateway instead of a NAT gateway."
  type        = bool
  default     = false
}

variable "bedrock_model_arns" {
  description = "Amazon Bedrock model and inference-profile ARNs the task may invoke. Wildcards are refused. Empty means no Bedrock access."
  type        = list(string)
  default     = []
  validation {
    condition     = alltrue([for arn in var.bedrock_model_arns : can(regex("^arn:aws(-us-gov)?:bedrock:", arn)) && !strcontains(arn, "*")])
    error_message = "bedrock_model_arns must be explicit Bedrock ARNs without wildcards."
  }
}

variable "code_interpreter" {
  description = "Create a Bedrock AgentCore Code Interpreter with no network access, so Sessions can run code. Check that AgentCore is available in your Region first."
  type        = bool
  default     = false
}

variable "cui_profile" {
  description = "Load the CUI profile: only the AgentCore Code Interpreter, with no public Session links and no Google plugin. Requires code_interpreter. Pair it with an Installation Policy that admits only Amazon Bedrock."
  type        = bool
  default     = false
  validation {
    condition     = !var.cui_profile || var.code_interpreter
    error_message = "cui_profile requires code_interpreter = true: the CUI profile loads the AgentCore Code Interpreter."
  }
}

variable "fips_endpoints" {
  description = "Route S3, KMS, and Bedrock calls to FIPS endpoints. Always on in AWS GovCloud; on by default in US commercial Regions; FIPS endpoints don't exist outside the US."
  type        = bool
  default     = null
}

variable "setup_token" {
  description = "A Setup token you choose. By default the module generates one; read it with `terraform output -raw setup_token`. Pass your own from a secret store; never commit it."
  type        = string
  default     = null
  sensitive   = true
}

variable "login_banner" {
  description = "System use notification people acknowledge before signing in. Empty for none."
  type        = string
  default     = ""
}

variable "task" {
  description = "Task size: cpu in units (1024 = 1 vCPU) and memory in MiB, a valid Fargate combination."
  type = object({
    cpu    = optional(number, 1024)
    memory = optional(number, 2048)
  })
  default = {}
}

variable "database" {
  description = "PostgreSQL 17 sizing and protection."
  type = object({
    instance_class        = optional(string, "db.t4g.small")
    allocated_storage     = optional(number, 20)
    max_allocated_storage = optional(number, 100)
    multi_az              = optional(bool, false)
    backup_retention_days = optional(number, 7)
    deletion_protection   = optional(bool, true)
  })
  default = {}
}

variable "log_retention_days" {
  description = "How long CloudWatch keeps the application logs."
  type        = number
  default     = 90
}
