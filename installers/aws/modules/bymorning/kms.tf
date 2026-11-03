# One customer-managed key for this installation: the database, the bucket, the
# runtime secret, the log groups, and the envelope key that wraps stored
# Credentials (CREDENTIAL_KMS_KEY). The account-root statement is the standard
# delegation that lets IAM policies grant use; nothing can use the key without
# one. CloudWatch Logs is the one service that needs its own statement.
resource "aws_kms_key" "main" {
  description             = "${var.name} ByMorning data key"
  enable_key_rotation     = true
  deletion_window_in_days = 30
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid       = "AccountIAM"
        Effect    = "Allow"
        Principal = { AWS = "arn:${local.partition}:iam::${local.account}:root" }
        Action    = "kms:*"
        Resource  = "*"
      },
      {
        Sid       = "CloudWatchLogs"
        Effect    = "Allow"
        Principal = { Service = "logs.${local.region}.${local.dns_suffix}" }
        Action    = ["kms:Encrypt", "kms:Decrypt", "kms:ReEncrypt*", "kms:GenerateDataKey*", "kms:DescribeKey"]
        Resource  = "*"
        Condition = {
          ArnLike = {
            "kms:EncryptionContext:aws:logs:arn" = [
              "arn:${local.partition}:logs:${local.region}:${local.account}:log-group:/bymorning/${var.name}",
              "arn:${local.partition}:logs:${local.region}:${local.account}:log-group:/aws/rds/instance/${var.name}-db/postgresql",
            ]
          }
        }
      },
    ]
  })
}

resource "aws_kms_alias" "main" {
  name          = "alias/${var.name}"
  target_key_id = aws_kms_key.main.key_id
}
