import {
  HQBOT_MODELS,
  type HQBotModel,
  type HQBotModelId,
  hqbotModelName,
  isHQBotModelId,
  type ModelTokenRates
} from "../domain/models";

interface CatalogProperty {
  property_id: string;
  value: unknown;
}

interface CatalogModel {
  name?: unknown;
  description?: unknown;
  task?: { name?: unknown };
  properties?: CatalogProperty[];
}

interface CatalogPrice {
  unit?: unknown;
  price?: unknown;
  currency?: unknown;
}

interface WorkersAiCatalog {
  models(options: {
    task: string;
    hide_experimental: boolean;
    page: number;
    per_page: number;
  }): Promise<unknown>;
}

const CATALOG_PAGE_SIZE = 100;
const MAX_CATALOG_PAGES = 10;

function property(model: CatalogModel, name: string): unknown {
  return model.properties?.find((item) => item.property_id === name)?.value;
}

function enabled(value: unknown): boolean {
  return value === true || value === "true";
}

function positiveNumber(value: unknown): number | null {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function priceList(value: unknown): CatalogPrice[] {
  if (Array.isArray(value)) return value as CatalogPrice[];
  if (typeof value !== "string" || !value.startsWith("[")) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? (parsed as CatalogPrice[]) : [];
  } catch {
    return [];
  }
}

function tokenRates(value: unknown): ModelTokenRates | null {
  let input: number | null = null;
  let cached: number | null = null;
  let output: number | null = null;
  for (const item of priceList(value)) {
    if (item.currency !== "USD" || typeof item.unit !== "string") continue;
    const price = positiveNumber(item.price);
    if (price === null) continue;
    const unit = item.unit.toLocaleLowerCase();
    if (unit.includes("cached input")) cached = price;
    else if (unit.includes("input token")) input = price;
    else if (unit.includes("output token")) output = price;
  }
  if (input === null || output === null) return null;
  return {
    inputUsdPerMillion: input,
    cachedInputUsdPerMillion: cached ?? input,
    outputUsdPerMillion: output
  };
}

function rank(model: HQBotModel): string {
  const preferred = HQBOT_MODELS.findIndex((item) => item.id === model.id);
  return `${String(preferred < 0 ? 9_999 : preferred).padStart(4, "0")}:${model.label.toLocaleLowerCase()}`;
}

export function parseHQBotModels(value: unknown): HQBotModel[] {
  if (!Array.isArray(value)) return [];
  return value
    .flatMap((item): HQBotModel[] => {
      const model = item as CatalogModel;
      if (
        model.task?.name !== "Text Generation" ||
        !isHQBotModelId(model.name) ||
        !enabled(property(model, "function_calling"))
      ) {
        return [];
      }
      return [
        {
          id: model.name,
          label: hqbotModelName(model.name),
          description:
            typeof model.description === "string" && model.description.trim()
              ? model.description.trim().slice(0, 500)
              : "Cloudflare AI text model with tool support.",
          contextWindow: positiveNumber(property(model, "context_window")),
          reasoning: enabled(property(model, "reasoning")),
          vision: enabled(property(model, "vision")),
          requiresPaid:
            !model.name.startsWith("@cf/") || enabled(property(model, "require_workers_paid")),
          rates: tokenRates(property(model, "price"))
        }
      ];
    })
    .sort((left, right) => rank(left).localeCompare(rank(right)));
}

export async function listHQBotModels(ai: WorkersAiCatalog): Promise<HQBotModel[]> {
  const discovered: unknown[] = [];
  try {
    for (let page = 1; page <= MAX_CATALOG_PAGES; page += 1) {
      const result = await ai.models({
        task: "Text Generation",
        hide_experimental: true,
        page,
        per_page: CATALOG_PAGE_SIZE
      });
      if (!Array.isArray(result)) break;
      discovered.push(...result);
      if (result.length < CATALOG_PAGE_SIZE) break;
    }
  } catch {
    // Use any complete pages before the catalog became unavailable.
  }
  const models = new Map(HQBOT_MODELS.map((model) => [model.id, model]));
  for (const model of parseHQBotModels(discovered)) models.set(model.id, model);
  return [...models.values()].sort((left, right) => rank(left).localeCompare(rank(right)));
}

export function modelTokenRates(
  models: readonly HQBotModel[],
  modelId: HQBotModelId
): ModelTokenRates | null {
  return models.find((model) => model.id === modelId)?.rates ?? null;
}
