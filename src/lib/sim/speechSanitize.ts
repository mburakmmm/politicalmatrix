/** Kamuoyuna/kürsüye gidecek metinlerde teknik sızıntı temizliği */

const LEAK_HARD =
  /simülasyon|tool_calls?|tool çağır|voteOnBill|voteConfidence|proposeLaw|proposeCustomBill|proposeBill|holdRally|ZORUNLU\s*OY|DURUM ANALİZİ|Siz ne yapacaksınız|mevcut simülasyon|talimatlar ışığında|native tool|Öncelikli:|Strateji:|oyum=/i;

const TECH_ID =
  /\b(?:neg|party|bill|sim|cbu|evt|reg|rp|ally|mot)_[a-f0-9-]{6,}\b/gi;

const UUID =
  /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;

export function looksLikePromptLeak(text: string): boolean {
  const t = text.trim();
  if (!t) return true;
  if (LEAK_HARD.test(t)) return true;
  if ((t.match(TECH_ID) || []).length >= 1 && t.length < 220) return true;
  if (/r\d+\s+Güvenlik ve milli/i.test(t)) return true;
  return false;
}

export function sanitizePublicSpeech(
  text: string,
  fallback: string
): string {
  let t = String(text || "").trim();
  if (!t || looksLikePromptLeak(t)) return fallback;

  t = t.replace(TECH_ID, "").replace(UUID, "");
  t = t.replace(/\s{2,}/g, " ").replace(/\s+([,.!?])/g, "$1").trim();

  if (t.length < 12 || looksLikePromptLeak(t)) return fallback;
  if (t.length > 400) t = t.slice(0, 397) + "…";
  return t;
}
