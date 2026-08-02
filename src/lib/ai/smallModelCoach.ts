import type { ChatCompletionTool } from "openai/resources/chat/completions";
import type { NativeToolFamily, NativeToolProfile } from "./nativeToolFormats";
import { nativeRecoveryUserHint } from "./nativeToolFormats";
import type { PartyRow } from "../types";

export type DecisionHints = {
  forceTool?: string;
  /** Oylamada geçerli seçenekler — model karar verir */
  voteChoices?: Array<"YES" | "NO" | "ABSTAIN">;
  billId?: string;
  billTitle?: string;
  /** Katalogdan 3–5 aday — model seçer, sistem seçmez */
  lawChoices?: Array<{ id: string; title: string }>;
  /** Diğer partiler slug|name|id */
  partyChoices?: Array<{ id: string; slug: string; name: string }>;
  negotiationId?: string;
  cityChoices?: string[];
  /** breakAlliance zorunluluğunda hedef ortak */
  breakPartnerId?: string;
  coalitionStress?: number;
  /** respondNegotiation karar turu */
  decisionRound?: boolean;
  preferAccept?: boolean;
};

/**
 * Path A: modele karar bırakan, formatı öğreten few-shot.
 * Argümanlar örnek şeklindedir; "kendi kararını yaz" denir.
 */
export function buildNativeFewShot(
  family: NativeToolFamily,
  forceTool: string | undefined,
  hints: DecisionHints
): string {
  if (!forceTool) {
    return [
      "",
      "# Format example (replace with YOUR decision)",
      fewShotFor(family, "holdRally", {
        cityId: "ankara",
        tone: "MODERATE",
        focusTopic: "istikrar",
      }),
      "Now output ONE call for this turn. Do not copy example values blindly.",
    ].join("\n");
  }

  const example = exampleArgsForForce(forceTool, hints);
  return [
    "",
    `# Format example for ${forceTool}`,
    fewShotFor(family, forceTool, example),
    "Replace example argument values with YOUR political decision.",
    "Output ONLY the tool call in the same format — no essay.",
  ].join("\n");
}

function fewShotFor(
  family: NativeToolFamily,
  tool: string,
  args: Record<string, unknown>
): string {
  const json = JSON.stringify(args);
  if (family === "phi") {
    return `functools[{"name":"${tool}","arguments":${json}}]`;
  }
  if (family === "qwen" || family === "qwen_xml") {
    if (family === "qwen_xml") {
      const params = Object.entries(args)
        .map(
          ([k, v]) =>
            `  <parameter=${k}>\n    ${typeof v === "string" ? v : JSON.stringify(v)}\n  </parameter>`
        )
        .join("\n");
      return `<tool_call>\n<function=${tool}>\n${params}\n</function>\n</tool_call>`;
    }
    return `<tool_call>\n{"name":"${tool}","arguments":${json}}\n</tool_call>`;
  }
  if (family === "gemma") {
    const py = Object.entries(args)
      .map(([k, v]) =>
        typeof v === "string" ? `${k}=${JSON.stringify(v)}` : `${k}=${JSON.stringify(v)}`
      )
      .join(", ");
    return "```tool_code\n" + `${tool}(${py})\n` + "```";
  }
  if (family === "functiongemma") {
    const inner = Object.entries(args)
      .map(([k, v]) =>
        typeof v === "string"
          ? `${k}:<escape>${v}<escape>`
          : `${k}:${JSON.stringify(v)}`
      )
      .join(",");
    return `<start_function_call>call:${tool}{${inner}}<end_function_call>`;
  }
  if (family === "llama" || family === "llama_json") {
    if (family === "llama") {
      return `<tool_call>\n{"name":"${tool}","arguments":${json}}\n</tool_call>`;
    }
    return `{"name":"${tool}","parameters":${json}}`;
  }
  if (family === "glm") {
    const lines = Object.entries(args)
      .map(
        ([k, v]) =>
          `<arg_key>${k}</arg_key>\n<arg_value>${
            typeof v === "string" ? v : JSON.stringify(v)
          }</arg_value>`
      )
      .join("\n");
    return `<tool_call>${tool}\n${lines}\n</tool_call>`;
  }
  if (family === "harmony") {
    return `<|start|>assistant<|channel|>commentary to=functions.${tool} <|constrain|>json<|message|>${json}<|call|>`;
  }
  if (family === "instruct") {
    return `<tool_call>\n{"name":"${tool}","arguments":${json}}\n</tool_call>`;
  }
  // mistral / ministral
  return `[TOOL_CALLS][{"name":"${tool}","arguments":${json}}]`;
}

