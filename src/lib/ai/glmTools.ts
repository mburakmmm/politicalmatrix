import type { ChatCompletionTool } from "openai/resources/chat/completions";
import type { ParsedTextTool } from "./textToolParser";
import {
  pushCall,
  stripReasoningArtifacts,
} from "./toolFormatUtils";
import { toolsAsOpenAiFunctionDefs } from "./qwenTools";

/**
 * Zhipu / ChatGLM / GLM-4.5+ / GLM-4.7 tool-calling.
 * Format: <tool_call>fn_name<arg_key>k</arg_key><arg_value>v</arg_value></tool_call>
 * (JSON Hermes değil — Qwen <tool_call>{"name"...} ile karışmasın.)
 */
export function isGlmNativeToolModel(modelId: string): boolean {
  const id = modelId.toLowerCase();
  if (/chatglm|glm-?4|glm4|zai-org\/glm|zhipu/i.test(id)) return true;
  if (/\bglm\b/.test(id) && !/google|gemma/i.test(id)) return true;
  return false;
}

function toolLines(tools: ChatCompletionTool[], compact?: boolean): string {
  const defs = toolsAsOpenAiFunctionDefs(tools);
  return defs
    .map((d) => {
      const req = (
        (d.function.parameters as { required?: string[] } | undefined)
          ?.required || []
      ).join(", ");
      const desc = (d.function.description || "").slice(0, compact ? 60 : 120);
      return `- ${d.function.name}(${req}): ${desc}`;
    })
    .join("\n");
}

export function buildGlmSystemPrompt(opts: {
  partyName: string;
  ideologyPrompt?: string;
  tools: ChatCompletionTool[];
  forceTool?: string;
  compact?: boolean;
}): string {
  const identity = opts.compact
    ? `${opts.partyName}. Act via <tool_call> only.`
    : `${opts.partyName}. ${(opts.ideologyPrompt || "").slice(0, 280)}`;

  const force = opts.forceTool
    ? `\nYou MUST call ${opts.forceTool} now inside one <tool_call>…</tool_call> block. No essay.`
    : "\nWhen you act, emit exactly one <tool_call> block.";

  return [
    identity,
    "You are a political party agent with tools. Use GLM XML tool-call format.",
    "Available tools:",
    toolLines(opts.tools, opts.compact),
    "Format (function name immediately after <tool_call>, then arg pairs):",
    "<tool_call>functionName",
    "<arg_key>param</arg_key>",
    "<arg_value>value</arg_value>",
    "</tool_call>",
    "Rules: ONE call per turn. Turkish strings for speech/PR/message. No markdown fences.",
    force,
  ].join("\n");
}

export function buildGlmUserSuffix(forceTool?: string): string {
  if (forceTool) {
    return `\n\nRespond ONLY with:\n<tool_call>${forceTool}\n<arg_key>…</arg_key>\n<arg_value>…</arg_value>\n</tool_call>`;
  }
  return `\n\nIf you act, wrap the call in <tool_call>…</tool_call> with <arg_key>/<arg_value> pairs.`;
}

function coerceGlmValue(raw: string): unknown {
  const t = raw.trim();
  if (!t) return "";
  if (/^(true|false)$/i.test(t)) return /^true$/i.test(t);
  if (/^null$/i.test(t)) return null;
  if (/^-?\d+(\.\d+)?$/.test(t)) return Number(t);
  if (
    (t.startsWith("{") && t.endsWith("}")) ||
    (t.startsWith("[") && t.endsWith("]"))
  ) {
    try {
      return JSON.parse(t);
    } catch {
      /* fallthrough */
    }
  }
  if (
    (t.startsWith('"') && t.endsWith('"')) ||
    (t.startsWith("'") && t.endsWith("'"))
  ) {
    return t.slice(1, -1);
  }
  return t;
}

/** GLM arg_key/arg_value XML — JSON Hermes tool_call'ları dokunma */
export function parseGlmToolCalls(content: string): ParsedTextTool[] {
  const cleaned = stripReasoningArtifacts(content);
  if (!cleaned) return [];
  const found: ParsedTextTool[] = [];

  const blocks = cleaned.matchAll(/<tool_call>([\s\S]*?)<\/tool_call>/gi);
  for (const block of blocks) {
    const inner = block[1].trim();
    // JSON Hermes: {"name":...} → GLM değil
    if (/^\s*\{/.test(inner) && /"name"\s*:/.test(inner)) continue;
    // Qwen XML: <function=...>
    if (/<function\s*=/i.test(inner)) continue;

    const args: Record<string, unknown> = {};
    const pairs = [
      ...inner.matchAll(
        /<arg_key>\s*([\s\S]*?)\s*<\/arg_key>\s*<arg_value>\s*([\s\S]*?)\s*<\/arg_value>/gi
      ),
    ];
    for (const p of pairs) {
      const key = p[1].trim();
      if (!key) continue;
      args[key] = coerceGlmValue(p[2]);
    }

    let name = "";
    const keyIdx = inner.search(/<arg_key>/i);
    const namePart = (keyIdx >= 0 ? inner.slice(0, keyIdx) : inner)
      .replace(/<\/?tool_call>/gi, "")
      .trim();
    name = namePart.split(/[\s\n\r]+/)[0] || "";
    // Compact: name glued to <arg_key>
    if (!name && keyIdx > 0) {
      name = inner.slice(0, keyIdx).trim();
    }
    if (!name) continue;
    pushCall(found, name, args);
  }

  // Unclosed / truncated: <tool_call>holdRally<arg_key>...
  if (!found.length) {
    const open = cleaned.match(
      /<tool_call>\s*([A-Za-z_][\w]*)\s*((?:<arg_key>[\s\S]*)?)$/i
    );
    if (open) {
      const args: Record<string, unknown> = {};
      for (const p of open[2].matchAll(
        /<arg_key>\s*([\s\S]*?)\s*<\/arg_key>\s*<arg_value>\s*([\s\S]*?)(?:<\/arg_value>|$)/gi
      )) {
        args[p[1].trim()] = coerceGlmValue(p[2]);
      }
      pushCall(found, open[1], args);
    }
  }

  return found;
}

export function glmRecoveryUserHint(
  forceTool: string,
  argsExample: Record<string, unknown>
): string {
  const lines = Object.entries(argsExample).map(([k, v]) => {
    const val = typeof v === "string" ? v : JSON.stringify(v);
    return `<arg_key>${k}</arg_key>\n<arg_value>${val}</arg_value>`;
  });
  return `Output ONLY:\n<tool_call>${forceTool}\n${lines.join("\n")}\n</tool_call>`;
}

export function glmFewShot(
  tool: string,
  args: Record<string, unknown>
): string {
  return glmRecoveryUserHint(tool, args).replace(/^Output ONLY:\n/, "");
}
