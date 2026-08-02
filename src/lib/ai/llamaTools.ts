import type { ChatCompletionTool } from "openai/resources/chat/completions";
import type { ParsedTextTool } from "./textToolParser";
import {
  parseQwenToolCalls,
  toolsAsOpenAiFunctionDefs,
} from "./qwenTools";
import {
  extractBalancedObject,
  parsePythonishCall,
  pushCall,
  stripReasoningArtifacts,
} from "./toolFormatUtils";
import { clipPartyIdeologyPrompt } from "./prompts";

/**
 * Llama 3.1 / 3.2 / 3.3 Instruct + Hermes-Llama + Nemotron.
 * Küçük 3.2-3B OpenAI tools şemasında context şişer → 30–40 token kesilir;
 * native Hermes / JSON (`python_tag`) kullanılır — Phi/Qwen Path A ile aynı disiplin.
 */
export type LlamaDialect = "hermes" | "json";

const LLAMA_TOOL_NAMES =
  "holdRally|voteOnBill|proposeLaw|negotiateCoalition|respondNegotiation|issuePRStatement|launchSmearCampaign|proposeAlliance|breakAlliance|moveConfidence|voteConfidence|proposeRegimeChange|declareEmergency|seizePower|callEarlyElection|proposeCustomBill";

const LLAMA_RULES = `Function-calling rules:
  * Prefer exactly ONE tool call per turn — no strategy essays
  * lawId MUST be a catalog id like economy_t2 / citizenship_t1 — never party_… or UUID
  * Use slug or party id from the choice card for targetPartyId / partyId
  * Turkish strings for speechText / statementText / focusTopic / message
  * Do not invent billId / negotiationId — copy from the choice card
  * Do not wrap the call in markdown fences unless required by the format`;

export function isLlamaNativeToolModel(modelId: string): boolean {
  const id = modelId.toLowerCase();
  if (/hermes.*llama|llama.*hermes/i.test(id)) return true;
  if (/nemotron|llama-?3(\.[123])?/i.test(id)) return true;
  if (/meta-llama|meta\/llama/i.test(id)) return true;
  if (/\bllama\b/i.test(id) && /instruct|chat|3\.[123]/i.test(id)) return true;
  return false;
}

/**
 * Tiny 3.2 1B/3B → Hermes tags (Path A few-shot daha stabil).
 * Meta 3.1 / 3.3 / 8B+ / 70B → resmi JSON + <|python_tag|>.
 */
export function detectLlamaDialect(modelId: string): LlamaDialect {
  const id = modelId.toLowerCase();
  if (/hermes/.test(id)) return "hermes";
  // Llama 3.2 1B / 3B only (not 11B / 90B)
  if (/3\.2/.test(id) && /(?:^|[^0-9])(1|3)b\b/.test(id)) return "hermes";
  if (/llama-3\.2-(1|3)b/.test(id)) return "hermes";
  return "json";
}

/** Tiny prompt: şemayı kısalt — 3B context’i koru */
function toolDefsForPrompt(
  tools: ChatCompletionTool[],
  compact: boolean
): ReturnType<typeof toolsAsOpenAiFunctionDefs> {
  const defs = toolsAsOpenAiFunctionDefs(tools);
  if (!compact) return defs;
  return defs.map((d) => {
    const params = (d.function.parameters || {}) as {
      type?: string;
      properties?: Record<string, { type?: unknown; enum?: unknown[] }>;
      required?: string[];
    };
    const props = params.properties || {};
    const slimProps: Record<string, { type?: unknown; enum?: unknown[] }> = {};
    for (const [k, v] of Object.entries(props)) {
      slimProps[k] = {
        type: Array.isArray(v.type) ? v.type[0] : v.type,
        ...(v.enum?.length ? { enum: v.enum } : {}),
      };
    }
    return {
      type: "function" as const,
      function: {
        name: d.function.name,
        description: (d.function.description || d.function.name).slice(0, 72),
        parameters: {
          type: "object",
          properties: slimProps,
          required: params.required || [],
        },
      },
    };
  });
}

