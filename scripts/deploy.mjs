import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const wranglerLog = resolve(root, ".wrangler", "wrangler.log");
const connectionSecret = "HQBOT_CONNECTION_KEY";
const setupSecret = "HQBOT_SETUP_TOKEN";
const trustedWindowsAccounts = new Set(["SY", "S-1-5-18", "BA", "S-1-5-32-544"]);

export function deploy(overrides = {}) {
  const operations = {
    attemptWrangler,
    build,
    capture,
    environment: process.env,
    runWrangler,
    ...overrides
  };
  const gitSha = currentGitSha(operations.capture);
  assertCleanGitTree(operations.capture);

  process.stdout.write(`Building HQBot from Git ${gitSha.slice(0, 12)}.\n`);
  operations.build();

  const secrets = remoteSecretNames(operations.attemptWrangler);
  const secretsToUpload = missingSecretValues(secrets, operations.environment);
  const deployArgs = [
    "deploy",
    "--keep-vars",
    "--tag",
    gitSha,
    "--message",
    `Deploy HQBot from Git ${gitSha}`
  ];

  process.stdout.write(`Deploying HQBot from Git ${gitSha.slice(0, 12)}.\n`);
  if (Object.keys(secretsToUpload).length === 0) {
    operations.runWrangler(deployArgs);
    process.stdout.write(`HQBot deploy ${gitSha.slice(0, 12)} is complete.\n`);
    return;
  }

  const secretDirectory = createRestrictedDirectory("hqbot-secrets-");
  const secretFile = resolve(secretDirectory, "secrets.json");
  try {
    writeFileSync(secretFile, `${JSON.stringify(secretsToUpload)}\n`, { mode: 0o600 });
    operations.runWrangler([...deployArgs, "--secrets-file", secretFile]);
  } finally {
    rmSync(secretDirectory, { force: true, recursive: true });
  }
  process.stdout.write(`HQBot deploy ${gitSha.slice(0, 12)} is complete.\n`);
}

function missingSecretValues(secretNames, environment) {
  const values = {};
  if (!secretNames.has(setupSecret)) {
    const setupToken = environment[setupSecret]?.trim();
    if (!setupToken) {
      throw new Error(`Set ${setupSecret} before the first deployment.`);
    }
    if (setupToken.length < 24 || setupToken.length > 256) {
      throw new Error(`${setupSecret} must contain 24 to 256 characters.`);
    }
    values[setupSecret] = setupToken;
  }
  if (!secretNames.has(connectionSecret)) {
    values[connectionSecret] = randomBytes(32).toString("base64url");
  }
  return values;
}

function build() {
  runNode(packageExecutable("typescript", "bin", "tsc"), ["-b"]);
  runNode(packageExecutable("vite", "bin", "vite.js"), ["build"]);
}

function remoteSecretNames(attemptCommand) {
  const result = attemptCommand(["secret", "list", "--format", "json"]);
  if (result.status !== 0) {
    if (workerDoesNotExist(result)) return new Set();
    emitOutput(result);
    throw result.error ?? new Error(`Wrangler secret inspection failed with ${result.status}.`);
  }

  const parsed = JSON.parse(result.stdout || "[]");
  if (!Array.isArray(parsed)) throw new Error("Wrangler returned an invalid secret list.");
  return new Set(
    parsed.map((secret) => (typeof secret?.name === "string" ? secret.name : null)).filter(Boolean)
  );
}

function currentGitSha(captureCommand) {
  const value = captureCommand("git", ["rev-parse", "--verify", "HEAD"]).trim();
  if (!/^[0-9a-f]{40}$/i.test(value)) throw new Error("Git returned an invalid commit SHA.");
  return value.toLowerCase();
}

function assertCleanGitTree(captureCommand) {
  if (captureCommand("git", ["status", "--porcelain"]).trim()) {
    throw new Error("Refusing to deploy a dirty Git tree. Commit or remove local changes first.");
  }
}

function packageExecutable(packageName, ...parts) {
  const executable = resolve(root, "node_modules", packageName, ...parts);
  if (!existsSync(executable)) {
    throw new Error(`Missing ${packageName}. Install the locked dependencies before deployment.`);
  }
  return executable;
}

function runWrangler(args) {
  runNode(packageExecutable("wrangler", "bin", "wrangler.js"), args);
}

function attemptWrangler(args) {
  return spawnSync(
    process.execPath,
    [packageExecutable("wrangler", "bin", "wrangler.js"), ...args],
    commandOptions({ encoding: "utf8" })
  );
}

