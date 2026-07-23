import { looksLikePromptLeak } from "../sim/speechSanitize";
import { parsePhiFunctools } from "./phiTools";
import {
  parseMistralToolCalls,
  parseQwenToolCalls,
} from "./nativeToolFormats";

/** Zayıf modeller tool_calls yerine metin / reasoning yazar; bunları yakala. */

const KNOWN_TOOLS = [
  "proposeLaw",
  "proposeCustomBill",
  "proposeBill",
  "voteOnBill",
  "callEarlyElection",
  "proposeAlliance",
  "negotiateCoalition",
  "breakAlliance",
  "holdRally",
  "launchSmearCampaign",
  "issuePRStatement",
  "moveConfidence",
  "voteConfidence",
  "proposeRegimeChange",
  "declareEmergency",
  "seizePower",
  "respondNegotiation",
] as const;

export type ParsedTextTool = {
  name: string;
  args: Record<string, unknown>;
};

function tryParseJsonObject(raw: string): Record<string, unknown> | null {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  try {
    return JSON.parse(raw.slice(start, end + 1)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function parseKeyValues(raw: string): Record<string, unknown> {
  const args: Record<string, unknown> = {};
  const re = /(\w+)\s*[:=]\s*"([^"]+)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw))) {
    args[m[1]] = m[2];
  }
  const re2 = /(\w+)\s*[:=]\s*'([^']+)'/g;
  while ((m = re2.exec(raw))) {
    args[m[1]] = m[2];
  }
  const vote = raw.match(/\bvote\s*[:=]\s*(YES|NO|ABSTAIN)\b/i);
  if (vote) args.vote = vote[1].toUpperCase();
  const tone = raw.match(/\btone\s*[:=]\s*(POPULIST|RADICAL|MODERATE)\b/i);
  if (tone) args.tone = tone[1].toUpperCase();
  return args;
}

function pushUnique(found: ParsedTextTool[], item: ParsedTextTool) {
  if (found.some((f) => f.name === item.name)) return;
  found.push(item);
}

/** Qwen / Phi / Hermes tarzı XML tool çağrıları */
function parseXmlToolCalls(content: string): ParsedTextTool[] {
  const found: ParsedTextTool[] = [];

  const toolCallBlocks = content.matchAll(
    /<tool_call>\s*([\s\S]*?)\s*<\/tool_call>/gi
  );
  for (const block of toolCallBlocks) {
    const inner = block[1];
    const name =
      inner.match(/"name"\s*:\s*"(\w+)"/i)?.[1] ||
      inner.match(/name\s*[:=]\s*"?(\w+)"?/i)?.[1];
    if (!name || !KNOWN_TOOLS.includes(name as (typeof KNOWN_TOOLS)[number])) {
      continue;
    }
    const argsRaw =
      inner.match(/"arguments"\s*:\s*(\{[\s\S]*\})/i)?.[1] ||
      inner.match(/arguments\s*[:=]\s*(\{[\s\S]*\})/i)?.[1] ||
      "{}";
    const args = tryParseJsonObject(argsRaw) || parseKeyValues(argsRaw);
    pushUnique(found, { name, args });
  }

  const fnBlocks = content.matchAll(
    /<function\s*=\s*(\w+)>([\s\S]*?)<\/function>/gi
  );
  for (const block of fnBlocks) {
    const name = block[1];
    if (!KNOWN_TOOLS.includes(name as (typeof KNOWN_TOOLS)[number])) continue;
    const args = tryParseJsonObject(block[2]) || parseKeyValues(block[2]);
    pushUnique(found, { name, args });
  }

  // <|tool_call|>holdRally\n{"cityId":"..."}\n
  const pipe = content.matchAll(
    /<\|tool_call\|>\s*(\w+)\s*(\{[\s\S]*?\})?/gi
  );
  for (const block of pipe) {
    const name = block[1];
    if (!KNOWN_TOOLS.includes(name as (typeof KNOWN_TOOLS)[number])) continue;
    const args = block[2]
      ? tryParseJsonObject(block[2]) || parseKeyValues(block[2])
      : {};
    pushUnique(found, { name, args: args || {} });
  }

  return found;
}

