import { releaseImage, releaseImageFor } from "./image"
import { router } from "./router"

const AUTH_ISSUER = new sst.Secret("AUTH_ISSUER")
const AUTH_CLIENT_ID = new sst.Secret("AUTH_CLIENT_ID")
const AUTH_CLIENT_SECRET = new sst.Secret("AUTH_CLIENT_SECRET")
const AUTH_PROVIDER = new sst.Secret("AUTH_PROVIDER")
const AUTH_EMAIL_DOMAINS = new sst.Secret("AUTH_EMAIL_DOMAINS")
const WEB_COOKIE_KEY = new sst.Secret("WEB_COOKIE_KEY")

const vpc = new sst.aws.Vpc("Vpc", {
  bastion: $app.stage === "production",
  nat: $app.stage === "production" ? "ec2" : undefined,
})
const caller = aws.getCallerIdentityOutput()
const partition = aws.getPartitionOutput()
const region = aws.getRegionOutput()
const codeInterpreterExecutionRole = new aws.iam.Role("CodeInterpreterExecutionRole", {
  assumeRolePolicy: aws.iam.getPolicyDocumentOutput({
    statements: [
      {
        effect: "Allow",
        actions: ["sts:AssumeRole"],
        principals: [{ type: "Service", identifiers: ["bedrock-agentcore.amazonaws.com"] }],
        conditions: [
          { test: "StringEquals", variable: "aws:SourceAccount", values: [caller.accountId] },
          {
            test: "ArnLike",
            variable: "aws:SourceArn",
            values: [$interpolate`arn:${partition.partition}:bedrock-agentcore:${region.name}:${caller.accountId}:*`],
          },
        ],
      },
    ],
  }).json,
})
const codeInterpreterSecurityGroup = new aws.ec2.SecurityGroup("CodeInterpreterSecurityGroup", {
  vpcId: vpc.id,
  description: "AgentCore Code Interpreter with no outbound access",
  egress: [],
})
const codeInterpreterResource = new aws.bedrock.AgentcoreCodeInterpreter("CodeInterpreterResource", {
  name: `bymorning_${$app.stage.replace(/[^a-zA-Z0-9_]/g, "_").slice(0, 38)}`,
  description: "Isolated shell execution",
  executionRoleArn: codeInterpreterExecutionRole.arn,
  networkConfiguration: {
    networkMode: "VPC",
    vpcConfig: {
      subnets: vpc.privateSubnets,
      securityGroups: [codeInterpreterSecurityGroup.id],
    },
  },
})
const codeInterpreter = new sst.Linkable("CodeInterpreter", {
  properties: {
    id: codeInterpreterResource.codeInterpreterId,
    arn: codeInterpreterResource.codeInterpreterArn,
  },
  include: [
    sst.aws.permission({
      actions: [
        "bedrock-agentcore:StartCodeInterpreterSession",
        "bedrock-agentcore:InvokeCodeInterpreter",
        "bedrock-agentcore:GetCodeInterpreterSession",
        "bedrock-agentcore:StopCodeInterpreterSession",
      ],
      resources: [codeInterpreterResource.codeInterpreterArn],
    }),
  ],
})

const database = new sst.aws.Aurora("Database", {
  engine: "postgres",
  vpc,
  scaling: {
    min: $app.stage === "production" ? "4 ACU" : "1 ACU",
  },

  dev: {
    username: "bymorning",
    password: "bymorning",
    database: "bymorning",
    port: 5432,
  },
})
// Credential-at-rest envelope encryption: one symmetric CMK per stage. The
// Gateway task may wrap and unwrap data keys on it (CREDENTIAL_KMS_KEY).
const cipher = new aws.kms.Key("CipherKey", {
  description: "ByMorning credential envelope encryption",
  enableKeyRotation: true,
})
const storage = new sst.aws.Bucket("Storage", {
  lifecycle: [{ id: "expire-tool-output", prefix: "tool-output/", expiresIn: "7 days" }],
})
const databaseURL = $dev
  ? $interpolate`postgresql://${database.username}:${database.password}@${database.host}:${database.port}/${database.database}`
  : $interpolate`postgresql://${database.username}:${database.password}@${database.host}:${database.port}/${database.database}?sslmode=no-verify`

