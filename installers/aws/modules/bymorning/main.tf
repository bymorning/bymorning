# ByMorning on AWS: one ECS Fargate task behind an Application Load Balancer, with
# PostgreSQL 17 on RDS, an S3 bucket, and one KMS key, in a VPC you already have.
# The same module serves commercial AWS and AWS GovCloud (US); the partition and
# the FIPS endpoint setting follow from the provider's Region.

data "aws_caller_identity" "current" {}
data "aws_partition" "current" {}
data "aws_region" "current" {}

data "aws_vpc" "this" {
  id = var.vpc_id
}

locals {
  account    = data.aws_caller_identity.current.account_id
  partition  = data.aws_partition.current.partition
  dns_suffix = data.aws_partition.current.dns_suffix
  region     = data.aws_region.current.region
  govcloud   = local.partition == "aws-us-gov"
  # The Gateway refuses a GovCloud Region without FIPS endpoints, so they are not optional there.
  fips   = local.govcloud ? true : coalesce(var.fips_endpoints, startswith(local.region, "us-"))
  port   = 3210
  origin = "https://${var.hostname}"
  # The image ships the installation documents: the default one adds the AgentCore
  # Code Interpreter; the other is the same set of plugins without it.
  config_file      = var.code_interpreter ? "/app/bymorning.jsonc" : "/app/bymorning.azure.jsonc"
  database_subnets = coalesce(var.database_subnet_ids, var.service_subnet_ids)
}
