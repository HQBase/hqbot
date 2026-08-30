import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { deploy } from "../../scripts/deploy.mjs";

const reportedSha = "ABCDEF0123456789ABCDEF0123456789ABCDEF01";
const gitSha = reportedSha.toLowerCase();
const setupToken = "setup-token-from-environment-0123456789";
const deployArgs = [
  "deploy",
  "--keep-vars",
  "--tag",
  gitSha,
  "--message",
  `Deploy HQBot from Git ${gitSha}`
];

function gitCapture(status = "") {
  return vi.fn((command, args) => {
    expect(command).toBe("git");
    if (args[0] === "rev-parse") return `${reportedSha}\n`;
    if (args[0] === "status") return status;
    throw new Error(`Unexpected Git command: ${args.join(" ")}`);
  });
}

function operations(secretResult, runWrangler = vi.fn(), status = "") {
  return {
    attemptWrangler: vi.fn(() => secretResult),
    build: vi.fn(),
    capture: gitCapture(status),
    environment: {},
    runWrangler
  };
}

describe("HQBot deployment", () => {
  let stdoutWrite;

  beforeEach(() => {
    stdoutWrite = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("declares the decorator transform used by the direct release build", () => {
    const packageJson = JSON.parse(
      readFileSync(new URL("../../package.json", import.meta.url), "utf8")
    );

    expect(packageJson.devDependencies["@babel/plugin-proposal-decorators"]).toBe("8.0.2");
  });

  it("rejects a dirty tree before building or contacting Cloudflare", () => {
    const runtime = operations(
      { status: 0, stdout: "[]", stderr: "" },
      vi.fn(),
      " M scripts/deploy.mjs\n"
    );

    expect(() => deploy(runtime)).toThrow("Refusing to deploy a dirty Git tree");
    expect(runtime.build).not.toHaveBeenCalled();
    expect(runtime.attemptWrangler).not.toHaveBeenCalled();
    expect(runtime.runWrangler).not.toHaveBeenCalled();
  });

  it("preserves existing secrets and tags the exact clean commit", () => {
    const runtime = operations({
      status: 0,
      stdout: JSON.stringify([
        { name: "HQBOT_CONNECTION_KEY", type: "secret_text" },
        { name: "HQBOT_SETUP_TOKEN", type: "secret_text" }
      ]),
      stderr: ""
    });

    deploy(runtime);

    expect(runtime.build).toHaveBeenCalledOnce();
    expect(runtime.attemptWrangler).toHaveBeenCalledWith(["secret", "list", "--format", "json"]);
    expect(runtime.runWrangler).toHaveBeenCalledOnce();
    expect(runtime.runWrangler).toHaveBeenCalledWith(deployArgs);
  });

  it("creates restricted first-install secrets and removes their temporary directory", () => {
    let secretDirectory;
    const runWrangler = vi.fn((args) => {
      const secretArgument = args.indexOf("--secrets-file");
      expect(secretArgument).toBe(deployArgs.length);
      expect(args.slice(0, secretArgument)).toEqual(deployArgs);

      const secretFile = args[secretArgument + 1];
      secretDirectory = dirname(secretFile);
      expect(existsSync(secretFile)).toBe(true);
      const secret = JSON.parse(readFileSync(secretFile, "utf8"));
      expect(secret).toEqual({
        HQBOT_CONNECTION_KEY: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/),
        HQBOT_SETUP_TOKEN: setupToken
      });
      expect(stdoutWrite.mock.calls.flat().join(" ")).not.toContain(secret.HQBOT_CONNECTION_KEY);
      expect(stdoutWrite.mock.calls.flat().join(" ")).not.toContain(setupToken);

      if (process.platform !== "win32") {
        expect(statSync(secretDirectory).mode & 0o777).toBe(0o700);
        expect(statSync(secretFile).mode & 0o777).toBe(0o600);
      }
    });
    const runtime = operations(
      {
        status: 1,
        stdout: "",
        stderr: 'Worker "hqbot" not found.\n'
      },
      runWrangler
    );
    runtime.environment = { HQBOT_SETUP_TOKEN: setupToken };

    deploy(runtime);

    expect(runWrangler).toHaveBeenCalledOnce();
    expect(secretDirectory).toBeDefined();
    expect(existsSync(secretDirectory)).toBe(false);
  });

  it("removes first-install secret storage when deployment fails", () => {
    let secretDirectory;
    const failure = new Error("Cloudflare deployment failed");
    const runWrangler = vi.fn((args) => {
      const secretFile = args[args.indexOf("--secrets-file") + 1];
      secretDirectory = dirname(secretFile);
      expect(existsSync(secretFile)).toBe(true);
      throw failure;
    });
    const runtime = operations({ status: 0, stdout: "[]", stderr: "" }, runWrangler);
    runtime.environment = { HQBOT_SETUP_TOKEN: setupToken };

    expect(() => deploy(runtime)).toThrow(failure);
    expect(secretDirectory).toBeDefined();
    expect(existsSync(secretDirectory)).toBe(false);
  });

  it("fails without exposing or inventing a missing setup token", () => {
    const runtime = operations({
      status: 0,
      stdout: JSON.stringify([{ name: "HQBOT_CONNECTION_KEY", type: "secret_text" }]),
      stderr: ""
    });

    expect(() => deploy(runtime)).toThrow("Set HQBOT_SETUP_TOKEN before the first deployment");
    expect(runtime.runWrangler).not.toHaveBeenCalled();
    expect(stdoutWrite.mock.calls.flat().join(" ")).not.toContain(setupToken);
  });

  it.each([
    ["short", "s".repeat(23)],
    ["long", "l".repeat(257)]
  ])("rejects a %s first-install setup token", (_label, invalidToken) => {
    const runtime = operations({ status: 0, stdout: "[]", stderr: "" });
    runtime.environment = { HQBOT_SETUP_TOKEN: invalidToken };

    expect(() => deploy(runtime)).toThrow("HQBOT_SETUP_TOKEN must contain 24 to 256 characters");
    expect(runtime.runWrangler).not.toHaveBeenCalled();
    expect(stdoutWrite.mock.calls.flat().join(" ")).not.toContain(invalidToken);
  });

  it.each([24, 256])("accepts a %i-character first-install setup token", (length) => {
    const runWrangler = vi.fn();
    const runtime = operations({ status: 0, stdout: "[]", stderr: "" }, runWrangler);
    runtime.environment = { HQBOT_SETUP_TOKEN: "s".repeat(length) };

    deploy(runtime);

    expect(runWrangler).toHaveBeenCalledOnce();
  });
});
