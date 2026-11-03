locals {
  ecs_assume_role = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Action    = "sts:AssumeRole"
      Principal = { Service = "ecs-tasks.amazonaws.com" }
      Condition = {
        ArnLike      = { "aws:SourceArn" = "arn:${local.partition}:ecs:${local.region}:${local.account}:*" }
        StringEquals = { "aws:SourceAccount" = local.account }
      }
    }]
  })
}

# What ECS needs to start the task: pull the image, write logs, read the runtime secret.
resource "aws_iam_role" "execution" {
  name_prefix        = "${var.name}-execution-"
  assume_role_policy = local.ecs_assume_role
}

resource "aws_iam_role_policy_attachment" "execution" {
  role       = aws_iam_role.execution.name
  policy_arn = "arn:${local.partition}:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

resource "aws_iam_role_policy" "execution" {
  name = "runtime-secret"
  role = aws_iam_role.execution.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = "secretsmanager:GetSecretValue"
        Resource = aws_secretsmanager_secret.runtime.arn
      },
      {
        Effect    = "Allow"
        Action    = "kms:Decrypt"
        Resource  = aws_kms_key.main.arn
        Condition = { StringEquals = { "kms:ViaService" = "secretsmanager.${local.region}.${local.dns_suffix}" } }
      },
    ]
  })
}

# What ByMorning itself calls. Every statement names its resources; the one key
# is split by use: S3 may use it only through S3, and the Credential envelope
# only with ByMorning's encryption context.
locals {
  task_statements = concat(
    [
      {
        Sid      = "Storage"
        Effect   = "Allow"
        Resource = [aws_s3_bucket.storage.arn, "${aws_s3_bucket.storage.arn}/*"]
        Action = [
          "s3:ListBucket", "s3:GetBucketLocation", "s3:ListBucketMultipartUploads",
          "s3:GetObject", "s3:PutObject", "s3:DeleteObject",
          "s3:AbortMultipartUpload", "s3:ListMultipartUploadParts",
        ]
      },
      {
        Sid       = "StorageKey"
        Effect    = "Allow"
        Resource  = [aws_kms_key.main.arn]
        Action    = ["kms:Encrypt", "kms:Decrypt", "kms:GenerateDataKey*", "kms:DescribeKey"]
        Condition = { StringEquals = { "kms:ViaService" = "s3.${local.region}.${local.dns_suffix}" } }
      },
      {
        Sid       = "CredentialKey"
        Effect    = "Allow"
        Resource  = [aws_kms_key.main.arn]
        Action    = ["kms:GenerateDataKey", "kms:Decrypt"]
        Condition = { StringEquals = { "kms:EncryptionContext:bymorning" = "cipher" } }
      },
    ],
    length(var.bedrock_model_arns) == 0 ? [] : [
      {
        Sid       = "BedrockModels"
        Effect    = "Allow"
        Resource  = var.bedrock_model_arns
        Action    = ["bedrock:InvokeModel", "bedrock:InvokeModelWithResponseStream"]
        Condition = null
      },
      # Bedrock Mantle (the OpenAI-compatible endpoint) supports only the default project.
      {
        Sid       = "BedrockMantle"
        Effect    = "Allow"
        Resource  = ["arn:${local.partition}:bedrock-mantle:${local.region}:${local.account}:project/default"]
        Action    = ["bedrock-mantle:CreateInference"]
        Condition = null
      },
    ],
    var.code_interpreter ? [
      {
        Sid      = "CodeInterpreter"
        Effect   = "Allow"
        Resource = [aws_bedrockagentcore_code_interpreter.main[0].code_interpreter_arn]
        Action = [
          "bedrock-agentcore:StartCodeInterpreterSession", "bedrock-agentcore:InvokeCodeInterpreter",
          "bedrock-agentcore:GetCodeInterpreterSession", "bedrock-agentcore:StopCodeInterpreterSession",
        ]
        Condition = null
      },
    ] : [],
  )
}

resource "aws_iam_role" "task" {
  name_prefix        = "${var.name}-task-"
  assume_role_policy = local.ecs_assume_role
}

resource "aws_iam_role_policy" "task" {
  name = "bymorning"
  role = aws_iam_role.task.id
  policy = jsonencode({
    Version   = "2012-10-17"
    Statement = [for statement in local.task_statements : { for key, value in statement : key => value if value != null }]
  })
}

# Optional: an AgentCore Code Interpreter in the task subnets with a security
# group that has no rules, so code it runs has no network access.
resource "aws_iam_role" "interpreter" {
  count       = var.code_interpreter ? 1 : 0
  name_prefix = "${var.name}-interpreter-"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Action    = "sts:AssumeRole"
      Principal = { Service = "bedrock-agentcore.amazonaws.com" }
      Condition = {
        StringEquals = { "aws:SourceAccount" = local.account }
        ArnLike      = { "aws:SourceArn" = "arn:${local.partition}:bedrock-agentcore:${local.region}:${local.account}:*" }
      }
    }]
  })
}

resource "aws_security_group" "interpreter" {
  count       = var.code_interpreter ? 1 : 0
  name_prefix = "${var.name}-interpreter-"
  description = "${var.name} Code Interpreter: no ingress, no egress"
  vpc_id      = var.vpc_id
  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_bedrockagentcore_code_interpreter" "main" {
  count              = var.code_interpreter ? 1 : 0
  name               = substr(replace(var.name, "-", "_"), 0, 48)
  description        = "${var.name} isolated code execution"
  execution_role_arn = aws_iam_role.interpreter[0].arn
  network_configuration {
    network_mode = "VPC"
    vpc_config {
      subnets         = var.service_subnet_ids
      security_groups = [aws_security_group.interpreter[0].id]
    }
  }
}
