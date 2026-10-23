import { gateway } from "./server"
import { router } from "./router"

router.route("/auth", gateway.url, {
  readTimeout: "60 seconds",
})
router.route("/api", gateway.url)
router.route("/mcp", gateway.url)
router.route("/system", gateway.url)
router.route("/oauth", gateway.url)
router.route("/.well-known", gateway.url)
router.route("/inference", gateway.url)

export const web = new sst.aws.StaticSite("Web", {
  path: "packages/web",
  build: { command: "bun run build", output: "dist" },
  environment: {
    VITE_GATEWAY_URL: $dev ? gateway.url : router.url,
  },
  router: { instance: router },
})
