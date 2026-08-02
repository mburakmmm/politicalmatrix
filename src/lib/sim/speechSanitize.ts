/** Kamuoyuna/kürsüye gidecek metinlerde teknik sızıntı / çöp token temizliği */

const LEAK_HARD =
  /simülasyon|tool_calls?|tool çağır|voteOnBill|voteConfidence|proposeLaw|proposeCustomBill|proposeBill|holdRally|ZORUNLU\s*OY|DURUM ANALİZİ|Siz ne yapacaksınız|mevcut simülasyon|talimatlar ışığında|native tool|Öncelikli:|Strateji:|oyum=|functools\s*\[|<tool_call>|<start_function_call>|```tool_code/i;

const TECH_ID =
  /\b(?:neg|party|bill|sim|cbu|evt|reg|rp|ally|mot)_[a-f0-9-]{6,}\b/gi;

const UUID =
  /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;

/**
 * Latin-1 “bozuk encode” işaretleri — Türkçe ç/ö/ü hariç.
 * g flag zorunlu (match sayımı için).
 */
const MOJIBAKE_MARKERS =
  /[\u00C0-\u00C6\u00C8-\u00D5\u00D7-\u00DB\u00DD-\u00E6\u00E8-\u00F5\u00F7-\u00FB\u00FD-\u00FF\u00A4\u00A6\u00B6\u00B0\u00B1]/g;

/** Türkçe + temel Latin dışı “anlamlı harf” sayılmayan yoğunluk */
const TURKISH_OK = new Set([
  ..."abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZğüşıöçĞÜŞİÖÇâîûÂÎÛ",
]);

function nonTurkishLatinRatio(text: string): number {
  const letters = [...text].filter((c) => /\p{L}/u.test(c));
  if (letters.length < 12) return 0;
  const alien = letters.filter((c) => !TURKISH_OK.has(c)).length;
  return alien / letters.length;
}

export function looksLikePromptLeak(text: string): boolean {
  const t = text.trim();
  if (!t) return true;
  if (LEAK_HARD.test(t)) return true;
  if ((t.match(TECH_ID) || []).length >= 1 && t.length < 220) return true;
  if (/r\d+\s+Güvenlik ve milli/i.test(t)) return true;
  return false;
}

/** Anlamsız / bozuk PR-kürsü metni — feed'e basılmamalı */
export function looksLikeGibberish(text: string): boolean {
  const t = String(text || "").trim();
  if (!t) return true;
  if (looksLikePromptLeak(t)) return true;
  if (/[\uFFFD\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(t)) return true;

  const moji = (t.match(MOJIBAKE_MARKERS) || []).length;
  if (moji >= 3) return true;
  if (moji >= 2 && t.length < 120) return true;

  // Aynı 6–20 karakterlik parçanın 3+ tekrarı (küçük model loop)
  if (/(.{6,20})\1{2,}/u.test(t)) return true;

  if (nonTurkishLatinRatio(t) >= 0.22) return true;

  const letters = t.replace(/[^a-zA-ZğüşıöçĞÜŞİÖÇâîûÂÎÛ]/gu, "");
  if (letters.length >= 18) {
    const vowels = (letters.match(/[aeiouAEIOUıİöÖüÜâîûÂÎÛ]/gu) || []).length;
    if (vowels / letters.length < 0.18) return true;
  }

  const weird = (t.match(/[^\p{L}\p{N}\p{P}\p{Z}]/gu) || []).length;
  if (weird >= 3) return true;

  return false;
}

export function sanitizePublicSpeech(
  text: string,
  fallback: string
): string {
  let t = String(text || "").trim();
  if (!t || looksLikePromptLeak(t) || looksLikeGibberish(t)) return fallback;

  t = t.replace(TECH_ID, "").replace(UUID, "");
  t = t.replace(/\s{2,}/g, " ").replace(/\s+([,.!?])/g, "$1").trim();

  if (t.length < 12 || looksLikePromptLeak(t) || looksLikeGibberish(t)) {
    return fallback;
  }
  if (t.length > 400) t = t.slice(0, 397) + "…";
  return t;
}
