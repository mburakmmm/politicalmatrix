import type { ChatCompletionTool } from "openai/resources/chat/completions";
import type { ParsedTextTool } from "./textToolParser";
import {
  parsePythonishCall,
  pushCall,
  stripReasoningArtifacts,
} from "./toolFormatUtils";

export type GemmaDialect = "tool_code" | "functiongemma";

/**
 * FunctionGemma (google/functiongemma*): özel token diyalekti
 * Gemma 2/3 instruct: Google'ın önerdiği ```tool_code``` python çağrıları
 */
export function detectGemmaDialect(modelId: string): GemmaDialect {
  if (/function.?gemma|functiongemma/i.test(modelId)) return "functiongemma";
  return "tool_code";
}

export function isGemmaNativeToolModel(modelId: string): boolean {
  return /gemma|function.?gemma/i.test(modelId);
}

type JsonSchemaProp = {
  type?: string | string[];
  description?: string;
  enum?: unknown[];
  items?: unknown;
  default?: unknown;
  properties?: Record<string, JsonSchemaProp>;
  required?: string[];
};

type JsonSchema = {
  type?: string;
  properties?: Record<string, JsonSchemaProp>;
  required?: string[];
};

function escapeFg(value: string): string {
  return `<escape>${value}<escape>`;
}

function mapFgType(rawType: string | undefined): string {
  switch (rawType) {
    case "number":
    case "integer":
      return "NUMBER";
    case "boolean":
      return "BOOLEAN";
    case "array":
      return "ARRAY";
    case "object":
      return "OBJECT";
    default:
      return "STRING";
  }
}

/** OpenAI JSON Schema → FunctionGemma declaration gövdesi */
export function openaiToolsToFunctionGemmaDeclarations(
  tools: ChatCompletionTool[]
): string {
  const parts: string[] = [];

  for (const t of tools) {
    if (t.type !== "function") continue;
    const schema = (t.function.parameters || {}) as JsonSchema;
    const props = schema.properties || {};
    const required = schema.required || [];

    const propEntries = Object.entries(props).map(([key, def]) => {
      const rawType = Array.isArray(def.type) ? def.type[0] : def.type;
      const typeStr = mapFgType(rawType);
      const desc = escapeFg(def.description || key);
      let body = `description:${desc}`;
      if (def.enum?.length) {
        const enumParts = def.enum.map((e) => escapeFg(String(e))).join(",");
        body += `,enum:[${enumParts}]`;
      }
      body += `,type:${escapeFg(typeStr)}`;
      return `${key}:{${body}}`;
    });

    const requiredPart = required.length
      ? `required:[${required.map((r) => escapeFg(r)).join(",")}],`
      : "";

    const paramsInner =
      propEntries.length > 0
        ? `properties:{${propEntries.join(",")}},${requiredPart}type:${escapeFg("OBJECT")}`
        : `type:${escapeFg("OBJECT")}`;

    const desc = escapeFg(t.function.description || t.function.name);
    parts.push(
      `<start_function_declaration>declaration:${t.function.name}{description:${desc},parameters:{${paramsInner}}}<end_function_declaration>`
    );
  }

  return parts.join("");
}

/** Gemma 3: Python imzaları tool_code için */
function toolsAsPythonSignatures(tools: ChatCompletionTool[]): string {
  const lines: string[] = [];
  for (const t of tools) {
    if (t.type !== "function") continue;
    const schema = (t.function.parameters || {}) as JsonSchema;
    const props = schema.properties || {};
    const required = new Set(schema.required || []);
    const args = Object.entries(props).map(([key, def]) => {
      const rawType = Array.isArray(def.type) ? def.type[0] : def.type || "str";
      const pyType =
        rawType === "integer" || rawType === "number"
          ? "float"
          : rawType === "boolean"
            ? "bool"
            : rawType === "array"
              ? "list"
              : rawType === "object"
                ? "dict"
                : "str";
      const defaultPart = required.has(key) ? "" : " = None";
      return `${key}: ${pyType}${defaultPart}`;
    });
    const docLines = Object.entries(props)
      .map(([key, def]) => `      ${key}: ${def.description || key}`)
      .join("\n");
    lines.push(
      [
        `def ${t.function.name}(${args.join(", ")}) -> dict:`,
        `    """${t.function.description || t.function.name}`,
        docLines ? `\n${docLines}` : "",
        `\n    """`,
        `    ...`,
      ].join("")
    );
  }
  return lines.join("\n\n");
}

