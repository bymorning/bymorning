// Runs inside the candidate image on the boot network (test/image-boot.sh) and
// probes the serving Gateway over TLS with certificate verification against the
// throwaway CA. Prints one "<id> ok|fail <detail>" line per check.
//
//   node gateway-probe.mjs <host> <ca.pem>
import { request } from "node:https"
import { readFileSync } from "node:fs"

const [host, caFile] = process.argv.slice(2)
const ca = readFileSync(caFile)
const get = (path, options = {}) =>
  new Promise((resolve) => {
    const req = request({ host, port: 3210, path, ca, servername: host, ...options }, (res) => {
      const chunks = []
      const { protocol, cipher } = { protocol: res.socket.getProtocol(), cipher: res.socket.getCipher().name }
      res.on("data", (chunk) => chunks.push(chunk))
      res.on("end", () =>
        resolve({
          status: res.statusCode,
          headers: res.headers,
          body: Buffer.concat(chunks).toString(),
          protocol,
          cipher,
        }),
      )
    })
    req.setTimeout(20000, () => req.destroy(new Error("timeout")))
    req.on("error", (error) => resolve({ error: error.code ?? error.message }))
    req.end()
  })
const line = (id, ok, detail) => console.log(`${id} ${ok ? "ok" : "fail"} ${detail}`)

// Wait for readiness: the listener answers /system/health with "ok".
let health
for (let attempt = 0; attempt < 120; attempt++) {
  health = await get("/system/health")
  if (health.status === 200) break
  await new Promise((resolve) => setTimeout(resolve, 1000))
}
line(
  "SMK-30",
  health.status === 200 && health.body === "ok",
  `liveness only: HTTPS /system/health (constant "ok", no dependency check) -> ${health.status ?? health.error} ${JSON.stringify(health.body ?? "")} (${health.protocol} ${health.cipher}, certificate verified)`,
)

const modern = await get("/system/health", { minVersion: "TLSv1.3", maxVersion: "TLSv1.3" })
const classic = await get("/system/health", {
  minVersion: "TLSv1.2",
  maxVersion: "TLSv1.2",
  ciphers: "ECDHE-ECDSA-AES128-GCM-SHA256",
})
line(
  "SMK-32",
  modern.status === 200 &&
    /^TLS_AES_(128|256)_GCM/.test(modern.cipher) &&
    classic.status === 200 &&
    classic.protocol === "TLSv1.2",
  `TLS 1.3 ${modern.cipher} and TLS 1.2 ${classic.cipher} served (older versions and ChaCha20 are refused by test/image-security.sh SEC-IMG-08)`,
)

const ui = await get("/")
const missing = []
if (ui.status !== 200 || !String(ui.headers["content-type"]).startsWith("text/html"))
  missing.push(`ui(${ui.status} ${ui.headers?.["content-type"]})`)
if (!/default-src 'self'/.test(String(ui.headers?.["content-security-policy"]))) missing.push("CSP")
if (!/max-age=31536000/.test(String(ui.headers?.["strict-transport-security"]))) missing.push("HSTS")
if (String(ui.headers?.["x-frame-options"]).toUpperCase() !== "DENY") missing.push("X-Frame-Options")
line(
  "SMK-33",
  missing.length === 0,
  missing.length === 0 ? "UI served with CSP, HSTS, X-Frame-Options" : `missing ${missing.join(" ")}`,
)

const method = await get("/auth/method")
line(
  "SMK-34",
  method.status === 200 && /no-store/.test(String(method.headers["cache-control"])),
  `/auth/method -> ${method.status} cache-control=${method.headers?.["cache-control"]}`,
)
