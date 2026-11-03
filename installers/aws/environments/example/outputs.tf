output "origin" {
  value = module.bymorning.origin
}

output "load_balancer_dns_name" {
  value = module.bymorning.load_balancer_dns_name
}

output "load_balancer_zone_id" {
  value = module.bymorning.load_balancer_zone_id
}

output "log_group" {
  value = module.bymorning.log_group
}

output "cluster" {
  value = module.bymorning.cluster
}

output "service" {
  value = module.bymorning.service
}

output "database_identifier" {
  value = module.bymorning.database_identifier
}

output "setup_token" {
  value     = module.bymorning.setup_token
  sensitive = true
}

output "fips_endpoints" {
  value = module.bymorning.fips_endpoints
}
