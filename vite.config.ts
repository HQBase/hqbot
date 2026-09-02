import { cloudflare } from "@cloudflare/vite-plugin";
import react from "@vitejs/plugin-react";
import agents from "agents/vite";
import { defineConfig, type Plugin } from "vite";

function lazyChatSdkAbortSignal(): Plugin {
  const eager = "var NEVER_ABORTED_SIGNAL = new AbortController().signal;";
  const lazy = "var NEVER_ABORTED_SIGNAL;";
  const eagerUse = "this.signal = config.signal ?? NEVER_ABORTED_SIGNAL;";
  const lazyUse =
    "this.signal = config.signal ?? (NEVER_ABORTED_SIGNAL ??= new AbortController().signal);";
  return {
    name: "hqbot-lazy-chat-sdk-abort-signal",
    enforce: "pre",
    transform(code, id) {
      if (!id.includes("/chat/dist/") || !code.includes("NEVER_ABORTED_SIGNAL")) return;
      if (!code.includes(eager) || !code.includes(eagerUse)) {
        throw new Error("The Chat SDK abort-signal compatibility patch no longer matches");
      }
      return code.replace(eager, lazy).replace(eagerUse, lazyUse);
    }
  };
}

export default defineConfig({
  plugins: [lazyChatSdkAbortSignal(), agents(), react(), cloudflare()]
});
