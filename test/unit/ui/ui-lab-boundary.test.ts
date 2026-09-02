import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const uiRoot = fileURLToPath(new URL("../../../src/ui", import.meta.url));

async function sourceFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map((entry) => {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) return sourceFiles(path);
      return path.endsWith(".ts") || path.endsWith(".tsx") ? [path] : [];
    })
  );
  return nested.flat();
}

describe("AI UI lab boundary", () => {
  it("keeps the helper behind the development-only dynamic entry", async () => {
    const main = await readFile(join(uiRoot, "main.tsx"), "utf8");
    const files = await sourceFiles(uiRoot);
    const labDirectory = join(uiRoot, "features", "ui-lab");
    const productionSources = await Promise.all(
      files.filter((path) => dirname(path) !== labDirectory).map((path) => readFile(path, "utf8"))
    );

    expect(main).toContain("import.meta.env.DEV");
    expect(main).toContain('window.location.pathname === "/__ui"');
    expect(main).toContain('window.location.pathname.startsWith("/__ui/")');
    expect(main).toContain('import("./features/ui-lab/agent-ui-lab")');
    expect(productionSources.join("\n")).not.toContain("@shadcn/helpers");
    const labSources = await Promise.all(
      (await sourceFiles(labDirectory)).map((path) => readFile(path, "utf8"))
    );
    expect(labSources.join("\n")).toContain("@shadcn/helpers/ai-sdk");
  });

  it("provides one command for the local lab", async () => {
    const packageJson = JSON.parse(
      await readFile(join(uiRoot, "..", "..", "package.json"), "utf8")
    );
    expect(packageJson.scripts["dev:ui"]).toBe("vite --open /__ui");
  });
});
