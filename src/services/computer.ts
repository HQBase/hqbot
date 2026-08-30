import puppeteer, {
  type BrowserWorker,
  type CookieParam,
  type KeyInput,
} from "@cloudflare/puppeteer"

import { safeResearchUrl } from "../domain/research"
import type { StoredComputerState } from "../domain/types"
import { decryptSecret, encryptSecret } from "./crypto"

const keepAliveMilliseconds = 120_000
const screenshotKey = "computer/shared.png"

export type ComputerAction =
  | { type: "navigate"; url: string }
  | { type: "click"; x: number; y: number }
  | { type: "type"; text: string }
  | { type: "key"; key: "Enter" | "Tab" | "Escape" | "Backspace" | "ArrowUp" | "ArrowDown" }
  | { type: "refresh" }

function safeRequest(value: string): boolean {
  try {
    const url = new URL(value)
    if (["about:", "blob:", "data:"].includes(url.protocol)) return true
    if (url.protocol === "wss:" || url.protocol === "ws:") {
      url.protocol = url.protocol === "wss:" ? "https:" : "http:"
    }
    return safeResearchUrl(url.toString()) !== null
  } catch {
    return false
  }
}

async function connectOrLaunch(
  binding: BrowserWorker,
  current: StoredComputerState,
  connectionKey: string,
) {
  if (current.active && current.sessionId) {
    try {
      return await puppeteer.connect(binding, current.sessionId)
    } catch {
      // The short-lived session expired between the snapshot and this action.
    }
  }
  const browser = await puppeteer.launch(binding, { keep_alive: keepAliveMilliseconds })
  const pages = await browser.pages()
  const page = pages[0] ?? (await browser.newPage())
  if (current.cookiesCiphertext && current.cookiesIv) {
    try {
      const cookies = JSON.parse(
        await decryptSecret(connectionKey, current.cookiesCiphertext, current.cookiesIv),
      ) as CookieParam[]
      if (cookies.length > 0) await page.setCookie(...cookies)
    } catch {
      // Invalid or obsolete cookies must not block a clean computer session.
    }
  }
  return browser
}

export async function operateComputer(
  binding: BrowserWorker,
  artifacts: R2Bucket,
  connectionKey: string,
  current: StoredComputerState,
  action: ComputerAction,
): Promise<Omit<StoredComputerState, "active" | "updatedAt">> {
  const browser = await connectOrLaunch(binding, current, connectionKey)
  try {
    const pages = await browser.pages()
    const page = pages.at(-1) ?? (await browser.newPage())
    await page.setViewport({ width: 1280, height: 800 })
    await page.setRequestInterception(true)
    page.on("request", async (request) => {
      if (safeRequest(request.url())) await request.continue()
      else await request.abort("blockedbyclient")
    })

    if (action.type === "navigate") {
      const url = safeResearchUrl(action.url)
      if (!url) throw new Error("The computer URL must be a public HTTP or HTTPS page")
      await page.goto(url.toString(), { waitUntil: "domcontentloaded", timeout: 30_000 })
    } else if (action.type === "click") {
      await page.mouse.click(
        Math.max(0, Math.min(1_280, action.x)),
        Math.max(0, Math.min(800, action.y)),
      )
    } else if (action.type === "type") {
      await page.keyboard.type(action.text.slice(0, 2_000))
    } else if (action.type === "key") {
      await page.keyboard.press(action.key as KeyInput)
    } else {
      await page.reload({ waitUntil: "domcontentloaded", timeout: 30_000 })
    }

    const screenshot = await page.screenshot({ type: "png" })
    await artifacts.put(screenshotKey, screenshot, {
      httpMetadata: { contentType: "image/png", cacheControl: "private, no-store" },
    })
    const encrypted = await encryptSecret(connectionKey, JSON.stringify(await page.cookies()))
    return {
      sessionId: browser.sessionId(),
      url: page.url(),
      screenshotKey,
      expiresAt: new Date(Date.now() + keepAliveMilliseconds).toISOString(),
      cookiesCiphertext: encrypted.ciphertext,
      cookiesIv: encrypted.iv,
    }
  } finally {
    await browser.disconnect()
  }
}

export async function stopComputer(
  binding: BrowserWorker,
  current: StoredComputerState,
): Promise<Omit<StoredComputerState, "active" | "updatedAt">> {
  if (current.active && current.sessionId) {
    try {
      const browser = await puppeteer.connect(binding, current.sessionId)
      await browser.close()
    } catch {
      // An already expired session is stopped.
    }
  }
  return {
    sessionId: null,
    url: current.url,
    screenshotKey: current.screenshotKey,
    expiresAt: null,
    cookiesCiphertext: current.cookiesCiphertext,
    cookiesIv: current.cookiesIv,
  }
}
