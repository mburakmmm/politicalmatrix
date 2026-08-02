import { getLaw, resolveCatalogLawId } from "./laws/catalog";

/** Katalog id / tier kalıbı: healthcare_t1, elections_t5, banking_t2 … */
const LAW_ID_PATTERN =
  /^[a-z][a-z0-9]*(?:_[a-z0-9]+)*_t\d+$/i;

export function looksLikeCatalogLawId(raw: string): boolean {
  const s = String(raw || "").trim();
  if (!s) return false;
  if (LAW_ID_PATTERN.test(s)) return true;
  if (getLaw(s)) return true;
  const resolved = resolveCatalogLawId(s, "center");
  // Tam id eşleşmesi — kısa Türkçe konu "sağlık" false positive olmasın
  if (resolved.law && resolved.law.id.toLowerCase() === s.toLowerCase()) {
    return true;
  }
  return false;
}

export function defaultRallyFocusTopic(slug: string): string {
  if (slug === "left") return "emek ve sosyal adalet";
  if (slug === "right") return "güvenlik ve milli değerler";
  return "istikrar ve reform";
}

/**
 * Model bazen focusTopic'e lawId yazar (healthcare_t1).
 * Bunları parti slogalarına çevir.
 */
export function sanitizeRallyFocusTopic(
  raw: unknown,
  slug: string
): string {
  const t = String(raw ?? "").trim();
  if (!t || looksLikeCatalogLawId(t)) {
    return defaultRallyFocusTopic(slug);
  }
  // "healthcare_t1 reform" gibi karışık
  if (/\b[a-z][a-z0-9_]*_t\d+\b/i.test(t) && t.length < 40) {
    return defaultRallyFocusTopic(slug);
  }
  return t.slice(0, 120);
}
