import { defineConfig } from "vitest/config";
export default defineConfig({
  resolve: {
    alias: {
      "cloudflare:workers": new URL("./test/support/cloudflare-workers.ts", import.meta.url)
        .pathname
    }
  },
  test: { server: { deps: { inline: true } }, include: ["test/approvals/*.test.ts"] }
});
