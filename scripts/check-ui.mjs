import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

// Only a fresh browser and the local fixture server. Never attach to a user profile.
const binary =
  process.env.HQBOT_TEST_CHROME ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const output = path.resolve(process.env.HQBOT_UI_OUTPUT ?? "coverage/ui");
await mkdir(output, { recursive: true });
const profile = await mkdtemp(path.join(tmpdir(), "hqbot-ui-"));
const browser = spawn(
  binary,
  [
    "--headless=new",
    "--no-first-run",
    "--disable-extensions",
    "--disable-background-networking",
    `--user-data-dir=${profile}`,
    "--remote-debugging-port=0",
    "about:blank"
  ],
  { stdio: "ignore" }
);
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let socket;
try {
  let port;
  for (let attempt = 0; attempt < 50; attempt++) {
    try {
      port = (await readFile(path.join(profile, "DevToolsActivePort"), "utf8")).split("\n")[0];
      break;
    } catch {
      await pause(200);
    }
  }
  assert(port, "Test browser did not start");
  const tabs = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  socket = new WebSocket(tabs.find((tab) => tab.type === "page").webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.onopen = resolve;
    socket.onerror = reject;
  });
  let sequence = 0;
  const pending = new Map();
  const errors = [];
  socket.onmessage = ({ data }) => {
    const value = JSON.parse(data);
    if (value.method === "Runtime.exceptionThrown") errors.push(value.params.exceptionDetails.text);
    const promise = pending.get(value.id);
    if (!promise) return;
    pending.delete(value.id);
    if (value.error) promise.reject(new Error(value.error.message));
    else promise.resolve(value.result);
  };
  const call = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = ++sequence;
      pending.set(id, { resolve, reject });
      socket.send(JSON.stringify({ id, method, params }));
    });
  await call("Runtime.enable");
  const evaluate = async (expression) => {
    const result = await call("Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise: true
    });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
    return result.result.value;
  };
  for (const width of [390, 1440]) {
    await call("Emulation.setDeviceMetricsOverride", {
      width,
      height: 950,
      deviceScaleFactor: 1,
      mobile: width < 500
    });
    await call("Page.navigate", { url: "http://127.0.0.1:5199/__ui/workspace" });
    for (let attempt = 0; attempt < 50; attempt++) {
      if (
        await evaluate(`Boolean(document.querySelector('button[aria-label="Conversation info"]'))`)
      )
        break;
      await pause(100);
    }
    await evaluate(`document.querySelector('button[aria-label="Conversation info"]').click()`);
    for (const section of [
      "Files",
      "Integrations",
      "Memory",
      "Skills",
      "Routines",
      "Permissions",
      "Cost",
      "Agent settings",
      "Activity"
    ]) {
      await evaluate(
        `[...document.querySelectorAll('nav[aria-label="Conversation resources"] button')].find(b => b.textContent === '${section}').click()`
      );
      await pause(400);
      assert.equal(await evaluate(`document.querySelector('aside h2')?.textContent`), section);
      const overflow = await evaluate(
        `(() => { const r = document.querySelector('aside').getBoundingClientRect(); return r.right > innerWidth + 2 || r.left < 0; })()`
      );
      assert.equal(overflow, false, `${section} fits at ${width}px`);
      await writeFile(
        path.join(output, `${section.toLowerCase().replaceAll(" ", "-")}-${width}.png`),
        Buffer.from((await call("Page.captureScreenshot", { format: "png" })).data, "base64")
      );
      console.log(`${section} ${width}px: rendered, no horizontal overflow`);
      if (section !== "Activity") {
        await evaluate(
          `document.querySelector('button[aria-label="Back to conversation info"]').click()`
        );
        await pause(100);
      }
    }
    for (let attempt = 0; attempt < 30; attempt++) {
      if (await evaluate(`Boolean(document.querySelector('[aria-label="Specialist questions"]'))`))
        break;
      await pause(100);
    }
    await evaluate(`document.querySelector('[aria-label="Specialist questions"] summary').click()`);
    const questions = await evaluate(
      `document.querySelector('[aria-label="Specialist questions"]').textContent`
    );
    assert(
      questions.includes("Writer → Operator") &&
        questions.includes("Answered") &&
        questions.includes("saved official source"),
      "Question and saved answer are visible"
    );
    const questionOverflow = await evaluate(
      `(() => { const r = document.querySelector('[aria-label="Specialist questions"]').getBoundingClientRect(); return r.right > innerWidth + 2 || r.left < 0; })()`
    );
    assert.equal(questionOverflow, false, "Specialist questions fit the viewport");
    await evaluate(
      `document.querySelector('[aria-label="Specialist questions"]').scrollIntoView({block:'center'})`
    );
    await writeFile(
      path.join(output, `specialist-questions-${width}.png`),
      Buffer.from((await call("Page.captureScreenshot", { format: "png" })).data, "base64")
    );
    console.log(`Specialist questions ${width}px: expanded saved answer, no horizontal overflow`);
    await call("Page.navigate", { url: "http://127.0.0.1:5199/__ui/workspace?attention" });
    for (let attempt = 0; attempt < 60; attempt++) {
      if (
        await evaluate(
          `Boolean(document.querySelector('[aria-label="Computer handoff from Operator"]'))`
        )
      )
        break;
      await pause(100);
    }
    const handoff = await evaluate(
      `document.querySelector('[aria-label="Computer handoff from Operator"]')?.textContent`
    );
    assert(handoff?.includes("I’m done—continue"), "Inline handoff has a resume action");
    assert(handoff?.includes("Reconnect computer"), "Expired control can reconnect from chat");
    assert(
      await evaluate(
        `document.querySelector('[aria-label="Action details"]')?.textContent.includes('https://hqbase.example')`
      ),
      "Exact computer approval is inline"
    );
    await evaluate(
      `document.querySelector('[aria-label="Computer handoff from Operator"]').scrollIntoView({block:'center'})`
    );
    assert.equal(
      await evaluate(
        `(() => {const r = document.querySelector('[aria-label="Computer handoff from Operator"]').getBoundingClientRect();return r.left < 0 || r.right > innerWidth + 2;})()`
      ),
      false,
      "Inline handoff fits the viewport"
    );
    await writeFile(
      path.join(output, `inline-handoff-${width}.png`),
      Buffer.from((await call("Page.captureScreenshot", { format: "png" })).data, "base64")
    );
    console.log(`Inline approval and handoff ${width}px: rendered in conversation`);
  }
  await evaluate("localStorage.setItem('hqbot_theme_v1','light')");
  await call("Page.navigate", { url: "http://127.0.0.1:5199/__ui/workspace" });
  await pause(700);
  assert.equal(await evaluate("document.documentElement.dataset.theme"), "light");
  await writeFile(
    path.join(output, "conversation-light-1440.png"),
    Buffer.from((await call("Page.captureScreenshot", { format: "png" })).data, "base64")
  );
  assert.deepEqual(errors, [], "Unexpected browser exceptions");
  console.log(`UI checks passed. Screenshots: ${output}`);
} finally {
  socket?.close();
  browser.kill("SIGTERM");
}
