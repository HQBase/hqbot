#!/usr/bin/env node
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";

const DEBUG_URL = "http://127.0.0.1:9222";
const MAX_OUTPUT_BYTES = 64_000;
const TARGET_FILE = "/workspace/hqbot/browser-target";
const input = JSON.parse(process.env.HQBOT_BROWSER_INPUT ?? "{}");

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function pages() {
  const response = await fetch(`${DEBUG_URL}/json/list`);
  if (!response.ok) throw new Error("Chrome is not ready");
  return (await response.json()).filter((target) => target.type === "page");
}

async function savedTarget() {
  return readFile(TARGET_FILE, "utf8").catch(() => "");
}

async function selectPage(targetId) {
  const available = await pages();
  const selectedId = targetId || (await savedTarget()).trim();
  const selected = available.find((target) => target.id === selectedId);
  if (targetId && !selected) throw new Error("The Chrome tab is no longer available");
  const fallback = selected ?? available[0];
  if (!fallback) throw new Error("Chrome has no open page");
  await mkdir("/workspace/hqbot", { recursive: true });
  await writeFile(TARGET_FILE, fallback.id);
  return fallback;
}

async function cdp(target, run) {
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  const pending = new Map();
  let nextId = 0;
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(String(event.data));
    if (!message.id) return;
    const entry = pending.get(message.id);
    if (!entry) return;
    pending.delete(message.id);
    if (message.error) entry.reject(new Error(message.error.message));
    else entry.resolve(message.result);
  });
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", () => reject(new Error("Chrome control failed")), {
      once: true
    });
  });
  const call = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = ++nextId;
      pending.set(id, { reject, resolve });
      socket.send(JSON.stringify({ id, method, params }));
    });
  try {
    return await run(call);
  } finally {
    socket.close();
  }
}
async function runtimeEvaluate(call, expression) {
  return call("Runtime.evaluate", {
    awaitPromise: true,
    expression,
    returnByValue: true,
    userGesture: true
  });
}
function pageActionError(result) {
  const description = result.exceptionDetails?.exception?.description;
  const text = typeof description === "string" ? description : result.exceptionDetails?.text;
  const message = typeof text === "string" ? text.split("\n", 1)[0]?.trim() : "";
  return new Error(
    message ? `The page action failed: ${message.slice(0, 500)}` : "The page action failed"
  );
}

async function evaluate(call, expression) {
  const result = await runtimeEvaluate(call, expression);
  if (result.exceptionDetails) throw pageActionError(result);
  return result.result?.value;
}

async function evaluatePageScript(call, script) {
  const result = await runtimeEvaluate(call, script);
  if (!result.exceptionDetails) return result.result?.value;
  const description = result.exceptionDetails.exception?.description;
  const syntaxError =
    result.exceptionDetails.exception?.className === "SyntaxError" ||
    (typeof description === "string" && description.startsWith("SyntaxError"));
  if (syntaxError) return evaluate(call, `(async () => {\n${script}\n})()`);
  throw pageActionError(result);
}

async function waitForPage(call) {
  const deadline = Date.now() + 15_000;
  let readyAt = 0;
  let readyUrl = "";
  while (Date.now() < deadline) {
    const state = await evaluate(
      call,
      `({ ready: document.readyState === "complete" || document.readyState === "interactive", rendered: Boolean((document.body?.innerText || "").trim() || document.querySelector("a,button,input,textarea,select,[role]")), url: location.href })`
    ).catch(() => null);
    if (state?.ready) {
      if (readyUrl !== state.url) {
        readyAt = Date.now();
        readyUrl = state.url;
      }
      if (state.rendered || Date.now() - readyAt >= 1_500) return;
    }
    await delay(200);
  }
}

const snapshotExpression = `(() => {
  const visible = (element) => {
    const box = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return box.width > 0 && box.height > 0 && style.visibility !== "hidden" && style.display !== "none";
  };
  const name = (element) =>
    (element.getAttribute("aria-label") || element.getAttribute("title") ||
      element.innerText || element.getAttribute("placeholder") || element.getAttribute("name") || "")
      .trim().replace(/\\s+/g, " ").slice(0, 200);
  document.querySelectorAll("[data-hqbot-ref]").forEach((element) =>
    element.removeAttribute("data-hqbot-ref"));
  const elements = [...document.querySelectorAll(
    "a,button,input,textarea,select,[contenteditable=true],[role=button],[role=link],[role=combobox],[role=checkbox],[role=menuitem],[role=menuitemcheckbox],[role=menuitemradio],[role=option],[role=radio],[role=switch],[role=tab]"
  )].filter(visible).slice(0, 120).map((element, index) => {
    const ref = "e" + (index + 1);
    element.setAttribute("data-hqbot-ref", ref);
    const type = element.getAttribute("type") || undefined;
    return {
      ref,
      tag: element.tagName.toLowerCase(),
      role: element.getAttribute("role") || undefined,
      name: name(element),
      type,
      href: element.href || undefined,
      checked: element.getAttribute("aria-checked") || undefined,
      disabled: element.hasAttribute("disabled") || element.getAttribute("aria-disabled") === "true" || undefined,
      expanded: element.getAttribute("aria-expanded") || undefined,
      hasPopup: element.getAttribute("aria-haspopup") || undefined,
      selected: element.getAttribute("aria-selected") || undefined,
      value: type === "password" ? undefined : ("value" in element ? String(element.value).slice(0, 200) : undefined)
    };
  });
  return {
    url: location.href,
    title: document.title,
    text: (document.body?.innerText || "").trim().slice(0, 20000),
    elements
  };
})()`;

