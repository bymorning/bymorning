terraform {
  required_version = ">= 1.9.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = ">= 6.55.0, < 7.0.0"
    }
  }

  # Terraform state holds the database password and the cookie key. Use a
  # private, encrypted backend, for example:
  #
  # backend "s3" {
  #   bucket       = "my-terraform-state"
  #   key          = "bymorning.tfstate"
  #   region       = "us-gov-west-1"
  #   encrypt      = true
  #   use_lockfile = true
  # }
}

provider "aws" {
  # A GovCloud Region (us-gov-west-1, us-gov-east-1) selects AWS GovCloud (US).
  region = var.region
  default_tags {
    tags = var.tags
  }
}

module "bymorning" {
  source = "../../modules/bymorning"

  name            = var.name
  image           = var.image
  hostname        = var.hostname
  certificate_arn = var.certificate_arn

  vpc_id                   = var.vpc_id
  service_subnet_ids       = var.service_subnet_ids
  load_balancer_subnet_ids = var.load_balancer_subnet_ids
  database_subnet_ids      = var.database_subnet_ids
  internal                 = var.internal
  assign_public_ip         = var.assign_public_ip
  allowed_cidrs            = var.allowed_cidrs

  bedrock_model_arns = var.bedrock_model_arns
  code_interpreter   = var.code_interpreter
  cui_profile        = var.cui_profile
  setup_token        = var.setup_token
  login_banner       = var.login_banner
  database           = var.database
}
