import { defineConfig } from "blume"

export default defineConfig({
  title: "ByMorning",
  description: "Operate your ByMorning Workspace, Sessions, Projects, integrations, and AI infrastructure.",
  logo: {
    image: "/wordmark.svg",
    text: "",
  },
  content: {
    root: "./src/",
  },
  theme: {
    accent: {
      light: "#b94716",
      dark: "#ff9b66",
    },
    background: {
      light: "#fffdfa",
      dark: "#171411",
    },
    fonts: {
      body: "inter",
      display: "inter-tight",
      mono: "ibm-plex-mono",
    },
    mode: "system",
    radius: "sm",
  },
  navigation: {
    tabs: [
      { label: "Docs", path: "/" },
      { label: "Configure", path: "/configure" },
      { label: "API", path: "/api" },
    ],
  },
  openapi: {
    enabled: true,
    route: "/api",
    spec: "../protocol/openapi.json",
    codeSamples: ["curl", "js", "python"],
  },
})
