import type { MetricKey, RegimeType } from "../../types";

export type LawGroup =
  | "economy"
  | "taxation"
  | "trade"
  | "labor"
  | "welfare"
  | "citizenship"
  | "civil_rights"
  | "policing"
  | "military"
  | "church"
  | "education"
  | "media"
  | "judiciary"
  | "healthcare"
  | "environment"
  | "agriculture"
  | "housing"
  | "foreign"
  | "migration"
  | "constitution"
  | "regime"
  | "technology"
  | "culture"
  | "local_gov"
  | "energy"
  | "infrastructure"
  | "banking"
  | "elections"
  | "intelligence"
  | "family";

export const LAW_GROUP_LABELS: Record<LawGroup, string> = {
  economy: "Ekonomi modeli",
  taxation: "Vergi rejimi",
  trade: "Ticaret & gümrük",
  labor: "İşçi hakları",
  welfare: "Sosyal refah",
  citizenship: "Vatandaşlık",
  civil_rights: "Sivil haklar",
  policing: "İç güvenlik / polis",
  military: "Ordu & savunma",
  church: "Din–devlet",
  education: "Eğitim",
  media: "Medya & basın",
  judiciary: "Yargı",
  healthcare: "Sağlık",
  environment: "Çevre",
  agriculture: "Tarım",
  housing: "Konut",
  foreign: "Dış politika",
  migration: "Göç",
  constitution: "Anayasa gücü",
  regime: "Rejim formu",
  technology: "Teknoloji & veri",
  culture: "Kültür & dil",
  local_gov: "Yerel yönetim",
  energy: "Enerji",
  infrastructure: "Altyapı & ulaşım",
  banking: "Bankacılık & finans",
  elections: "Seçim sistemi",
  intelligence: "İstihbarat",
  family: "Aile & toplumsal cinsiyet",
};

export interface LawDef {
  id: string;
  group: LawGroup;
  tier: number;
  title: string;
  summary: string;
  deltas: Partial<Record<MetricKey, number>>;
  debateMonths: number;
  proposedRegime?: RegimeType;
  tags: string[];
  /** Sol/merkez/sağ için öneri skoru (-2..+2) */
  bias: { left: number; center: number; right: number };
}

export interface CustomTemplate {
  id: string;
  titleHint: string;
  category: string;
  summary: string;
  deltas: Partial<Record<MetricKey, number>>;
  debateMonths: number;
  proposedRegime?: RegimeType;
}

type TierSpec = {
  title: string;
  summary: string;
  deltas: Partial<Record<MetricKey, number>>;
  debateMonths?: number;
  proposedRegime?: RegimeType;
  bias: LawDef["bias"];
  tags?: string[];
};

function buildGroup(group: LawGroup, tiers: TierSpec[]): LawDef[] {
  return tiers.map((t, i) => ({
    id: `${group}_t${i + 1}`,
    group,
    tier: i + 1,
    title: t.title,
    summary: t.summary,
    deltas: t.deltas,
    debateMonths: t.debateMonths ?? (t.proposedRegime ? 3 : i >= 3 ? 2 : 1),
    proposedRegime: t.proposedRegime,
    tags: t.tags ?? [group],
    bias: t.bias,
  }));
}

