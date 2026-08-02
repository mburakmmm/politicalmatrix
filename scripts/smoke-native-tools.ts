/**
 * Native tool format parser smoke testleri.
 * Çalıştır: npx tsx scripts/smoke-native-tools.ts
 */
import { detectNativeToolProfile, parseNativeToolCalls } from "../src/lib/ai/nativeToolFormats";
import { parsePhiFunctools } from "../src/lib/ai/phiTools";
import { parseQwenToolCalls, detectQwenDialect } from "../src/lib/ai/qwenTools";
import {
  parseGemmaToolCalls,
  parseFunctionGemmaArgs,
  detectGemmaDialect,
} from "../src/lib/ai/gemmaTools";
import { buildLlamaSystemPrompt } from "../src/lib/ai/llamaTools";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

// Detection
assert(detectNativeToolProfile("phi-4-mini-instruct")?.family === "phi", "phi detect");
assert(detectNativeToolProfile("Qwen2.5-7B-Instruct")?.family === "qwen", "qwen hermes");
assert(detectNativeToolProfile("Qwen3-Coder-30B")?.family === "qwen_xml", "qwen xml");
assert(detectNativeToolProfile("qwen3.5-9b")?.family === "qwen_xml", "qwen3.5 xml");
assert(detectNativeToolProfile("gemma-3-27b-it")?.family === "gemma", "gemma");
assert(
  detectNativeToolProfile("functiongemma-270m-it")?.family === "functiongemma",
  "fg"
);
assert(detectQwenDialect("Qwen2.5-Coder-7B") === "xml", "coder xml");
assert(detectGemmaDialect("google/gemma-3-4b") === "tool_code", "gemma tool_code");

// Phi
{
  const r = parsePhiFunctools(
    `functools[{"name":"holdRally","arguments":{"cityId":"ankara","tone":"POPULIST"}}]`
  );
  assert(r.length === 1 && r[0].name === "holdRally", "phi functools");
  assert(r[0].args.cityId === "ankara", "phi args");
}

// Qwen Hermes
{
  const r = parseQwenToolCalls(
    `<tool_call>\n{"name":"voteOnBill","arguments":{"vote":"YES","speechText":"Destekliyoruz"}}\n</tool_call>`,
    "hermes"
  );
  assert(r[0]?.name === "voteOnBill" && r[0].args.vote === "YES", "qwen hermes");
}

// Qwen XML
{
  const r = parseQwenToolCalls(
    `<tool_call>
<function=holdRally>
  <parameter=cityId>
    istanbul
  </parameter>
  <parameter=tone>
    RADICAL
  </parameter>
</function>
</tool_call>`,
    "xml"
  );
  assert(r[0]?.name === "holdRally", "qwen xml name");
  assert(r[0]?.args.cityId === "istanbul", "qwen xml city");
  assert(r[0]?.args.tone === "RADICAL", "qwen xml tone");
}

// Gemma tool_code
{
  const r = parseGemmaToolCalls(
    "```tool_code\nholdRally(cityId=\"ankara\", tone=\"POPULIST\", focusTopic=\"emek\")\n```",
    "tool_code"
  );
  assert(r[0]?.name === "holdRally", "gemma tool_code");
  assert(r[0]?.args.tone === "POPULIST", "gemma tone");
}

// FunctionGemma
{
  const args = parseFunctionGemmaArgs(
    "{location:<escape>Tokyo, Japan<escape>,unit:celsius}"
  );
  assert(args.location === "Tokyo, Japan", "fg escape");
  assert(args.unit === "celsius", "fg unit");

  const r = parseGemmaToolCalls(
    `<start_function_call>call:issuePRStatement{stance:<escape>deny<escape>,statementText:<escape>Yalan haber.<escape>}<end_function_call>`,
    "functiongemma"
  );
  assert(r[0]?.name === "issuePRStatement", "fg call");
  assert(r[0]?.args.stance === "deny", "fg stance");
}

