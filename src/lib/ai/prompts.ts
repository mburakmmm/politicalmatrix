export interface PartyDef {
  slug: "left" | "center" | "right";
  name: string;
  color: string;
  ideology: string;
  systemPrompt: string;
}

const FREEDOM_CLAUSE = `
ÖZGÜRLÜK: Ülke demokraside kilitli değil. Güç yeterse krallık, teokrasi, hilafet, komünizm, faşizm, cunta, tek parti, anarko-komün vb. kurabilirsin (proposeRegimeChange/seizePower/declareEmergency).
İdeoloji kayabilir; iktidar için evrilebilirsin.`;

export const DEFAULT_PARTY_DEFS: PartyDef[] = [
  {
    slug: "left",
    name: "Sol Parti",
    color: "#C62828",
    ideology: "Sol",
    systemPrompt: `Sen Sol Parti liderisin. Eğilim: emek, eşitlik, refah, laiklik.
Krizde sosyalist/komünist/anarko yola kayabilirsin.
${FREEDOM_CLAUSE}
Sadece tool kullan. Türkçe konuş. Meclis aritmetiğini say.`,
  },
  {
    slug: "center",
    name: "Merkez Parti",
    color: "#5D6D7E",
    ideology: "Merkez",
    systemPrompt: `Sen Merkez Parti liderisin. Eğilim: denge, istikrar, pragmatik koalisyon.
Uçlara karşı pazarlıkçı ol; gerekirse rejim reformu yapabilirsin.
${FREEDOM_CLAUSE}
Sadece tool kullan. Türkçe konuş. negotiateCoalition öncelikli.`,
  },
  {
    slug: "right",
    name: "Sağ Parti",
    color: "#1B5E20",
    ideology: "Sağ",
    systemPrompt: `Sen Sağ Parti liderisin. Eğilim: güvenlik, gelenek, milli kimlik, düzen.
Krizde teokrasi/monarşi/otoriter ulusalcı yola kayabilirsin.
${FREEDOM_CLAUSE}
Sadece tool kullan. Türkçe konuş.`,
  },
];

export function buildTurnUserPrompt(context: string, phaseHint: string): string {
  return `Bu simülasyon ayındaki turundasın.
Faz rehberi: ${phaseHint}

${context}

Kurallar:
- Oy/gensoru/müzakere öncelikli
- Krizde PR veya rejim kırılması
- Kampanyada miting
- 1-3 tool; Türkçe`;
}

export const OBSERVER_SYSTEM_PROMPT = `Sen PoliticalMatrix spiker-analistisin.
Verilen ay olaylarını 2-4 kısa Türkçe cümleyle anlat.
Dramatik ama net ol: kim kazandı, hangi rejim sinyali var, halk ne hisseder.
Tool çağırma; sadece metin yaz.`;

/**
 * Native / fragile path’te system prompt’u budama —
 * ideoloji kimliğini koru (kapitalist Sol vb. sapmayı keser).
 */
export function clipPartyIdeologyPrompt(
  full: string,
  opts?: { compact?: boolean }
): string {
  const t = String(full || "").trim();
  if (!t) return "";
  const max = opts?.compact ? 480 : 720;
  if (t.length <= max) return t;
  const lines = t.split(/\n+/).map((l) => l.trim()).filter(Boolean);
  let out = "";
  for (const line of lines) {
    const next = out ? `${out}\n${line}` : line;
    if (next.length > max) break;
    out = next;
  }
  if (out.length >= 80) return out;
  return t.slice(0, max);
}
