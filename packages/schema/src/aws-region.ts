import { Schema } from "effect"

/** AWS partitions an Installation may run in. Region syntax decides the partition. */
export const AwsPartition = Schema.Literals(["aws", "aws-us-gov"]).annotate({ identifier: "AwsPartition" })
export type AwsPartition = typeof AwsPartition.Type

/**
 * Region code in the commercial (`aws`) or GovCloud (`aws-us-gov`) partition;
 * AWS determines service availability. China and ISO partitions are rejected.
 */
export const AwsRegion = Schema.String.check(
  Schema.isPattern(/^(?!cn-|us-iso)[a-z]{2}(?:-[a-z]+)+-[1-9][0-9]*$/),
).pipe(Schema.brand("AwsRegion"))

/** Commercial or GovCloud AWS region used for endpoint construction and signing. */
export type AwsRegion = typeof AwsRegion.Type

/** Partition a region belongs to. */
export const partitionOf = (region: AwsRegion): AwsPartition => (region.startsWith("us-gov-") ? "aws-us-gov" : "aws")