/** {"name":"holdRally","arguments":{...}} veya OpenAI tool formatı */
function parseJsonToolBlobs(content: string): ParsedTextTool[] {
  const found: ParsedTextTool[] = [];
  const re =
    /\{\s*"name"\s*:\s*"(\w+)"\s*,\s*"arguments"\s*:\s*(\{[\s\S]*?\})\s*\}/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content))) {
    const name = m[1];
    if (!KNOWN_TOOLS.includes(name as (typeof KNOWN_TOOLS)[number])) continue;
    const args = tryParseJsonObject(m[2]) || {};
    pushUnique(found, { name, args });
  }
  return found;
}

export function parseTextToolCalls(content: string): ParsedTextTool[] {
  if (!content?.trim()) return [];
  // Native formatlar önce (Phi / Qwen Hermes / Mistral)
  const found: ParsedTextTool[] = [
    ...parsePhiFunctools(content),
    ...parseQwenToolCalls(content),
    ...parseMistralToolCalls(content),
  ];

  found.push(...parseXmlToolCalls(content));
  found.push(...parseJsonToolBlobs(content));

  for (const name of KNOWN_TOOLS) {
    if (found.some((f) => f.name === name)) continue;
    const patterns = [
      new RegExp(
        `(?:TOOL\\s+)?${name}\\s*(?:=>|->|:)\\s*(\\{[\\s\\S]*?\\})`,
        "i"
      ),
      new RegExp(`(?:TOOL\\s+)?${name}\\s*\\((\\{[\\s\\S]*?\\})\\)`, "i"),
      new RegExp(`(?:TOOL\\s+)?${name}\\s*\\(([^)]*)\\)`, "i"),
      new RegExp(`(?:TOOL\\s+)?${name}\\s*(?:=>|->)\\s*([^\\n]+)`, "i"),
      new RegExp(
        `(?:call|invoke|use)\\s+(?:the\\s+)?(?:tool\\s+)?${name}\\b[\\s\\S]{0,120}`,
        "i"
      ),
    ];
    for (const re of patterns) {
      const m = content.match(re);
      if (!m) continue;
      const payload = (m[1] || "").trim();
      const json = payload ? tryParseJsonObject(payload) : null;
      const args = json ?? (payload ? parseKeyValues(payload) : {});
      // İsim geçtiği yeter (zayıf modeller boş argüman yazar)
      pushUnique(found, { name, args });
      break;
    }
  }

  if (!found.some((f) => f.name === "voteOnBill")) {
    const billMatch = content.match(/\b(bill_[a-f0-9-]{8,})\b/i);
    const voteMatch = content.match(/\b(YES|NO|ABSTAIN)\b/i);
    if (billMatch && voteMatch && /oy|vote|yasa/i.test(content)) {
      const speech =
        content.match(/speechText\s*[:=]\s*"([^"]+)"/i)?.[1] ||
        content.match(/"([^"]{10,120})"/)?.[1] ||
        "Kürsüden oyumuzu açıklıyoruz.";
      pushUnique(found, {
        name: "voteOnBill",
        args: {
          billId: billMatch[1],
          vote: voteMatch[1].toUpperCase(),
          speechText: speech,
        },
      });
    }
  }

  const seen = new Set<string>();
  return found.filter((f) => {
    if (seen.has(f.name)) return false;
    seen.add(f.name);
    return true;
  });
}

/**
 * Reasoning/metin tool JSON’u yazmasa bile zorunlu araç niyetini çıkar.
 * Örn. "Ankara'da miting yapacağım" → holdRally
 */