export function buildGemmaToolCodeSystemPrompt(opts: {
  partyName: string;
  ideologyPrompt?: string;
  tools: ChatCompletionTool[];
  forceTool?: string;
  compact?: boolean;
}): string {
  const identity = opts.compact
    ? `${opts.partyName}. Act via tool_code only.`
    : `${opts.partyName}. ${(opts.ideologyPrompt || "").slice(0, 280)}`;

  const force = opts.forceTool
    ? `\nYou MUST call ${opts.forceTool} now inside a \`\`\`tool_code fence. No prose outside the fence.`
    : "\nWhen you act, wrap the call in a ```tool_code fence.";

  return [
    identity,
    "",
    "At each turn, if you decide to invoke any of the function(s), it MUST be wrapped with ```tool_code```.",
    "The python methods described below are imported and available; you can only use defined methods.",
    "The generated code should be a single function call (print(...) optional).",
    "Do NOT invent helper functions. Turkish string arguments when the schema expects speech/text.",
    "Do NOT write long strategy essays.",
    "",
    "The following Python methods are available:",
    "",
    "```python",
    toolsAsPythonSignatures(opts.tools),
    "```",
    force,
  ].join("\n");
}

export function buildFunctionGemmaSystemPrompt(opts: {
  partyName: string;
  ideologyPrompt?: string;
  tools: ChatCompletionTool[];
  forceTool?: string;
  compact?: boolean;
}): string {
  const decls = openaiToolsToFunctionGemmaDeclarations(opts.tools);
  const identity = opts.compact
    ? `${opts.partyName}.`
    : `${opts.partyName}. ${(opts.ideologyPrompt || "").slice(0, 200)}`;

  const force = opts.forceTool
    ? ` You MUST emit <start_function_call>call:${opts.forceTool}{...}<end_function_call> now.`
    : " Call a function when an action is needed.";

  // FunctionGemma developer/system cümlesi sabit kalmalı
  return [
    "You are a model that can do function calling with the following functions",
    decls,
    identity,
    "Turkish string args for speech fields.",
    "Do not write essays.",
    force,
  ].join("");
}

export function buildGemmaSystemPrompt(
  dialect: GemmaDialect,
  opts: {
    partyName: string;
    ideologyPrompt?: string;
    tools: ChatCompletionTool[];
    forceTool?: string;
    compact?: boolean;
  }
): string {
  return dialect === "functiongemma"
    ? buildFunctionGemmaSystemPrompt(opts)
    : buildGemmaToolCodeSystemPrompt(opts);
}

export function buildGemmaUserSuffix(
  dialect: GemmaDialect,
  forceTool?: string
): string {
  if (dialect === "functiongemma") {
    if (forceTool) {
      return `\n\nRespond ONLY with:\n<start_function_call>call:${forceTool}{...}<end_function_call>`;
    }
    return `\n\nIf you act, emit <start_function_call>call:NAME{args}<end_function_call>.`;
  }
  if (forceTool) {
    return `\n\nRespond ONLY with:\n\`\`\`tool_code\n${forceTool}(...)\n\`\`\``;
  }
  return `\n\nIf you act, wrap the call in \`\`\`tool_code ... \`\`\`.`;
}

// ─── Parsers ────────────────────────────────────────────────────────────────

/** ```tool_code\nholdRally(...)\n``` veya ```python */
export function parseGemmaToolCodeCalls(content: string): ParsedTextTool[] {
  const cleaned = stripReasoningArtifacts(content);
  if (!cleaned) return [];
  const found: ParsedTextTool[] = [];

  const fences = cleaned.matchAll(
    /```(?:tool_code|python|tool_call)?\s*([\s\S]*?)```/gi
  );
  for (const f of fences) {
    const body = f[1].trim();
    const lines = body
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith("#") && !l.startsWith("def "));
    for (const line of lines) {
      const parsed = parsePythonishCall(line);
      if (parsed) pushCall(found, parsed.name, parsed.args);
    }
    // Tek satırda birleşik
    if (!found.length) {
      const parsed = parsePythonishCall(body.replace(/\n/g, " "));
      if (parsed) pushCall(found, parsed.name, parsed.args);
    }
  }

  // Fence yok: düz çağrı
  if (!found.length) {
    const bare = cleaned.match(
      /\b((?:holdRally|voteOnBill|proposeLaw|negotiateCoalition|respondNegotiation|issuePRStatement|launchSmearCampaign|proposeAlliance|breakAlliance|moveConfidence|voteConfidence|proposeRegimeChange|declareEmergency|seizePower|callEarlyElection|proposeCustomBill)\s*\([^)]*\))/i
    );
    if (bare) {
      const parsed = parsePythonishCall(bare[1]);
      if (parsed) pushCall(found, parsed.name, parsed.args);
    }
  }

  return found;
}

/**
 * FunctionGemma argüman gövdesi:
 *   {location:<escape>Tokyo, Japan<escape>,unit:celsius}
 *   {color:red}
 */
