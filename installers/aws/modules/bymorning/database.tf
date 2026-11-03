# PostgreSQL 17 on one RDS instance (Multi-AZ optional). TLS 1.3 is required, and
# the Gateway verifies the server against the RDS CA bundle in the image.

resource "random_password" "database" {
  length  = 32
  special = false
}

resource "aws_db_subnet_group" "main" {
  name_prefix = "${var.name}-"
  subnet_ids  = local.database_subnets
}

resource "aws_db_parameter_group" "main" {
  name_prefix = "${var.name}-pg17-"
  family      = "postgres17"
  parameter {
    name         = "rds.force_ssl"
    value        = "1"
    apply_method = "pending-reboot"
  }
  parameter {
    name         = "ssl_min_protocol_version"
    value        = "TLSv1.3"
    apply_method = "pending-reboot"
  }
  parameter {
    name  = "password_encryption"
    value = "scram-sha-256"
  }
  lifecycle {
    create_before_destroy = true
  }
}

# PostgreSQL's own log, exported to CloudWatch under the installation's key.
resource "aws_cloudwatch_log_group" "database" {
  name              = "/aws/rds/instance/${var.name}-db/postgresql"
  retention_in_days = var.log_retention_days
  kms_key_id        = aws_kms_key.main.arn
}

resource "aws_db_instance" "main" {
  identifier                = "${var.name}-db"
  engine                    = "postgres"
  engine_version            = "17"
  instance_class            = var.database.instance_class
  allocated_storage         = var.database.allocated_storage
  max_allocated_storage     = var.database.max_allocated_storage
  storage_type              = "gp3"
  storage_encrypted         = true
  kms_key_id                = aws_kms_key.main.arn
  db_name                   = "bymorning"
  username                  = "bymorning"
  password                  = random_password.database.result
  port                      = 5432
  db_subnet_group_name      = aws_db_subnet_group.main.name
  parameter_group_name      = aws_db_parameter_group.main.name
  vpc_security_group_ids    = [aws_security_group.database.id]
  publicly_accessible       = false
  multi_az                  = var.database.multi_az
  backup_retention_period   = var.database.backup_retention_days
  copy_tags_to_snapshot     = true
  deletion_protection       = var.database.deletion_protection
  skip_final_snapshot       = false
  final_snapshot_identifier = "${var.name}-db-final"
  # Minor versions are applied in the maintenance window.
  auto_minor_version_upgrade      = true
  enabled_cloudwatch_logs_exports = ["postgresql"]
  depends_on                      = [aws_cloudwatch_log_group.database]
}
