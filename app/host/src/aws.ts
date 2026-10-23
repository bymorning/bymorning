/**
 * AWS selections: `STORAGE_PROVIDER=s3` and `CIPHER_BACKEND=kms`. Both read
 * `AWS_REGION` (the Region of the bucket and the key). The SDK resolves
 * credentials from the task role and honors AWS_USE_FIPS_ENDPOINT, which
 * `Host.resolve` validates for every selection (a GovCloud Region without it is
 * refused there).
 */
import { kms as kmsBackend } from "@bymorning/backend-aws/kms"
import { s3 as s3Provider } from "@bymorning/backend-aws/s3"
import { Config, Effect, Schema } from "effect"
import { Host } from "./host.js"

const region = Config.schema(Schema.NonEmptyString, "AWS_REGION")

/** S3 storage on STORAGE_BUCKET in AWS_REGION. */
export const s3: Host.StorageFactory = Effect.gen(function* () {
  const bucket = yield* Config.schema(Schema.NonEmptyString, "STORAGE_BUCKET")
  const selected = yield* region
  return s3Provider({ bucket, config: { region: selected } })
})

/**
 * A full KMS key ARN: the commercial or GovCloud partition, a Region, a
 * 12-digit account, and a key id (not an alias). Every shipped installer passes
 * `aws_kms_key.<name>.arn`, which has exactly this shape.
 */
const keyARN = /^arn:(aws|aws-us-gov):kms:([a-z0-9-]+):\d{12}:key\/[0-9a-f-]{36}$/

/**
 * KMS cipher backend over the symmetric CMK named by CREDENTIAL_KMS_KEY. The
 * task role may GenerateDataKey/Decrypt on it; the ARN's Region must equal
 * AWS_REGION so the client and the key agree on the endpoint, and its partition
 * must be the Region's (`aws-us-gov` exactly for `us-gov-*`). The ARN is the
 * envelope key identity, so it is stored verbatim, as 1.1.0 stored it.
 */
export const kms: Host.CipherFactory = Effect.gen(function* () {
  const arn = yield* Config.schema(Schema.NonEmptyString, "CREDENTIAL_KMS_KEY")
  const selected = yield* region
  const match = keyARN.exec(arn)
  if (match === null)
    return yield* new Host.ConfigError({
      setting: "CREDENTIAL_KMS_KEY",
      reason: "must be a KMS key ARN (arn:<partition>:kms:<region>:<account>:key/<key-id>)",
    })
  const [, partition, keyRegion] = match
  if (keyRegion !== selected)
    return yield* new Host.ConfigError({ setting: "CREDENTIAL_KMS_KEY", reason: "ARN Region must equal AWS_REGION" })
  if ((partition === "aws-us-gov") !== selected.startsWith("us-gov-"))
    return yield* new Host.ConfigError({
      setting: "CREDENTIAL_KMS_KEY",
      reason: "ARN partition must be aws-us-gov exactly when AWS_REGION is us-gov-*",
    })
  return yield* kmsBackend({ arn, region: selected })
})
