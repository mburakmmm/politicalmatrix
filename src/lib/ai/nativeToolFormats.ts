import type { ChatCompletionTool } from "openai/resources/chat/completions";
import type { ParsedTextTool } from "./textToolParser";
import {
  buildPhiSystemPrompt,
  buildPhiUserSuffix,
  isPhiNativeToolModel,
  parsePhiFunctools,
} from "./phiTools";

export type NativeToolFamily = "phi" | "qwen" | "mistral";

/**
 * Qwen 2.5 / 3 / 3.5 / QwQ, Mistral/Mixtral/Ministral, Phi-4
 * — OpenAI tools API yerine native chat formatı.
 */
export function detectNativeToolFamily(
  modelId: string
): NativeToolFamily | null {
  if (isPhiNativeToolModel(modelId)) return "phi";
  // Qwen2.5, Qwen3, Qwen3.5, QwQ, Qwen2-VL tool-capable text, vs.
  if (/qwen|qwq/i.test(modelId)) return "qwen";
  if (/mistral|mixtral|ministral|codestral/i.test(modelId)) return "mistral";
  return null;
}

export function isNativeToolModel(modelId: string): boolean {
  return detectNativeToolFamily(modelId) !== null;
}

/** OpenAI tools → standart function descriptor (Qwen/Mistral) */
export function toolsAsOpenAiFunctionDefs(
  tools: ChatCompletionTool[]
): Array<{
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}> {
  return tools
    .filter((t) => t.type === "function")
    .map((t) => ({
      type: "function" as const,
      function: {
        name: t.function.name,
        description: t.function.description || t.function.name,
        parameters: (t.function.parameters || {
          type: "object",
          properties: {},
        }) as Record<string, unknown>,
      },
    }));
}

function extractBalancedArray(src: string, fromIdx: number): string | null {
  if (src[fromIdx] !== "[") return null;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = fromIdx; i < src.length; i++) {
    const ch = src[i];
    if (inStr) {
      if (esc) {
        esc = false;
        continue;
      }
      if (ch === "\\") {
        esc = true;
        continue;
      }
      if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') {
      inStr = true;
      continue;
    }
    if (ch === "[") depth++;
    else if (ch === "]") {
      depth--;
      if (depth === 0) return src.slice(fromIdx, i + 1);
    }
  }
  return null;
}

function pushCall(
  found: ParsedTextTool[],
  name: string,
  argsRaw: unknown
): void {
  if (!name || found.some((f) => f.name === name)) return;
  let args: Record<string, unknown> = {};
  if (typeof argsRaw === "string") {
    try {
      args = JSON.parse(argsRaw) as Record<string, unknown>;
    } catch {
      args = {};
    }
  } else if (argsRaw && typeof argsRaw === "object") {
    args = argsRaw as Record<string, unknown>;
  }
  found.push({ name, args });
}

// ─── Qwen Hermes (2.5 / 3 / 3.5 / QwQ) ─────────────────────────────────────

export function buildQwenSystemPrompt(opts: {
  partyName: string;
  ideologyPrompt?: string;
  tools: ChatCompletionTool[];
  forceTool?: string;
  compact?: boolean;
}): string {
  const defs = toolsAsOpenAiFunctionDefs(opts.tools);
  const toolLines = defs.map((d) => JSON.stringify(d)).join("\n");
  const identity = opts.compact
    ? `${opts.partyName}. Act via <tool_call> only.`
    : `${opts.partyName}. ${(opts.ideologyPrompt || "").slice(0, 280)}`;

  const force = opts.forceTool
    ? `\nYou MUST call ${opts.forceTool} now inside a <tool_call> block. No prose before the tag.`
    : "\nCall at least one function via <tool_call> when an action is needed.";

  return [
    "You are Qwen, a helpful assistant with function calling.",
    identity,
    "",
    "# Tools",
    "",
    "You may call one or more functions to assist with the user query.",
    "",
    "You are provided with function signatures within <tools></tools> XML tags:",
    "<tools>",
    toolLines,
    "</tools>",
    "",
    "For each function call, return a json object with function name and arguments within <tool_call></tool_call> XML tags:",
    "<tool_call>",
    '{"name": <function-name>, "arguments": <args-json-object>}',
    "</tool_call>",
    "Turkish string arguments when the schema expects speech/text.",
    "Do NOT write long strategy essays. Prefer a single <tool_call>.",
    force,
  ].join("\n");
}

export function buildQwenUserSuffix(forceTool?: string): string {
  if (forceTool) {
    return `\n\nRespond ONLY with:\n<tool_call>\n{"name":"${forceTool}","arguments":{...}}\n</tool_call>`;
  }
  return `\n\nIf you act, wrap the call in <tool_call>...</tool_call>.`;
}

