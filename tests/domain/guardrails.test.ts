import { describe, expect, it } from "vitest";
import { assemblePacket } from "@/lib/domain/assemble";
import { findDates, findMoney, findNameCandidates, findTrackingLike } from "@/lib/domain/extract";
import {
  MAX_REMOVED_RATIO,
  NARRATIVE_MAX_CHARS,
  NARRATIVE_SECTIONS,
  splitSentences,
  verifyNarrative,
} from "@/lib/domain/guardrails";
import { emptyFacts, type Facts } from "@/lib/domain/types";
import { makeInput } from "../fixtures/disputes";

const FACTS: Facts = assemblePacket(makeInput("fraudulent")).facts;

function kept(narrative: string, facts: Facts = FACTS): boolean {
  const r = verifyNarrative(narrative, facts);
  return r.removed.length === 0 && r.narrative === narrative.trim();
}

function removedKind(narrative: string, facts: Facts = FACTS) {
  return verifyNarrative(narrative, facts).removed.map((r) => r.kind);
}

const GOOD = [
  "What was purchased",
  "Jordan Ellis bought one Linen Throw Blanket from Larkspur Goods for $129.00 on September 10, 2026.",
  "",
  "Delivery / access",
  "UPS shipped the order on 2026-09-12 with tracking number 1Z999AA10123456784 to the billing address. It was delivered on Sep 15, 2026.",
  "",
  "Communication",
  "On 16 September 2026 the customer wrote from jordan.ellis@example.com that the blanket had arrived.",
  "",
  "Why this dispute is invalid",
  "The order was placed from IP 203.0.113.42 and delivered to the cardholder's own address.",
].join("\n");

describe("verifyNarrative: clean narrative", () => {
  const r = verifyNarrative(GOOD, FACTS);

  it("keeps a fully verified narrative unchanged", () => {
    expect(r.removed).toEqual([]);
    expect(r.narrative).toBe(GOOD);
    expect(r.ok).toBe(true);
  });

  it("lists every verified claim once, by kind", () => {
    const byKind = (k: string) => r.verified.filter((v) => v.kind === k).map((v) => v.text);
    expect(byKind("amount")).toEqual(["$129.00"]);
    expect(byKind("date")).toEqual(["September 10, 2026", "2026-09-12", "Sep 15, 2026", "16 September 2026"]);
    expect(byKind("tracking")).toEqual(["1Z999AA10123456784"]);
    expect(byKind("email")).toEqual(["jordan.ellis@example.com"]);
    expect(byKind("ip")).toEqual(["203.0.113.42"]);
    expect(byKind("name")).toEqual(expect.arrayContaining(["Jordan Ellis", "Linen Throw Blanket", "Larkspur Goods"]));
  });
});

