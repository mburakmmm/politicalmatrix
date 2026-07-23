import OpenAI from "openai";
import { getSetting, setSetting } from "../db/client";

export type LlmProviderId = "lm_studio" | "openrouter";

export const OPENROUTER_DEFAULT_BASE = "https://openrouter.ai/api/v1";
export const LM_STUDIO_DEFAULT_BASE = "http://127.0.0.1:1234/v1";

/** Tool-calling için sık kullanılan OpenRouter modelleri (combolarda üstte). */
export const OPENROUTER_CURATED_MODELS: Array<{ id: string; label: string }> = [
  { id: "openai/gpt-4o-mini", label: "OpenAI GPT-4o Mini" },
  { id: "openai/gpt-4o", label: "OpenAI GPT-4o" },
  { id: "openai/gpt-4.1-mini", label: "OpenAI GPT-4.1 Mini" },
  { id: "anthropic/claude-sonnet-4", label: "Anthropic Claude Sonnet 4" },
  { id: "anthropic/claude-3.5-sonnet", label: "Anthropic Claude 3.5 Sonnet" },
  { id: "google/gemini-2.5-flash", label: "Google Gemini 2.5 Flash" },
  { id: "google/gemini-2.0-flash-001", label: "Google Gemini 2.0 Flash" },
  { id: "deepseek/deepseek-chat-v3-0324", label: "DeepSeek Chat V3" },
  { id: "deepseek/deepseek-chat", label: "DeepSeek Chat" },
  {
    id: "meta-llama/llama-3.3-70b-instruct",
    label: "Meta Llama 3.3 70B Instruct",
  },
  {
    id: "qwen/qwen-2.5-72b-instruct",
    label: "Qwen 2.5 72B Instruct",
  },
  {
    id: "mistralai/mistral-large-2411",
    label: "Mistral Large 2411",
  },
  {
    id: "mistralai/mistral-small-3.1-24b-instruct",
    label: "Mistral Small 3.1 24B",
  },
];

export function getLlmProvider(): LlmProviderId {
  const raw =
    getSetting("llm_provider") ||
    process.env.LLM_PROVIDER ||
    "lm_studio";
  return raw === "openrouter" ? "openrouter" : "lm_studio";
}

export function setLlmProvider(provider: LlmProviderId): void {
  setSetting("llm_provider", provider);
}

export function getLmBaseUrl(): string {
  return (
    getSetting("lm_base_url") ||
    process.env.LM_STUDIO_BASE_URL ||
    LM_STUDIO_DEFAULT_BASE
  ).replace(/\/$/, "");
}

export function getOpenRouterBaseUrl(): string {
  return (
    getSetting("openrouter_base_url") ||
    process.env.OPENROUTER_BASE_URL ||
    OPENROUTER_DEFAULT_BASE
  ).replace(/\/$/, "");
}

export function getActiveBaseUrl(): string {
  return getLlmProvider() === "openrouter"
    ? getOpenRouterBaseUrl()
    : getLmBaseUrl();
}

export function getOpenRouterApiKey(): string {
  return (
    getSetting("openrouter_api_key") ||
    process.env.OPENROUTER_API_KEY ||
    ""
  ).trim();
}

export function getActiveApiKey(): string {
  if (getLlmProvider() === "openrouter") {
    return getOpenRouterApiKey();
  }
  return process.env.LM_STUDIO_API_KEY || "lm-studio";
}

export function providerLabel(provider: LlmProviderId = getLlmProvider()): string {
  return provider === "openrouter" ? "OpenRouter" : "LM Studio";
}

export function createChatClient(baseUrl?: string): OpenAI {
  const provider = getLlmProvider();
  const url = (baseUrl || getActiveBaseUrl()).replace(/\/$/, "");
  // OpenRouter anahtarı opsiyonel (liste için gerekmez); chat’te yoksa OR hata döner.
  const apiKey =
    provider === "openrouter"
      ? getOpenRouterApiKey() || "openrouter"
      : getActiveApiKey();

  const defaultHeaders =
    provider === "openrouter"
      ? {
          "HTTP-Referer":
            process.env.OPENROUTER_HTTP_REFERER || "http://localhost:3000",
          "X-Title": process.env.OPENROUTER_APP_TITLE || "PoliticalMatrix",
        }
      : undefined;

  return new OpenAI({
    baseURL: url,
    apiKey,
    timeout: 120_000,
    defaultHeaders,
  });
}

/** @deprecated createChatClient kullanın — geriye uyumluluk */
export function createLmClient(baseUrl?: string): OpenAI {
  return createChatClient(baseUrl);
}

export interface ModelListItem {
  id: string;
  name?: string;
  curated?: boolean;
  tools?: boolean;
}

export interface ModelListResult {
  connected: boolean;
  provider: LlmProviderId;
  provider_label: string;
  models: string[];
  model_items: ModelListItem[];
  error?: string;
}

type OpenRouterCatalogModel = {
  id: string;
  name?: string;
  supported_parameters?: string[];
  architecture?: { modality?: string; input_modalities?: string[] };
};

