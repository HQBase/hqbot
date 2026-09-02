import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const architectureScript = fileURLToPath(
  new URL("../../scripts/check-architecture.mjs", import.meta.url)
);
const fixtures: string[] = [];

afterEach(async () => {
  await Promise.all(
    fixtures.splice(0).map((fixture) => rm(fixture, { force: true, recursive: true }))
  );
});

describe("architecture check", () => {
  it("warns at 301 lines and fails at 401 lines", async () => {
    const reviewFixture = await fixture({ "src/review.ts": lines(301) });
    const review = runArchitectureCheck(reviewFixture);
    expect(review.status).toBe(0);
    expect(review.stderr).toContain("301 lines should be reviewed for splitting");

    const failureFixture = await fixture({ "src/too-large.ts": lines(401) });
    const failure = runArchitectureCheck(failureFixture);
    expect(failure.status).toBe(1);
    expect(failure.stderr).toContain("401 lines exceeds the 400-line limit");
  });

  it("keeps frontend and runtime imports separate", async () => {
    const root = await fixture({
      "src/ui/chat.tsx": 'import "../services/mail";\n',
      "src/worker.ts": 'import "./ui/chat";\n'
    });
    const result = runArchitectureCheck(root);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("frontend code must not import runtime modules");
    expect(result.stderr).toContain("runtime code must not import frontend modules");
  });

  it("rejects Node built-ins from product code", async () => {
    const root = await fixture({ "src/domain/id.ts": 'import "node:crypto";\n' });
    const result = runArchitectureCheck(root);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("product code must prefer Web Platform APIs");
  });
});

async function fixture(files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "hqbot-architecture-"));
  fixtures.push(root);
  for (const [relativePath, contents] of Object.entries(files)) {
    const file = path.join(root, relativePath);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, contents);
  }
  return root;
}

function lines(count: number): string {
  return Array.from({ length: count }, (_, index) => `export const line${index} = ${index};`).join(
    "\n"
  );
}

function runArchitectureCheck(cwd: string) {
  return spawnSync(process.execPath, [architectureScript], {
    cwd,
    encoding: "utf8"
  });
}