/** Victoria 3 tarzı geniş kanun ağacı — 120+ madde */
export const LAW_CATALOG: LawDef[] = [
  ...buildGroup("economy", [
    { title: "Komuta ekonomisi", summary: "Merkezi planlama ve kamu tekeli.", deltas: { economy: -4, unemployment: -3, freedom: -6, inflation: 2 }, bias: { left: 2, center: -1, right: -2 } },
    { title: "Ağır devlet kapitalizmi", summary: "Stratejik sektörlerde kamu ağırlığı.", deltas: { economy: -1, unemployment: -2, freedom: -2 }, bias: { left: 2, center: 0, right: -1 } },
    { title: "Karma ekonomi", summary: "Kamu–özel denge, düzenlenmiş piyasalar.", deltas: { economy: 2, unemployment: -1, freedom: 1 }, bias: { left: 1, center: 2, right: 0 } },
    { title: "Liberal piyasa", summary: "Özelleştirme ve rekabet öncelikli.", deltas: { economy: 4, unemployment: 2, freedom: 2, inflation: -1 }, bias: { left: -1, center: 1, right: 2 } },
    { title: "Laissez-faire", summary: "Minimal devlet müdahalesi.", deltas: { economy: 3, unemployment: 4, freedom: 3, fear: 2 }, bias: { left: -2, center: 0, right: 2 } },
  ]),
  ...buildGroup("taxation", [
    { title: "Sömürü vergisi / aşırı haraç", summary: "Ağır ve keyfi vergi yükü.", deltas: { economy: -5, fear: 4, freedom: -3 }, bias: { left: -1, center: -2, right: -1 } },
    { title: "Yüksek artan oranlı vergi", summary: "Üst gelirden güçlü kesinti, yeniden dağıtım.", deltas: { economy: -2, unemployment: -2, freedom: 1 }, bias: { left: 2, center: 0, right: -2 } },
    { title: "Dengeli vergi sistemi", summary: "Orta düzey artan oran + KDV.", deltas: { economy: 1, inflation: 0 }, bias: { left: 0, center: 2, right: 0 } },
    { title: "Düşük kurumlar vergisi", summary: "Yatırım çekmek için vergi indirimi.", deltas: { economy: 3, unemployment: -1, freedom: 1 }, bias: { left: -1, center: 1, right: 2 } },
    { title: "Vergi cenneti modeli", summary: "Minimal vergi, sermaye kaçışına açık.", deltas: { economy: 2, unemployment: 1, fear: 1 }, bias: { left: -2, center: -1, right: 1 } },
  ]),
  ...buildGroup("trade", [
    { title: "Otarşi / kapalı ekonomi", summary: "İthalat yasaklarına yakın korumacılık.", deltas: { economy: -3, inflation: 4, security: 1 }, bias: { left: 0, center: -1, right: 1 } },
    { title: "Yüksek gümrük duvarı", summary: "Yerli üretimi koruyan tarifeler.", deltas: { economy: -1, inflation: 2, unemployment: -1 }, bias: { left: 1, center: 0, right: 1 } },
    { title: "Seçici serbest ticaret", summary: "Stratejik sektör koruması + genel açıklık.", deltas: { economy: 2, inflation: -1 }, bias: { left: 0, center: 2, right: 1 } },
    { title: "Serbest ticaret", summary: "Düşük tarife, küresel entegrasyon.", deltas: { economy: 3, unemployment: 1, inflation: -2 }, bias: { left: -1, center: 1, right: 1 } },
    { title: "Tek taraflı açıklık", summary: "Tarifesiz ithalat; yerli sanayi riski.", deltas: { economy: 1, unemployment: 3, inflation: -3 }, bias: { left: -2, center: 0, right: 0 } },
  ]),
  ...buildGroup("labor", [
    { title: "Zorunlu çalışma / angarya", summary: "Devlet veya toprak sahipleri için zorunlu emek.", deltas: { economy: 1, freedom: -8, fear: 5, unemployment: -4 }, bias: { left: -2, center: -2, right: -1 } },
    { title: "Sendikasız esnek piyasa", summary: "İş güvencesi zayıf, işveren lehine.", deltas: { economy: 2, unemployment: 1, freedom: -1 }, bias: { left: -2, center: 0, right: 2 } },
    { title: "Dengeli iş hukuku", summary: "Asgari ücret + sınırlı sendika.", deltas: { economy: 1, unemployment: 0, freedom: 1 }, bias: { left: 1, center: 2, right: 0 } },
    { title: "Güçlü sendikal haklar", summary: "Toplu sözleşme ve grev hakkı geniş.", deltas: { economy: -1, unemployment: -2, freedom: 2 }, bias: { left: 2, center: 0, right: -2 } },
    { title: "İşçi öz yönetimi", summary: "Fabrika konseyleri ve ortak yönetim.", deltas: { economy: -2, unemployment: -3, freedom: 3 }, bias: { left: 2, center: -1, right: -2 } },
  ]),
  ...buildGroup("welfare", [
    { title: "Hayırseverlik / yokluk", summary: "Devlet yardımı yok, cemaat yardımı.", deltas: { economy: 1, unemployment: 2, fear: 2, freedom: -1 }, bias: { left: -2, center: -1, right: 1 } },
    { title: "Dar yardım ağı", summary: "Sadece aşırı yoksullara yardım.", deltas: { unemployment: 1, fear: 1 }, bias: { left: -1, center: 0, right: 1 } },
    { title: "Genel sosyal güvenlik", summary: "Emeklilik, işsizlik, temel sağlık.", deltas: { economy: -1, unemployment: -2, fear: -2, freedom: 1 }, bias: { left: 1, center: 2, right: 0 } },
    { title: "Geniş refah devleti", summary: "Evrensel yardımlar ve kamu hizmetleri.", deltas: { economy: -2, unemployment: -3, fear: -3, freedom: 2, inflation: 1 }, bias: { left: 2, center: 1, right: -2 } },
    { title: "Evrensel temel gelir", summary: "Herkese düzenli nakit ödeme.", deltas: { economy: -3, unemployment: -1, fear: -4, freedom: 3, inflation: 2 }, bias: { left: 2, center: 0, right: -2 } },
  ]),
  ...buildGroup("citizenship", [
    { title: "Kan bağı / ırksal vatandaşlık", summary: "Vatandaşlık etnik kökene bağlı.", deltas: { freedom: -4, fear: 3, security: 1 }, bias: { left: -2, center: -1, right: 2 } },
    { title: "Sıkı kültürel asimilasyon", summary: "Vatandaşlık dil/kültür şartına bağlı.", deltas: { freedom: -2, fear: 1 }, bias: { left: -1, center: 0, right: 2 } },
    { title: "Anayasal vatandaşlık", summary: "Doğum ve yasal süreçle vatandaşlık.", deltas: { freedom: 2, fear: -1 }, bias: { left: 1, center: 2, right: 0 } },
    { title: "Çok kültürlü vatandaşlık", summary: "Kimlik çeşitliliği anayasal güvence.", deltas: { freedom: 3, fear: -1, security: -1 }, bias: { left: 2, center: 1, right: -2 } },
    { title: "Açık dünya vatandaşlığı", summary: "Kolay vatandaşlık, sınırlar gevşek.", deltas: { freedom: 4, security: -3, unemployment: 2 }, bias: { left: 1, center: 0, right: -2 } },
  ]),
  ...buildGroup("civil_rights", [
    { title: "Sivil haklar askıda", summary: "OHAL kalıcı; haklar fiilen yok.", deltas: { freedom: -8, fear: 6, security: 2 }, bias: { left: -1, center: -2, right: 0 } },
    { title: "Kısıtlı haklar", summary: "Temel haklar dar yorumlanır.", deltas: { freedom: -3, fear: 2, security: 1 }, bias: { left: -1, center: -1, right: 1 } },
    { title: "Anayasal güvenceler", summary: "Standart sivil ve siyasi haklar.", deltas: { freedom: 2, fear: -1 }, bias: { left: 1, center: 2, right: 0 } },
    { title: "Geniş özgürlükler paketi", summary: "İfade, toplanma, mahremiyet güçlenir.", deltas: { freedom: 4, fear: -2, security: -1 }, bias: { left: 2, center: 1, right: -1 } },
    { title: "Radikal özgürlükçülük", summary: "Neredeyse sınırsız bireysel özgürlük.", deltas: { freedom: 6, security: -3, fear: 1 }, bias: { left: 1, center: 0, right: -2 } },
  ]),
  ...buildGroup("policing", [
    { title: "Gizli polis / terör aygıtı", summary: "Muhalefeti bastıran iç istihbarat.", deltas: { security: 3, freedom: -7, fear: 5 }, bias: { left: -1, center: -2, right: 1 } },
    { title: "Ağır güvenlik doktrini", summary: "Geniş yetkili polis, sıkı kontrol.", deltas: { security: 4, freedom: -3, fear: 1 }, bias: { left: -1, center: 0, right: 2 } },
    { title: "Hukuka bağlı kolluk", summary: "Denetimli polis, orantılı güç.", deltas: { security: 2, freedom: 1, fear: -1 }, bias: { left: 0, center: 2, right: 1 } },
    { title: "Toplum destekli güvenlik", summary: "Yerel güvenlik ve şeffaflık.", deltas: { security: 1, freedom: 2, fear: -2 }, bias: { left: 1, center: 1, right: 0 } },
    { title: "Minimal kolluk", summary: "Polis gücü küçültülür.", deltas: { security: -3, freedom: 3, fear: 2 }, bias: { left: 1, center: -1, right: -2 } },
  ]),
  ...buildGroup("military", [
    { title: "Askeri üstünlük / cunta hazırlığı", summary: "Ordu siyasette fiili veto.", deltas: { security: 4, freedom: -4, economy: -2, fear: 2 }, bias: { left: -2, center: -1, right: 1 }, tags: ["military", "regime"] },
    { title: "Büyük profesyonel ordu", summary: "Yüksek savunma bütçesi.", deltas: { security: 3, economy: -2 }, bias: { left: -1, center: 0, right: 2 } },
    { title: "Dengeli savunma", summary: "Orta bütçe, NATO tarzı profesyonellik.", deltas: { security: 2, economy: -1 }, bias: { left: 0, center: 2, right: 1 } },
    { title: "Savunma odaklı milis", summary: "Küçük ordu + sivil savunma.", deltas: { security: 0, economy: 1, freedom: 1 }, bias: { left: 1, center: 0, right: -1 } },
    { title: "Pasifist / silahsızlanma", summary: "Askeri harcama minimum.", deltas: { security: -4, economy: 2, freedom: 2, fear: 2 }, bias: { left: 2, center: 0, right: -2 } },
  ]),
  ...buildGroup("church", [
    { title: "Devlet dini zorunlu", summary: "Tek resmi din, muhalif inanç yasak.", deltas: { freedom: -6, fear: 3, security: 1 }, bias: { left: -2, center: -1, right: 2 }, proposedRegime: "theocracy", debateMonths: 3 },
    { title: "Resmi din + ayrıcalık", summary: "Bir din devletle iç içe.", deltas: { freedom: -3, fear: 1 }, bias: { left: -2, center: 0, right: 2 } },
    { title: "Laiklik (dengeli)", summary: "Din–devlet ayrılığı, ibadet özgürlüğü.", deltas: { freedom: 2, fear: -1 }, bias: { left: 1, center: 2, right: 0 } },
    { title: "Katı laiklik", summary: "Kamusal alanda din görünürlüğü kısıtlı.", deltas: { freedom: 1, fear: 1 }, bias: { left: 2, center: 0, right: -2 } },
    { title: "Dinler üstü çoğulculuk", summary: "Tüm inançlara eşit mesafe, geniş özgürlük.", deltas: { freedom: 3, fear: -1 }, bias: { left: 1, center: 1, right: -1 } },
  ]),
  ...buildGroup("education", [
    { title: "Seçkin / sınıfsal eğitim", summary: "Eğitim zenginlere; halk okulsuz.", deltas: { economy: -1, unemployment: 2, freedom: -2 }, bias: { left: -2, center: -1, right: 1 } },
    { title: "Dini müfredat ağırlıklı", summary: "Okullarda resmi inanç öğretimi.", deltas: { freedom: -2, fear: 1 }, bias: { left: -2, center: 0, right: 2 } },
    { title: "Ulusal müfredat", summary: "Merkezi, standart kamu eğitimi.", deltas: { economy: 1, unemployment: -1 }, bias: { left: 0, center: 2, right: 1 } },
    { title: "Kapsayıcı kamu eğitimi", summary: "Ücretsiz, geniş erişimli eğitim.", deltas: { economy: 1, unemployment: -2, freedom: 1 }, bias: { left: 2, center: 1, right: -1 } },
    { title: "Özgür / deneysel eğitim", summary: "Okul seçimi ve alternatif modeller.", deltas: { freedom: 3, economy: 0, unemployment: 1 }, bias: { left: 1, center: 0, right: 0 } },
  ]),
  ...buildGroup("media", [
    { title: "Devlet propagandası", summary: "Tek kanal, sansür mutlak.", deltas: { freedom: -7, fear: 3, security: 1 }, bias: { left: 0, center: -2, right: 1 } },
    { title: "Ağır sansür rejimi", summary: "Lisans + kırmızı çizgiler.", deltas: { freedom: -4, fear: 2 }, bias: { left: -1, center: -1, right: 1 } },
    { title: "Düzenlenmiş basın", summary: "RTÜK tarzı denetim, çoğulculuk sınırlı.", deltas: { freedom: -1, fear: 0 }, bias: { left: 0, center: 1, right: 1 } },
    { title: "Serbest basın", summary: "Bağımsız medya, sınırlı müdahale.", deltas: { freedom: 3, fear: -1 }, bias: { left: 1, center: 2, right: 0 } },
    { title: "Radikal ifade özgürlüğü", summary: "Neredeyse sansürsüz ortam.", deltas: { freedom: 5, security: -2, fear: 1 }, bias: { left: 1, center: 0, right: -1 } },
  ]),
  ...buildGroup("judiciary", [
    { title: "Siyasi mahkemeler", summary: "Yargı iktidarın uzantısı.", deltas: { freedom: -6, fear: 4, security: 1 }, bias: { left: -1, center: -2, right: 0 } },
    { title: "Zayıf bağımsızlık", summary: "Atamalar siyasallaşmış.", deltas: { freedom: -2, fear: 1 }, bias: { left: -1, center: -1, right: 1 } },
    { title: "Anayasal yargı", summary: "AYM ve bağımsız mahkemeler.", deltas: { freedom: 2, fear: -1, security: 1 }, bias: { left: 1, center: 2, right: 0 } },
    { title: "Güçlü hukuk devleti", summary: "Şeffaf yargılama, hak arama kolay.", deltas: { freedom: 3, fear: -2, economy: 1 }, bias: { left: 1, center: 2, right: 0 } },
    { title: "Halk mahkemeleri / jüri üstünlüğü", summary: "Yargı gücü halka yaklaşır.", deltas: { freedom: 2, fear: 1, security: -1 }, bias: { left: 2, center: -1, right: -1 } },
  ]),
  ...buildGroup("healthcare", [
    { title: "Piyasa sağlığı", summary: "Özel sigorta ağırlıklı sistem.", deltas: { economy: 1, unemployment: 0, fear: 1, freedom: 1 }, bias: { left: -2, center: 0, right: 2 } },
    { title: "Karma sağlık", summary: "Kamu + özel hastane dengesi.", deltas: { economy: 0, fear: -1 }, bias: { left: 0, center: 2, right: 1 } },
    { title: "Ulusal sağlık hizmeti", summary: "Ücretsiz temel sağlık.", deltas: { economy: -2, fear: -2, unemployment: -1 }, bias: { left: 2, center: 1, right: -1 } },
    { title: "Evrensel kapsamlı sağlık", summary: "İlaç ve tedavi geniş güvence.", deltas: { economy: -3, fear: -3, freedom: 1 }, bias: { left: 2, center: 0, right: -2 } },
    { title: "Koruyucu halk sağlığı seferberliği", summary: "Aşı, hijyen, koruyucu hekimlik öncelikli.", deltas: { economy: -1, fear: -2, unemployment: -1 }, bias: { left: 1, center: 1, right: 0 } },
  ]),
  ...buildGroup("environment", [
    { title: "Sınırsız sömürü", summary: "Çevre kuralsız; büyüme her şey.", deltas: { economy: 3, fear: 2, freedom: -1 }, bias: { left: -2, center: -1, right: 1 } },
    { title: "Zayıf çevre denetimi", summary: "Sembolik standartlar.", deltas: { economy: 1, fear: 1 }, bias: { left: -1, center: 0, right: 1 } },
    { title: "Dengeli çevre yasası", summary: "Emisyon ve doğa koruma orta düzey.", deltas: { economy: -1, fear: -1 }, bias: { left: 1, center: 2, right: 0 } },
    { title: "Yeşil dönüşüm", summary: "Yenilenebilir enerji zorunluluğu.", deltas: { economy: -2, unemployment: -1, fear: -2, freedom: 1 }, bias: { left: 2, center: 1, right: -1 } },
    { title: "Ekolojik öncelik", summary: "Büyüme ikinci planda; doğa birinci.", deltas: { economy: -4, fear: -2, freedom: 2 }, bias: { left: 2, center: 0, right: -2 } },
  ]),
  ...buildGroup("agriculture", [
    { title: "Büyük toprak sahipliği", summary: "Toprak azınlıkta toplanır.", deltas: { economy: 1, unemployment: 2, freedom: -2 }, bias: { left: -2, center: -1, right: 1 } },
    { title: "Tarımsal destekler", summary: "Çiftçiye sübvansiyon.", deltas: { economy: -1, unemployment: -1, inflation: 1 }, bias: { left: 1, center: 1, right: 1 } },
    { title: "Kooperatif tarım", summary: "Üretici birlikleri güçlenir.", deltas: { economy: 0, unemployment: -2, freedom: 1 }, bias: { left: 2, center: 0, right: -1 } },
    { title: "Modern tarım reformu", summary: "Teknoloji + toprak dağılımı.", deltas: { economy: 2, unemployment: -2 }, bias: { left: 1, center: 2, right: 0 } },
    { title: "Gıda egemenliği", summary: "İthalata bağımlılık azaltılır.", deltas: { economy: 1, inflation: -1, security: 1 }, bias: { left: 1, center: 1, right: 1 } },
  ]),
  ...buildGroup("housing", [
    { title: "Kira serbestisi", summary: "Konut tamamen piyasa.", deltas: { economy: 1, fear: 2, freedom: 1 }, bias: { left: -2, center: 0, right: 2 } },
    { title: "Kira kontrolü", summary: "Üst sınır ve tahliye koruması.", deltas: { economy: -1, fear: -2, freedom: 1 }, bias: { left: 2, center: 1, right: -1 } },
    { title: "Toplu konut seferberliği", summary: "Devlet konutu üretimi.", deltas: { economy: -2, unemployment: -2, fear: -2 }, bias: { left: 2, center: 1, right: -1 } },
    { title: "Konut hakkı anayasası", summary: "Barınma temel hak sayılır.", deltas: { economy: -2, fear: -3, freedom: 2 }, bias: { left: 2, center: 0, right: -2 } },
    { title: "Mülksüzleştirme / kamulaştırma", summary: "Boş konutlara el koyma yetkisi.", deltas: { economy: -3, freedom: -2, fear: 1, unemployment: -1 }, bias: { left: 2, center: -2, right: -2 } },
  ]),
  ...buildGroup("foreign", [
    { title: "İzolasyonizm", summary: "Dış ilişkiler minimal.", deltas: { security: -1, economy: -2, freedom: 0 }, bias: { left: 0, center: -1, right: 1 } },
    { title: "Bölgesel güç doktrini", summary: "Komşularda nüfuz arayışı.", deltas: { security: 2, economy: -1, fear: 1 }, bias: { left: -1, center: 0, right: 2 } },
    { title: "Çok taraflı diplomasi", summary: "Uluslararası kurumlara bağlılık.", deltas: { economy: 1, freedom: 1, security: 1 }, bias: { left: 1, center: 2, right: 0 } },
    { title: "Müttefik blok üyeliği", summary: "Askeri-siyasi ittifak ağı.", deltas: { security: 3, economy: 1, freedom: -1 }, bias: { left: 0, center: 1, right: 1 } },
    { title: "Emperyal projeksiyon", summary: "Yurtdışı üs ve müdahale yetkisi.", deltas: { security: 2, economy: -3, fear: 2, freedom: -2 }, bias: { left: -2, center: -1, right: 2 } },
  ]),
  ...buildGroup("migration", [
    { title: "Kapalı sınırlar", summary: "Göç fiilen yasak.", deltas: { security: 2, freedom: -3, unemployment: -1, economy: -1 }, bias: { left: -2, center: -1, right: 2 } },
    { title: "Sıkı kota sistemi", summary: "Sınırlı ve seçici göç.", deltas: { security: 1, freedom: -1 }, bias: { left: -1, center: 1, right: 2 } },
    { title: "Düzenli göç + entegrasyon", summary: "Yasal yollar ve uyum programı.", deltas: { economy: 1, freedom: 1, unemployment: 1 }, bias: { left: 1, center: 2, right: 0 } },
    { title: "Açık göç politikası", summary: "Geniş kabul, zayıf filtre.", deltas: { economy: 2, freedom: 2, unemployment: 2, security: -2 }, bias: { left: 2, center: 0, right: -2 } },
    { title: "Sığınmacı önceliği", summary: "İnsani kabul kapasitesi yüksek.", deltas: { freedom: 3, fear: -1, unemployment: 1, economy: -1 }, bias: { left: 2, center: 1, right: -2 } },
  ]),
  ...buildGroup("constitution", [
    { title: "Kâğıt anayasa", summary: "Anayasa sembolik; güç fiilidir.", deltas: { freedom: -5, fear: 3 }, bias: { left: -1, center: -2, right: 0 } },
    { title: "Esnek anayasa", summary: "Kolay değiştirilebilir çerçeve.", deltas: { freedom: 0, fear: 1 }, bias: { left: 0, center: 0, right: 1 } },
    { title: "Katı anayasal düzen", summary: "Değişiklik için nitelikli çoğunluk.", deltas: { freedom: 2, fear: -1, security: 1 }, bias: { left: 1, center: 2, right: 0 } },
    { title: "Güçlü haklar kataloğu", summary: "Temel haklar değiştirilemez çekirdek.", deltas: { freedom: 4, fear: -2 }, bias: { left: 2, center: 1, right: -1 } },
    { title: "Kurucu meclis yetkisi", summary: "Anayasa köklü yenilenebilir.", deltas: { freedom: 1, fear: 2, security: -1 }, bias: { left: 1, center: 0, right: 0 }, debateMonths: 3 },
  ]),
  ...buildGroup("regime", [
    { title: "Parlamenter cumhuriyet pekiştirme", summary: "Meclis üstünlüğü ve seçimler.", deltas: { freedom: 2, fear: -1 }, bias: { left: 1, center: 2, right: 0 }, proposedRegime: "parliamentary_republic", debateMonths: 2 },
    { title: "Başkanlık sistemi", summary: "Yürütme güçlenir.", deltas: { freedom: -1, security: 1 }, bias: { left: 0, center: 0, right: 1 }, proposedRegime: "presidential_republic", debateMonths: 3 },
    { title: "Anayasal monarşi", summary: "Sembolik taht + parlamenter düzen.", deltas: { freedom: 0, fear: -1, security: 1 }, bias: { left: -1, center: 1, right: 2 }, proposedRegime: "constitutional_monarchy", debateMonths: 3 },
    { title: "Sosyalist cumhuriyet ilanı", summary: "Sosyalist anayasal düzen.", deltas: { freedom: -2, unemployment: -2, economy: -1 }, bias: { left: 2, center: -1, right: -2 }, proposedRegime: "socialist_republic", debateMonths: 3 },
    { title: "Tek parti / otoriter düzen", summary: "Rekabetçi siyaset sona erer.", deltas: { freedom: -8, fear: 4, security: 2 }, bias: { left: 0, center: -2, right: 1 }, proposedRegime: "one_party_state", debateMonths: 4 },
    { title: "Askeri yönetim yetkisi", summary: "Cunta yolunu anayasal açar.", deltas: { freedom: -6, security: 3, fear: 3 }, bias: { left: -2, center: -2, right: 1 }, proposedRegime: "military_junta", debateMonths: 4 },
    { title: "Teokratik egemenlik", summary: "Dini egemenlik anayasaya işler.", deltas: { freedom: -5, fear: 2 }, bias: { left: -2, center: -1, right: 2 }, proposedRegime: "theocracy", debateMonths: 4 },
  ]),
  ...buildGroup("technology", [
    { title: "Gözetim devleti", summary: "Kitlesel dijital izleme.", deltas: { security: 3, freedom: -5, fear: 2 }, bias: { left: -1, center: -1, right: 1 } },
    { title: "Sıkı veri kontrolü", summary: "Devlet veri tekeli.", deltas: { freedom: -3, security: 2 }, bias: { left: 0, center: -1, right: 1 } },
    { title: "Kişisel veri koruması", summary: "KVKK tarzı mahremiyet.", deltas: { freedom: 2, economy: -1 }, bias: { left: 1, center: 2, right: 0 } },
    { title: "Açık inovasyon", summary: "Ar-Ge teşviki, net nötrlük.", deltas: { economy: 3, freedom: 2 }, bias: { left: 0, center: 1, right: 1 } },
    { title: "Tekno-ütopya / AI önceliği", summary: "Otomasyon hızlanır; iş kaybı riski.", deltas: { economy: 2, unemployment: 3, freedom: 1 }, bias: { left: 0, center: 0, right: 0 } },
  ]),
  ...buildGroup("culture", [
    { title: "Tek kültür dayatması", summary: "Resmi dil/kültür tekeli.", deltas: { freedom: -4, fear: 2 }, bias: { left: -2, center: -1, right: 2 } },
    { title: "Ulusal kültür politikası", summary: "Devlet destekli milli kültür.", deltas: { freedom: -1, fear: 0 }, bias: { left: -1, center: 1, right: 2 } },
    { title: "Çoğulcu kültür", summary: "Azınlık dilleri ve sanat özgürlüğü.", deltas: { freedom: 3, fear: -1 }, bias: { left: 2, center: 1, right: -1 } },
    { title: "Sansürsüz sanat", summary: "Kültürel ifade neredeyse sınırsız.", deltas: { freedom: 4, security: -1 }, bias: { left: 1, center: 0, right: -1 } },
    { title: "Kültürel devrim programı", summary: "Eski semboller tasfiye edilir.", deltas: { freedom: -2, fear: 3, economy: -1 }, bias: { left: 2, center: -2, right: -2 } },
  ]),
  ...buildGroup("local_gov", [
    { title: "Merkezi mutlakiyet", summary: "Yerel yönetim yetkisiz.", deltas: { freedom: -3, security: 1 }, bias: { left: 0, center: -1, right: 1 } },
    { title: "Atanmış valilik modeli", summary: "Merkez ataması ağırlıklı.", deltas: { freedom: -1 }, bias: { left: -1, center: 0, right: 1 } },
    { title: "Seçilmiş yerel yönetim", summary: "Belediye özerkliği standart.", deltas: { freedom: 2 }, bias: { left: 1, center: 2, right: 0 } },
    { title: "Geniş yerelleşme", summary: "Vergi ve hizmet yerelde.", deltas: { freedom: 3, economy: 1, security: -1 }, bias: { left: 1, center: 1, right: 0 } },
    { title: "Konfederatif özerklik", summary: "Bölgeler neredeyse bağımsız.", deltas: { freedom: 4, security: -2, fear: 1 }, bias: { left: 1, center: 0, right: -1 }, proposedRegime: "confederation", debateMonths: 3 },
  ]),
  ...buildGroup("energy", [
    { title: "Kömür & fosil önceliği", summary: "Ucuz enerji, çevre maliyeti.", deltas: { economy: 2, unemployment: -1, fear: 1 }, bias: { left: -1, center: 0, right: 2 } },
    { title: "Karma enerji sepeti", summary: "Fosil + yenilenebilir denge.", deltas: { economy: 1 }, bias: { left: 0, center: 2, right: 0 } },
    { title: "Yenilenebilir dönüşüm", summary: "Yeşil enerji yatırımı hızlanır.", deltas: { economy: -1, unemployment: -1, fear: -1 }, bias: { left: 2, center: 1, right: -1 } },
    { title: "Nükleer program", summary: "Enerji bağımsızlığı, güvenlik riski.", deltas: { economy: 2, security: 1, fear: 1 }, bias: { left: 0, center: 1, right: 1 } },
    { title: "Enerji kamulaştırması", summary: "Şebekeler ve üretim kamuda.", deltas: { economy: -1, unemployment: -2, freedom: -2 }, bias: { left: 2, center: -1, right: -2 } },
  ]),
  ...buildGroup("infrastructure", [
    { title: "Altyapı ihmal dönemi", summary: "Yatırım ertelenir, tıkanıklık artar.", deltas: { economy: -3, unemployment: 1, fear: 1 }, bias: { left: -1, center: -2, right: -1 } },
    { title: "Seçici mega projeler", summary: "Sembolik büyük işler.", deltas: { economy: 1, unemployment: -1 }, bias: { left: 0, center: 1, right: 1 } },
    { title: "Ulusal altyapı planı", summary: "Yol, ray, liman dengeli yatırım.", deltas: { economy: 3, unemployment: -2 }, bias: { left: 1, center: 2, right: 1 } },
    { title: "Yeşil ulaşım ağı", summary: "Toplu taşıma ve demiryolu öncelikli.", deltas: { economy: 1, unemployment: -1, fear: -1 }, bias: { left: 2, center: 1, right: -1 } },
    { title: "Özel kontratlı otoyollar", summary: "PPP ve ücretli yollar.", deltas: { economy: 2, freedom: 1, fear: 1 }, bias: { left: -1, center: 0, right: 2 } },
  ]),
  ...buildGroup("banking", [
    { title: "Sermaye kontrolleri", summary: "Döviz ve sermaye çıkışı kısıtlı.", deltas: { economy: -2, freedom: -3, inflation: -1 }, bias: { left: 1, center: -1, right: -1 } },
    { title: "Sıkı banka regülasyonu", summary: "Kriz tamponları güçlenir.", deltas: { economy: -1, fear: -2 }, bias: { left: 1, center: 2, right: 0 } },
    { title: "Standart merkez bankası", summary: "Bağımsız para politikası.", deltas: { economy: 2, inflation: -2 }, bias: { left: 0, center: 2, right: 1 } },
    { title: "Finansal deregülasyon", summary: "Kredi genişler, kriz riski artar.", deltas: { economy: 3, fear: 2, inflation: 1 }, bias: { left: -2, center: 0, right: 2 } },
    { title: "Kamu bankası egemenliği", summary: "Kredi tahsisi politikleşir.", deltas: { economy: 0, unemployment: -1, freedom: -2 }, bias: { left: 2, center: -1, right: -2 } },
  ]),
  ...buildGroup("elections", [
    { title: "Güdümlü seçim", summary: "Sonuç fiilen önceden belli.", deltas: { freedom: -6, fear: 3 }, bias: { left: 0, center: -2, right: 1 }, proposedRegime: "one_party_state", debateMonths: 3 },
    { title: "Dar bölge çoğunluk", summary: "İki partili baskı, istikrar.", deltas: { freedom: -1, security: 1 }, bias: { left: -1, center: 1, right: 1 } },
    { title: "Karma seçim sistemi", summary: "Çoğunluk + nispi denge.", deltas: { freedom: 1 }, bias: { left: 1, center: 2, right: 0 } },
    { title: "Tam nispi temsil", summary: "Küçük partiler güçlenir.", deltas: { freedom: 2, fear: 1 }, bias: { left: 2, center: 1, right: -1 } },
    { title: "Zorunlu oy + şeffaf sandık", summary: "Katılım artar, meşruiyet yükselir.", deltas: { freedom: 2, fear: -1 }, bias: { left: 1, center: 2, right: 0 } },
  ]),
  ...buildGroup("intelligence", [
    { title: "Gizli polis egemenliği", summary: "İstihbarat siyaseti belirler.", deltas: { security: 3, freedom: -6, fear: 4 }, bias: { left: -1, center: -2, right: 1 } },
    { title: "Geniş istihbarat yetkisi", summary: "Gözetim yasal ama geniş.", deltas: { security: 2, freedom: -3, fear: 1 }, bias: { left: -1, center: 0, right: 1 } },
    { title: "Parlamenter denetimli MIT", summary: "Yetki + hesap verebilirlik.", deltas: { security: 1, freedom: 1 }, bias: { left: 1, center: 2, right: 0 } },
    { title: "Dar yetkili istihbarat", summary: "Sadece dış tehdit odaklı.", deltas: { security: -1, freedom: 2 }, bias: { left: 1, center: 1, right: -1 } },
    { title: "İstihbaratın sivilleşmesi", summary: "Askeri/gizli yapılar budanır.", deltas: { security: -2, freedom: 3, fear: -1 }, bias: { left: 2, center: 0, right: -2 } },
  ]),
  ...buildGroup("family", [
    { title: "Ataerkil aile kanunu", summary: "Geleneksel roller yasal bağlayıcı.", deltas: { freedom: -3, fear: 1 }, bias: { left: -2, center: -1, right: 2 } },
    { title: "Muhafazakâr aile politikası", summary: "Doğum teşviki, gelenek vurgusu.", deltas: { freedom: -1, unemployment: -1 }, bias: { left: -1, center: 0, right: 2 } },
    { title: "Eşit medeni kanun", summary: "Cinsiyet eşitliği standart.", deltas: { freedom: 2 }, bias: { left: 2, center: 2, right: 0 } },
    { title: "Geniş LGBT+ hakları", summary: "Aile tanımı genişler.", deltas: { freedom: 3, fear: 1 }, bias: { left: 2, center: 0, right: -2 } },
    { title: "Devlet kreş & ebeveyn izni", summary: "İşgücü ve eşitlik birlikte.", deltas: { unemployment: -2, economy: -1, freedom: 1 }, bias: { left: 2, center: 1, right: -1 } },
  ]),
];

