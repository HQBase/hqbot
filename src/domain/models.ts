export const GLM_PRIMARY_MODEL_ID = "@cf/zai-org/glm-5.3-flash" as const;
export const DEEPSEEK_FALLBACK_MODEL_ID = "@cf/deepseek-ai/deepseek-v4-flash-0731" as const;

export const HQBOT_MODELS = [
  {
    id: GLM_PRIMARY_MODEL_ID,
    label: "GLM 5.3 Flash",
    description: "Fast, capable, and the default choice."
  },
  {
    id: DEEPSEEK_FALLBACK_MODEL_ID,
    label: "DeepSeek V4 Flash",
    description: "A low-cost choice for everyday work."
  }
] as const;

export type HQBotModelId = (typeof HQBOT_MODELS)[number]["id"];

export function isHQBotModelId(value: unknown): value is HQBotModelId {
  return HQBOT_MODELS.some((model) => model.id === value);
}

export function normalizeHQBotModelId(value: unknown): HQBotModelId {
  return isHQBotModelId(value) ? value : GLM_PRIMARY_MODEL_ID;
}

export function hqbotModelName(value: unknown): string {
  const modelId = normalizeHQBotModelId(value);
  return HQBOT_MODELS.find((model) => model.id === modelId)?.label ?? "GLM 5.3 Flash";
}
