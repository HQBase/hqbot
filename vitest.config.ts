import { defineConfig } from "vitest/config";

export default defineConfig({
  define: {
    "process.env.NODE_ENV": JSON.stringify("development")
  },
  test: {
    environment: "node",
    include: [
      "test/*.test.ts",
      "test/unit/**/*.test.{ts,tsx,mjs}",
      "test/runtime/**/*.test.ts",
      "test/quality/**/*.test.ts"
    ],
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary"],
      reportsDirectory: "coverage",
      include: ["src/**/*.{ts,tsx}"],
      exclude: [
        "src/agent.ts",
        "src/teammate.ts",
        "src/http/**",
        "src/runtime/browser.ts",
        "src/ui/components/ui/**",
        "src/ui/features/ui-lab/**",
        "src/ui/main.tsx",
        "src/workspace/agent-base.ts",
        "src/workspace/mail-realtime.ts",
        "src/worker.ts"
      ],
      thresholds: {
        branches: 30,
        functions: 30,
        lines: 35,
        statements: 34
      }
    }
  }
});