/** Özgür slot şablonları — etki sabit, başlık serbest */
export const CUSTOM_TEMPLATES: CustomTemplate[] = [
  { id: "cust_stimulus", titleHint: "Ekonomik teşvik paketi", category: "economy", summary: "Kısa vadeli büyüme, enflasyon riski.", deltas: { economy: 4, inflation: 3, unemployment: -2 }, debateMonths: 1 },
  { id: "cust_austerity", titleHint: "Kemerkısıma", category: "economy", summary: "Kamu harcaması kısılır.", deltas: { economy: -2, inflation: -3, unemployment: 2, fear: 2 }, debateMonths: 1 },
  { id: "cust_amnesty", titleHint: "Genel af", category: "judiciary", summary: "Toplumsal yumuşama veya güvenlik kaygısı.", deltas: { freedom: 2, fear: -1, security: -2 }, debateMonths: 2 },
  { id: "cust_emergency_police", titleHint: "Olağanüstü kolluk yetkisi", category: "security", summary: "Geçici sert güvenlik.", deltas: { security: 4, freedom: -4, fear: 2 }, debateMonths: 1 },
  { id: "cust_press_shield", titleHint: "Basın kalkanı", category: "media", summary: "Gazeteci koruması.", deltas: { freedom: 3, fear: -1 }, debateMonths: 1 },
  { id: "cust_wage_hike", titleHint: "Asgari ücret zammı", category: "welfare", summary: "Alım gücü artar, enflasyon baskısı.", deltas: { unemployment: -1, inflation: 2, fear: -2, economy: -1 }, debateMonths: 1 },
  { id: "cust_border_op", titleHint: "Sınır operasyonu yetkisi", category: "foreign", summary: "Dış güvenlik hamlesi.", deltas: { security: 2, fear: 1, economy: -1, freedom: -1 }, debateMonths: 2 },
  { id: "cust_secular_reform", titleHint: "Laiklik reformu", category: "religious", summary: "Din–devlet mesafesi artar.", deltas: { freedom: 2, fear: 1 }, debateMonths: 2 },
  { id: "cust_faith_fund", titleHint: "İnanç kurumları fonu", category: "religious", summary: "Dini kurumlara kamu desteği.", deltas: { freedom: -1, fear: -1 }, debateMonths: 1 },
  { id: "cust_digital_tax", titleHint: "Dijital hizmet vergisi", category: "economy", summary: "Teknoloji şirketlerinden ek gelir.", deltas: { economy: 1, freedom: -1 }, debateMonths: 1 },
];