export function synthesizeToolFromIntent(
  forceTool: string,
  content: string,
  defaults: {
    cityId: string;
    tone: "POPULIST" | "RADICAL" | "MODERATE";
    focusTopic: string;
    partyName: string;
  }
): ParsedTextTool | null {
  if (!forceTool || !content?.trim()) return null;
  const c = content.toLowerCase();

  if (forceTool === "holdRally") {
    if (
      /miting|rally|kampanya|seçmen|meydan|toplantı|ankara|i̇stanbul|istanbul|i̇zmir|izmir|bursa|adana/i.test(
        c
      ) ||
      /holdrally|hold_rally/i.test(c)
    ) {
      const city =
        content.match(
          /\b(ankara|istanbul|izmir|bursa|adana|gaziantep|konya|antalya)\b/i
        )?.[1] || defaults.cityId;
      const toneMatch = content.match(/\b(POPULIST|RADICAL|MODERATE)\b/i);
      return {
        name: "holdRally",
        args: {
          cityId: String(city).toLowerCase(),
          tone: (toneMatch?.[1]?.toUpperCase() as
            | "POPULIST"
            | "RADICAL"
            | "MODERATE") || defaults.tone,
          focusTopic: defaults.focusTopic,
        },
      };
    }
  }

  if (forceTool === "issuePRStatement") {
    if (/pr|açıklama|basın|kamuoyu|beyan|skandal|reform/i.test(c)) {
      return {
        name: "issuePRStatement",
        args: {
          stance: /reform|özür/i.test(c) ? "reform" : "deny",
          statementText: `${defaults.partyName} kamuoyuna seslendi.`,
        },
      };
    }
  }

  if (forceTool === "launchSmearCampaign") {
    if (/karalama|smear|iftira|hedef|saldır/i.test(c)) {
      return { name: "launchSmearCampaign", args: {} };
    }
  }

  // Model tool adını yazdıysa boş argümanla da kabul
  if (new RegExp(`\\b${forceTool}\\b`, "i").test(content)) {
    return { name: forceTool, args: {} };
  }

  return null;
}

const TOOL_NAME_RE = new RegExp(`\\b(${KNOWN_TOOLS.join("|")})\\b`, "i");

/** Modelin iç monolog / tool planı — kürsüye düşmemeli */
export function looksLikeToolNarration(content: string): boolean {
  if (!content) return false;
  const c = content.trim();
  if (c.length < 8) return true;
  if (looksLikePromptLeak(c)) return true;

  if (TOOL_NAME_RE.test(c)) return true;
  if (/\*\*[^*]+\*\*/.test(c) && /strateji|öneri|holdRally|voteOnBill/i.test(c)) {
    return true;
  }

  return (
    /TOOL\s+\w+/i.test(c) ||
    /functools\s*\[/i.test(c) ||
    /\[TOOL_CALLS\]/i.test(c) ||
    /\[AVAILABLE_TOOLS\]/i.test(c) ||
    /<tool_call>/i.test(c) ||
    /<tools>/i.test(c) ||
    /<\|tool\|>/i.test(c) ||
    /seçeneği yok/i.test(c) ||
    /oy verme zorunluluğu/i.test(c) ||
    /Öneri\s*:/i.test(c) ||
    /Öncelikli/i.test(c) ||
    /Strateji/i.test(c) ||
    /Siz ne yapacaksınız/i.test(c) ||
    /DURUM ANALİZİ/i.test(c) ||
    /tool_choice|function call/i.test(c) ||
    /meclis etkileme/i.test(c) ||
    /önerileri\s*:/i.test(c) ||
    /^#\s/m.test(c) ||
    ((c.match(/-/g) || []).length >= 3 && /parti|anket|iktidar/i.test(c))
  );
}

/** Kürsü için temiz cümle — markdown/tool artıklarını at */
export function cleanSpeechText(content: string): string | null {
  if (!content || looksLikeToolNarration(content)) return null;
  let s = content
    .replace(/\*\*/g, "")
    .replace(/^#+\s*/gm, "")
    .replace(/`+/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (s.length < 12) return null;
  if (s.length > 280) s = s.slice(0, 277) + "…";
  return s;
}
