export interface ScenarioPack {
  id: string;
  name: string;
  description: string;
  seedHint?: number;
  metrics?: Partial<{
    economy: number;
    freedom: number;
    security: number;
    fear: number;
    inflation: number;
    unemployment: number;
  }>;
  regime?: string;
  notes?: string;
}

export const SCENARIO_PACKS: ScenarioPack[] = [
  {
    id: "balanced",
    name: "Dengeli Cumhuriyet",
    description: "Klasik kırılgan demokrasi; hiçbiri tek başına iktidar değil.",
  },
  {
    id: "economic_collapse",
    name: "Ekonomik Çöküş",
    description: "Enflasyon ve işsizlik patlamış; radikal dönüşüm kapıda.",
    metrics: {
      economy: 18,
      inflation: 78,
      unemployment: 32,
      fear: 70,
      freedom: 40,
    },
  },
  {
    id: "narrow_majority",
    name: "İnce Çoğunluk Sonrası",
    description:
      "Eşit başlangıç + mini seçim; senaryo metrikleri gerilimli — seçim sonrası ince fark beklenir.",
  },
  {
    id: "theocratic_pressure",
    name: "Dini Dalga",
    description: "Toplumsal dindarlık yükselmiş; teokrasi yolu açık.",
    metrics: { fear: 45, freedom: 42, security: 55 },
  },
  {
    id: "revolutionary_left",
    name: "Devrimci Sol Moment",
    description: "İşçi öfkesi ve eşitsizlik; komünist/sosyalist kırılma riski.",
    metrics: {
      economy: 28,
      unemployment: 35,
      freedom: 48,
      fear: 55,
    },
  },
  {
    id: "authoritarian_temptation",
    name: "Otoriter Ayartı",
    description: "Güvenlik korkusu yüksek; faşizan/cunta yolu kolaylaşır.",
    metrics: { fear: 72, security: 35, freedom: 38 },
  },
];

export function getScenario(id: string): ScenarioPack | undefined {
  return SCENARIO_PACKS.find((s) => s.id === id);
}