function runNode(executable, args) {
  const result = spawnSync(
    process.execPath,
    [executable, ...args],
    commandOptions({ stdio: "inherit" })
  );
  assertSucceeded(result, process.execPath, [executable, ...args]);
}

function capture(command, args) {
  const result = spawnSync(command, args, commandOptions({ encoding: "utf8" }));
  assertSucceeded(result, command, args);
  return result.stdout ?? "";
}

function commandOptions(options) {
  return {
    cwd: root,
    env: { ...process.env, CI: process.env.CI ?? "true", WRANGLER_LOG_PATH: wranglerLog },
    ...options
  };
}

function assertSucceeded(result, command, args) {
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(
      `Command failed (${result.status ?? "no exit code"}): ${command} ${args.join(" ")}`
    );
  }
}

function emitOutput(result) {
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
}

function workerDoesNotExist(result) {
  const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`.replace(
    // biome-ignore lint/suspicious/noControlCharactersInRegex: ANSI escape stripping.
    /\x1b\[[0-?]*[ -/]*[@-~]/g,
    ""
  );
  return (
    /Worker ".+"(?: \(env: .+\))? not found\./s.test(output) ||
    /This Worker does not exist on your account\./i.test(output) ||
    /workers\.api\.error\.script_not_found|code["': ]+(?:10007|10090)/i.test(output)
  );
}

function createRestrictedDirectory(prefix) {
  const directory = mkdtempSync(resolve(tmpdir(), prefix));
  try {
    restrictDirectory(directory);
    const failure = restrictionFailure(directory);
    if (failure) throw new Error(`Could not restrict temporary secret storage: ${failure}`);
    return directory;
  } catch (error) {
    rmSync(directory, { force: true, recursive: true });
    throw error;
  }
}

function restrictDirectory(directory) {
  if (process.platform !== "win32") {
    chmodSync(directory, 0o700);
    return;
  }
  runWindows("icacls.exe", [
    directory,
    "/inheritance:r",
    "/grant:r",
    `*${currentWindowsSid()}:(OI)(CI)F`
  ]);
}

function restrictionFailure(directory) {
  if (process.platform !== "win32") {
    const mode = statSync(directory).mode & 0o777;
    return mode === 0o700 ? null : `mode is 0${mode.toString(8)}, expected 0700`;
  }
  const sid = currentWindowsSid();
  const trustees = windowsTrustees(directory);
  const foreign = trustees.filter(
    (trustee) => !isCurrentWindowsAccount(trustee, sid) && !trustedWindowsAccounts.has(trustee)
  );
  if (foreign.length > 0) return `access is also granted to [${foreign.join(", ")}]`;
  return trustees.some((trustee) => isCurrentWindowsAccount(trustee, sid))
    ? null
    : "the current Windows account has no access entry";
}

let windowsSid;
function currentWindowsSid() {
  if (windowsSid) return windowsSid;
  const output = runWindows("whoami.exe", ["/user", "/fo", "csv", "/nh"]);
  const sid = /S-1-[\d-]+/.exec(output)?.[0];
  if (!sid) throw new Error("Could not determine the current Windows account SID.");
  windowsSid = sid;
  return sid;
}

function windowsTrustees(directory) {
  const aclFile = `${directory}.acl`;
  try {
    runWindows("icacls.exe", [directory, "/save", aclFile, "/q"]);
    const descriptor = readFileSync(aclFile, "utf16le").split(/\r?\n/)[1] ?? "";
    return [...descriptor.matchAll(/\(([^)]*)\)/g)]
      .map((entry) => entry[1].split(";")[5])
      .filter(Boolean);
  } finally {
    rmSync(aclFile, { force: true });
  }
}

function isCurrentWindowsAccount(trustee, sid) {
  return trustee === sid || (trustee === "LA" && sid.endsWith("-500"));
}

function runWindows(name, args) {
  const systemRoot = process.env.SystemRoot ?? process.env.WINDIR;
  if (!systemRoot) throw new Error("Windows system directory is not available.");
  const executable = resolve(systemRoot, "System32", name);
  const result = spawnSync(executable, args, { encoding: "utf8" });
  assertSucceeded(result, executable, args);
  return result.stdout ?? "";
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : null;
if (invokedPath === import.meta.url) {
  try {
    deploy();
  } catch (error) {
    process.stderr.write(`HQBot deploy failed: ${errorMessage(error)}\n`);
    process.exitCode = 1;
  }
}

function errorMessage(error) {
  return error instanceof Error ? error.message : "Unknown deployment error.";
}
