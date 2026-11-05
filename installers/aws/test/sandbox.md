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

## Results

Run 1 on 2026-11-04 in a commercial AWS account (us-east-2, a default VPC with no NAT gateway, so
`assign_public_ip = true`), with the signed 1.3.1 release image mirrored into ECR by digest, a self-signed ACM
certificate, and a small test OIDC provider (Amazon Cognito cannot be used: its login page is on a different origin
than its issuer, which the Gateway refuses). AWS GovCloud was not tested.

| #   | Result  | Notes                                                                                                                                                                                                        |
| --- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | Pass    | The apply took 26 minutes, almost all of it RDS. The service reached a steady state.                                                                                                                         |
| 2   | Pass    | `/system/health` returned `ok` through the load balancer, and port 80 redirected to 443.                                                                                                                     |
| 3   | Pass    | `Host resolved` showed `storage=s3`, the KMS key ARN, and `fips=true`.                                                                                                                                       |
| 4   | Pass    | The generated Setup token was accepted, the test provider registered, and a browser sign-in landed in the Default Workspace.                                                                                 |
| 5   | Pass    | A Project File round-tripped byte for byte. The S3 object was SSE-KMS under the installation key with the bucket key on, and the bucket policy denied non-TLS requests.                                      |
| 6   | Pass    | A stored credential, the session, and the file all survived a forced task replacement. A listing proves the record, not decryption on use: the test key was fake.                                            |
| 7   | Blocked | Bedrock was reached through the task role and the allowed ARNs, but the account has no token quota for Haiku 4.5 and no access to Haiku 5.5. Retry in an account with Bedrock model access.                  |
| 8   | Partial | Run against the interpreter directly, because there was no working model. Code ran, and outbound HTTPS, TCP, and VPC addresses timed out. DNS names still resolve, and the microVM metadata service answers. |
| 9   | Pass    | An in-place apply (new task definition, a task-role policy change) ran `migrate` to exit 0, replaced the task, and left the data intact.                                                                     |
| 10  | Partial | The load balancer, task, database, bucket, and key were removed. The Code Interpreter's security group stayed because AgentCore held its network interfaces for more than 40 minutes.                        |

Findings fixed from this run: the example environment now passes `assign_public_ip` through, the README gives the real
database creation and destroy times, and the security review package states that the sandbox resolves DNS names and
that its metadata service answers (§2.9).