const cluster = new sst.aws.Cluster("Cluster", { vpc })
const _studio = new sst.x.DevCommand("Studio", {
  link: [database],
  environment: { DATABASE_URL: databaseURL },
  dev: {
    command: "bun db studio",
    directory: "packages/core",
    autostart: true,
  },
})
const _migrate = new sst.x.DevCommand("Migrate", {
  link: [database],
  environment: { DATABASE_URL: databaseURL },
  dev: {
    command: "bun db migrate",
    directory: "packages/core",
    autostart: false,
  },
})

const databaseMigrator = !$dev
  ? new sst.aws.Function("DatabaseMigrator", {
      handler: "packages/server/src/migrator.handler",
      runtime: "nodejs22.x",
      timeout: "15 minutes",
      vpc,
      environment: { DATABASE_URL: databaseURL },
      copyFiles: [{ from: "packages/core/src/database/migration", to: "migration" }],
      // Only the binary build provides this module; Lambda uses the copied migration folder.
      nodejs: { esbuild: { external: ["virtual:bymorning-assets"] } },
    })
  : undefined
const databaseMigration = databaseMigrator
  ? new aws.lambda.Invocation("DatabaseMigration", {
      functionName: databaseMigrator.name,
      input: JSON.stringify({}),
      triggers: { migrationBundle: databaseMigrator.nodes.function.codeSha256 },
    })
  : undefined

// Optional tested release image (digest only); unset builds the root Dockerfile from source.
const prebuiltImage = releaseImage(process.env.BYMORNING_IMAGE)

export const gateway = new sst.aws.Service("Gateway", {
  wait: true,
  cluster,
  // Callback state is process-local. max=1 avoids steady-state overlap, but deploys/restarts invalidate pending OAuth;
  // drain requests and avoid old/new task overlap. Shared callback storage is required before raising max.
  scaling: { min: 1, max: 1 },
  permissions: [
    {
      actions: ["bedrock:InvokeModel", "bedrock:InvokeModelWithResponseStream", "bedrock-mantle:CreateInference"],
      resources: ["*"],
    },
    { actions: ["kms:GenerateDataKey", "kms:Decrypt"], resources: [cipher.arn] },
  ],
  environment: {
    PORT: "3210",
    DATABASE_URL: databaseURL,
    APP_ORIGIN: $dev ? "http://localhost:3000" : router.url,
    // The single image is bound to AWS by the two selectors; it refuses to
    // start without them. The image no longer bakes the FIPS flag.
    STORAGE_PROVIDER: "s3",
    STORAGE_BUCKET: storage.name,
    CIPHER_BACKEND: "kms",
    AWS_USE_FIPS_ENDPOINT: "true",
    // The image ships the document at /app; `sst dev` runs from the source
    // tree, where the host resolves the same default beside the entry.
    ...($dev ? {} : { BYMORNING_CONFIG: "/app/bymorning.jsonc" }),
    CODE_INTERPRETER_ID: codeInterpreterResource.codeInterpreterId,
    AWS_REGION: region.name,
    CREDENTIAL_KMS_KEY: cipher.arn,
    AUTH_ISSUER: AUTH_ISSUER.value,
    AUTH_CLIENT_ID: AUTH_CLIENT_ID.value,
    AUTH_CLIENT_SECRET: AUTH_CLIENT_SECRET.value,
    AUTH_PROVIDER: AUTH_PROVIDER.value,
    AUTH_EMAIL_DOMAINS: AUTH_EMAIL_DOMAINS.value,
    WEB_COOKIE_KEY: WEB_COOKIE_KEY.value,
  },
  image: prebuiltImage
    ? caller.accountId.apply((accountID) => releaseImageFor(prebuiltImage, accountID))
    : {
        context: ".",
        dockerfile: "Dockerfile",
      },
  dev: {
    directory: "app/host",
    command: "bunx tsx src/index.ts",
    url: "http://127.0.0.1:3210",
  },
  link: [
    AUTH_ISSUER,
    AUTH_CLIENT_ID,
    AUTH_CLIENT_SECRET,
    AUTH_PROVIDER,
    AUTH_EMAIL_DOMAINS,
    WEB_COOKIE_KEY,
    storage,
    codeInterpreter,
  ],
  loadBalancer: {
    ports: [{ listen: "80/http", forward: "3210/http" }],
    health: { "3210/http": { path: "/system/health" } },
  },
  transform: {
    // Block the rolling ECS update until the packaged migrations complete.
    service: (_args, options) => {
      if (databaseMigration) options.dependsOn = databaseMigration
    },
  },
})