async function snapshot(call) {
  return evaluate(call, snapshotExpression);
}

async function pageAction() {
  const target = await selectPage(input.targetId);
  return cdp(target, async (call) => {
    await call("Page.enable");
    await call("Runtime.enable");
    await call("Page.bringToFront");
    if (input.action === "open") {
      await call("Page.navigate", { url: input.url });
      await waitForPage(call);
      return snapshot(call);
    }
    if (input.action === "snapshot") return snapshot(call);
    if (input.action === "evaluate") {
      return {
        result: await evaluatePageScript(call, input.script),
        url: await evaluate(call, "location.href")
      };
    }
    if (input.action === "click") {
      const ref = JSON.stringify(input.ref);
      const point = await evaluate(
        call,
        `(() => { const element = document.querySelector('[data-hqbot-ref="' + ${ref} + '"]'); if (!element) return null; element.scrollIntoView({block:'center'}); const box = element.getBoundingClientRect(); return box.width > 0 && box.height > 0 ? { x: box.left + box.width / 2, y: box.top + box.height / 2 } : null; })()`
      );
      if (!point) throw new Error("Element reference is stale. Take a new snapshot.");
      await call("Input.dispatchMouseEvent", {
        button: "left",
        buttons: 1,
        clickCount: 1,
        type: "mousePressed",
        x: point.x,
        y: point.y
      });
      await call("Input.dispatchMouseEvent", {
        button: "left",
        buttons: 0,
        clickCount: 1,
        type: "mouseReleased",
        x: point.x,
        y: point.y
      });
      await delay(400);
      await waitForPage(call);
      return snapshot(call);
    }
    if (input.action === "press") {
      const ref = JSON.stringify(input.ref);
      const focused = await evaluate(
        call,
        `(() => { const element = document.querySelector('[data-hqbot-ref="' + ${ref} + '"]'); if (!element) return false; element.scrollIntoView({block:'center'}); element.focus(); return true; })()`
      );
      if (!focused) throw new Error("Element reference is stale. Take a new snapshot.");
      const key = input.key === "Space" ? " " : input.key;
      const modifiers =
        (input.alt ? 1 : 0) | (input.ctrl ? 2 : 0) | (input.meta ? 4 : 0) | (input.shift ? 8 : 0);
      await call("Input.dispatchKeyEvent", { key, modifiers, type: "keyDown" });
      await call("Input.dispatchKeyEvent", { key, modifiers, type: "keyUp" });
      await delay(300);
      await waitForPage(call);
      return snapshot(call);
    }
    if (input.action === "type") {
      const ref = JSON.stringify(input.ref);
      const focused = await evaluate(
        call,
        `(() => { const element = document.querySelector('[data-hqbot-ref="' + ${ref} + '"]'); if (!element) return false; element.scrollIntoView({block:'center'}); element.focus(); return true; })()`
      );
      if (!focused) throw new Error("Element reference is stale. Take a new snapshot.");
      if (input.clear !== false) {
        await call("Input.dispatchKeyEvent", { type: "keyDown", key: "a", modifiers: 2 });
        await call("Input.dispatchKeyEvent", { type: "keyUp", key: "a", modifiers: 2 });
        await call("Input.dispatchKeyEvent", { type: "keyDown", key: "Backspace" });
        await call("Input.dispatchKeyEvent", { type: "keyUp", key: "Backspace" });
      }
      await call("Input.insertText", { text: input.text });
      if (input.submit) {
        await call("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter" });
        await call("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter" });
        await delay(400);
        await waitForPage(call);
      }
      return snapshot(call);
    }
    if (input.action === "screenshot") {
      const result = await call("Page.captureScreenshot", {
        captureBeyondViewport: false,
        format: "jpeg",
        quality: 75
      });
      await writeFile(input.path, Buffer.from(result.data, "base64"));
      return { path: input.path, url: await evaluate(call, "location.href") };
    }
    throw new Error("Unknown browser action");
  });
}

async function tabsAction() {
  if (input.operation === "new") {
    const response = await fetch(`${DEBUG_URL}/json/new?${encodeURIComponent(input.url)}`, {
      method: "PUT"
    });
    if (!response.ok) throw new Error("A new Chrome tab could not be opened");
    const target = await response.json();
    await mkdir("/workspace/hqbot", { recursive: true });
    await writeFile(TARGET_FILE, target.id);
  } else if (input.operation === "select") {
    const target = await selectPage(input.targetId);
    await cdp(target, (call) => call("Page.bringToFront"));
  } else if (input.operation === "close") {
    const target = await selectPage(input.targetId);
    const response = await fetch(`${DEBUG_URL}/json/close/${encodeURIComponent(target.id)}`);
    if (!response.ok) throw new Error("The Chrome tab could not be closed");
    await unlink(TARGET_FILE).catch(() => undefined);
  }
  const activeId = (await savedTarget()).trim();
  return {
    tabs: (await pages()).map((target) => ({
      active: target.id === activeId,
      targetId: target.id,
      title: target.title,
      url: target.url
    }))
  };
}

try {
  const output = input.action === "tabs" ? await tabsAction() : await pageAction();
  const serialized = JSON.stringify(output);
  if (Buffer.byteLength(serialized) > MAX_OUTPUT_BYTES) {
    throw new Error("The browser result is too large");
  }
  process.stdout.write(serialized);
} catch (error) {
  process.stderr.write(error instanceof Error ? error.message : "Chrome control failed");
  process.exitCode = 1;
}
