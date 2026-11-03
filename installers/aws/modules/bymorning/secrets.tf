# Generated secrets reach the task as ECS container secrets from one Secrets
# Manager secret, never as plain environment. They are also in Terraform state:
# keep the state backend private and encrypted.

resource "random_bytes" "cookie" {
  length = 32
}

# The Setup token registers the first identity provider. The task has no shell
# access, so the module supplies it rather than leaving it in a file inside the task.
resource "random_password" "setup" {
  length  = 48
  special = false
}

# The load balancer -> task hop is TLS. The load balancer does not validate
# target certificates, so a self-signed one is enough; renewal rolls the task.
resource "tls_private_key" "listener" {
  algorithm   = "ECDSA"
  ecdsa_curve = "P256"
}

resource "tls_self_signed_cert" "listener" {
  private_key_pem = tls_private_key.listener.private_key_pem
  subject {
    common_name = var.hostname
  }
  dns_names             = [var.hostname]
  validity_period_hours = 8760
  early_renewal_hours   = 720
  allowed_uses          = ["digital_signature", "server_auth"]
}

locals {
  # WEB_COOKIE_KEY: 32 random bytes, unpadded base64url.
  cookie_key = trimsuffix(replace(replace(random_bytes.cookie.base64, "+", "-"), "/", "_"), "=")
  # verify-full against the AWS RDS CA bundle baked into the image (commercial and GovCloud roots).
  database_url = "postgresql://bymorning:${random_password.database.result}@${aws_db_instance.main.address}:5432/bymorning?sslmode=verify-full&sslrootcert=/app/certs/rds-global-bundle.pem"
}

resource "aws_secretsmanager_secret" "runtime" {
  name_prefix             = "${var.name}-runtime-"
  description             = "${var.name} ByMorning runtime secrets"
  kms_key_id              = aws_kms_key.main.arn
  recovery_window_in_days = 7
}

resource "aws_secretsmanager_secret_version" "runtime" {
  secret_id = aws_secretsmanager_secret.runtime.id
  secret_string = jsonencode({
    DATABASE_URL   = local.database_url
    WEB_COOKIE_KEY = local.cookie_key
    TLS_KEY        = tls_private_key.listener.private_key_pem
    SETUP_TOKEN    = coalesce(var.setup_token, random_password.setup.result)
  })
}
