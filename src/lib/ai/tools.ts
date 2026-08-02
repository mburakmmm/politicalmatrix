import type { ChatCompletionTool } from "openai/resources/chat/completions";
import type { SimPhase } from "../types";

const ALL_TOOLS: ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "proposeLaw",
        description:
          "ÖNCELİKLİ: Katalogdan ideolojine UYGUN sabit kanun teklif et (lawId). Ters ideoloji reddedilir. Serbest impact YASAK.",
      parameters: {
        type: "object",
        properties: {
          lawId: {
            type: "string",
            description: "Katalog id: {group}_t{tier} — bağlamdaki önerilerden seç",
          },
        },
        required: ["lawId"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "proposeCustomBill",
      description:
        "NADİR özgür slot. Şablon etkisi sabit (templateId); sadece title serbest. Kota/soğuma var — katalog yetmiyorsa rationale ile kullan.",
      parameters: {
        type: "object",
        properties: {
          templateId: {
            type: "string",
            enum: [
              "cust_stimulus",
              "cust_austerity",
              "cust_amnesty",
              "cust_emergency_police",
              "cust_press_shield",
              "cust_wage_hike",
              "cust_border_op",
              "cust_secular_reform",
              "cust_faith_fund",
              "cust_digital_tax",
            ],
          },
          title: { type: "string" },
          rationale: {
            type: "string",
            description: "Neden katalog yasası yetmedi?",
          },
        },
        required: ["templateId", "title", "rationale"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "voteOnBill",
      description:
        "Aktif yasaya oy ve kürsü konuşması. Oy sizin siyasi kararınız (YES|NO|ABSTAIN). Grup içi milletvekili isyanı sandalye kaçışı yaratabilir. speechText yasaya değinsin.",
      parameters: {
        type: "object",
        properties: {
          billId: { type: "string" },
          vote: { type: "string", enum: ["YES", "NO", "ABSTAIN"] },
          speechText: { type: "string" },
        },
        required: ["billId", "vote", "speechText"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "callEarlyElection",
      description: "Erken seçim başlat (rejim seçime izin veriyorsa).",
      parameters: {
        type: "object",
        properties: { rationale: { type: "string" } },
        required: ["rationale"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "proposeAlliance",
      description: "Basit ittifak teklifi (tek tur).",
      parameters: {
        type: "object",
        properties: {
          targetPartyId: { type: "string" },
          concessionsOffer: { type: "string" },
          acceptExistingId: { type: "string" },
        },
        required: ["targetPartyId", "concessionsOffer"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "negotiateCoalition",
      description:
        "Koalisyon müzakeresi aç/devam. accept:true mühürler; accept:false soft veya red. Soft uzatma geç turda anket cezası. Zorla kabul yok. Bakış attitudeAllowsAlliance eşiğinde mühürlenebilir.",
      parameters: {
        type: "object",
        properties: {
          targetPartyId: { type: "string" },
          negotiationId: {
            type: "string",
            description: "Varsa mevcut müzakere id",
          },
          ministriesOffered: {
            type: "array",
            items: { type: "string" },
            description: "interior,finance,justice,defense,education,media,religious,labor",
          },
          constitutionalConcessions: { type: "string" },
          message: { type: "string" },
          accept: {
            type: "boolean",
            description:
              "true = kabul/mühür. false = soft karşı teklif veya (net red metniyle) masa dağıtma. Sizin kararınız.",
          },
        },
        required: ["targetPartyId", "message"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "breakAlliance",
      description: "İttifakı boz / hükümeti sars.",
      parameters: {
        type: "object",
        properties: {
          partyId: { type: "string" },
          reason: { type: "string" },
        },
        required: ["partyId", "reason"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "holdRally",
      description: "Şehirde miting; bölgesel anketi etkiler.",
      parameters: {
        type: "object",
        properties: {
          cityId: {
            type: "string",
            enum: [
              "Ankara",
              "İstanbul",
              "İzmir",
              "Bursa",
              "Antalya",
              "Adana",
              "Konya",
              "Gaziantep",
              "Trabzon",
              "Diyarbakır",
            ],
            description: "Sadece bu şehirlerden biri",
          },
          focusTopic: { type: "string" },
          tone: { type: "string", enum: ["POPULIST", "RADICAL", "MODERATE"] },
        },
        required: ["cityId", "focusTopic", "tone"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "launchSmearCampaign",
      description: "Karalama; medya gücüne bağlı etki.",
      parameters: {
        type: "object",
        properties: {
          targetPartyId: { type: "string" },
          scandalType: {
            type: "string",
            enum: ["corruption", "nepotism", "espionage", "ethics"],
          },
        },
        required: ["targetPartyId", "scandalType"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "issuePRStatement",
      description:
        "PR: deny|reform; resign yalnız iktidar/koalisyon ortağı (gerçek istifa). Yolsuzlukta yalnız iktidar bloğu.",
      parameters: {
        type: "object",
        properties: {
          stance: { type: "string", enum: ["resign", "deny", "reform"] },
          statementText: { type: "string" },
        },
        required: ["stance", "statementText"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "moveConfidence",
      description:
        "Gensoru (censure): yalnız muhalefet. Güvenoyu (confidence): yalnız iktidar lideri. Aktif motion yokken.",
      parameters: {
        type: "object",
        properties: {
          motionType: {
            type: "string",
            enum: ["censure", "confidence"],
          },
          rationale: { type: "string" },
        },
        required: ["motionType", "rationale"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "voteConfidence",
      description: "Aktif gensoru/güvenoyuna oy ver.",
      parameters: {
        type: "object",
        properties: {
          motionId: { type: "string" },
          vote: { type: "string", enum: ["YES", "NO", "ABSTAIN"] },
          speechText: { type: "string" },
        },
        required: ["motionId", "vote", "speechText"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "proposeRegimeChange",
      description:
        "Ülke rejimini köklü değiştir (krallık, teokrasi, komünizm, faşizm, cunta, hilafet...). Güç/çoğunluk veya kriz gerekir.",
      parameters: {
        type: "object",
        properties: {
          regimeType: {
            type: "string",
            enum: [
              "parliamentary_republic",
              "presidential_republic",
              "constitutional_monarchy",
              "absolute_monarchy",
              "theocracy",
              "caliphate",
              "socialist_republic",
              "communist_state",
              "fascist_state",
              "military_junta",
              "one_party_state",
              "anarcho_commune",
              "technocratic_state",
              "confederation",
            ],
          },
          method: {
            type: "string",
            enum: ["parliamentary_vote", "emergency_decree", "revolution", "palace_coup"],
          },
          stateReligion: { type: "string" },
          rulingDoctrine: { type: "string" },
          monarchTitle: { type: "string" },
          manifesto: { type: "string" },
        },
        required: ["regimeType", "method", "manifesto"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "declareEmergency",
      description: "Olağanüstü hâl ilan et; sivil özgürlükleri kıs, rejim değişimine zemin hazırla.",
      parameters: {
        type: "object",
        properties: {
          rationale: { type: "string" },
          durationMonths: { type: "number" },
        },
        required: ["rationale"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "seizePower",
      description:
        "Meclisi baypas ederek güç ele geçir (cunta/devrim/saray darbesi). Yüksek risk; korku/kriz/radikalizm gerekir.",
      parameters: {
        type: "object",
        properties: {
          regimeType: { type: "string" },
          manifesto: { type: "string" },
        },
        required: ["regimeType", "manifesto"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "respondNegotiation",
      description:
        "Açık müzakereye yanıt. accept:true|false sizin kararınız. Soft uzatma cezalı; counterMessage'da net ret → masa dağılır. Zorla kabul yok.",
      parameters: {
        type: "object",
        properties: {
          negotiationId: { type: "string" },
          accept: { type: "boolean" },
          counterMessage: { type: "string" },
          ministriesRequested: { type: "array", items: { type: "string" } },
        },
        required: ["negotiationId", "accept", "counterMessage"],
      },
    },
  },
];

export const PARTY_TOOLS = ALL_TOOLS;

const PHASE_ALLOW: Record<string, string[]> = {
  voting: ["voteOnBill", "issuePRStatement"],
  confidence: ["voteConfidence", "issuePRStatement"],
  crisis: [
    "issuePRStatement",
    "proposeRegimeChange",
    "seizePower",
    "declareEmergency",
    "moveConfidence",
    "callEarlyElection",
    "holdRally",
    "proposeLaw",
    "proposeCustomBill",
  ],
  coalition_talks: [
    "negotiateCoalition",
    "respondNegotiation",
    "proposeAlliance",
    "breakAlliance",
    "holdRally",
    "issuePRStatement",
  ],
  negotiation: [
    "negotiateCoalition",
    "respondNegotiation",
    "proposeAlliance",
    "breakAlliance",
  ],
  regime_transition: [
    "declareEmergency",
    "proposeRegimeChange",
    "seizePower",
    "issuePRStatement",
    "holdRally",
  ],
  election: ["holdRally", "launchSmearCampaign", "issuePRStatement"],
  governing: ALL_TOOLS.map((t) =>
    t.type === "function" ? t.function.name : ""
  ).filter(Boolean),
};

export function toolsForPhase(phase: SimPhase | string): ChatCompletionTool[] {
  const allow = PHASE_ALLOW[phase] ?? PHASE_ALLOW.governing;
  const set = new Set(allow);
  return ALL_TOOLS.filter(
    (t) => t.type === "function" && set.has(t.function.name)
  );
}

export function phaseHint(phase: SimPhase | string): string {
  switch (phase) {
    case "voting":
      return "OYLAMA FAZI — öncelik voteOnBill";
    case "confidence":
      return "GENSORU/GÜVENOYU — voteConfidence";
    case "crisis":
      return "KRİZ — PR, olağanüstü hâl veya rejim kırılması fırsatı";
    case "coalition_talks":
    case "negotiation":
      return "KOALİSYON — Formateur: negotiateCoalition ile masa aç. Size gelen masa: respondNegotiation (accept:true|false sizin). Müzakere yokken respond YASAK. Soft uzatma cezalı; zorla kabul yok.";
    case "regime_transition":
      return "REJİM GEÇİŞİ — yeni düzeni pekiştir";
    case "election":
      return "SEÇİM — miting ve algı";
    default:
      return "YÖNETİM — menü serbest (proposeLaw / gensoru / miting / PR…). Boş ay (pass) serbest. Anket/stres ülke fiziği olarak hükümeti düşürebilir.";
  }
}
