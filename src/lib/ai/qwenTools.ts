import type { ChatCompletionTool } from "openai/resources/chat/completions";
import type { ParsedTextTool } from "./textToolParser";
import {
  extractBalancedObject,
  parsePythonishCall,
  pushCall,
  stripReasoningArtifacts,
} from "./toolFormatUtils";
import { clipPartyIdeologyPrompt } from "./prompts";

export type QwenDialect = "hermes" | "xml";

/**
 * Qwen2.5 / Qwen3 (non-coder): Hermes `<tool_call>{json}</tool_call>`
 * Qwen2.5-Coder / Qwen3-Coder / Qwen3.5: XML
 *   `<tool_call><function=name><parameter=k>v</parameter></function></tool_call>`
 */
export function detectQwenDialect(modelId: string): QwenDialect {
  // Qwen2.5-Coder / Qwen3-Coder / Qwen3.5+ → XML parameter diyalekti
  // Qwen2.5 / Qwen3 / QwQ → Hermes JSON <tool_call>
  if (/coder|qwen3\.5|qwen-3\.5|qwen3_5|qwen3\.6|qwen-3\.6/i.test(modelId)) {
    return "xml";
  }
  return "hermes";
}

export function isQwenNativeToolModel(modelId: string): boolean {
  return /qwen|qwq/i.test(modelId);
}

/** OpenAI tools → standart function descriptor (Hermes katalog) */
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

function toolParamNames(tool: ChatCompletionTool): string[] {
  if (tool.type !== "function") return [];
  const schema = (tool.function.parameters || {}) as {
    properties?: Record<string, unknown>;
  };
  return Object.keys(schema.properties || {});
}

// ─── Hermes (Qwen2.5 / Qwen3) ───────────────────────────────────────────────

export function buildQwenHermesSystemPrompt(opts: {
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
    : `${opts.partyName}. ${clipPartyIdeologyPrompt(opts.ideologyPrompt || "")}`;

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
    "Do not wrap the call in markdown fences.",
    force,
  ].join("\n");
}

export function buildQwenHermesUserSuffix(forceTool?: string): string {
  if (forceTool) {
    return `\n\nRespond ONLY with:\n<tool_call>\n{"name":"${forceTool}","arguments":{...}}\n</tool_call>`;
  }
  return `\n\nIf you act, wrap the call in <tool_call>...</tool_call>.`;
}