export function parseFunctionGemmaArgs(
  raw: string
): Record<string, unknown> {
  const args: Record<string, unknown> = {};
  let body = raw.trim();
  if (body.startsWith("{") && body.endsWith("}")) {
    body = body.slice(1, -1);
  }
  if (!body.trim()) return args;

  // key:value çiftlerini escape-aware böl
  const entries: Array<{ key: string; value: string }> = [];
  let i = 0;
  while (i < body.length) {
    while (i < body.length && /[\s,]/.test(body[i])) i++;
    if (i >= body.length) break;
    const keyMatch = body.slice(i).match(/^([A-Za-z_][\w]*)\s*:/);
    if (!keyMatch) break;
    const key = keyMatch[1];
    i += keyMatch[0].length;
    while (i < body.length && /\s/.test(body[i])) i++;

    let value = "";
    if (body.slice(i).startsWith("<escape>")) {
      i += "<escape>".length;
      const end = body.indexOf("<escape>", i);
      if (end === -1) {
        value = body.slice(i);
        i = body.length;
      } else {
        value = body.slice(i, end);
        i = end + "<escape>".length;
      }
    } else {
      // virgüle veya sona kadar (iç içe {} destekle)
      let depth = 0;
      const start = i;
      while (i < body.length) {
        const ch = body[i];
        if (ch === "{") depth++;
        else if (ch === "}") {
          if (depth === 0) break;
          depth--;
        } else if (ch === "," && depth === 0) break;
        i++;
      }
      value = body.slice(start, i).trim();
    }
    entries.push({ key, value });
  }

  for (const { key, value } of entries) {
    if (/^(true|false)$/i.test(value)) {
      args[key] = /^true$/i.test(value);
    } else if (/^null$/i.test(value)) {
      args[key] = null;
    } else if (/^-?\d+(\.\d+)?$/.test(value)) {
      args[key] = Number(value);
    } else {
      args[key] = value;
    }
  }
  return args;
}

/** <start_function_call>call:name{args}<end_function_call> */
export function parseFunctionGemmaCalls(content: string): ParsedTextTool[] {
  const cleaned = stripReasoningArtifacts(content);
  if (!cleaned) return [];
  const found: ParsedTextTool[] = [];

  const blocks = cleaned.matchAll(
    /<start_function_call>\s*([\s\S]*?)\s*<end_function_call>/gi
  );
  for (const m of blocks) {
    const inner = m[1].trim();
    const call = inner.match(
      /^call\s*:\s*([A-Za-z_][\w]*)\s*(\{[\s\S]*\})?\s*$/i
    );
    if (!call) {
      // call:name{...} tek satır gevşek
      const loose = inner.match(
        /call\s*:\s*([A-Za-z_][\w]*)\s*(\{[\s\S]*\})?/i
      );
      if (loose) {
        pushCall(
          found,
          loose[1],
          loose[2] ? parseFunctionGemmaArgs(loose[2]) : {}
        );
      }
      continue;
    }
    pushCall(
      found,
      call[1],
      call[2] ? parseFunctionGemmaArgs(call[2]) : {}
    );
  }

  // Kapanmamış
  if (!found.length) {
    const open = cleaned.match(
      /<start_function_call>\s*call\s*:\s*([A-Za-z_][\w]*)\s*(\{[\s\S]*?)(?:<end_function_call>|$)/i
    );
    if (open) {
      pushCall(
        found,
        open[1],
        open[2] ? parseFunctionGemmaArgs(open[2]) : {}
      );
    }
  }

  return found;
}

export function parseGemmaToolCalls(
  content: string,
  dialect?: GemmaDialect | null
): ParsedTextTool[] {
  if (dialect === "functiongemma") {
    const a = parseFunctionGemmaCalls(content);
    if (a.length) return a;
    return parseGemmaToolCodeCalls(content);
  }
  if (dialect === "tool_code") {
    const a = parseGemmaToolCodeCalls(content);
    if (a.length) return a;
    return parseFunctionGemmaCalls(content);
  }
  const a = parseGemmaToolCodeCalls(content);
  const b = parseFunctionGemmaCalls(content);
  const names = new Set(a.map((x) => x.name));
  return [...a, ...b.filter((x) => !names.has(x.name))];
}

export function gemmaRecoveryUserHint(
  dialect: GemmaDialect,
  forceTool: string,
  argsExample: Record<string, unknown>
): string {
  if (dialect === "functiongemma") {
    const inner = Object.entries(argsExample)
      .map(([k, v]) =>
        typeof v === "string"
          ? `${k}:<escape>${v}<escape>`
          : `${k}:${JSON.stringify(v)}`
      )
      .join(",");
    return `Output ONLY:\n<start_function_call>call:${forceTool}{${inner}}<end_function_call>`;
  }
  const pyArgs = Object.entries(argsExample)
    .map(([k, v]) =>
      typeof v === "string" ? `${k}=${JSON.stringify(v)}` : `${k}=${JSON.stringify(v)}`
    )
    .join(", ");
  return `Output ONLY:\n\`\`\`tool_code\n${forceTool}(${pyArgs})\n\`\`\``;
}