export const CUSTOM_COOLDOWN_MONTHS = 6;
export const CUSTOM_MAX_PER_PARTY_PER_TERM = 2;
/** Dönemde en az bu kadar katalog teklifi olmadan özgür slot yok */
export const CUSTOM_REQUIRES_CATALOG_PROPOSALS = 1;
/** Komisyonda bekleyebilecek maksimum yasa */
export const MAX_COMMITTEE_QUEUE = 6;

const byId = new Map(LAW_CATALOG.map((l) => [l.id, l]));
const templatesById = new Map(CUSTOM_TEMPLATES.map((t) => [t.id, t]));

export function getLaw(id: string): LawDef | undefined {
  return byId.get(id);
}

/** Model uydurması / yanlış grup adları → gerçek katalog id */
const GROUP_ALIASES: Record<string, LawGroup> = {
  security: "policing",
  national_security: "policing",
  interior: "policing",
  police: "policing",
  defense: "military",
  defence: "military",
  army: "military",
  econ: "economy",
  economic: "economy",
  finance: "banking",
  banking_finance: "banking",
  social: "welfare",
  social_security: "welfare",
  social_welfare: "welfare",
  labor_rights: "labor",
  labour: "labor",
  infra: "infrastructure",
  infrastructure_dev: "infrastructure",
  citizenship_rights: "citizenship",
  national_unity: "citizenship",
  culture: "culture",
  education_rights: "education",
  health: "healthcare",
  healthcare_system: "healthcare",
  foreign_policy: "foreign",
  border: "migration",
  immigration: "migration",
};