/** Hermes / Qwen: <tool_call>{"name","arguments"}</tool_call> */
export function parseQwenHermesToolCalls(content: string): ParsedTextTool[] {
  const cleaned = stripReasoningArtifacts(content);
  if (!cleaned) return [];
  const found: ParsedTextTool[] = [];

  const blocks = cleaned.matchAll(
    /<tool_call>\s*([\s\S]*?)\s*<\/tool_call>/gi
  );
  for (const m of blocks) {
    const inner = m[1].trim();
    // XML diyalekti karışmışsa Hermes parser atla (XML parser yakalar)
    if (/<function\s*=/i.test(inner)) continue;
    try {
      const obj = JSON.parse(inner) as Record<string, unknown>;
      const name = String(obj.name || "");
      pushCall(found, name, obj.arguments ?? obj.parameters ?? {});
    } catch {
      // markdown fence içinde JSON
      const fenced = inner.match(/```(?:json)?\s*([\s\S]*?)```/i);
      const candidate = fenced ? fenced[1].trim() : inner;
      try {
        const obj = JSON.parse(candidate) as Record<string, unknown>;
        pushCall(
          found,
          String(obj.name || ""),
          obj.arguments ?? obj.parameters ?? {}
        );
      } catch {
        const name = inner.match(/"name"\s*:\s*"(\w+)"/)?.[1];
        const argsIdx = inner.search(/"arguments"\s*:\s*\{/);
        if (name && argsIdx !== -1) {
          const braceAt = inner.indexOf("{", argsIdx);
          const argsRaw =
            braceAt >= 0 ? extractBalancedObject(inner, braceAt) : null;
          let args: unknown = {};
          if (argsRaw) {
            try {
              args = JSON.parse(argsRaw);
            } catch {
              args = {};
            }
          }
          pushCall(found, name, args);
        } else if (name) {
          pushCall(found, name, {});
        }
      }
    }
  }

  // Kapanmamış / stream kesik
  const open = cleaned.match(/<tool_call>\s*(\{[\s\S]*)$/i);
  if (open && !found.length && !/<function\s*=/i.test(open[1])) {
    try {
      const obj = JSON.parse(open[1]) as Record<string, unknown>;
      pushCall(found, String(obj.name || ""), obj.arguments ?? {});
    } catch {
      const brace = open[1].indexOf("{");
      if (brace >= 0) {
        const objRaw = extractBalancedObject(open[1], brace);
        if (objRaw) {
          try {
            const obj = JSON.parse(objRaw) as Record<string, unknown>;
            pushCall(found, String(obj.name || ""), obj.arguments ?? {});
          } catch {
            /* ignore */
          }
        }
      }
    }
  }

  return found;
}

// ─── Qwen XML / Coder (Qwen3-Coder, Qwen3.5) ────────────────────────────────

export function buildQwenXmlSystemPrompt(opts: {
  partyName: string;
  ideologyPrompt?: string;
  tools: ChatCompletionTool[];
  forceTool?: string;
  compact?: boolean;
}): string {
  const defs = toolsAsOpenAiFunctionDefs(opts.tools);
  const identity = opts.compact
    ? `${opts.partyName}. Act via XML <tool_call> only.`
    : `${opts.partyName}. ${clipPartyIdeologyPrompt(opts.ideologyPrompt || "")}`;

  const catalog = defs
    .map((d) => {
      const params = d.function.parameters as {
        properties?: Record<string, { type?: string; description?: string }>;
        required?: string[];
      };
      const props = params.properties || {};
      const paramLines = Object.entries(props)
        .map(([k, v]) => {
          const req = (params.required || []).includes(k) ? " required" : "";
          return `  - ${k} (${v.type || "string"}${req}): ${v.description || k}`;
        })
        .join("\n");
      return [
        `## ${d.function.name}`,
        d.function.description,
        paramLines ? `Parameters:\n${paramLines}` : "Parameters: none",
      ].join("\n");
    })
    .join("\n\n");

  const force = opts.forceTool
    ? `\nYou MUST call ${opts.forceTool} now. Output ONLY the XML tool_call block.`
    : "\nWhen you act, emit exactly one <tool_call> XML block.";

  const exampleName = opts.forceTool || defs[0]?.function.name || "holdRally";
  const exampleParams =
    opts.tools.find(
      (t) => t.type === "function" && t.function.name === exampleName
    ) || opts.tools[0];
  const exampleKeys = exampleParams ? toolParamNames(exampleParams).slice(0, 2) : [];
  const exampleParamXml = exampleKeys.length
    ? exampleKeys
        .map((k) => `  <parameter=${k}>\n    ...\n  </parameter>`)
        .join("\n")
    : "  <parameter=example>\n    value\n  </parameter>";

  return [
    "You are Qwen, a helpful assistant with function calling.",
    identity,
    "",
    "# Available tools",
    catalog,
    "",
    "Function calls MUST be enclosed within <tool_call> and </tool_call> tags.",
    "If you choose to call a function ONLY reply in the following format with NO suffix:",
    "<tool_call>",
    `<function=${exampleName}>`,
    exampleParamXml,
    "</function>",
    "</tool_call>",
    "",
    "Rules:",
    "- An inner <function=...></function> block MUST be nested within <tool_call></tool_call>",
    "- Do NOT omit the initial <tool_call> tag",
    "- Do NOT use JSON inside <tool_call>; use <parameter=name>value</parameter>",
    "- Required parameters MUST be specified",
    "- Turkish string arguments when the schema expects speech/text",
    "- Do NOT write long strategy essays after the tool call",
    force,
  ].join("\n");
}

export function buildQwenXmlUserSuffix(forceTool?: string): string {
  if (forceTool) {
    return `\n\nRespond ONLY with:\n<tool_call>\n<function=${forceTool}>\n  <parameter=...>...</parameter>\n</function>\n</tool_call>`;
  }
  return `\n\nIf you act, emit <tool_call><function=NAME>...</function></tool_call>.`;
}

function parseXmlParameterBlock(inner: string): Record<string, unknown> {
  const args: Record<string, unknown> = {};
  const params = inner.matchAll(
    /<parameter\s*=\s*([A-Za-z_][\w]*)\s*>([\s\S]*?)<\/parameter>/gi
  );
  for (const p of params) {
    const key = p[1];
    const val = p[2].trim();
    // Tip kestirimi
    if (/^(true|false)$/i.test(val)) {
      args[key] = /^true$/i.test(val);
    } else if (/^null$/i.test(val)) {
      args[key] = null;
    } else if (/^-?\d+(\.\d+)?$/.test(val)) {
      args[key] = Number(val);
    } else if (
      (val.startsWith("{") && val.endsWith("}")) ||
      (val.startsWith("[") && val.endsWith("]"))
    ) {
      try {
        args[key] = JSON.parse(val);
      } catch {
        args[key] = val;
      }
    } else {
      args[key] = val;
    }
  }
  return args;
}

/** Qwen3-Coder / Qwen3.5 XML tool calls */
export function parseQwenXmlToolCalls(content: string): ParsedTextTool[] {
  const cleaned = stripReasoningArtifacts(content);
  if (!cleaned) return [];
  const found: ParsedTextTool[] = [];

  const blocks = cleaned.matchAll(
    /<tool_call>\s*([\s\S]*?)\s*<\/tool_call>/gi
  );
  for (const m of blocks) {
    const inner = m[1];
    const fnBlocks = inner.matchAll(
      /<function\s*=\s*([A-Za-z_][\w]*)\s*>([\s\S]*?)<\/function>/gi
    );
    let any = false;
    for (const fb of fnBlocks) {
      any = true;
      pushCall(found, fb[1], parseXmlParameterBlock(fb[2]));
    }
    // Self-closing / incomplete: <function=name> ... without close
    if (!any) {
      const openFn = inner.match(
        /<function\s*=\s*([A-Za-z_][\w]*)\s*>([\s\S]*)$/i
      );
      if (openFn) {
        pushCall(found, openFn[1], parseXmlParameterBlock(openFn[2]));
      }
    }
  }

  // Tag'sız ama <function=...> basılmış (sık hata)
  if (!found.length) {
    const lone = cleaned.matchAll(
      /<function\s*=\s*([A-Za-z_][\w]*)\s*>([\s\S]*?)<\/function>/gi
    );
    for (const fb of lone) {
      pushCall(found, fb[1], parseXmlParameterBlock(fb[2]));
    }
  }

  // Kapanmamış tool_call
  if (!found.length) {
    const open = cleaned.match(/<tool_call>\s*([\s\S]*)$/i);
    if (open) {
      const fn = open[1].match(
        /<function\s*=\s*([A-Za-z_][\w]*)\s*>([\s\S]*?)(?:<\/function>|$)/i
      );
      if (fn) pushCall(found, fn[1], parseXmlParameterBlock(fn[2]));
    }
  }

  return found;
}

export function parseQwenToolCalls(
  content: string,
  dialect?: QwenDialect | null
): ParsedTextTool[] {
  if (dialect === "xml") {
    const xml = parseQwenXmlToolCalls(content);
    if (xml.length) return xml;
    return parseQwenHermesToolCalls(content);
  }
  if (dialect === "hermes") {
    const hermes = parseQwenHermesToolCalls(content);
    if (hermes.length) return hermes;
    return parseQwenXmlToolCalls(content);
  }
  // Bilinmiyor: ikisini birleştir
  const a = parseQwenHermesToolCalls(content);
  const b = parseQwenXmlToolCalls(content);
  const names = new Set(a.map((x) => x.name));
  return [...a, ...b.filter((x) => !names.has(x.name))];
}

export function buildQwenSystemPrompt(
  dialect: QwenDialect,
  opts: {
    partyName: string;
    ideologyPrompt?: string;
    tools: ChatCompletionTool[];
    forceTool?: string;
    compact?: boolean;
  }
): string {
  return dialect === "xml"
    ? buildQwenXmlSystemPrompt(opts)
    : buildQwenHermesSystemPrompt(opts);
}

export function buildQwenUserSuffix(
  dialect: QwenDialect,
  forceTool?: string
): string {
  return dialect === "xml"
    ? buildQwenXmlUserSuffix(forceTool)
    : buildQwenHermesUserSuffix(forceTool);
}

export function qwenRecoveryUserHint(
  dialect: QwenDialect,
  forceTool: string,
  argsExample: Record<string, unknown>
): string {
  if (dialect === "xml") {
    const params = Object.entries(argsExample)
      .map(
        ([k, v]) =>
          `  <parameter=${k}>\n    ${typeof v === "string" ? v : JSON.stringify(v)}\n  </parameter>`
      )
      .join("\n");
    return `Output ONLY:\n<tool_call>\n<function=${forceTool}>\n${params || "  <parameter=x>value</parameter>"}\n</function>\n</tool_call>`;
  }
  return `Output ONLY:\n<tool_call>\n{"name":"${forceTool}","arguments":${JSON.stringify(argsExample)}}\n</tool_call>`;
}

/** Eski import uyumu — Hermes varsayılan */
export function parseQwenToolCallsCompat(content: string): ParsedTextTool[] {
  return parseQwenToolCalls(content, null);
}

/** Nadir: model tool_code / python basarsa */
export function parseQwenPythonFallback(content: string): ParsedTextTool[] {
  const cleaned = stripReasoningArtifacts(content);
  const found: ParsedTextTool[] = [];
  const fence = cleaned.match(/```(?:python|tool_code)?\s*([\s\S]*?)```/i);
  const body = fence ? fence[1].trim() : cleaned;
  const py = parsePythonishCall(body.split("\n").find((l) => /\(/.test(l)) || body);
  if (py) pushCall(found, py.name, py.args);
  return found;
}
