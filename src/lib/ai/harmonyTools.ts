import type { ChatCompletionTool } from "openai/resources/chat/completions";
import type { ParsedTextTool } from "./textToolParser";
import {
  extractBalancedObject,
  pushCall,
  stripReasoningArtifacts,
} from "./toolFormatUtils";
import { toolsAsOpenAiFunctionDefs } from "./qwenTools";
import { clipPartyIdeologyPrompt } from "./prompts";

/**
 * OpenAI gpt-oss (Harmony) native tool format.
 * Model emits commentary-channel calls, e.g.:
 *   <|channel|>commentary to=functions.holdRally <|constrain|>json<|message|>{...}<|call|>
 * or:
 *   <|start|>assistant to=functions.holdRally<|channel|>commentary <|constrain|>json<|message|>{...}<|call|>
 */
export function isHarmonyNativeToolModel(modelId: string): boolean {
  const id = modelId.toLowerCase();
  if (/gpt-?oss|openai\/gpt-oss|harmony/i.test(id)) return true;
  if (/oss-?(20|120)b/i.test(id)) return true;
  return false;
}

function toolNamespaceDefs(
  tools: ChatCompletionTool[],
  compact?: boolean
): string {
  const defs = toolsAsOpenAiFunctionDefs(tools);
  const lines = defs.map((d) => {
    const params = d.function.parameters || { type: "object", properties: {} };
    const desc = (d.function.description || "").slice(0, compact ? 48 : 100);
    // Harmony TypeScript-ish namespace style (compact)
    return `  // ${desc}\n  type ${d.function.name} = (_: ${JSON.stringify(params)}) => any;`;
  });
  return ["namespace functions {", ...lines, "} // namespace functions"].join(
    "\n"
  );
}

export function buildHarmonySystemPrompt(opts: {
  partyName: string;
  ideologyPrompt?: string;
  tools: ChatCompletionTool[];
  forceTool?: string;
  compact?: boolean;
}): string {
  const identity = opts.compact
    ? `${opts.partyName}. ${clipPartyIdeologyPrompt(opts.ideologyPrompt || "", { compact: true }).slice(0, 200)} Call tools on commentary channel.`
    : `${opts.partyName}. ${clipPartyIdeologyPrompt(opts.ideologyPrompt || "")}`;

  const force = opts.forceTool
    ? `\nYou MUST call functions.${opts.forceTool} now on the commentary channel. End with <|call|>.`
    : "\nFunction tool calls MUST use the commentary channel and end with <|call|>.";

  return [
    identity,
    "You are gpt-oss style agent. Use OpenAI Harmony tool-calling tokens.",
    "Channels: analysis = private chain-of-thought (do not show user); commentary = function calls; final = user-visible text.",
    "When calling a function, emit ONE of these equivalent forms:",
    "<|start|>assistant<|channel|>commentary to=functions.TOOL_NAME <|constrain|>json<|message|>{...}<|call|>",
    "or",
    "<|start|>assistant to=functions.TOOL_NAME<|channel|>commentary <|constrain|>json<|message|>{...}<|call|>",
    "Available functions:",
    toolNamespaceDefs(opts.tools, opts.compact),
    "Rules: ONE tool call per turn. Turkish strings for speech/PR. Prefer commentary channel for functions.",
    force,
  ].join("\n");
}

export function buildHarmonyUserSuffix(forceTool?: string): string {
  if (forceTool) {
    return `\n\nRespond ONLY with a Harmony commentary tool call for functions.${forceTool}, ending with <|call|>.`;
  }
  return `\n\nIf you act, emit a commentary-channel function call ending with <|call|>.`;
}

/**
 * Parse Harmony commentary tool calls from free text (LM Studio may strip some tokens).
 */
export function parseHarmonyToolCalls(content: string): ParsedTextTool[] {
  const cleaned = stripReasoningArtifacts(content);
  if (!cleaned) return [];
  const found: ParsedTextTool[] = [];

  // Primary: to=functions.NAME ... <|message|>{json}<|call|>
  const re =
    /to\s*=\s*functions\.([A-Za-z_][\w]*)[\s\S]*?(?:<\|constrain\|>\s*json)?[\s\S]*?<\|message\|>([\s\S]*?)(?:<\|call\|>|<\|end\|>|$)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(cleaned))) {
    const name = m[1];
    const body = m[2].trim();
    let args: Record<string, unknown> = {};
    const objStart = body.indexOf("{");
    if (objStart >= 0) {
      const raw = extractBalancedObject(body, objStart);
      if (raw) {
        try {
          args = JSON.parse(raw) as Record<string, unknown>;
        } catch {
          args = {};
        }
      }
    }
    pushCall(found, name, args);
  }

  // Fallback: functions.NAME({...}) or call functions.NAME with {...}
  if (!found.length) {
    const alt = cleaned.matchAll(
      /functions\.([A-Za-z_][\w]*)\s*(?:<\|message\|>)?\s*(\{[\s\S]*?\})/gi
    );
    for (const a of alt) {
      try {
        pushCall(found, a[1], JSON.parse(a[2]));
      } catch {
        pushCall(found, a[1], {});
      }
    }
  }

  // Bare: <|call|> after name mention
  if (!found.length) {
    const nameOnly = cleaned.match(
      /(?:to\s*=\s*)?functions\.([A-Za-z_][\w]*)/i
    );
    if (nameOnly && /<\|call\|>/i.test(cleaned)) {
      const objStart = cleaned.indexOf("{");
      let args: Record<string, unknown> = {};
      if (objStart >= 0) {
        const raw = extractBalancedObject(cleaned, objStart);
        if (raw) {
          try {
            args = JSON.parse(raw) as Record<string, unknown>;
          } catch {
            /* ignore */
          }
        }
      }
      pushCall(found, nameOnly[1], args);
    }
  }

  return found;
}

export function harmonyRecoveryUserHint(
  forceTool: string,
  argsExample: Record<string, unknown>
): string {
  const json = JSON.stringify(argsExample);
  return `Output ONLY:\n<|start|>assistant<|channel|>commentary to=functions.${forceTool} <|constrain|>json<|message|>${json}<|call|>`;
}

export function harmonyFewShot(
  tool: string,
  args: Record<string, unknown>
): string {
  return harmonyRecoveryUserHint(tool, args).replace(/^Output ONLY:\n/, "");
}
