import type { ChatCompletionTool } from "openai/resources/chat/completions";
import type { ParsedTextTool } from "./textToolParser";
import {
  extractBalancedArray,
  extractBalancedObject,
  pushCall,
  stripReasoningArtifacts,
} from "./toolFormatUtils";
import { toolsAsOpenAiFunctionDefs } from "./qwenTools";

/**
 * Mistral / Ministral / Mixtral / Codestral Tekken tool-calling.
 * [AVAILABLE_TOOLS]…[/AVAILABLE_TOOLS] + [TOOL_CALLS][{name,arguments,id?}]
 */
export function isMistralNativeToolModel(modelId: string): boolean {
  return /mistral|mixtral|ministral|codestral|devstral/i.test(modelId);
}

export function buildMistralSystemPrompt(opts: {
  partyName: string;
  ideologyPrompt?: string;
  tools: ChatCompletionTool[];
  forceTool?: string;
  compact?: boolean;
}): string {
  const defs = toolsAsOpenAiFunctionDefs(opts.tools);
  const toolsJson = JSON.stringify(defs);
  const identity = opts.compact
    ? `${opts.partyName}. Reply with [TOOL_CALLS] only.`
    : `${opts.partyName}. ${(opts.ideologyPrompt || "").slice(0, 280)}`;

  const force = opts.forceTool
    ? `\nYou MUST emit [TOOL_CALLS][{"name":"${opts.forceTool}","arguments":{...}}] now. No essay.`
    : "\nWhen you act, emit [TOOL_CALLS] followed by a JSON array of calls.";

  return [
    identity,
    "You have access to tools. Use Mistral / Ministral function-calling format.",
    `[AVAILABLE_TOOLS]${toolsJson}[/AVAILABLE_TOOLS]`,
    "To call tools, output exactly one of:",
    '[TOOL_CALLS][{"name":"<function>","arguments":{...}}]',
    '[TOOL_CALLS][{"name":"<function>","arguments":{...},"id":"AbCdEfGhI"}]',
    "Single-object form is also accepted: [TOOL_CALLS]{\"name\":\"…\",\"arguments\":{…}}",
    "Turkish args for speech fields. ONE call preferred.",
    force,
  ].join("\n");
}

export function buildMistralUserSuffix(forceTool?: string): string {
  if (forceTool) {
    return `\n\nRespond ONLY with:\n[TOOL_CALLS][{"name":"${forceTool}","arguments":{...}}]`;
  }
  return `\n\nIf you act, prefix with [TOOL_CALLS] and a JSON array (or single object).`;
}

function pushFromRecord(
  found: ParsedTextTool[],
  item: Record<string, unknown>
): void {
  const fn = (item.function as Record<string, unknown>) || item;
  const name = String(fn.name || item.name || "");
  pushCall(
    found,
    name,
    fn.arguments ?? item.arguments ?? fn.parameters ?? item.parameters ?? {}
  );
}

/** Mistral/Ministral: [TOOL_CALLS] array | object | call name variants */
export function parseMistralToolCalls(content: string): ParsedTextTool[] {
  const cleaned = stripReasoningArtifacts(content);
  if (!cleaned) return [];
  const found: ParsedTextTool[] = [];
  const markers = [
    "[TOOL_CALLS]",
    "[TOOL_CALL]",
    "TOOL_CALLS",
    "TOOL_CALL",
  ];

  for (const marker of markers) {
    let searchFrom = 0;
    const needle = marker.toLowerCase();
    while (searchFrom < cleaned.length) {
      const idx = cleaned.toLowerCase().indexOf(needle, searchFrom);
      if (idx === -1) break;
      const fromMarker = cleaned.slice(idx + marker.length).replace(/^\s*/, "");

      // Array form
      const bracketRel = fromMarker.search(/\[/);
      const braceRel = fromMarker.search(/\{/);
      let consumed = marker.length;

      if (
        bracketRel !== -1 &&
        (braceRel === -1 || bracketRel <= braceRel)
      ) {
        const arrRaw = extractBalancedArray(fromMarker, bracketRel);
        if (arrRaw) {
          try {
            const arr = JSON.parse(arrRaw) as unknown;
            if (Array.isArray(arr)) {
              for (const item of arr) {
                if (item && typeof item === "object") {
                  pushFromRecord(found, item as Record<string, unknown>);
                }
              }
            }
          } catch {
            /* ignore */
          }
          consumed += bracketRel + arrRaw.length;
        }
      } else if (braceRel !== -1) {
        const objRaw = extractBalancedObject(fromMarker, braceRel);
        if (objRaw) {
          try {
            const obj = JSON.parse(objRaw) as Record<string, unknown>;
            pushFromRecord(found, obj);
          } catch {
            /* ignore */
          }
          consumed += braceRel + objRaw.length;
        }
      }

      searchFrom = idx + Math.max(consumed, marker.length);
    }
  }

  // Ministral bazen: call holdRally with {...} / invoke tool …
  if (!found.length) {
    const invoke = cleaned.matchAll(
      /(?:call|invoke)\s+([A-Za-z_][\w]*)\s+(?:with\s+)?(\{[\s\S]*?\})/gi
    );
    for (const m of invoke) {
      try {
        pushCall(found, m[1], JSON.parse(m[2]));
      } catch {
        pushCall(found, m[1], {});
      }
    }
  }

  return found;
}

export function mistralRecoveryUserHint(
  forceTool: string,
  argsExample: Record<string, unknown>
): string {
  const json = JSON.stringify([{ name: forceTool, arguments: argsExample }]);
  return `Output ONLY:\n[TOOL_CALLS]${json}`;
}

export function mistralFewShot(
  tool: string,
  args: Record<string, unknown>
): string {
  return mistralRecoveryUserHint(tool, args).replace(/^Output ONLY:\n/, "");
}
