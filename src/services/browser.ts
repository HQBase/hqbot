import puppeteer, { type BrowserWorker } from "@cloudflare/puppeteer"

import { safeResearchUrl } from "../domain/research"
import type { ResearchPlan, ResearchResult, ResearchSource } from "../domain/types"

const sourceLimit = 3
const pageCharacterLimit = 14_000
type Browser = Awaited<ReturnType<typeof puppeteer.launch>>
type Page = Awaited<ReturnType<Browser["newPage"]>>

function cleanText(value: string): string {
  return value.replace(/\s+/gu, " ").trim().slice(0, pageCharacterLimit)
}

async function searchLinks(page: Page, query: string) {
  const searchUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`
  await page.goto(searchUrl, { waitUntil: "domcontentloaded", timeout: 20_000 })
  const links = await page.evaluate(() =>
    [...document.querySelectorAll<HTMLAnchorElement>("a.result__a")].map((anchor) => anchor.href),
  )
  return links
    .map(safeResearchUrl)
    .filter((url): url is URL => url !== null)
    .map((url) => url.toString())
}

async function readPage(page: Page, value: string): Promise<ResearchSource | null> {
  const url = safeResearchUrl(value)
  if (!url) return null
  await page.goto(url.toString(), { waitUntil: "domcontentloaded", timeout: 25_000 })
  const [title, text] = await Promise.all([
    page.title(),
    page.evaluate(() => document.body?.innerText ?? ""),
  ])
  const cleaned = cleanText(text)
  if (!cleaned) return null
  return { title: cleanText(title) || url.hostname, url: page.url(), text: cleaned }
}

export async function researchWithBrowser(
  browserBinding: BrowserWorker,
  artifacts: R2Bucket,
  taskId: string,
  plan: ResearchPlan,
): Promise<ResearchResult> {
  const browser = await puppeteer.launch(browserBinding)
  const page = await browser.newPage()
  const sources: ResearchSource[] = []
  let screenshotKey: string | null = null
  let browserUrl: string | null = null
  try {
    await page.setRequestInterception(true)
    page.on("request", async (request) => {
      if (safeResearchUrl(request.url())) {
        await request.continue()
      } else {
        await request.abort("blockedbyclient")
      }
    })
    await page.setViewport({ width: 1440, height: 900 })
    const candidates = [...plan.urls]
    for (const query of plan.queries) {
      if (candidates.length >= sourceLimit) break
      try {
        candidates.push(
          ...(await searchLinks(page, query)).slice(0, sourceLimit - candidates.length),
        )
      } catch {
        // A blocked search page must not stop direct source research.
      }
    }
    for (const candidate of [...new Set(candidates)]) {
      if (sources.length >= sourceLimit) break
      try {
        const source = await readPage(page, candidate)
        if (source) sources.push(source)
      } catch {
        // Continue to the next bounded source when one page cannot load.
      }
    }
    if (sources.length === 0) throw new Error("The cloud browser could not read a public source")
    browserUrl = page.url()
    const screenshot = await page.screenshot({ type: "png" })
    screenshotKey = `tasks/${taskId}/browser.png`
    await artifacts.put(screenshotKey, screenshot, {
      httpMetadata: { contentType: "image/png", cacheControl: "private, no-store" },
    })
    return { sources, screenshotKey, browserUrl }
  } finally {
    await browser.close()
  }
}
