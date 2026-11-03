resource "aws_cloudwatch_log_group" "gateway" {
  name              = "/bymorning/${var.name}"
  retention_in_days = var.log_retention_days
  kms_key_id        = aws_kms_key.main.arn
}

resource "aws_ecs_cluster" "main" {
  name = var.name
  setting {
    name  = "containerInsights"
    value = "enabled"
  }
}

locals {
  log_configuration = {
    logDriver = "awslogs"
    options = {
      awslogs-group         = aws_cloudwatch_log_group.gateway.name
      awslogs-region        = local.region
      awslogs-stream-prefix = "ecs"
    }
  }
  secret = aws_secretsmanager_secret.runtime.arn
  # Non-secret settings. STORAGE_PROVIDER and CIPHER_BACKEND bind the image to S3
  # and KMS; the load balancer is the only ingress, so its forwarding chain is trusted.
  environment = merge(
    {
      PORT                  = tostring(local.port)
      APP_ORIGIN            = local.origin
      STORAGE_PROVIDER      = "s3"
      STORAGE_BUCKET        = aws_s3_bucket.storage.id
      CIPHER_BACKEND        = "kms"
      CREDENTIAL_KMS_KEY    = aws_kms_key.main.arn
      AWS_REGION            = local.region
      AWS_USE_FIPS_ENDPOINT = local.fips ? "true" : "false"
      TLS_CERT              = tls_self_signed_cert.listener.cert_pem
      TRUSTED_PROXIES       = data.aws_vpc.this.cidr_block
      BYMORNING_CONFIG      = local.config_file
    },
    var.code_interpreter ? { CODE_INTERPRETER_ID = aws_bedrockagentcore_code_interpreter.main[0].code_interpreter_id } : {},
    var.login_banner == "" ? {} : { LOGIN_BANNER = var.login_banner },
  )
  health_check = "require('node:https').get({ host: '127.0.0.1', port: ${local.port}, path: '/system/health', rejectUnauthorized: false }, (r) => process.exit(r.statusCode === 200 ? 0 : 1)).on('error', () => process.exit(1))"
}

# One task, two containers from the same image: `migrate` applies the database
# migrations and exits; `gateway` starts only after it succeeds.
resource "aws_ecs_task_definition" "gateway" {
  family                   = "${var.name}-gateway"
  cpu                      = tostring(var.task.cpu)
  memory                   = tostring(var.task.memory)
  network_mode             = "awsvpc"
  requires_compatibilities = ["FARGATE"]
  execution_role_arn       = aws_iam_role.execution.arn
  task_role_arn            = aws_iam_role.task.arn
  runtime_platform {
    cpu_architecture        = "X86_64"
    operating_system_family = "LINUX"
  }
  container_definitions = jsonencode([
    {
      name             = "migrate"
      image            = var.image
      essential        = false
      command          = ["node", "/app/bymorning.mjs", "migrate"]
      secrets          = [{ name = "DATABASE_URL", valueFrom = "${local.secret}:DATABASE_URL::" }]
      logConfiguration = local.log_configuration
    },
    {
      name            = "gateway"
      image           = var.image
      essential       = true
      dependsOn       = [{ containerName = "migrate", condition = "SUCCESS" }]
      linuxParameters = { initProcessEnabled = true }
      portMappings    = [{ protocol = "tcp", containerPort = local.port }]
      environment     = [for name, value in local.environment : { name = name, value = value }]
      secrets = [
        for name in ["DATABASE_URL", "WEB_COOKIE_KEY", "TLS_KEY", "SETUP_TOKEN"] : { name = name, valueFrom = "${local.secret}:${name}::" }
      ]
      healthCheck = {
        command     = ["CMD", "node", "-e", local.health_check]
        interval    = 30
        timeout     = 5
        retries     = 3
        startPeriod = 60
      }
      logConfiguration = local.log_configuration
    },
  ])
}

# One running task: OAuth callbacks and the scheduler are process-local, so two
# versions must never overlap. An upgrade stops the old task, then starts the new
# one, and the circuit breaker rolls back a task that never becomes healthy.
resource "aws_ecs_service" "gateway" {
  name                               = "${var.name}-gateway"
  cluster                            = aws_ecs_cluster.main.id
  task_definition                    = aws_ecs_task_definition.gateway.arn
  launch_type                        = "FARGATE"
  desired_count                      = 1
  deployment_minimum_healthy_percent = 0
  deployment_maximum_percent         = 100
  health_check_grace_period_seconds  = 600
  enable_execute_command             = false
  wait_for_steady_state              = true
  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }
  network_configuration {
    subnets          = var.service_subnet_ids
    security_groups  = [aws_security_group.service.id]
    assign_public_ip = var.assign_public_ip
  }
  load_balancer {
    target_group_arn = aws_lb_target_group.main.arn
    container_name   = "gateway"
    container_port   = local.port
  }
  depends_on = [
    aws_lb_listener.https,
    aws_iam_role_policy.task,
    aws_iam_role_policy.execution,
    aws_iam_role_policy_attachment.execution,
    aws_secretsmanager_secret_version.runtime,
    aws_db_instance.main,
  ]
}