/** Hermes / Qwen: <tool_call>{"name","arguments"}</tool_call> */
export function parseQwenToolCalls(content: string): ParsedTextTool[] {
  if (!content?.trim()) return [];
  const found: ParsedTextTool[] = [];

  const blocks = content.matchAll(
    /<tool_call>\s*([\s\S]*?)\s*<\/tool_call>/gi
  );
  for (const m of blocks) {
    const inner = m[1].trim();
    try {
      const obj = JSON.parse(inner) as Record<string, unknown>;
      const name = String(obj.name || "");
      pushCall(found, name, obj.arguments ?? obj.parameters ?? {});
    } catch {
      const name = inner.match(/"name"\s*:\s*"(\w+)"/)?.[1];
      const argsMatch = inner.match(/"arguments"\s*:\s*(\{[\s\S]*\})/);
      if (name) {
        let args: unknown = {};
        if (argsMatch) {
          try {
            args = JSON.parse(argsMatch[1]);
          } catch {
            args = {};
          }
        }
        pushCall(found, name, args);
      }
    }
  }

  // Kapanmamış / stream kesik
  const open = content.match(/<tool_call>\s*(\{[\s\S]*)$/i);
  if (open && !found.length) {
    try {
      const obj = JSON.parse(open[1]) as Record<string, unknown>;
      pushCall(found, String(obj.name || ""), obj.arguments ?? {});
    } catch {
      /* ignore */
    }
  }

  return found;
}

// ─── Mistral [AVAILABLE_TOOLS] / [TOOL_CALLS] ───────────────────────────────

export function buildMistralSystemPrompt(opts: {
  partyName: string;
  ideologyPrompt?: string;
  tools: ChatCompletionTool[];
  forceTool?: string;
  compact?: boolean;
}): string {
  const defs = toolsAsOpenAiFunctionDefs(opts.tools);
  // Mistral chat template araçları AVAILABLE_TOOLS içinde tutar; system'e gömüyoruz
  const toolsJson = JSON.stringify(defs);
  const identity = opts.compact
    ? `${opts.partyName}. Reply with [TOOL_CALLS] only.`
    : `${opts.partyName}. ${(opts.ideologyPrompt || "").slice(0, 280)}`;

  const force = opts.forceTool
    ? `\nYou MUST emit [TOOL_CALLS][{"name":"${opts.forceTool}","arguments":{...}}] now. No essay.`
    : "\nWhen you act, emit [TOOL_CALLS] followed by a JSON array of calls.";

  return [
    identity,
    "You have access to tools. Use Mistral function-calling format.",
    `[AVAILABLE_TOOLS]${toolsJson}[/AVAILABLE_TOOLS]`,
    "To call tools, output exactly:",
    '[TOOL_CALLS][{"name":"<function>","arguments":{...}}]',
    "Optional id field (9 chars) is allowed. Turkish args for speech fields.",
    force,
  ].join("\n");
}

export function buildMistralUserSuffix(forceTool?: string): string {
  if (forceTool) {
    return `\n\nRespond ONLY with:\n[TOOL_CALLS][{"name":"${forceTool}","arguments":{...}}]`;
  }
  return `\n\nIf you act, prefix with [TOOL_CALLS] and a JSON array.`;
}

/** Mistral: [TOOL_CALLS][{"name","arguments","id"?}] */
export function parseMistralToolCalls(content: string): ParsedTextTool[] {
  if (!content?.trim()) return [];
  const found: ParsedTextTool[] = [];
  const markers = ["[TOOL_CALLS]", "TOOL_CALLS"];

  for (const marker of markers) {
    let searchFrom = 0;
    const needle = marker.toLowerCase();
    while (searchFrom < content.length) {
      const idx = content.toLowerCase().indexOf(needle, searchFrom);
      if (idx === -1) break;
      const fromMarker = content.slice(idx + marker.length);
      const bracketRel = fromMarker.search(/\[/);
      if (bracketRel === -1) {
        searchFrom = idx + marker.length;
        continue;
      }
      const arrRaw = extractBalancedArray(fromMarker, bracketRel);
      if (!arrRaw) {
        searchFrom = idx + marker.length;
        continue;
      }
      try {
        const arr = JSON.parse(arrRaw) as Array<Record<string, unknown>>;
        if (Array.isArray(arr)) {
          for (const item of arr) {
            // Bazen {type,function:{name,arguments}} gelir
            const fn = (item.function as Record<string, unknown>) || item;
            const name = String(fn.name || item.name || "");
            pushCall(found, name, fn.arguments ?? item.arguments ?? {});
          }
        }
      } catch {
        /* ignore */
      }
      searchFrom = idx + marker.length + bracketRel + arrRaw.length;
    }
  }

  return found;
}

// ─── Dispatcher ─────────────────────────────────────────────────────────────

export function buildNativeSystemPrompt(
  family: NativeToolFamily,
  opts: {
    partyName: string;
    ideologyPrompt?: string;
    tools: ChatCompletionTool[];
    forceTool?: string;
    compact?: boolean;
  }
): string {
  if (family === "phi") return buildPhiSystemPrompt(opts);
  if (family === "qwen") return buildQwenSystemPrompt(opts);
  return buildMistralSystemPrompt(opts);
}

export function buildNativeUserSuffix(
  family: NativeToolFamily,
  forceTool?: string
): string {
  if (family === "phi") return buildPhiUserSuffix(forceTool);
  if (family === "qwen") return buildQwenUserSuffix(forceTool);
  return buildMistralUserSuffix(forceTool);
}

export function parseNativeToolCalls(
  family: NativeToolFamily | null | undefined,
  content: string
): ParsedTextTool[] {
  if (!content?.trim()) return [];
  if (family === "phi") return parsePhiFunctools(content);
  if (family === "qwen") return parseQwenToolCalls(content);
  if (family === "mistral") return parseMistralToolCalls(content);

  // Family bilinmiyorsa hepsini dene (LM Studio bazen karışık basar)
  return [
    ...parsePhiFunctools(content),
    ...parseQwenToolCalls(content),
    ...parseMistralToolCalls(content),
  ];
}

export function nativeRecoveryUserHint(
  family: NativeToolFamily,
  forceTool: string,
  argsExample: Record<string, unknown>
): string {
  const argsJson = JSON.stringify(argsExample);
  if (family === "phi") {
    return `Output ONLY:\nfunctools[{"name":"${forceTool}","arguments":${argsJson}}]`;
  }
  if (family === "qwen") {
    return `Output ONLY:\n<tool_call>\n{"name":"${forceTool}","arguments":${argsJson}}\n</tool_call>`;
  }
  return `Output ONLY:\n[TOOL_CALLS][{"name":"${forceTool}","arguments":${argsJson}}]`;
}