function exampleArgsForForce(
  forceTool: string,
  hints: DecisionHints
): Record<string, unknown> {
  switch (forceTool) {
    case "voteOnBill":
      return {
        billId: hints.billId || "bill_…",
        vote: hints.voteChoices?.[0] || "YES",
        speechText: "Kürsüden gerekçeli oyumuzu açıklıyoruz.",
      };
    case "proposeLaw":
      return {
        lawId: hints.lawChoices?.[0]?.id || "economy_t2",
      };
    case "negotiateCoalition":
      return {
        targetPartyId: hints.partyChoices?.[0]?.slug || "merkez",
        message: "Koalisyon için ortak program öneriyoruz.",
        ministriesOffered: ["finance", "justice"],
      };
    case "respondNegotiation":
      return {
        negotiationId: hints.negotiationId || "neg_…",
        accept: hints.preferAccept === false ? false : true,
        counterMessage:
          hints.preferAccept === false
            ? "Bakış yetersiz; masayı kapatıyoruz."
            : "Teklifi kabul ediyoruz — ortak hükümet.",
      };
    case "holdRally":
      return {
        cityId: hints.cityChoices?.[0] || "ankara",
        tone: "MODERATE",
        focusTopic: "kampanya",
      };
    case "issuePRStatement":
      return {
        stance: "reform",
        statementText: "Kamuoyuna duruşumuzu açıklıyoruz.",
      };
    case "breakAlliance":
      return {
        partyId:
          hints.breakPartnerId ||
          hints.partyChoices?.[0]?.id ||
          hints.partyChoices?.[0]?.slug ||
          "party_…",
        reason: `Koalisyon gerilimi sürdürülemez${
          hints.coalitionStress != null
            ? ` (stres ${hints.coalitionStress.toFixed(0)}/100)`
            : ""
        }.`,
      };
    case "moveConfidence":
      return {
        motionType: "censure",
        rationale: "Hükümetin performansı ve anketleri meclis denetimini gerektiriyor.",
      };
    default:
      return {};
  }
}

/** Path A: karar menüsü — sistem seçmez, seçenekleri listeler */
export function buildDecisionChoiceCard(hints: DecisionHints): string {
  const lines: string[] = ["", "# YOUR CHOICES (pick, do not invent ids)"];
  if (hints.forceTool) {
    lines.push(`Required tool this turn: ${hints.forceTool}`);
  }
  if (hints.billId) {
    lines.push(
      `billId (use exactly): ${hints.billId}${
        hints.billTitle ? ` (“${hints.billTitle}”)` : ""
      }`
    );
  }
  if (hints.voteChoices?.length) {
    lines.push(`vote ∈ {${hints.voteChoices.join(" | ")}} — YOUR decision`);
  }
  if (hints.lawChoices?.length) {
    lines.push("lawId candidates (pick one):");
    for (const l of hints.lawChoices) {
      lines.push(`  - ${l.id} — ${l.title}`);
    }
  }
  if (hints.partyChoices?.length) {
    lines.push("targetPartyId (use slug or id):");
    for (const p of hints.partyChoices) {
      lines.push(`  - ${p.slug} | ${p.name} | ${p.id}`);
    }
  }
  if (hints.forceTool === "breakAlliance" && hints.breakPartnerId) {
    lines.push(
      `partyId for breakAlliance (use exactly): ${hints.breakPartnerId}${
        hints.coalitionStress != null
          ? ` — stress ${hints.coalitionStress.toFixed(0)}/100`
          : ""
      }`
    );
  }
  if (hints.negotiationId) {
    lines.push(`negotiationId (use exactly): ${hints.negotiationId}`);
    if (hints.decisionRound) {
      lines.push(
        hints.preferAccept === false
          ? "Late round: soft continue costs polls; accept:false or hard-reject OK. NO forced accept."
          : "Late round: accept:true seals; accept:false soft-continues (poll cost) or hard-reject. YOUR choice."
      );
    } else {
      lines.push(
        "Round 1: accept=true preferred to seal; accept=false soft-counter allowed once."
      );
    }
  }
  if (hints.cityChoices?.length) {
    lines.push(`cityId ∈ {${hints.cityChoices.join(", ")}}`);
  }
  return lines.join("\n");
}

