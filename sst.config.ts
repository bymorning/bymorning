export default $config({
  app(input) {
    return {
      name: "bymorning",
      removal: input?.stage === "production" ? "remove" : "remove",
      home: "aws",
      providers: {
        aws: {
          region: "us-east-1",
          // Set SST_AWS_PROFILE to use a named AWS profile; otherwise the default credential chain applies.
          ...(process.env.SST_AWS_PROFILE === undefined ? {} : { profile: process.env.SST_AWS_PROFILE }),
        },
      },
    }
  },
  async run() {
    const gateway = await import("./infra/server")
    const web = await import("./infra/web")

    return {
      Gateway: gateway.gateway.url,
      Web: web.web.url,
    }
  },
})
