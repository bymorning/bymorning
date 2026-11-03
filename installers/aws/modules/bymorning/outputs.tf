output "origin" {
  description = "The address people open."
  value       = local.origin
}

output "load_balancer_dns_name" {
  description = "Point hostname at this name (a CNAME, or a Route 53 alias with load_balancer_zone_id)."
  value       = aws_lb.main.dns_name
}

output "load_balancer_zone_id" {
  description = "Hosted zone of the load balancer, for a Route 53 alias record."
  value       = aws_lb.main.zone_id
}

output "log_group" {
  description = "CloudWatch log group of the task, including the one-line startup errors."
  value       = aws_cloudwatch_log_group.gateway.name
}

output "cluster" {
  description = "ECS cluster name."
  value       = aws_ecs_cluster.main.name
}

output "service" {
  description = "ECS service name."
  value       = aws_ecs_service.gateway.name
}

output "storage_bucket" {
  description = "S3 bucket for Project Files and Tool output."
  value       = aws_s3_bucket.storage.id
}

output "database_identifier" {
  description = "RDS instance identifier, for snapshots before an upgrade."
  value       = aws_db_instance.main.identifier
}

output "kms_key_arn" {
  description = "The installation's KMS key. Never schedule it for deletion while the data exists."
  value       = aws_kms_key.main.arn
}

output "setup_token" {
  description = "The Setup token for first sign-in."
  value       = coalesce(var.setup_token, random_password.setup.result)
  sensitive   = true
}

output "fips_endpoints" {
  description = "Whether the task uses FIPS endpoints."
  value       = local.fips
}