function supportsTools(m: OpenRouterCatalogModel): boolean {
  const params = m.supported_parameters || [];
  return params.includes("tools") || params.includes("tool_choice");
}

function isTextModel(m: OpenRouterCatalogModel): boolean {
  const modality = m.architecture?.modality || "";
  const inputs = m.architecture?.input_modalities || [];
  if (inputs.length > 0) return inputs.includes("text");
  if (!modality) return true;
  return modality.includes("text");
}

function curatedModelItems(): ModelListItem[] {
  return OPENROUTER_CURATED_MODELS.map((m) => ({
    id: m.id,
    name: m.label,
    curated: true,
    tools: true,
  }));
}

function buildOpenRouterModelList(
  raw: OpenRouterCatalogModel[]
): Pick<ModelListResult, "models" | "model_items"> {
  const toolModels = raw
    .filter((m) => m.id && isTextModel(m) && supportsTools(m))
    .map((m) => ({
      id: m.id,
      name: m.name || m.id,
      curated: false,
      tools: true,
    }));

  const curatedIds = new Set(OPENROUTER_CURATED_MODELS.map((m) => m.id));
  const curatedItems = curatedModelItems();

  const rest = toolModels
    .filter((m) => !curatedIds.has(m.id))
    .sort((a, b) => a.id.localeCompare(b.id));

  // Katalog boş/araçsız dönerse yine de canlı id’leri göster
  const fallbackLive =
    rest.length === 0
      ? raw
          .filter((m) => m.id && isTextModel(m))
          .map((m) => ({
            id: m.id,
            name: m.name || m.id,
            curated: false,
            tools: supportsTools(m),
          }))
          .filter((m) => !curatedIds.has(m.id))
          .sort((a, b) => a.id.localeCompare(b.id))
          .slice(0, 120)
      : rest.slice(0, 200);

  const model_items = [...curatedItems, ...fallbackLive];
  const seen = new Set<string>();
  const models: string[] = [];
  for (const item of model_items) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    models.push(item.id);
  }
  return { models, model_items };
}

async function fetchOpenRouterCatalog(
  apiKey?: string
): Promise<OpenRouterCatalogModel[]> {
  const base = getOpenRouterBaseUrl();
  const headers: Record<string, string> = {
    "HTTP-Referer":
      process.env.OPENROUTER_HTTP_REFERER || "http://localhost:3000",
    "X-Title": process.env.OPENROUTER_APP_TITLE || "PoliticalMatrix",
  };
  // Katalog herkese açık; anahtar varsa ekle (opsiyonel).
  if (apiKey) {
    headers.Authorization = `Bearer ${apiKey}`;
  }

  const res = await fetch(`${base}/models`, {
    headers,
    cache: "no-store",
    signal: AbortSignal.timeout(30_000),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(
      `OpenRouter modelleri alınamadı (${res.status}): ${body.slice(0, 200)}`
    );
  }

  const json = (await res.json()) as { data?: OpenRouterCatalogModel[] };
  return Array.isArray(json.data) ? json.data : [];
}

async function listOpenRouterModels(): Promise<ModelListResult> {
  const provider: LlmProviderId = "openrouter";
  const apiKey = getOpenRouterApiKey();

  try {
    let raw: OpenRouterCatalogModel[];
    try {
      raw = await fetchOpenRouterCatalog(apiKey || undefined);
    } catch (firstErr) {
      // Geçersiz anahtar katalogu bozmasın — anahtarsız public listeyi dene.
      if (apiKey) {
        raw = await fetchOpenRouterCatalog(undefined);
      } else {
        throw firstErr;
      }
    }

    const { models, model_items } = buildOpenRouterModelList(raw);
    return {
      connected: true,
      provider,
      provider_label: providerLabel(provider),
      models,
      model_items,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      connected: true,
      provider,
      provider_label: providerLabel(provider),
      models: OPENROUTER_CURATED_MODELS.map((m) => m.id),
      model_items: curatedModelItems(),
      error: `Katalog yenilenemedi (${message}). Önerilen modeller kullanılıyor.`,
    };
  }
}

async function listLmStudioModels(): Promise<ModelListResult> {
  const provider: LlmProviderId = "lm_studio";
  try {
    const client = createChatClient(getLmBaseUrl());
    const res = await client.models.list();
    const models = res.data.map((m) => m.id).sort();
    return {
      connected: true,
      provider,
      provider_label: providerLabel(provider),
      models,
      model_items: models.map((id) => ({ id, name: id, tools: true })),
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      connected: false,
      provider,
      provider_label: providerLabel(provider),
      models: [],
      model_items: [],
      error: message,
    };
  }
}

export async function listLlmModels(): Promise<ModelListResult> {
  if (getLlmProvider() === "openrouter") {
    return listOpenRouterModels();
  }
  return listLmStudioModels();
}

export async function listLmModels(): Promise<{
  connected: boolean;
  models: string[];
  error?: string;
}> {
  const r = await listLlmModels();
  return {
    connected: r.connected,
    models: r.models,
    error: r.error,
  };
}

export async function checkLmHealth(): Promise<boolean> {
  const r = await listLlmModels();
  return r.connected;
}