describe("verifyNarrative: unmatched claims", () => {
  it("removes only the sentence with an invented tracking number", () => {
    const text = "The order shipped with UPS. Tracking 1Z999AA10999999999 shows delivery. The customer was notified.";
    const r = verifyNarrative(text, FACTS);
    expect(r.narrative).toBe("The order shipped with UPS. The customer was notified.");
    expect(r.removed).toEqual([
      { text: "Tracking 1Z999AA10999999999 shows delivery.", kind: "tracking", claim: "1Z999AA10999999999" },
    ]);
  });

  it.each([
    ["$129.00", true],
    ["$129", true],
    ["129.00 USD", true],
    ["USD 129.00", true],
    ["129.00", true],
    ["€129", true],
    ["$139.00", false],
    ["$1,290.00", false],
    ["1290.00 dollars", false],
  ])("amount %s verified=%s", (amount, ok) => {
    const r = verifyNarrative(`The customer paid ${amount} for the order.`, FACTS);
    expect(r.removed.length === 0).toBe(ok);
    if (!ok) expect(r.removed[0]).toMatchObject({ kind: "amount", claim: amount });
  });

  it.each([
    ["2026-09-12", true],
    ["2026-09-12T15:00:00Z", true],
    ["Sep 12, 2026", true],
    ["Sept. 12, 2026", true],
    ["September 12th, 2026", true],
    ["12 September 2026", true],
    ["12th of September 2026", true],
    ["09/12/2026", true],
    ["12/09/2026", true], // day-first reading matches
    ["September 12", true], // no year: month and day must match a fact
    ["September 13, 2026", false],
    ["2026-09-13", false],
    ["13/09/2026", false],
    ["October 1", false],
  ])("date %s verified=%s", (date, ok) => {
    const r = verifyNarrative(`The parcel left the warehouse on ${date} as planned.`, FACTS);
    expect(r.removed.length === 0).toBe(ok);
    if (!ok) expect(r.removed[0].kind).toBe("date");
  });

  it("matches emails case-insensitively and rejects unknown ones", () => {
    expect(kept("A reply came from Jordan.Ellis@Example.com that day.")).toBe(true);
    expect(removedKind("A reply came from j.ellis@example.net that day.")).toEqual(["email"]);
  });

  it("checks IP addresses and does not read them as money", () => {
    expect(kept("The purchase came from 203.0.113.42.")).toBe(true);
    const r = verifyNarrative("The purchase came from 198.51.100.99.", FACTS);
    expect(r.removed[0]).toMatchObject({ kind: "ip", claim: "198.51.100.99" });
  });

  it("checks Stripe ids", () => {
    expect(kept("The disputed charge is ch_3LarkFraud0001.")).toBe(true);
    expect(removedKind("A prior charge ch_9Invented123 was refunded.")).toEqual(["id"]);
  });

  it("checks capitalised multi-word names", () => {
    expect(kept("Jordan Ellis received the parcel.")).toBe(true);
    expect(kept("Jordan Ellis's parcel arrived intact.")).toBe(true);
    expect(kept("The Linen Throw Blanket is described on our site.")).toBe(true);
    expect(kept("Larkspur Goods packed the order.")).toBe(true);
    expect(kept("Customer Service replied the same day.")).toBe(true); // generic, not a name
    expect(removedKind("Taylor Brooks signed for the parcel.")).toEqual(["name"]);
    expect(removedKind("The customer also bought a Velvet Cushion Cover.")).toEqual(["name"]);
  });

  it("does not treat months, weekdays or sentence openers as names", () => {
    expect(findNameCandidates("On Monday October the parcel arrived.")).toEqual([]);
    expect(findNameCandidates("On October 4 Jordan Ellis wrote.").map((n) => n.text)).toEqual(["Jordan Ellis"]);
  });
});

describe("verifyNarrative: tone", () => {
  it.each([
    ["The cardholder is clearly lying about the delivery.", "speculation"],
    ["This looks like the work of a fraudster.", "speculation"],
    ["The customer intentionally disputed a valid charge.", "speculation"],
    ["This dispute is a scam.", "speculation"],
    ["We will take legal action if this continues.", "legal_threat"],
    ["Our lawyer has been informed.", "legal_threat"],
    ["We may sue to recover the funds.", "legal_threat"],
    ["The customer could be prosecuted.", "legal_threat"],
  ])("removes %j as %s", (sentence, kind) => {
    const r = verifyNarrative(`The order shipped with UPS. ${sentence}`, FACTS);
    expect(r.narrative).toBe("The order shipped with UPS.");
    expect(r.removed[0]).toMatchObject({ text: sentence, kind });
  });

  it("does not flag words that merely contain the patterns", () => {
    expect(kept("We pursued the issue with the carrier.")).toBe(true);
    expect(kept("The underlying order was courteous and complete.")).toBe(true);
  });
});

