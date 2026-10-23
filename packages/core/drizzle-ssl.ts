export const ssl = (host: string) =>
  host === "localhost" || host === "127.0.0.1" ? false : { rejectUnauthorized: false as const }
