import { defineConfig } from "drizzle-kit"

export default defineConfig({
  dialect: "postgresql",
  schema: ["./src/database/schema/*.sql.ts"],
  out: "./src/database/migration",
  dbCredentials: { url: process.env.DATABASE_URL ?? "" },
})
