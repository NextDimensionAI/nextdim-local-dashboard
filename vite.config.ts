import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { callMedia } from "./server/callMedia";

const CONFIGURATOR_URL = "http://localhost:9100";

// The configurator's own .env holds the key; read it here so the browser never handles it.
function configuratorApiKey(): string {
  const env = readFileSync(resolve(__dirname, "../nextdim-ai/.env"), "utf8");
  const keys = env
    .split("\n")
    .filter((line) => line.startsWith("CONFIGURATOR_API_KEY="))
    .map((line) => line.slice("CONFIGURATOR_API_KEY=".length).trim().replace(/^["']|["']$/g, ""));
  const key = keys.at(-1);
  if (!key) throw new Error("CONFIGURATOR_API_KEY missing from nextdim-ai/.env");
  return key;
}

const apiKey = configuratorApiKey();

export default defineConfig({
  plugins: [react(), callMedia(CONFIGURATOR_URL, apiKey)],
  server: {
    proxy: {
      "/api": {
        target: CONFIGURATOR_URL,
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ""),
        headers: { "X-API-Key": apiKey },
      },
    },
  },
});
