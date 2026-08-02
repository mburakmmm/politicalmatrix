/**
 * Geriye uyumluluk: asıl implementasyon llmProvider.ts içinde.
 */
export {
  createLmClient,
  createChatClient,
  getLmBaseUrl,
  getActiveBaseUrl,
  getActiveApiKey,
  getLlmProvider,
  listLmModels,
  listLlmModels,
  checkLmHealth,
  providerLabel,
  OPENROUTER_CURATED_MODELS,
  OPENROUTER_DEFAULT_BASE,
  LM_STUDIO_DEFAULT_BASE,
} from "./llmProvider";
export type {
  LlmProviderId,
  ModelListItem,
  ModelListResult,
} from "./llmProvider";