/**
 * lawId çözümle: birebir, alias (defense_t2→military_t2), anahtar kelime.
 * Uymazsa null — öneri listesi ayrı verilir.
 */
export function resolveCatalogLawId(
  raw: string,
  slug?: string
): { law: LawDef | null; note?: string } {
  const id = String(raw || "").trim();
  if (!id) return { law: null };

  const exact = byId.get(id);
  if (exact) return { law: exact };

  const lower = id.toLowerCase().replace(/-/g, "_");

  // group_tN veya group_something_tN
  const tierMatch = lower.match(
    /^(?:([a-z_]+?)_)?(?:t|tier)?(\d+)$/
  );
  const prefixTier = lower.match(/^([a-z_]+?)_t(\d+)(?:_|$)/);
  const simpleTier = lower.match(/^([a-z]+)_t(\d+)$/);

  let groupRaw: string | null = null;
  let tier: number | null = null;
  if (prefixTier) {
    groupRaw = prefixTier[1];
    tier = Number(prefixTier[2]);
  } else if (simpleTier) {
    groupRaw = simpleTier[1];
    tier = Number(simpleTier[2]);
  } else if (tierMatch && tierMatch[1]) {
    groupRaw = tierMatch[1];
    tier = Number(tierMatch[2]);
  }

  if (groupRaw && tier && tier >= 1 && tier <= 5) {
    const parts = groupRaw.split("_");
    // national_security_upgrade → dene security, national_security, ...
    const candidates = [
      groupRaw,
      ...parts.slice().reverse().map((_, i, arr) =>
        arr.slice(0, i + 1).reverse().join("_")
      ),
      parts[parts.length - 1],
    ];
    for (const c of candidates) {
      const g = (GROUP_ALIASES[c] || c) as LawGroup;
      const tryId = `${g}_t${tier}`;
      const hit = byId.get(tryId);
      if (hit) {
        return {
          law: hit,
          note: `lawId “${id}” → ${hit.id} (“${hit.title}”) olarak çözüldü`,
        };
      }
    }
  }

  // Anahtar kelime: security/defense/labor...
  const keywordMap: Array<[RegExp, LawGroup]> = [
    [/security|güvenlik|polis|kolluk/i, "policing"],
    [/defense|defence|savunma|ordu|asker/i, "military"],
    [/labor|labour|işçi|sendika|emek/i, "labor"],
    [/welfare|sosyal|refah|emekli/i, "welfare"],
    [/citizen|vatandaş|ırk|kan.?bağı/i, "citizenship"],
    [/econ|ekonomi|piyasa/i, "economy"],
    [/tax|vergi/i, "taxation"],
    [/bank|maliye|finans/i, "banking"],
    [/educat|eğitim|müfredat/i, "education"],
    [/health|sağlık/i, "healthcare"],
    [/border|göç|sınır|migration/i, "migration"],
    [/infra|altyapı/i, "infrastructure"],
  ];
  for (const [re, g] of keywordMap) {
    if (!re.test(lower)) continue;
    const preferredTier =
      slug === "right" ? [2, 1, 3] : slug === "left" ? [4, 3, 5] : [3, 2, 4];
    for (const t of preferredTier) {
      const hit = byId.get(`${g}_t${t}`);
      if (hit) {
        return {
          law: hit,
          note: `lawId “${id}” anahtar kelime ile ${hit.id} olarak çözüldü`,
        };
      }
    }
  }

  return { law: null };
}

