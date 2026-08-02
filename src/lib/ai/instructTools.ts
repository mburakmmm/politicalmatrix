import type { ChatCompletionTool } from "openai/resources/chat/completions";
import type { ParsedTextTool } from "./textToolParser";
import {
  extractBalancedArray,
  extractBalancedObject,
  pushCall,
  stripReasoningArtifacts,
} from "./toolFormatUtils";
import { toolsAsOpenAiFunctionDefs } from "./qwenTools";
import { parseLlamaToolCalls } from "./llamaTools";

/**
 * Bonsai / generic *-Instruct / small local chat models.
 * OpenAI tools API zayıf kalınca Path A: kompakt Hermes JSON + düz JSON blob.
 * Bonsai BFCL'de yapısal tool-use güçlü → kısa şema + tek çağrı disiplini.
 */
export function isInstructNativeToolModel(modelId: string): boolean {
  const id = modelId.toLowerCase();
  if (/bonsai|prism-?ml\/bonsai/i.test(id)) return true;
  // Spesifik aileleri çalma — detect sırası zaten korur; çift emniyet
  if (
    /llama|qwen|gemma|phi|mistral|ministral|mixtral|codestral|glm|chatglm|gpt-?oss|nemotron|hermes|deepseek/i.test(
      id
    )
  ) {
    return false;
  }
  if (/\binstruct\b/.test(id)) return true;
  if (/\bchat\b/.test(id) && /(?:^|[^0-9])(1|2|3|4|7|8|9)b(?:[^0-9]|$)/.test(id)) {
    return true;
  }
  return false;
}

function slimToolLines(tools: ChatCompletionTool[], compact?: boolean): string {
  const defs = toolsAsOpenAiFunctionDefs(tools);
  return defs
    .map((d) => {
      const req = (
        (d.function.parameters as { required?: string[] } | undefined)
          ?.required || []
      ).join(",");
      const desc = (d.function.description || d.function.name).slice(
        0,
        compact ? 48 : 90
      );
      return `- ${d.function.name}(${req}) — ${desc}`;
    })
    .join("\n");
}

export function buildInstructSystemPrompt(opts: {
  partyName: string;
  ideologyPrompt?: string;
  tools: ChatCompletionTool[];
  forceTool?: string;
  compact?: boolean;
}): string {
  const identity = opts.compact
    ? `${opts.partyName}. Output one tool call only.`
    : `${opts.partyName}. ${(opts.ideologyPrompt || "").slice(0, 220)}`;

  const force = opts.forceTool
    ? `\nYou MUST call ${opts.forceTool} now. Output ONLY the tool-call block.`
    : "\nWhen you act, emit exactly ONE tool call — no strategy essay.";

  return [
    identity,
    "You are a political party agent. Prefer structured tool calls.",
    "Preferred format (Hermes):",
    "<tool_call>",
    '{"name":"<function>","arguments":{...}}',
    "</tool_call>",
    "Also accepted: bare JSON {\"name\":\"…\",\"arguments\":{…}} or {\"name\":\"…\",\"parameters\":{…}}.",
    "Tools:",
    slimToolLines(opts.tools, opts.compact),
    "Rules: Turkish speech/PR text. lawId from catalog only. ONE call.",
    force,
  ].join("\n");
}

export function buildInstructUserSuffix(forceTool?: string): string {
  if (forceTool) {
    return `\n\nRespond ONLY with:\n<tool_call>\n{"name":"${forceTool}","arguments":{...}}\n</tool_call>`;
  }
  return `\n\nIf you act, emit one <tool_call> JSON block (or bare {"name","arguments"}).`;
}

/** Düz JSON tool blob’ları — name + arguments|parameters|args */
export function parseJsonFunctionBlobs(content: string): ParsedTextTool[] {
  const cleaned = stripReasoningArtifacts(content);
  if (!cleaned) return [];
  const found: ParsedTextTool[] = [];

  let searchFrom = 0;
  while (searchFrom < cleaned.length) {
    const idx = cleaned.indexOf("{", searchFrom);
    if (idx === -1) break;
    const raw = extractBalancedObject(cleaned, idx);
    if (!raw) {
      searchFrom = idx + 1;
      continue;
    }
    searchFrom = idx + raw.length;
    try {
      const obj = JSON.parse(raw) as Record<string, unknown>;
      const name = String(
        obj.name ||
          (obj.function as { name?: string } | undefined)?.name ||
          ""
      );
      if (!name) continue;
      const args =
        obj.arguments ??
        obj.parameters ??
        obj.args ??
        (obj.function as { arguments?: unknown } | undefined)?.arguments ??
        {};
      pushCall(found, name, args);
    } catch {
      /* ignore */
    }
  }

  // Array of calls
  searchFrom = 0;
  while (searchFrom < cleaned.length) {
    const idx = cleaned.indexOf("[", searchFrom);
    if (idx === -1) break;
    const raw = extractBalancedArray(cleaned, idx);
    if (!raw) {
      searchFrom = idx + 1;
      continue;
    }
    searchFrom = idx + raw.length;
    try {
      const arr = JSON.parse(raw) as unknown[];
      if (!Array.isArray(arr)) continue;
      for (const item of arr) {
        if (!item || typeof item !== "object") continue;
        const row = item as Record<string, unknown>;
        const fn = (row.function as Record<string, unknown>) || row;
        const name = String(fn.name || row.name || "");
        if (!name) continue;
        pushCall(found, name, fn.arguments ?? row.arguments ?? row.parameters ?? {});
      }
    } catch {
      /* ignore */
    }
  }

  return found;
}

export function parseInstructToolCalls(content: string): ParsedTextTool[] {
  const cleaned = stripReasoningArtifacts(content);
  if (!cleaned) return [];
  // Hermes first, then bare JSON blobs
  const hermes = parseLlamaToolCalls(cleaned, "hermes");
  if (hermes.length) return hermes;
  const jsonDialect = parseLlamaToolCalls(cleaned, "json");
  if (jsonDialect.length) return jsonDialect;
  return parseJsonFunctionBlobs(cleaned);
}

export function instructRecoveryUserHint(
  forceTool: string,
  argsExample: Record<string, unknown>
): string {
  const json = JSON.stringify({ name: forceTool, arguments: argsExample });
  return `Output ONLY:\n<tool_call>\n${json}\n</tool_call>`;
}

export function instructFewShot(
  tool: string,
  args: Record<string, unknown>
): string {
  return instructRecoveryUserHint(tool, args).replace(/^Output ONLY:\n/, "");
}