// Thinking strip + native dispatcher
{
  const r = parseNativeToolCalls(
    "qwen",
    `<think>uzun düşünce</think>\n<tool_call>\n{"name":"breakAlliance","arguments":{"partyId":"x"}}\n</tool_call>`
  );
  assert(r[0]?.name === "breakAlliance", "strip think + parse");
}

// Llama 3.2 / 3.3 / python_tag / salvage
{
  assert(
    detectNativeToolProfile("llama-3.2-3b-instruct")?.family === "llama",
    "llama 3.2 hermes family"
  );
  assert(
    detectNativeToolProfile("Meta-Llama-3.3-70B-Instruct")?.family ===
      "llama_json",
    "llama 3.3 json"
  );
  assert(
    detectNativeToolProfile("meta-llama-3.1-8b-instruct")?.family ===
      "llama_json",
    "llama 3.1-8b json"
  );
  assert(
    detectNativeToolProfile("Hermes-3-Llama-3.1-8B")?.family === "llama",
    "hermes-llama family"
  );

  const hermes = parseNativeToolCalls(
    "llama",
    `<tool_call>\n{"name":"proposeLaw","arguments":{"lawId":"citizenship_t1"}}\n</tool_call>`
  );
  assert(hermes[0]?.name === "proposeLaw", "llama hermes");
  assert(hermes[0]?.args.lawId === "citizenship_t1", "llama lawId");

  const json = parseNativeToolCalls(
    "llama_json",
    `{"name":"voteOnBill","parameters":{"billId":"b1","vote":"NO"}}`
  );
  assert(json[0]?.name === "voteOnBill", "llama json");
  assert(json[0]?.args.vote === "NO", "llama vote");

  const pyTag = parseNativeToolCalls(
    "llama_json",
    `<|python_tag|>{"name":"holdRally","parameters":{"cityId":"ankara","tone":"MODERATE","focusTopic":"emek"}}`
  );
  assert(pyTag[0]?.name === "holdRally", "llama python_tag");
  assert(pyTag[0]?.args.cityId === "ankara", "llama python_tag city");

  const nested = parseNativeToolCalls(
    "llama_json",
    `<|python_tag|>{"name":"negotiateCoalition","parameters":{"targetPartyId":"merkez","message":"teklif","ministriesOffered":["finance","justice"]}}`
  );
  assert(
    nested[0]?.name === "negotiateCoalition" &&
      Array.isArray(nested[0]?.args.ministriesOffered),
    "llama python_tag nested array"
  );

  const truncated = parseNativeToolCalls(
    "llama_json",
    `{"name":"proposeLaw","parameters":{"lawId":"economy_t2"`
  );
  assert(truncated[0]?.name === "proposeLaw", "llama truncated salvage name");
  assert(truncated[0]?.args.lawId === "economy_t2", "llama truncated salvage lawId");

  const fenced = parseNativeToolCalls(
    "llama_json",
    "```json\n{\"name\":\"breakAlliance\",\"parameters\":{\"partyId\":\"p1\",\"reason\":\"stres\"}}\n```"
  );
  assert(fenced[0]?.name === "breakAlliance", "llama markdown fence");

  const sys = buildLlamaSystemPrompt({
    partyName: "Sağ Parti",
    tools: [
      {
        type: "function",
        function: {
          name: "proposeLaw",
          description: "katalog",
          parameters: {
            type: "object",
            properties: { lawId: { type: "string" } },
            required: ["lawId"],
          },
        },
      },
    ],
    dialect: "hermes",
    compact: true,
  });
  assert(!/You are Qwen/i.test(sys), "llama hermes not qwen identity");
  assert(/You are Llama/i.test(sys), "llama hermes identity");
  assert(/economy_t2|catalog id|lawId MUST/i.test(sys), "llama lawId rule");
}

console.log("smoke-native-tools: OK");
