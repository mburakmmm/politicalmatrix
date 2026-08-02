import { CITIES } from "../types";

const CITY_ALIASES: Record<string, (typeof CITIES)[number]> = {
  istanbul: "İstanbul",
  izmir: "İzmir",
  gaziantep: "Gaziantep",
  diyarbakir: "Diyarbakır",
  diyarbakır: "Diyarbakır",
  ankara: "Ankara",
  bursa: "Bursa",
  antalya: "Antalya",
  adana: "Adana",
  konya: "Konya",
  trabzon: "Trabzon",
};

function fold(s: string): string {
  return s
    .trim()
    .toLocaleLowerCase("tr-TR")
    .normalize("NFC")
    .replace(/ı/g, "i")
    .replace(/İ/g, "i");
}

export function defaultCityForSlug(slug: string): (typeof CITIES)[number] {
  if (slug === "left") return "İzmir";
  if (slug === "right") return "Konya";
  return "Ankara";
}

/** Geçersiz cityId (party_…, unknown_city, center_region) → parti şehri */
export function resolveRallyCity(
  cityId: string,
  partySlug: string
): (typeof CITIES)[number] {
  const raw = String(cityId || "").trim();
  if (!raw || /unknown|center_region|party_|neg_|bill_/i.test(raw)) {
    return defaultCityForSlug(partySlug);
  }

  const folded = fold(raw);
  const alias = CITY_ALIASES[folded];
  if (alias) return alias;

  const hit = CITIES.find((c) => fold(c) === folded);
  if (hit) return hit;

  return defaultCityForSlug(partySlug);
}

export const RALLY_CITY_ENUM = [...CITIES];
