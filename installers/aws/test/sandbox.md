# Sandbox test for a release

The installer's offline checks (`sh installers/aws/test.sh`) prove what it asks AWS for, not that AWS accepts it. Run
this in a sandbox account before each release that changes the installer, and attach the results to the release PR.
Run it in commercial AWS and, when possible, in AWS GovCloud.

## Set up

- A VPC with two private subnets (NAT gateway) and two subnets for the load balancer.
- An ACM certificate for a test hostname, and a way to resolve that hostname to the load balancer (a Route 53 record,
  or `/etc/hosts` on the test machine pointing at one of the load balancer's addresses).
- The release candidate image by digest: the full-gate `release` artifact pushed to a test ECR repository with
  `crane push`, or a published `ghcr.io` digest.

## Checks

| #   | Check                                                                                    | Expect                                                   |
| --- | ---------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| 1   | `terraform apply` from `environments/example` with the candidate image                   | Completes; the service reaches a steady state            |
| 2   | `curl -fsS <origin>/system/health`                                                       | `ok`                                                     |
| 3   | The task log (`log_group` output) has `Host resolved` with `storage=s3 cipher=<key ARN>` | `fips=true` in GovCloud and US commercial Regions        |
| 4   | Setup with `terraform output -raw setup_token` and a test OIDC provider; sign in         | Lands in the Default Workspace as Installation Admin     |
| 5   | Upload a Project File, then download it                                                  | Same bytes; the object in S3 shows SSE-KMS with the key  |
| 6   | Add a Credential (for example an Integration API key), restart the service, use it       | Still readable after restart                             |
| 7   | With `bedrock_model_arns` set and model access enabled, start a Session                  | The model answers                                        |
| 8   | With `code_interpreter = true`, ask the assistant to run Python that fetches a URL       | Code runs; the network fetch fails                       |
| 9   | Set a new image digest and apply                                                         | Old task stops, new task becomes healthy, data is intact |
| 10  | `deletion_protection = false`, apply, empty the bucket, `terraform destroy`              | Completes; a final snapshot remains                      |

Record the account partition, Region, Terraform and provider versions, the image digest, and the outcome of each
check.
