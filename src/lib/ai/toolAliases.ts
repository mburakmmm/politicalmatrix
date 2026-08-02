/** Modelin uydurduğu / eski tool adları → kanonik isim */
const TOOL_ALIASES: Record<string, string> = {
  picklaw: "proposeLaw",
  chooselaw: "proposeLaw",
  selectlaw: "proposeLaw",
  proposelawid: "proposeLaw",
  enactlaw: "proposeLaw",
  submitlaw: "proposeLaw",
  passlaw: "proposeLaw",
  votelaw: "voteOnBill",
  castvote: "voteOnBill",
  vote: "voteOnBill",
  rally: "holdRally",
  holdmiting: "holdRally",
  pr: "issuePRStatement",
  pressstatement: "issuePRStatement",
  resign: "issuePRStatement",
  acceptnegotiation: "respondNegotiation",
  counteroffer: "respondNegotiation",
  startcoalition: "negotiateCoalition",
  opencoalition: "negotiateCoalition",
};

export function canonicalizeToolName(raw: string): string {
  const name = String(raw || "").trim();
  if (!name) return name;
  const key = name.toLowerCase().replace(/[_\s-]+/g, "");
  return TOOL_ALIASES[key] || name;
}
