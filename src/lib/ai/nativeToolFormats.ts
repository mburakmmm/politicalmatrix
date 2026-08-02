import type { ChatCompletionTool } from "openai/resources/chat/completions";
import type { ParsedTextTool } from "./textToolParser";
import {
  buildGemmaSystemPrompt,
  buildGemmaUserSuffix,
  detectGemmaDialect,
  gemmaRecoveryUserHint,
  isGemmaNativeToolModel,
  parseGemmaToolCalls,
  type GemmaDialect,
} from "./gemmaTools";
import {
  buildPhiSystemPrompt,
  buildPhiUserSuffix,
  isPhiNativeToolModel,
  parsePhiFunctools,
} from "./phiTools";
import {
  buildQwenSystemPrompt as buildQwenFamilySystemPrompt,
  buildQwenUserSuffix as buildQwenFamilyUserSuffix,
  detectQwenDialect,
  isQwenNativeToolModel,
  parseQwenToolCalls as parseQwenFamilyToolCalls,
  qwenRecoveryUserHint,
  toolsAsOpenAiFunctionDefs,
  type QwenDialect,
} from "./qwenTools";
import {
  buildLlamaSystemPrompt,
  buildLlamaUserSuffix,
  detectLlamaDialect,
  isLlamaNativeToolModel,
  llamaRecoveryUserHint,
  parseLlamaToolCalls,
  type LlamaDialect,
} from "./llamaTools";
import {
  buildGlmSystemPrompt,
  buildGlmUserSuffix,
  glmRecoveryUserHint,
  isGlmNativeToolModel,
  parseGlmToolCalls,
} from "./glmTools";
import {
  buildHarmonySystemPrompt,
  buildHarmonyUserSuffix,
  harmonyRecoveryUserHint,
  isHarmonyNativeToolModel,
  parseHarmonyToolCalls,
} from "./harmonyTools";
import {
  buildMistralSystemPrompt,
  buildMistralUserSuffix,
  isMistralNativeToolModel,
  mistralRecoveryUserHint,
  parseMistralToolCalls,
} from "./mistralTools";
import {
  buildInstructSystemPrompt,
  buildInstructUserSuffix,
  instructRecoveryUserHint,
  isInstructNativeToolModel,
  parseInstructToolCalls,
  parseJsonFunctionBlobs,
} from "./instructTools";

export type NativeToolFamily =
  | "phi"
  | "qwen"
  | "qwen_xml"
  | "gemma"
  | "functiongemma"
  | "mistral"
  | "llama"
  | "llama_json"
  | "glm"
  | "harmony"
  | "instruct";

export type NativeToolProfile = {
  family: NativeToolFamily;
  qwenDialect?: QwenDialect;
  gemmaDialect?: GemmaDialect;
  llamaDialect?: LlamaDialect;
};

/**
 * Phi / Qwen / Gemma / Mistral-Ministral / Llama / GLM / gpt-oss Harmony /
 * Bonsai-Instruct — OpenAI tools API yerine native chat formatı.
 *
 * Tespit sırası spesifik → genel (instruct en sonda).
 */
export function detectNativeToolProfile(
  modelId: string
): NativeToolProfile | null {
  if (isPhiNativeToolModel(modelId)) {
    return { family: "phi" };
  }
  if (isQwenNativeToolModel(modelId)) {
    const dialect = detectQwenDialect(modelId);
    return {
      family: dialect === "xml" ? "qwen_xml" : "qwen",
      qwenDialect: dialect,
    };
  }
  if (isGemmaNativeToolModel(modelId)) {
    const dialect = detectGemmaDialect(modelId);
    return {
      family: dialect === "functiongemma" ? "functiongemma" : "gemma",
      gemmaDialect: dialect,
    };
  }
  if (isGlmNativeToolModel(modelId)) {
    return { family: "glm" };
  }
  if (isHarmonyNativeToolModel(modelId)) {
    return { family: "harmony" };
  }
  if (isMistralNativeToolModel(modelId)) {
    return { family: "mistral" };
  }
  if (isLlamaNativeToolModel(modelId)) {
    const dialect = detectLlamaDialect(modelId);
    return {
      family: dialect === "json" ? "llama_json" : "llama",
      llamaDialect: dialect,
    };
  }
  if (isInstructNativeToolModel(modelId)) {
    return { family: "instruct" };
  }
  return null;
}

export function detectNativeToolFamily(
  modelId: string
): NativeToolFamily | null {
  return detectNativeToolProfile(modelId)?.family ?? null;
}

export function isNativeToolModel(modelId: string): boolean {
  return detectNativeToolProfile(modelId) !== null;
}

export { toolsAsOpenAiFunctionDefs, parseMistralToolCalls };

/** Geriye uyum: Hermes varsayılan Qwen system prompt */
export function buildQwenSystemPrompt(opts: {
  partyName: string;
  ideologyPrompt?: string;
  tools: ChatCompletionTool[];
  forceTool?: string;
  compact?: boolean;
}): string {
  return buildQwenFamilySystemPrompt("hermes", opts);
}

export function buildQwenUserSuffix(forceTool?: string): string {
  return buildQwenFamilyUserSuffix("hermes", forceTool);
}

/** Geriye uyum: her iki Qwen diyalektini dener */
export function parseQwenToolCalls(content: string): ParsedTextTool[] {
  return parseQwenFamilyToolCalls(content, null);
}

// ─── Dispatcher ─────────────────────────────────────────────────────────────

function resolveQwenDialect(
  family: NativeToolFamily,
  profile?: NativeToolProfile | null
): QwenDialect {
  if (profile?.qwenDialect) return profile.qwenDialect;
  return family === "qwen_xml" ? "xml" : "hermes";
}