describe("verifyNarrative: structure", () => {
  it("drops a heading whose whole section was removed", () => {
    const text = ["What was purchased", "A blanket.", "", "Communication", "Taylor Brooks phoned us."].join("\n");
    const r = verifyNarrative(text, FACTS);
    expect(r.narrative).toBe("What was purchased\nA blanket.");
  });

  it("keeps bullet markers", () => {
    const r = verifyNarrative("- Shipped with UPS.\n- Signed by Taylor Brooks.\n- Delivered on 2026-09-15.", FACTS);
    expect(r.narrative).toBe("- Shipped with UPS.\n- Delivered on 2026-09-15.");
  });

  it("does not split on abbreviations or initials", () => {
    expect(splitSentences("Ms. Ellis received it on Sep. 15, 2026. It was intact.")).toEqual([
      "Ms. Ellis received it on Sep. 15, 2026.",
      "It was intact.",
    ]);
    expect(splitSentences("Jordan A. Ellis paid, e.g. by card. Done.")).toEqual(["Jordan A. Ellis paid, e.g. by card.", "Done."]);
    expect(kept("Ms. Ellis received it on Sep. 15, 2026. It was intact.")).toBe(true);
  });

  it("exposes the five sections the prompt asks for", () => {
    expect(NARRATIVE_SECTIONS).toHaveLength(5);
  });
});

describe("verifyNarrative: length and ok", () => {
  it(`truncates to ${NARRATIVE_MAX_CHARS} chars at a sentence boundary`, () => {
    const sentence = "UPS delivered the Linen Throw Blanket to Jordan Ellis on 2026-09-15.";
    const text = Array.from({ length: 60 }, () => sentence).join(" ");
    const r = verifyNarrative(text, FACTS);
    expect(r.narrative.length).toBeLessThanOrEqual(NARRATIVE_MAX_CHARS);
    expect(r.narrative.endsWith(sentence)).toBe(true);
    expect(r.removed.length).toBeGreaterThan(0);
    expect(r.removed.every((x) => x.kind === "length")).toBe(true);
    expect(r.ok).toBe(true);
  });

  it(`is ok up to ${MAX_REMOVED_RATIO * 100}% removed and not beyond`, () => {
    const good = "The order shipped with UPS.";
    const bad = "Taylor Brooks signed for it.";
    const three = [...Array(7).fill(good), ...Array(3).fill(bad)].join(" ");
    const four = [...Array(6).fill(good), ...Array(4).fill(bad)].join(" ");
    expect(verifyNarrative(three, FACTS).ok).toBe(true);
    expect(verifyNarrative(four, FACTS).ok).toBe(false);
  });

  it("is not ok when empty or when everything is removed", () => {
    expect(verifyNarrative("", FACTS)).toEqual({ narrative: "", removed: [], verified: [], ok: false });
    expect(verifyNarrative("Taylor Brooks signed.", FACTS).ok).toBe(false);
  });

  it("removes every specific claim when there are no facts", () => {
    const r = verifyNarrative(GOOD, emptyFacts());
    expect(r.ok).toBe(false);
    expect(r.verified).toEqual([]);
  });
});

describe("extractors", () => {
  it("finds tracking-like tokens but not words, dates or ids", () => {
    expect(findTrackingLike("UPS 1Z999AA10123456784 and USPS 9400111899223197428490").map((s) => s.text)).toEqual([
      "1Z999AA10123456784",
      "9400111899223197428490",
    ]);
    expect(findTrackingLike("Delivered yesterday, order LG-10482, charge ch_3LarkFraud0001")).toEqual([]);
  });

  it("parses money in several notations", () => {
    expect(findMoney("$1,234.56, 1234.56 USD, €12 and £9.5").map((m) => m.major)).toEqual([1234.56, 1234.56, 12, 9.5]);
  });

  it("does not read 'may' the verb as a date", () => {
    expect(findDates("The customer may 2 times have asked.")).toEqual([]);
    expect(findDates("May 2, 2026")[0].candidates).toEqual(["2026-05-02"]);
  });
});
