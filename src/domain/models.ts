export const GLM_PRIMARY_MODEL_ID = "@cf/zai-org/glm-5.3-flash" as const;
export const DEEPSEEK_FALLBACK_MODEL_ID = "@cf/deepseek-ai/deepseek-v4-flash-0731" as const;

export type HQBotModelId = string;

export interface ModelTokenRates {
  inputUsdPerMillion: number;
  cachedInputUsdPerMillion: number;
  outputUsdPerMillion: number;
}

export interface HQBotModel {
  id: HQBotModelId;
  label: string;
  description: string;
  contextWindow: number | null;
  reasoning: boolean;
  vision: boolean;
  requiresPaid: boolean;
  rates: ModelTokenRates | null;
}

function gatewayModel(
  id: HQBotModelId,
  label: string,
  description: string,
  options: { reasoning?: boolean; vision?: boolean } = {}
): HQBotModel {
  return {
    id,
    label,
    description: `${description} Uses AI Gateway credits; its cost is not included in HQBot estimates.`,
    contextWindow: null,
    reasoning: options.reasoning ?? true,
    vision: options.vision ?? false,
    requiresPaid: true,
    rates: null
  };
}

export const HQBOT_MODELS: HQBotModel[] = [
  {
    id: GLM_PRIMARY_MODEL_ID,
    label: "GLM 5.3 Flash",
    description: "Fast, capable, and the default choice.",
    contextWindow: 1_310_720,
    reasoning: true,
    vision: true,
    requiresPaid: true,
    rates: {
      inputUsdPerMillion: 0.15,
      cachedInputUsdPerMillion: 0.03,
      outputUsdPerMillion: 0.5
    }
  },
  {
    id: DEEPSEEK_FALLBACK_MODEL_ID,
    label: "DeepSeek V4 Flash",
    description: "A low-cost choice for everyday work.",
    contextWindow: null,
    reasoning: true,
    vision: false,
    requiresPaid: true,
    rates: {
      inputUsdPerMillion: 0.44,
      cachedInputUsdPerMillion: 0.014,
      outputUsdPerMillion: 1.32
    }
  },
  gatewayModel("openai/gpt-5.4", "GPT 5.4", "OpenAI's flagship agentic model.", {
    vision: true
  }),
  gatewayModel("openai/gpt-5", "GPT 5", "OpenAI's coding and reasoning model.", {
    vision: true
  }),
  gatewayModel("openai/gpt-4o", "GPT 4o", "OpenAI's fast multimodal model.", {
    reasoning: false,
    vision: true
  }),
  gatewayModel("openai/gpt-5.5", "GPT 5.5", "OpenAI's model for complex work.", {
    vision: true
  }),
  gatewayModel("openai/gpt-4.1", "GPT 4.1", "OpenAI's general-purpose model.", {
    reasoning: false,
    vision: true
  }),
  gatewayModel(
    "anthropic/claude-sonnet-5",
    "Claude Sonnet 5",
    "Anthropic's balanced agentic model.",
    { vision: true }
  ),
  gatewayModel(
    "anthropic/claude-sonnet-4.6",
    "Claude Sonnet 4.6",
    "Anthropic's coding and reasoning model.",
    { vision: true }
  ),
  gatewayModel(
    "anthropic/claude-haiku-4.5",
    "Claude Haiku 4.5",
    "Anthropic's fast, lower-cost model.",
    { vision: true }
  ),
  gatewayModel("google/gemini-3.7-flash", "Gemini 3.7 Flash", "Google's fast agentic model.", {
    vision: true
  }),
  gatewayModel("google/gemini-2.5-flash", "Gemini 2.5 Flash", "Google's fast multimodal model.", {
    vision: true
  }),
  gatewayModel("xai/grok-4.6", "Grok 4.6", "xAI's flagship agentic model.", {
    vision: true
  }),
  gatewayModel(
    "deepseek/deepseek-v4-pro",
    "DeepSeek V4 Pro",
    "DeepSeek's long-horizon reasoning model."
  )
] as const;

export function isHQBotModelId(value: unknown): value is HQBotModelId {
  if (typeof value !== "string" || value.length > 200) return false;
  return /^(?:@cf\/)?[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*$/iu.test(value);
}

export function normalizeHQBotModelId(value: unknown): HQBotModelId {
  return isHQBotModelId(value) ? value : GLM_PRIMARY_MODEL_ID;
}

export function hqbotModelName(value: unknown): string {
  const modelId = normalizeHQBotModelId(value);
  const known = HQBOT_MODELS.find((model) => model.id === modelId)?.label;
  if (known) return known;
  const slug = modelId.split("/").at(-1) ?? modelId;
  return slug
    .replaceAll(/[-_]+/gu, " ")
    .replace(/\b\p{L}/gu, (letter) => letter.toLocaleUpperCase());
}
