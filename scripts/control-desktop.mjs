#!/usr/bin/env node

import { spawn, spawnSync } from "node:child_process";

const input = JSON.parse(process.env.HQBOT_DESKTOP_INPUT ?? "{}");
const childEnvironment = { ...process.env, DISPLAY: process.env.DISPLAY || ":99" };
const buttons = { left: "1", middle: "2", right: "3" };
let activeChild;
let heldButton;

process.once("SIGTERM", () => {
  activeChild?.kill("SIGKILL");
  if (heldButton) {
    spawnSync("xdotool", ["mouseup", heldButton], {
      env: childEnvironment,
      stdio: "ignore",
      timeout: 1_000
    });
  }
  process.exit(143);
});

function run(command, arguments_) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, arguments_, {
      env: childEnvironment,
      killSignal: "SIGKILL",
      timeout: 15_000
    });
    activeChild = child;
    let stderr = "";
    let stdout = "";
    child.stdout.on("data", (chunk) => {
      if (stdout.length < 16_000) stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      if (stderr.length < 16_000) stderr += String(chunk);
    });
    child.once("error", reject);
    child.once("close", (code) => {
      activeChild = undefined;
      if (code === 0) resolve(stdout);
      else reject(new Error(stderr.trim() || `${command} failed`));
    });
  });
}

async function move(x, y) {
  await run("xdotool", ["mousemove", String(x), String(y)]);
}

async function mouseAction() {
  if (input.action === "move") {
    await move(input.x, input.y);
  } else if (input.action === "click") {
    await move(input.x, input.y);
    await run("xdotool", [
      "click",
      "--repeat",
      String(input.count),
      "--delay",
      "120",
      buttons[input.button]
    ]);
  } else if (input.action === "drag") {
    const selectedButton = buttons[input.button];
    await move(input.fromX, input.fromY);
    heldButton = selectedButton;
    try {
      await run("xdotool", ["mousedown", selectedButton]);
      await run("xdotool", ["mousemove", String(input.toX), String(input.toY)]);
    } finally {
      await run("xdotool", ["mouseup", selectedButton]).catch(() => undefined);
      heldButton = undefined;
    }
  } else if (input.action === "scroll") {
    await move(input.x, input.y);
    if (input.deltaY) {
      await run("xdotool", [
        "click",
        "--repeat",
        String(Math.abs(input.deltaY)),
        input.deltaY > 0 ? "5" : "4"
      ]);
    }
    if (input.deltaX) {
      await run("xdotool", [
        "click",
        "--repeat",
        String(Math.abs(input.deltaX)),
        input.deltaX > 0 ? "7" : "6"
      ]);
    }
  } else {
    throw new Error("Unknown desktop action");
  }
  return { action: input.action, ok: true };
}

async function keyboardAction() {
  if (input.action === "type") {
    await run("xdotool", ["type", "--clearmodifiers", "--delay", "1", "--", input.text]);
  } else if (input.action === "press") {
    await run("xdotool", ["key", "--clearmodifiers", "--delay", "80", ...input.keys]);
  } else {
    throw new Error("Unknown desktop action");
  }
  return { action: input.action, ok: true };
}

async function screenshot() {
  if (!/^\/tmp\/hqbot-desktop-[0-9a-f-]+\.jpg$/u.test(input.path)) {
    throw new Error("Invalid desktop screenshot path");
  }
  await run("import", ["-window", "root", "-quality", "70", input.path]);
  const geometry = (await run("xdotool", ["getdisplaygeometry"])).trim().split(/\s+/u).map(Number);
  if (geometry.length !== 2 || geometry.some((value) => !Number.isInteger(value) || value <= 0)) {
    throw new Error("Desktop returned invalid dimensions");
  }
  return { height: geometry[1], width: geometry[0] };
}

try {
  const output =
    input.action === "screenshot"
      ? await screenshot()
      : input.action === "type" || input.action === "press"
        ? await keyboardAction()
        : await mouseAction();
  process.stdout.write(JSON.stringify(output));
} catch (error) {
  process.stderr.write(error instanceof Error ? error.message : "Desktop control failed");
  process.exitCode = 1;
}
