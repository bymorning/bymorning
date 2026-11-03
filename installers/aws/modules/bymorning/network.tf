# Load balancer -> task -> database, each admitting only the hop before it.

resource "aws_security_group" "load_balancer" {
  name_prefix = "${var.name}-alb-"
  description = "${var.name} load balancer"
  vpc_id      = var.vpc_id
  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_vpc_security_group_ingress_rule" "load_balancer" {
  for_each          = { for pair in setproduct([80, 443], var.allowed_cidrs) : "${pair[0]}-${pair[1]}" => pair }
  security_group_id = aws_security_group.load_balancer.id
  ip_protocol       = "tcp"
  from_port         = each.value[0]
  to_port           = each.value[0]
  cidr_ipv4         = each.value[1]
}

resource "aws_vpc_security_group_egress_rule" "load_balancer" {
  security_group_id            = aws_security_group.load_balancer.id
  ip_protocol                  = "tcp"
  from_port                    = local.port
  to_port                      = local.port
  referenced_security_group_id = aws_security_group.service.id
}

resource "aws_security_group" "service" {
  name_prefix = "${var.name}-task-"
  description = "${var.name} ByMorning task"
  vpc_id      = var.vpc_id
  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_vpc_security_group_ingress_rule" "service" {
  security_group_id            = aws_security_group.service.id
  ip_protocol                  = "tcp"
  from_port                    = local.port
  to_port                      = local.port
  referenced_security_group_id = aws_security_group.load_balancer.id
}

# HTTPS out: ECR or ghcr.io, S3, KMS, Secrets Manager, CloudWatch Logs, Bedrock,
# AgentCore, your identity provider, and the Model Providers you enable.
resource "aws_vpc_security_group_egress_rule" "service_https" {
  security_group_id = aws_security_group.service.id
  ip_protocol       = "tcp"
  from_port         = 443
  to_port           = 443
  cidr_ipv4         = "0.0.0.0/0"
}

resource "aws_vpc_security_group_egress_rule" "service_database" {
  security_group_id            = aws_security_group.service.id
  ip_protocol                  = "tcp"
  from_port                    = 5432
  to_port                      = 5432
  referenced_security_group_id = aws_security_group.database.id
}

resource "aws_security_group" "database" {
  name_prefix = "${var.name}-db-"
  description = "${var.name} PostgreSQL"
  vpc_id      = var.vpc_id
  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_vpc_security_group_ingress_rule" "database" {
  security_group_id            = aws_security_group.database.id
  ip_protocol                  = "tcp"
  from_port                    = 5432
  to_port                      = 5432
  referenced_security_group_id = aws_security_group.service.id
}
