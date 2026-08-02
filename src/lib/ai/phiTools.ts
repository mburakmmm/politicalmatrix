import type { ChatCompletionTool } from "openai/resources/chat/completions";
import type { ParsedTextTool } from "./textToolParser";
import {
  coerceArgs,
  extractBalancedArray,
  parsePythonishCall,
  pushCall,
  stripReasoningArtifacts,
} from "./toolFormatUtils";

/** Phi-4-mini(-instruct/reasoning) Microsoft native tool format */

export function isPhiNativeToolModel(modelId: string): boolean {
  return /phi-?4|phi4|phi-?3\.?5|phi3/i.test(modelId);
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
  * respect the argument type formatting (number as number, bool as true/false)
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

function pushPhiItem(
  found: ParsedTextTool[],
  item: Record<string, unknown>
): void {
  // {name, arguments} veya OpenAI tarzı {type, function:{name,arguments}}
  const fn =
    item.function && typeof item.function === "object"
      ? (item.function as Record<string, unknown>)
      : item;
  const name = String(fn.name || item.name || item.Name || "");
  if (!name) return;
  pushCall(
    found,
    name,
    fn.arguments ?? fn.parameters ?? item.arguments ?? item.Arguments ?? {}
  );
}

/**
 * Phi native: functools[{"name":"...","arguments":{...}}]
 * Ayrıca LM Studio / Ollama varyantları:
 *  - functor[...]
 *  - <|tool_call|>name\n{json}
 *  - ```json\nfunctools[...]\n```
 *  - tek obje: {"name":"...","arguments":{...}} functools sonrası
 */
export function parsePhiFunctools(content: string): ParsedTextTool[] {
  const cleaned = stripReasoningArtifacts(content);
  if (!cleaned) return [];
  const found: ParsedTextTool[] = [];
  const markers = ["functools", "functor"];

  for (const marker of markers) {
    let searchFrom = 0;
    const needle = marker.toLowerCase();
    while (searchFrom < cleaned.length) {
      const idx = cleaned.toLowerCase().indexOf(needle, searchFrom);
      if (idx === -1) break;
      const fromMarker = cleaned.slice(idx + marker.length);
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
          for (const item of arr) pushPhiItem(found, item);
        }
      } catch {
        // bozuk dilim — tek objeleri regex ile dene
        const objs = arrRaw.matchAll(/\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}/g);
        for (const om of objs) {
          try {
            pushPhiItem(found, JSON.parse(om[0]) as Record<string, unknown>);
          } catch {
            /* ignore */
          }
        }
      }
      searchFrom = idx + marker.length + bracketRel + arrRaw.length;
    }
  }

  // <|tool_call|>holdRally\n{"cityId":"..."}\n
  const tagged = cleaned.matchAll(
    /<\|tool_call\|>\s*([A-Za-z_][\w]*)\s*(\{[\s\S]*?\})?/gi
  );
  for (const m of tagged) {
    pushCall(found, m[1], m[2] ? coerceArgs(m[2]) : {});
  }

  // <|tool_call|>[{"name":...}]
  const taggedArr = cleaned.matchAll(/<\|tool_call\|>\s*(\[[\s\S]*?\])/gi);
  for (const m of taggedArr) {
    try {
      const arr = JSON.parse(m[1]) as Array<Record<string, unknown>>;
      if (Array.isArray(arr)) for (const item of arr) pushPhiItem(found, item);
    } catch {
      /* ignore */
    }
  }

  // Saf python-ish fallback (nadir)
  if (!found.length) {
    const py = cleaned.match(
      /\b((?:holdRally|voteOnBill|proposeLaw|negotiateCoalition|respondNegotiation|issuePRStatement|launchSmearCampaign|proposeAlliance|breakAlliance|moveConfidence|voteConfidence|proposeRegimeChange|declareEmergency|seizePower|callEarlyElection|proposeCustomBill)\s*\([^)]*\))/i
    );
    if (py) {
      const parsed = parsePythonishCall(py[1]);
      if (parsed) pushCall(found, parsed.name, parsed.args);
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
