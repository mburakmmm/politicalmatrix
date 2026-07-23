import type { ChatCompletionTool } from "openai/resources/chat/completions";
import type { ParsedTextTool } from "./textToolParser";

/** Phi-4-mini(-instruct/reasoning) Microsoft native tool format */

export function isPhiNativeToolModel(modelId: string): boolean {
  return /phi-?4|phi4/i.test(modelId);
}

type JsonSchemaProp = {
  type?: string | string[];
  description?: string;
  enum?: unknown[];
  items?: unknown;
  default?: unknown;
};

type JsonSchema = {
  type?: string;
  properties?: Record<string, JsonSchemaProp>;
  required?: string[];
};

/** OpenAI tools → Phi <|tool|> JSON (düz parameters map) */
export function openaiToolsToPhiCatalog(
  tools: ChatCompletionTool[]
): Array<{
  name: string;
  description: string;
  parameters: Record<
    string,
    { description: string; type: string; default?: unknown; enum?: unknown[] }
  >;
}> {
  const out: Array<{
    name: string;
    description: string;
    parameters: Record<
      string,
      { description: string; type: string; default?: unknown; enum?: unknown[] }
    >;
  }> = [];

  for (const t of tools) {
    if (t.type !== "function") continue;
    const schema = (t.function.parameters || {}) as JsonSchema;
    const props = schema.properties || {};
    const parameters: Record<
      string,
      { description: string; type: string; default?: unknown; enum?: unknown[] }
    > = {};

    for (const [key, def] of Object.entries(props)) {
      const rawType = Array.isArray(def.type) ? def.type[0] : def.type;
      let typeStr = "str";
      if (rawType === "number" || rawType === "integer") typeStr = "number";
      else if (rawType === "boolean") typeStr = "bool";
      else if (rawType === "array") typeStr = "list";
      else if (rawType === "object") typeStr = "dict";

      parameters[key] = {
        description: def.description || key,
        type: typeStr,
      };
      if (def.enum) parameters[key].enum = def.enum;
      if (def.default !== undefined) parameters[key].default = def.default;
    }

    out.push({
      name: t.function.name,
      description: t.function.description || t.function.name,
      parameters,
    });
  }

  return out;
}

const PHI_TOOL_RULES = `In addition to plain text responses, you can choose to call one or more of the provided functions.

Use the following rule to decide when to call a function:
  * if the response can be generated from your internal knowledge, do so
  * if you need to act in the simulation (vote, rally, negotiate, propose law, PR), generate a function call

If you decide to call functions:
  * prefix function calls with functools marker (no closing marker required)
  * all function calls should be generated in a single JSON list formatted as functools[{"name": [function name], "arguments": [function arguments as JSON]}, ...]
  * follow the provided JSON schema. Do not hallucinate arguments or values
  * respect the argument type formatting
  * pick the right functions that match the user intent
  * Turkish string arguments when the schema expects speech/text
  * Do NOT write strategy essays. Prefer a single functools[...] call.`;

/**
 * Microsoft Phi chat template: tools system içinde <|tool|>…<|/tool|>
 */
export function buildPhiSystemPrompt(opts: {
  partyName: string;
  ideologyPrompt?: string;
  tools: ChatCompletionTool[];
  forceTool?: string;
  compact?: boolean;
}): string {
  const catalog = openaiToolsToPhiCatalog(opts.tools);
  const toolJson = JSON.stringify(catalog);
  const identity = opts.compact
    ? `${opts.partyName}. Act via functools only.`
    : `${opts.partyName}. ${(opts.ideologyPrompt || "").slice(0, 280)}`;

  const force = opts.forceTool
    ? `\nYou MUST call ${opts.forceTool} now via functools[{"name":"${opts.forceTool}","arguments":{...}}]. No prose before functools.`
    : "\nCall at least one function via functools[...] when an action is needed.";

  return [
    "You are a helpful assistant with some tools.",
    identity,
    PHI_TOOL_RULES,
    force,
    `<|tool|>${toolJson}<|/tool|>`,
  ].join("\n");
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

/**
 * Phi native: functools[{"name":"...","arguments":{...}}]
 * vLLM phi4_mini_json ile aynı yüzey.
 */
export function parsePhiFunctools(content: string): ParsedTextTool[] {
  if (!content?.trim()) return [];
  const found: ParsedTextTool[] = [];
  const markers = ["functools", "functor", "<|tool_call|>"];

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
            const name = String(item.name || item.Name || "");
            if (!name) continue;
            const argsRaw =
              item.arguments ?? item.parameters ?? item.Arguments ?? {};
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
            if (!found.some((f) => f.name === name)) {
              found.push({ name, args });
            }
          }
        }
      } catch {
        // ignore malformed slice
      }
      searchFrom = idx + marker.length + bracketRel + arrRaw.length;
    }
  }

  // Bazı LM Studio şablonları <|tool_call|>name\n{json} basar
  const tagged = content.matchAll(
    /<\|tool_call\|>\s*([A-Za-z_][\w]*)\s*(\{[\s\S]*?\})?/gi
  );
  for (const m of tagged) {
    const name = m[1];
    let args: Record<string, unknown> = {};
    if (m[2]) {
      try {
        args = JSON.parse(m[2]) as Record<string, unknown>;
      } catch {
        args = {};
      }
    }
    if (!found.some((f) => f.name === name)) {
      found.push({ name, args });
    }
  }

  return found;
}

/** User turn sonuna Phi hatırlatması */
export function buildPhiUserSuffix(forceTool?: string): string {
  if (forceTool) {
    return `\n\nRespond ONLY with functools[{"name":"${forceTool}","arguments":{...}}] — no reasoning essay.`;
  }
  return `\n\nIf you act, respond with functools[{"name":"...","arguments":{...}}].`;
}
