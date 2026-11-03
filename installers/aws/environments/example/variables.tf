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

variable "tags" {
  description = "Tags added to every resource."
  type        = map(string)
  default     = { Application = "bymorning" }
}