export function getCustomTemplate(id: string): CustomTemplate | undefined {
  return templatesById.get(id);
}

export function lawsInGroup(group: LawGroup): LawDef[] {
  return LAW_CATALOG.filter((l) => l.group === group).sort(
    (a, b) => a.tier - b.tier
  );
}

export function catalogStats(): { total: number; groups: number } {
  return {
    total: LAW_CATALOG.length,
    groups: Object.keys(LAW_GROUP_LABELS).length,
  };
}

/** Ajan için kısa öneri listesi (ideolojiye uyumlu: bias >= 0) */
export function biasKeyForSlug(
  slug: string
): "left" | "center" | "right" {
  return slug === "left" || slug === "right" ? slug : "center";
}

export function lawFitsIdeology(
  law: LawDef,
  slug: string
): { ok: boolean; score: number; reason: string } {
  const key = biasKeyForSlug(slug);
  const score = law.bias[key];
  // Teklif: yalnız uyumlu / nötr (bias >= 0). Gri kapitalist/sol karşıtı (-1) kapalı.
  const minScore = 0;
  if (score < minScore) {
    return {
      ok: false,
      score,
      reason: `“${law.title}” (${law.id}) ideolojinize ters veya gri alan (skor ${score}). Yalnız bias≥0 katalog id seçin.`,
    };
  }
  return { ok: true, score, reason: "OK" };
}

export function suggestLawsForSlug(
  slug: string,
  limit = 8,
  excludeIds: Set<string> = new Set()
): LawDef[] {
  const key = biasKeyForSlug(slug);
  const minScore = 0;
  return [...LAW_CATALOG]
    .filter((l) => !excludeIds.has(l.id) && l.bias[key] >= minScore)
    .sort((a, b) => b.bias[key] - a.bias[key] || a.tier - b.tier)
    .slice(0, limit);
}

export function formatDeltas(
  deltas: Partial<Record<MetricKey, number>>
): { gains: string[]; losses: string[] } {
  const gains: string[] = [];
  const losses: string[] = [];
  const bad = new Set(["fear", "inflation", "unemployment"]);
  for (const [k, v] of Object.entries(deltas)) {
    if (v === undefined || v === 0) continue;
    const label = k;
    if (bad.has(k)) {
      if (v < 0) gains.push(`${label} ${v}`);
      else losses.push(`${label} +${v}`);
    } else if (v > 0) gains.push(`${label} +${v}`);
    else losses.push(`${label} ${v}`);
  }
  return { gains, losses };
}
