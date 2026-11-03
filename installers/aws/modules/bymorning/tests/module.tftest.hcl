# Offline checks of what the module asks AWS for. The aws provider is mocked, so
# no credentials are used and nothing is created.

mock_provider "aws" {
  override_data {
    target = data.aws_caller_identity.current
    values = { account_id = "123456789012" }
  }
  override_data {
    target = data.aws_partition.current
    values = { partition = "aws-us-gov", dns_suffix = "amazonaws.com" }
  }
  override_data {
    target = data.aws_region.current
    values = { region = "us-gov-west-1" }
  }
  override_data {
    target = data.aws_vpc.this
    values = { cidr_block = "10.20.0.0/16" }
  }
  # Arguments that take an ARN are validated, so the mocked ARNs must look like ARNs.
  mock_resource "aws_iam_role" {
    defaults = { arn = "arn:aws-us-gov:iam::123456789012:role/bymorning-mock" }
  }
  mock_resource "aws_kms_key" {
    defaults = { arn = "arn:aws-us-gov:kms:us-gov-west-1:123456789012:key/00000000-0000-4000-8000-000000000000" }
  }
  mock_resource "aws_lb" {
    defaults = { arn = "arn:aws-us-gov:elasticloadbalancing:us-gov-west-1:123456789012:loadbalancer/app/bymorning-alb/0123456789abcdef" }
  }
  mock_resource "aws_lb_target_group" {
    defaults = { arn = "arn:aws-us-gov:elasticloadbalancing:us-gov-west-1:123456789012:targetgroup/bm-mock/0123456789abcdef" }
  }
  mock_resource "aws_secretsmanager_secret" {
    defaults = { arn = "arn:aws-us-gov:secretsmanager:us-gov-west-1:123456789012:secret:bymorning-runtime-AbCdEf" }
  }
  mock_resource "aws_s3_bucket" {
    defaults = { arn = "arn:aws-us-gov:s3:::bymorning-storage-mock", id = "bymorning-storage-mock" }
  }
  mock_resource "aws_bedrockagentcore_code_interpreter" {
    defaults = {
      code_interpreter_arn = "arn:aws-us-gov:bedrock-agentcore:us-gov-west-1:123456789012:code-interpreter/bymorning-mock"
      code_interpreter_id  = "bymorning-mock"
    }
  }
}

mock_provider "random" {}
mock_provider "tls" {}

variables {
  image                    = "ghcr.io/bymorning/bymorning@sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
  hostname                 = "bymorning.example.com"
  certificate_arn          = "arn:aws-us-gov:acm:us-gov-west-1:123456789012:certificate/00000000-0000-0000-0000-000000000000"
  vpc_id                   = "vpc-0123456789abcdef0"
  service_subnet_ids       = ["subnet-1", "subnet-2"]
  load_balancer_subnet_ids = ["subnet-1", "subnet-2"]
  allowed_cidrs            = ["10.0.0.0/8"]
  bedrock_model_arns       = ["arn:aws-us-gov:bedrock:us-gov-west-1::foundation-model/anthropic.claude-sonnet-4-5-20250929-v1:0"]
}

