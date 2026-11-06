variable "region" {
  description = "AWS Region, for example us-gov-west-1 or us-east-1."
  type        = string
}

variable "name" {
  description = "Prefix for every resource."
  type        = string
  default     = "bymorning"
}

variable "image" {
  description = "The Gateway image pinned by digest."
  type        = string
}

variable "hostname" {
  description = "The DNS name people use to reach ByMorning."
  type        = string
}

variable "certificate_arn" {
  description = "ACM certificate for hostname."
  type        = string
}

variable "vpc_id" {
  type = string
}

variable "service_subnet_ids" {
  type = list(string)
}

variable "load_balancer_subnet_ids" {
  type = list(string)
}

variable "database_subnet_ids" {
  type    = list(string)
  default = null
}

variable "assign_public_ip" {
  description = "Give the task a public IP. Only for task subnets that reach the internet through an internet gateway instead of a NAT gateway, such as a default VPC."
  type        = bool
  default     = false
}

variable "internal" {
  type    = bool
  default = true
}

variable "allowed_cidrs" {
  type = list(string)
}

variable "bedrock_model_arns" {
  type    = list(string)
  default = []
}

variable "code_interpreter" {
  type    = bool
  default = false
}

variable "cui_profile" {
  type    = bool
  default = false
}

variable "setup_token" {
  type      = string
  default   = null
  sensitive = true
}

variable "login_banner" {
  type    = string
  default = ""
}

variable "database" {
  type    = any
  default = {}
}

variable "task" {
  description = "Task size: cpu in units (1024 = 1 vCPU) and memory in MiB, a valid Fargate combination. Defaults to the module's."
  type        = any
  default     = {}
}

variable "fips_endpoints" {
  description = "Route S3, KMS, and Bedrock calls to FIPS endpoints. Null follows the module: always on in AWS GovCloud, on in US commercial Regions, off elsewhere."
  type        = bool
  default     = null
}

# Keep this default equal to the module's; test.sh checks it.
variable "log_retention_days" {
  description = "How long CloudWatch keeps the application logs."
  type        = number
  default     = 90
}

variable "tags" {
  description = "Tags added to every resource."
  type        = map(string)
  default     = { Application = "bymorning" }
}