export function buildPathAUserTail(opts: {
  family: NativeToolFamily;
  profile?: NativeToolProfile | null;
  forceTool?: string;
  hints: DecisionHints;
}): string {
  const card = buildDecisionChoiceCard(opts.hints);
  const shot = buildNativeFewShot(opts.family, opts.forceTool, opts.hints);
  return `${card}\n${shot}`;
}

/** Recovery: format hatırlat — karar alanlarını boş bırakma, ama örnek = adaylardan biri */
export function buildPathARecoveryHint(
  family: NativeToolFamily,
  forceTool: string,
  hints: DecisionHints,
  profile?: NativeToolProfile | null
): string {
  const args = exampleArgsForForce(forceTool, hints);
  // Oylamada örnek vote'u "YOUR_CHOICE" gibi göstermeyelim; geçerli enum gösterelim
  if (forceTool === "voteOnBill" && hints.voteChoices?.length) {
    args.vote = hints.voteChoices[0];
  }
  return [
    nativeRecoveryUserHint(family, forceTool, args, profile),
    hints.lawChoices?.length
      ? `Pick lawId from: ${hints.lawChoices.map((l) => l.id).join(", ")}`
      : "",
    hints.partyChoices?.length
      ? `Pick target from: ${hints.partyChoices.map((p) => p.slug).join(", ")}`
      : "",
    "Use YOUR political judgment for vote/accept/lawId — only keep the format exact.",
  ]
    .filter(Boolean)
    .join("\n");
}

export function thinkingDisciplinePrefix(modelId: string): string {
  if (
    /qwen3|qwq|thinking|reasoning|r1|deepseek-r1|llama.*think|think.*llama|nemotron.*reasoning|glm.*thinking|gpt-?oss|harmony/i.test(
      modelId
    )
  ) {
    // Qwen3 /no_think; diğerlerinde kısa disiplin satırı
    if (/qwen3|qwq/i.test(modelId)) return "/no_think\n";
    return "Do not write long chain-of-thought. Emit the tool call immediately.\n";
  }
  return "";
}

export function pathAMaxTokens(fragile: boolean, native: boolean): number {
  // Native: tools şeması prompt'ta — completion için yer bırak
  // OpenAI tools API küçük Llama'da context şişirip 30–40 tokene kesiyordu
  if (fragile && native) return 1024;
  if (native) return 1280;
  if (fragile) return 1024;
  return 1800;
}

export function summarizeToolsForTinyPrompt(
  tools: ChatCompletionTool[]
): string {
  return tools
    .filter((t) => t.type === "function")
    .map((t) => {
      const req = (
        (t.function.parameters as { required?: string[] })?.required || []
      ).join(",");
      return `- ${t.function.name}(${req})`;
    })
    .join("\n");
}

export function partyToHintRow(p: PartyRow): {
  id: string;
  slug: string;
  name: string;
} {
  return { id: p.id, slug: p.slug, name: p.name };
}