export function buildLlamaHermesSystemPrompt(opts: {
  partyName: string;
  ideologyPrompt?: string;
  tools: ChatCompletionTool[];
  forceTool?: string;
  compact?: boolean;
}): string {
  const defs = toolDefsForPrompt(opts.tools, !!opts.compact);
  const toolLines = defs.map((d) => JSON.stringify(d)).join("\n");
  const identity = opts.compact
    ? `${opts.partyName}. Act via <tool_call> only.`
    : `${opts.partyName}. ${clipPartyIdeologyPrompt(opts.ideologyPrompt || "")}`;

  const force = opts.forceTool
    ? `\nYou MUST call ${opts.forceTool} now inside a <tool_call> block. No prose before the tag.`
    : "\nCall at least one function via <tool_call> when an action is needed.";

  return [
    "You are Llama Instruct, a political simulation agent with function calling.",
    identity,
    "",
    "# Tools",
    "You are provided with function signatures within <tools></tools> XML tags:",
    "<tools>",
    toolLines,
    "</tools>",
    "",
    "For each function call, return a json object with function name and arguments within <tool_call></tool_call> XML tags:",
    "<tool_call>",
    '{"name": <function-name>, "arguments": <args-json-object>}',
    "</tool_call>",
    LLAMA_RULES,
    force,
  ].join("\n");
}

export function buildLlamaJsonSystemPrompt(opts: {
  partyName: string;
  ideologyPrompt?: string;
  tools: ChatCompletionTool[];
  forceTool?: string;
  compact?: boolean;
}): string {
  const defs = toolDefsForPrompt(opts.tools, !!opts.compact);
  const toolsJson = JSON.stringify(defs);
  const identity = opts.compact
    ? `${opts.partyName}. Emit ONE JSON tool call only.`
    : `${opts.partyName}. ${clipPartyIdeologyPrompt(opts.ideologyPrompt || "")}`;

  const force = opts.forceTool
    ? `\nYou MUST call ${opts.forceTool} now as a single JSON object. No prose.`
    : "\nWhen acting, emit a single JSON tool call object.";

  return [
    "You are Llama Instruct with Meta-style function calling.",
    identity,
    `Available tools: ${toolsJson}`,
    "Output format (exactly one object, no markdown):",
    '{"name":"<function>","parameters":{...}}',
    'Also accepted: {"name":"<function>","arguments":{...}}',
    'Also accepted: <|python_tag|>{"name":"<function>","parameters":{...}}',
    LLAMA_RULES,
    force,
  ].join("\n");
}

export function buildLlamaSystemPrompt(opts: {
  partyName: string;
  ideologyPrompt?: string;
  tools: ChatCompletionTool[];
  forceTool?: string;
  compact?: boolean;
  dialect?: LlamaDialect;
}): string {
  const dialect = opts.dialect ?? "hermes";
  if (dialect === "hermes") return buildLlamaHermesSystemPrompt(opts);
  return buildLlamaJsonSystemPrompt(opts);
}

export function buildLlamaUserSuffix(
  dialect: LlamaDialect,
  forceTool?: string
): string {
  if (dialect === "hermes") {
    if (forceTool) {
      return `\n\nRespond ONLY with:\n<tool_call>\n{"name":"${forceTool}","arguments":{...}}\n</tool_call>`;
    }
    return `\n\nIf you act, wrap the call in <tool_call>...</tool_call>.`;
  }
  if (forceTool) {
    return `\nOutput ONLY: {"name":"${forceTool}","parameters":{...}}`;
  }
  return `\nOutput ONLY one JSON tool object: {"name":"...","parameters":{...}}`;
}

export function llamaRecoveryUserHint(
  dialect: LlamaDialect,
  forceTool: string,
  args: Record<string, unknown>
): string {
  const json = JSON.stringify(args);
  if (dialect === "hermes") {
    return `Output ONLY:\n<tool_call>\n{"name":"${forceTool}","arguments":${json}}\n</tool_call>`;
  }
  return `Output ONLY:\n{"name":"${forceTool}","parameters":${json}}`;
}

function unwrapMarkdownFence(text: string): string {
  const fenced = text.match(/```(?:json|python)?\s*([\s\S]*?)```/i);
  return fenced ? fenced[1].trim() : text;
}

