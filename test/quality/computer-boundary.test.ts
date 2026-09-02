import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = fileURLToPath(new URL("../..", import.meta.url));

async function productSources(directory = path.join(root, "src")): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) return productSources(file);
      return /\.(?:ts|tsx)$/u.test(entry.name) ? [file] : [];
    })
  );
  return nested.flat();
}

describe("unified Linux computer boundary", () => {
  it("has no Browser Run binding or runtime", async () => {
    const files = [
      path.join(root, "package.json"),
      path.join(root, "wrangler.jsonc"),
      path.join(root, "test/integration/worker/wrangler.test.jsonc")
    ];
    const configuration = (await Promise.all(files.map((file) => readFile(file, "utf8")))).join(
      "\n"
    );
    expect(configuration).not.toMatch(/\bBROWSER\b/u);

    expect(existsSync(path.join(root, "src/runtime/browser.ts"))).toBe(false);
    expect(existsSync(path.join(root, "src/runtime/browser-direct.ts"))).toBe(false);
    expect(existsSync(path.join(root, "src/runtime/browser-meter.ts"))).toBe(false);

    const source = (
      await Promise.all((await productSources()).map((file) => readFile(file, "utf8")))
    ).join("\n");
    expect(source).not.toContain("@cloudflare/think/tools/browser");
    expect(source).not.toContain('from "agents/browser"');
    expect(source).not.toContain("/live-view");

    const productCopy = (
      await Promise.all(
        ["README.md", "SECURITY.md", "docs/architecture.md", "docs/shared-computer.md"].map(
          (file) => readFile(path.join(root, file), "utf8")
        )
      )
    ).join("\n");
    expect(productCopy).not.toContain("Cloudflare Browser Run");
    expect(productCopy).not.toContain("Live View");
  });

  it("creates every teammate computer through one Sandbox factory", async () => {
    const sources = await productSources();
    const factories: string[] = [];
    for (const file of sources) {
      if ((await readFile(file, "utf8")).includes("getSandbox(")) factories.push(file);
    }

    expect(factories).toHaveLength(1);
  });
});