function resolveGemmaDialect(
  family: NativeToolFamily,
  profile?: NativeToolProfile | null
): GemmaDialect {
  if (profile?.gemmaDialect) return profile.gemmaDialect;
  return family === "functiongemma" ? "functiongemma" : "tool_code";
}

function resolveLlamaDialect(
  family: NativeToolFamily,
  profile?: NativeToolProfile | null
): LlamaDialect {
  if (profile?.llamaDialect) return profile.llamaDialect;
  return family === "llama_json" ? "json" : "hermes";
}

export function buildNativeSystemPrompt(
  family: NativeToolFamily,
  opts: {
    partyName: string;
    ideologyPrompt?: string;
    tools: ChatCompletionTool[];
    forceTool?: string;
    compact?: boolean;
  },
  profile?: NativeToolProfile | null
): string {
  if (family === "phi") return buildPhiSystemPrompt(opts);
  if (family === "qwen" || family === "qwen_xml") {
    return buildQwenFamilySystemPrompt(
      resolveQwenDialect(family, profile),
      opts
    );
  }
  if (family === "gemma" || family === "functiongemma") {
    return buildGemmaSystemPrompt(resolveGemmaDialect(family, profile), opts);
  }
  if (family === "llama" || family === "llama_json") {
    return buildLlamaSystemPrompt({
      ...opts,
      dialect: resolveLlamaDialect(family, profile),
    });
  }
  if (family === "glm") return buildGlmSystemPrompt(opts);
  if (family === "harmony") return buildHarmonySystemPrompt(opts);
  if (family === "instruct") return buildInstructSystemPrompt(opts);
  return buildMistralSystemPrompt(opts);
}

export function buildNativeUserSuffix(
  family: NativeToolFamily,
  forceTool?: string,
  profile?: NativeToolProfile | null
): string {
  if (family === "phi") return buildPhiUserSuffix(forceTool);
  if (family === "qwen" || family === "qwen_xml") {
    return buildQwenFamilyUserSuffix(
      resolveQwenDialect(family, profile),
      forceTool
    );
  }
  if (family === "gemma" || family === "functiongemma") {
    return buildGemmaUserSuffix(resolveGemmaDialect(family, profile), forceTool);
  }
  if (family === "llama" || family === "llama_json") {
    return buildLlamaUserSuffix(
      resolveLlamaDialect(family, profile),
      forceTool
    );
  }
  if (family === "glm") return buildGlmUserSuffix(forceTool);
  if (family === "harmony") return buildHarmonyUserSuffix(forceTool);
  if (family === "instruct") return buildInstructUserSuffix(forceTool);
  return buildMistralUserSuffix(forceTool);
}

export function parseNativeToolCalls(
  family: NativeToolFamily | null | undefined,
  content: string,
  profile?: NativeToolProfile | null
): ParsedTextTool[] {
  if (!content?.trim()) return [];
  if (family === "phi") return parsePhiFunctools(content);
  if (family === "qwen" || family === "qwen_xml") {
    return parseQwenFamilyToolCalls(
      content,
      resolveQwenDialect(family, profile)
    );
  }
  if (family === "gemma" || family === "functiongemma") {
    return parseGemmaToolCalls(content, resolveGemmaDialect(family, profile));
  }
  if (family === "mistral") return parseMistralToolCalls(content);
  if (family === "llama" || family === "llama_json") {
    return parseLlamaToolCalls(
      content,
      resolveLlamaDialect(family, profile)
    );
  }
  if (family === "glm") return parseGlmToolCalls(content);
  if (family === "harmony") return parseHarmonyToolCalls(content);
  if (family === "instruct") return parseInstructToolCalls(content);

  // Family bilinmiyor: tüm diyalektleri dene (önce spesifik XML/Harmony)
  return [
    ...parseGlmToolCalls(content),
    ...parseHarmonyToolCalls(content),
    ...parsePhiFunctools(content),
    ...parseQwenFamilyToolCalls(content, null),
    ...parseGemmaToolCalls(content, null),
    ...parseMistralToolCalls(content),
    ...parseLlamaToolCalls(content, null),
    ...parseInstructToolCalls(content),
    ...parseJsonFunctionBlobs(content),
  ];
}

export function nativeRecoveryUserHint(
  family: NativeToolFamily,
  forceTool: string,
  argsExample: Record<string, unknown>,
  profile?: NativeToolProfile | null
): string {
  const argsJson = JSON.stringify(argsExample);
  if (family === "phi") {
    return `Output ONLY:\nfunctools[{"name":"${forceTool}","arguments":${argsJson}}]`;
  }
  if (family === "qwen" || family === "qwen_xml") {
    return qwenRecoveryUserHint(
      resolveQwenDialect(family, profile),
      forceTool,
      argsExample
    );
  }
  if (family === "gemma" || family === "functiongemma") {
    return gemmaRecoveryUserHint(
      resolveGemmaDialect(family, profile),
      forceTool,
      argsExample
    );
  }
  if (family === "llama" || family === "llama_json") {
    return llamaRecoveryUserHint(
      resolveLlamaDialect(family, profile),
      forceTool,
      argsExample
    );
  }
  if (family === "glm") return glmRecoveryUserHint(forceTool, argsExample);
  if (family === "harmony") {
    return harmonyRecoveryUserHint(forceTool, argsExample);
  }
  if (family === "instruct") {
    return instructRecoveryUserHint(forceTool, argsExample);
  }
  return mistralRecoveryUserHint(forceTool, argsExample);
}
