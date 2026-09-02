import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

const roots = ["src", "scripts"];
const hardLimit = 400;
const reviewLimit = 300;
const failures = [];
const warnings = [];

for (const root of roots) {
  for (const file of await sourceFiles(root)) {
    const contents = await readFile(file, "utf8");
    const lineCount = contents.split("\n").length;

    if (lineCount > hardLimit) {
      failures.push(`${file}: ${lineCount} lines exceeds the ${hardLimit}-line limit`);
    } else if (lineCount > reviewLimit) {
      warnings.push(`${file}: ${lineCount} lines should be reviewed for splitting`);
    }

    for (const specifier of importSpecifiers(contents)) {
      if (isRuntimeFile(file) && importsUi(specifier)) {
        failures.push(`${file}: runtime code must not import frontend modules`);
      }
      if (isUiFile(file) && importsRuntime(specifier)) {
        failures.push(`${file}: frontend code must not import runtime modules`);
      }
      if (file.startsWith(`src${path.sep}`) && specifier.startsWith("node:")) {
        failures.push(`${file}: product code must prefer Web Platform APIs over Node built-ins`);
      }
    }
  }
}

for (const warning of warnings) console.warn(`warning: ${warning}`);
if (failures.length > 0) {
  for (const failure of failures) console.error(`error: ${failure}`);
  process.exitCode = 1;
} else {
  console.log(
    `Architecture check passed${warnings.length ? ` with ${warnings.length} warning(s)` : ""}.`
  );
}

async function sourceFiles(root) {
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }

  const files = [];
  for (const entry of entries) {
    const location = path.join(root, entry.name);
    if (entry.isDirectory()) files.push(...(await sourceFiles(location)));
    else if (/\.(?:mjs|ts|tsx)$/.test(entry.name)) files.push(location);
  }
  return files;
}

function importSpecifiers(contents) {
  const specifiers = [];
  const pattern = /(?:\bfrom\s*|\bimport\s*\(|\bimport\s*)["']([^"']+)["']/g;
  for (const match of contents.matchAll(pattern)) specifiers.push(match[1]);
  return specifiers;
}

function importsRuntime(specifier) {
  return (
    /^(?:\.\.\/)+(?:agent|runtime|services|worker|workflow)(?:\/|$)/.test(specifier) ||
    /^@(?:runtime|worker)\//.test(specifier)
  );
}

function importsUi(specifier) {
  return /^(?:\.\.\/|\.\/)*ui(?:\/|$)/.test(specifier) || /^@(?:\/ui|ui)\//.test(specifier);
}

function isRuntimeFile(file) {
  return file.startsWith(`src${path.sep}`) && !isUiFile(file);
}

function isUiFile(file) {
  return file.startsWith(path.join("src", "ui") + path.sep);
}