run "govcloud" {
  command = apply

  assert {
    condition     = output.fips_endpoints == true && aws_lb_listener.https.ssl_policy == "ELBSecurityPolicy-TLS13-1-2-FIPS-2023-04"
    error_message = "GovCloud must use FIPS endpoints and the FIPS TLS policy."
  }
  assert {
    condition = alltrue([
      local.environment.AWS_USE_FIPS_ENDPOINT == "true",
      local.environment.STORAGE_PROVIDER == "s3",
      local.environment.CIPHER_BACKEND == "kms",
      local.environment.APP_ORIGIN == "https://bymorning.example.com",
      local.environment.AWS_REGION == "us-gov-west-1",
      local.environment.TRUSTED_PROXIES == "10.20.0.0/16",
      local.environment.BYMORNING_CONFIG == "/app/bymorning.azure.jsonc",
      !contains(keys(local.environment), "CODE_INTERPRETER_ID"),
    ])
    error_message = "The task environment binds the image to S3 and KMS with FIPS endpoints and no Code Interpreter."
  }
  assert {
    # Secrets travel only as container secrets, never as environment.
    condition = alltrue([
      for name in ["DATABASE_URL", "WEB_COOKIE_KEY", "TLS_KEY", "SETUP_TOKEN", "BYMORNING_EVALUATION", "CIPHER_KEY"] :
      !contains(keys(local.environment), name)
    ]) && toset([for s in jsondecode(aws_ecs_task_definition.gateway.container_definitions)[1].secrets : s.name]) == toset(["DATABASE_URL", "WEB_COOKIE_KEY", "TLS_KEY", "SETUP_TOKEN"])
    error_message = "Secrets must reach the task through Secrets Manager only, and evaluation settings never appear."
  }
  assert {
    condition = alltrue([
      jsondecode(aws_ecs_task_definition.gateway.container_definitions)[0].command == ["node", "/app/bymorning.mjs", "migrate"],
      jsondecode(aws_ecs_task_definition.gateway.container_definitions)[1].dependsOn[0].condition == "SUCCESS",
      aws_ecs_service.gateway.desired_count == 1,
      aws_ecs_service.gateway.deployment_maximum_percent == 100,
      aws_ecs_service.gateway.enable_execute_command == false,
    ])
    error_message = "migrate runs first, and exactly one Gateway task runs with no ECS Exec."
  }
  assert {
    condition = alltrue([
      aws_db_instance.main.storage_encrypted,
      !aws_db_instance.main.publicly_accessible,
      aws_db_instance.main.deletion_protection,
      !aws_db_instance.main.skip_final_snapshot,
      aws_db_instance.main.engine_version == "17",
      strcontains(local.database_url, "sslmode=verify-full"),
    ])
    error_message = "PostgreSQL 17 is encrypted, private, protected from deletion, and verified over TLS."
  }
  assert {
    condition = alltrue([
      aws_s3_bucket_public_access_block.storage.block_public_acls,
      aws_s3_bucket_public_access_block.storage.block_public_policy,
      aws_s3_bucket_public_access_block.storage.ignore_public_acls,
      aws_s3_bucket_public_access_block.storage.restrict_public_buckets,
      strcontains(aws_s3_bucket_policy.storage.policy, "aws:SecureTransport"),
    ])
    error_message = "The bucket is private and refuses requests without TLS."
  }
  assert {
    condition = alltrue([
      aws_lb.main.internal,
      aws_lb.main.drop_invalid_header_fields,
      length(aws_vpc_security_group_ingress_rule.load_balancer) == 2,
    ])
    error_message = "The load balancer is internal by default and admits only allowed_cidrs on 80 and 443."
  }
  assert {
    # No wildcard resources, and the Credential key use is bound to ByMorning's encryption context.
    condition = alltrue([
      for statement in jsondecode(aws_iam_role_policy.task.policy).Statement : !contains(statement.Resource, "*")
      ]) && one([
      for statement in jsondecode(aws_iam_role_policy.task.policy).Statement : statement.Condition
      if statement.Sid == "CredentialKey"
    ]) == { StringEquals = { "kms:EncryptionContext:bymorning" = "cipher" } }
    error_message = "The task role names every resource and scopes the Credential key to its encryption context."
  }
  assert {
    condition     = length(aws_bedrockagentcore_code_interpreter.main) == 0
    error_message = "The Code Interpreter is off by default."
  }
}

run "govcloud_fips_cannot_be_disabled" {
  command = plan
  variables {
    fips_endpoints = false
  }
  assert {
    condition     = local.fips == true
    error_message = "The Gateway refuses a GovCloud Region without FIPS endpoints, so the module never disables them there."
  }
}

run "commercial_us" {
  command = plan
  override_data {
    target = data.aws_partition.current
    values = { partition = "aws", dns_suffix = "amazonaws.com" }
  }
  override_data {
    target = data.aws_region.current
    values = { region = "us-east-1" }
  }
  variables {
    certificate_arn    = "arn:aws:acm:us-east-1:123456789012:certificate/00000000-0000-0000-0000-000000000000"
    bedrock_model_arns = []
  }
  assert {
    condition     = local.fips == true && local.environment.AWS_USE_FIPS_ENDPOINT == "true"
    error_message = "US commercial Regions default to FIPS endpoints."
  }
  assert {
    condition     = !anytrue([for statement in local.task_statements : startswith(statement.Sid, "Bedrock")])
    error_message = "No Bedrock statements without bedrock_model_arns."
  }
}

run "commercial_outside_us" {
  command = plan
  override_data {
    target = data.aws_partition.current
    values = { partition = "aws", dns_suffix = "amazonaws.com" }
  }
  override_data {
    target = data.aws_region.current
    values = { region = "eu-west-1" }
  }
  variables {
    bedrock_model_arns = []
  }
  assert {
    condition     = local.fips == false && aws_lb_listener.https.ssl_policy == "ELBSecurityPolicy-TLS13-1-2-2021-06"
    error_message = "FIPS endpoints don't exist outside the US, so they are off there by default."
  }
}

run "code_interpreter" {
  command = apply
  variables {
    code_interpreter = true
  }
  assert {
    condition = alltrue([
      length(aws_bedrockagentcore_code_interpreter.main) == 1,
      aws_bedrockagentcore_code_interpreter.main[0].network_configuration[0].network_mode == "VPC",
      local.environment.BYMORNING_CONFIG == "/app/bymorning.jsonc",
      contains(keys(local.environment), "CODE_INTERPRETER_ID"),
      anytrue([for statement in local.task_statements : statement.Sid == "CodeInterpreter"]),
    ])
    error_message = "The Code Interpreter runs in VPC mode, and the task is told about it and may call it."
  }
}

run "tag_only_image_refused" {
  command = plan
  variables {
    image = "ghcr.io/bymorning/bymorning:1.3.2"
  }
  expect_failures = [var.image]
}

run "wildcard_model_refused" {
  command = plan
  variables {
    bedrock_model_arns = ["arn:aws-us-gov:bedrock:us-gov-west-1::foundation-model/*"]
  }
  expect_failures = [var.bedrock_model_arns]
}

run "open_ingress_needs_a_cidr" {
  command = plan
  variables {
    allowed_cidrs = []
  }
  expect_failures = [var.allowed_cidrs]
}