function safeParseObj(raw: string): Record<string, unknown> | null {
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function pushLlamaObj(
  found: ParsedTextTool[],
  obj: Record<string, unknown>
): void {
  const name = String(obj.name || obj.function || "").trim();
  if (!name) return;
  const args =
    (obj.parameters as Record<string, unknown>) ||
    (obj.arguments as Record<string, unknown>) ||
    {};
  pushCall(found, name, args && typeof args === "object" ? args : {});
}

/** Kapanmamış / kesik JSON: name + mümkün olduğunca args kurtar */
function salvagePartialLlamaJson(text: string): ParsedTextTool | null {
  const name = text.match(/"name"\s*:\s*"([A-Za-z_][\w]*)"/)?.[1];
  if (!name) return null;
  const argsKey = text.search(/"(?:parameters|arguments)"\s*:\s*\{/);
  if (argsKey === -1) return { name, args: {} };
  const braceAt = text.indexOf("{", argsKey);
  if (braceAt < 0) return { name, args: {} };
  const argsRaw = extractBalancedObject(text, braceAt);
  if (argsRaw) {
    const parsed = safeParseObj(argsRaw);
    if (parsed) return { name, args: parsed };
  }
  // Dengeli obje yok — basit "key":"value" çiftlerini topla
  const args: Record<string, unknown> = {};
  const kv = text
    .slice(braceAt)
    .matchAll(/"([A-Za-z_][\w]*)"\s*:\s*(?:"((?:\\.|[^"\\])*)"|(true|false|null|-?\d+(?:\.\d+)?))/g);
  for (const m of kv) {
    const key = m[1];
    if (key === "name" || key === "parameters" || key === "arguments") continue;
    if (m[2] !== undefined) args[key] = m[2].replace(/\\"/g, '"');
    else if (m[3] === "true") args[key] = true;
    else if (m[3] === "false") args[key] = false;
    else if (m[3] === "null") args[key] = null;
    else if (m[3] !== undefined) args[key] = Number(m[3]);
  }
  return { name, args };
}

function parsePythonTagCalls(text: string, found: ParsedTextTool[]): void {
  const re = /<\|python_tag\|>\s*/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const after = m.index + m[0].length;
    const brace = text.indexOf("{", after);
    if (brace < 0 || brace > after + 8) continue;
    const sliced = extractBalancedObject(text, brace);
    if (sliced) {
      const obj = safeParseObj(sliced);
      if (obj) {
        pushLlamaObj(found, obj);
        continue;
      }
    }
    // Truncated python_tag
    const salvage = salvagePartialLlamaJson(text.slice(brace));
    if (salvage) pushCall(found, salvage.name, salvage.args);
  }
}

function parseBareJsonToolObjects(text: string, found: ParsedTextTool[]): void {
  const re =
    /\{\s*"name"\s*:\s*"([^"]+)"\s*,\s*"(?:parameters|arguments)"\s*:\s*/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const start = m.index;
    const sliced = extractBalancedObject(text, start);
    if (sliced) {
      const obj = safeParseObj(sliced);
      if (obj) {
        pushLlamaObj(found, obj);
        continue;
      }
    }
    const salvage = salvagePartialLlamaJson(text.slice(start));
    if (salvage) pushCall(found, salvage.name, salvage.args);
  }
}

function parsePythonishFallback(text: string, found: ParsedTextTool[]): void {
  if (found.length) return;
  const re = new RegExp(
    `\\b((?:${LLAMA_TOOL_NAMES})\\s*\\([^)]*\\))`,
    "i"
  );
  const py = text.match(re);
  if (py) {
    const parsed = parsePythonishCall(py[1]);
    if (parsed) pushCall(found, parsed.name, parsed.args);
  }
}

/**
 * Llama 3.x: JSON name+parameters|arguments; <|python_tag|>; Hermes; pythonish.
 * Diyalekt öncelik sırasını belirler; her iki format da fallback olarak denenir.
 */
export function parseLlamaToolCalls(
  content: string,
  dialect: LlamaDialect | null = null
): ParsedTextTool[] {
  const raw = stripReasoningArtifacts(content);
  if (!raw.trim()) return [];

  const text = unwrapMarkdownFence(raw);
  const found: ParsedTextTool[] = [];

  const preferHermes = dialect === "hermes";

  const runJson = () => {
    parsePythonTagCalls(text, found);
    parseBareJsonToolObjects(text, found);
  };
  const runHermes = (): ParsedTextTool[] => parseQwenToolCalls(text, null);

  if (preferHermes) {
    const hermes = runHermes();
    if (hermes.length) return hermes;
    runJson();
    if (found.length) return found;
  } else {
    runJson();
    if (found.length) return found;
    const hermes = runHermes();
    if (hermes.length) return hermes;
  }

  parsePythonishFallback(text, found);

  if (!found.length) {
    const salvage = salvagePartialLlamaJson(text);
    if (salvage) pushCall(found, salvage.name, salvage.args);
  }

  return found;
}
