/**
 * Argüman zenginleştirme / oy normalizasyonu smoke testleri.
 * npx --yes tsx scripts/smoke-enrich-args.ts
 */
import {
  normalizeVoteValue,
  resolvePartyRef,
  enrichToolArgs,
  missingDecisionFields,
  isGarbageLawId,
} from "../src/lib/ai/enrichToolArgs";
import type { PartyRow } from "../src/lib/types";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

assert(normalizeVoteValue("YES") === "YES", "YES");
assert(normalizeVoteValue("kabul") === "YES", "kabul");
assert(normalizeVoteValue("Ret") === "NO", "Ret");
assert(normalizeVoteValue("hayır") === "NO", "hayır");
assert(normalizeVoteValue("çekimser") === "ABSTAIN", "çekimser");
assert(normalizeVoteValue("abstain") === "ABSTAIN", "abstain");
assert(normalizeVoteValue(true) === "YES", "bool true");
assert(normalizeVoteValue("") === null, "empty");
assert(normalizeVoteValue(".") === null, "dot");

assert(isGarbageLawId(".") === true, "garbage dot");
assert(isGarbageLawId("economy_t2") === false, "valid law");
assert(isGarbageLawId("none") === true, "none");

// Path A: format mode oy uydurmaz
{
  const fakeParty = {
    id: "p1",
    simulation_id: "s1",
    slug: "left",
    name: "Sol",
    color: "#f00",
    seats: 200,
    poll_share: 0.33,
    is_government: 0,
    model_id: null,
    system_prompt: "",
    created_at: "",
  } as unknown as PartyRow;

  const formatted = enrichToolArgs(
    fakeParty,
    "voteOnBill",
    { vote: "" },
    "format"
  );
  assert(
    missingDecisionFields("voteOnBill", formatted).includes("vote"),
    "format keeps vote missing"
  );
}

assert(typeof resolvePartyRef === "function", "resolvePartyRef export");
assert(typeof enrichToolArgs === "function", "enrich export");

console.log("smoke-enrich-args: OK");
