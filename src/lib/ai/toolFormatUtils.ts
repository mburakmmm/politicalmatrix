import type { ParsedTextTool } from "./textToolParser";

/** Dengeli `[...]` dilimi — string kaçışlarına saygılı */
export function extractBalancedArray(
  src: string,
  fromIdx: number
): string | null {
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

/** Dengeli `{...}` dilimi — string kaçışlarına saygılı */
export function extractBalancedObject(
  src: string,
  fromIdx: number
): string | null {
  if (src[fromIdx] !== "{") return null;
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
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return src.slice(fromIdx, i + 1);
    }
  }
  return null;
}

export function coerceArgs(argsRaw: unknown): Record<string, unknown> {
  if (typeof argsRaw === "string") {
    try {
      return JSON.parse(argsRaw) as Record<string, unknown>;
    } catch {
      return {};
    }
  }
  if (argsRaw && typeof argsRaw === "object" && !Array.isArray(argsRaw)) {
    return argsRaw as Record<string, unknown>;
  }
  return {};
}

export function pushCall(
  found: ParsedTextTool[],
  name: string,
  argsRaw: unknown
): void {
  const trimmed = String(name || "").trim();
  if (!trimmed || found.some((f) => f.name === trimmed)) return;
  found.push({ name: trimmed, args: coerceArgs(argsRaw) });
}

/**
 * Qwen3 / GLM / gpt-oss / reasoning modelleri düşünceyi content’e yazar.
 * Tool parse öncesi temizle — kapanmamış think bloklarını da kes.
 */
export function stripReasoningArtifacts(content: string): string {
  if (!content) return "";
  let t = content
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/<\/?think>/gi, "")
    .replace(/<\|thinking\|>[\s\S]*?<\|\/thinking\|>/gi, "")
    .replace(/<redacted_reasoning>[\s\S]*?<\/redacted_reasoning>/gi, "")
    .replace(/<reasoning>[\s\S]*?<\/reasoning>/gi, "")
    .replace(/<\/?reasoning>/gi, "")
    // Harmony analysis channel (CoT) — tool call öncesi
    .replace(
      /<\|channel\|>analysis<\|message\|>[\s\S]*?(?:<\|end\|>|(?=<\|start\|>|<\|channel\|>commentary))/gi,
      ""
    )
    // Orphan analysis without end
    .replace(/<\|channel\|>analysis<\|message\|>([\s\S]*)$/gi, "")
    // DeepSeek / generic
    .replace(/<\|begin_of_thought\|>[\s\S]*?<\|end_of_thought\|>/gi, "")
    .replace(/<\|begin_of_solution\|>/gi, "")
    .replace(/<\|end_of_solution\|>/gi, "");

  // Kapanmamış <think>… (stream/truncate)
  const openThink = t.search(/<think>/i);
  if (openThink !== -1 && !/<\/think>/i.test(t.slice(openThink))) {
    // think'ten sonra tool işareti varsa oraya kadar kes
    const after = t.slice(openThink);
    const toolAt = after.search(
      /<tool_call>|\[TOOL_CALLS\]|functools\s*\[|<\|channel\|>commentary|<\/think>/i
    );
    if (toolAt > 0) {
      t = t.slice(0, openThink) + after.slice(toolAt);
    } else {
      t = t.slice(0, openThink);
    }
  }

  return t.trim();
}

/** Python-benzeri kwarg çağrısı: holdRally(cityId="x", tone='Y') */
export function parsePythonishCall(
  expr: string
): ParsedTextTool | null {
  let cleaned = expr.trim().replace(/;+\s*$/, "");
  const printWrap = cleaned.match(/^print\s*\(([\s\S]*)\)\s*$/i);
  if (printWrap) cleaned = printWrap[1].trim();

  const m = cleaned.match(/^([A-Za-z_][\w]*)\s*\(([\s\S]*)\)\s*$/);
  if (!m) return null;

  const name = m[1];
  const inside = m[2].trim();
  const args: Record<string, unknown> = {};
  if (!inside) return { name, args };

  // key=value çiftleri (string / number / bool / null)
  const parts: string[] = [];
  let buf = "";
  let depth = 0;
  let inStr: '"' | "'" | null = null;
  let esc = false;
  for (let i = 0; i < inside.length; i++) {
    const ch = inside[i];
    if (inStr) {
      buf += ch;
      if (esc) {
        esc = false;
        continue;
      }
      if (ch === "\\") {
        esc = true;
        continue;
      }
      if (ch === inStr) inStr = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      inStr = ch;
      buf += ch;
      continue;
    }
    if (ch === "{" || ch === "[" || ch === "(") {
      depth++;
      buf += ch;
      continue;
    }
    if (ch === "}" || ch === "]" || ch === ")") {
      depth--;
      buf += ch;
      continue;
    }
    if (ch === "," && depth === 0) {
      parts.push(buf.trim());
      buf = "";
      continue;
    }
    buf += ch;
  }
  if (buf.trim()) parts.push(buf.trim());

  for (const part of parts) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    const key = part.slice(0, eq).trim();
    const raw = part.slice(eq + 1).trim();
    if (!key) continue;
    if (
      (raw.startsWith('"') && raw.endsWith('"')) ||
      (raw.startsWith("'") && raw.endsWith("'"))
    ) {
      args[key] = raw.slice(1, -1);
      continue;
    }
    if (/^(true|false)$/i.test(raw)) {
      args[key] = /^true$/i.test(raw);
      continue;
    }
    if (/^null$/i.test(raw)) {
      args[key] = null;
      continue;
    }
    if (/^-?\d+(\.\d+)?$/.test(raw)) {
      args[key] = Number(raw);
      continue;
    }
    if (
      (raw.startsWith("{") && raw.endsWith("}")) ||
      (raw.startsWith("[") && raw.endsWith("]"))
    ) {
      try {
        args[key] = JSON.parse(raw);
        continue;
      } catch {
        /* fallthrough */
      }
    }
    args[key] = raw;
  }

  return { name, args };
}
