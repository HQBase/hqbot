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
    for (const page of ["library", "projects", "automations", "inbox", "settings", "search"]) {
      await call("Page.navigate", { url: `http://127.0.0.1:5199/__ui/workspace?page=${page}` });
      let heading;
      for (let attempt = 0; attempt < 50; attempt++) {
        await pause(100);
        heading = await evaluate("document.querySelector('h1')?.textContent");
        if (heading?.toLowerCase() === page) break;
      }
      assert.equal(heading?.toLowerCase(), page, `${page} did not load`);
      await pause(250);
      const metrics = await evaluate(
        `({width:innerWidth,overflow:[...document.querySelectorAll('main *')].filter(e=>{const r=e.getBoundingClientRect();return r.width>1&&r.left>=0&&r.left<innerWidth&&r.right>innerWidth+2}).map(e=>({tag:e.tagName,class:e.className,text:e.textContent.slice(0,60)})).slice(0,8)})`
      );
      assert.equal(metrics.width, width, "Test viewport width");
      await writeFile(
        path.join(output, `${page}-${width}.png`),
        Buffer.from((await call("Page.captureScreenshot", { format: "png" })).data, "base64")
      );
      assert.deepEqual(
        metrics.overflow,
        [],
        `${page} overflows at ${width}px: ${JSON.stringify(metrics.overflow)}`
      );
      if (page === "settings") {
        for (const tab of ["Devices", "Network", "People"]) {
          await evaluate(
            `[...document.querySelectorAll('nav[aria-label="Settings"] button')].find(b=>b.textContent==='${tab}').click()`
          );
          await pause(300);
          await writeFile(
            path.join(output, `settings-${tab.toLowerCase()}-${width}.png`),
            Buffer.from((await call("Page.captureScreenshot", { format: "png" })).data, "base64")
          );
        }
      }
      console.log(`${page} ${width}px: rendered, no horizontal overflow`);
    }
  }
  await evaluate("localStorage.setItem('hqbot_theme_v1','light')");
  await call("Page.navigate", { url: "http://127.0.0.1:5199/__ui/workspace?page=library" });
  await pause(700);
  assert.equal(await evaluate("document.documentElement.dataset.theme"), "light");
  await writeFile(
    path.join(output, "library-light-1440.png"),
    Buffer.from((await call("Page.captureScreenshot", { format: "png" })).data, "base64")
  );
  assert.deepEqual(errors, [], "Unexpected browser exceptions");
  console.log(`UI checks passed. Screenshots: ${output}`);
} finally {
  socket?.close();
  browser.kill("SIGTERM");
}
