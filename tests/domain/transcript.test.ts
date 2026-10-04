import { describe, expect, it } from "vitest";
import { parseTranscript, speakerDirection, zonedTimeToUtc } from "@/lib/domain/transcript";

describe("parseTranscript", () => {
  it("splits dated lines into messages and joins continuation lines", () => {
    const text = [
      "2026-09-14 10:22 Customer: Hi, where is my order?",
      "It was meant to arrive Friday.",
      "",
      "2026-09-14 10:25 Me: It shipped yesterday with UPS.",
      "[2026-09-15 08:01] Jordan Ellis: Got it, thanks!",
    ].join("\n");
    const { messages, skipped } = parseTranscript(text, { customerName: "Jordan Ellis" });
    expect(skipped).toEqual([]);
    expect(messages).toHaveLength(3);
    expect(messages[0]).toEqual({
      occurredAt: "2026-09-14T10:22:00.000Z",
      direction: "inbound",
      speaker: "Customer",
      body: "Hi, where is my order?\nIt was meant to arrive Friday.",
    });
    expect(messages[1]).toMatchObject({ direction: "outbound", speaker: "Me", body: "It shipped yesterday with UPS." });
    expect(messages[2]).toMatchObject({ direction: "inbound", occurredAt: "2026-09-15T08:01:00.000Z" });
  });

  it("reads times in the given zone unless the line names one, and handles am/pm", () => {
    const { messages } = parseTranscript(
      ["2026-09-14 3:05 pm Support: Hello", "2026-09-14T10:00Z Customer: Hi", "2026-09-14 09:00 +02:00 Customer: Bonjour"].join("\n"),
      { timeZone: "America/New_York" },
    );
    expect(messages[0].occurredAt).toBe("2026-09-14T19:05:00.000Z");
    expect(messages[0].direction).toBe("outbound");
    expect(messages[1].occurredAt).toBe("2026-09-14T10:00:00.000Z");
    expect(messages[2].occurredAt).toBe("2026-09-14T07:00:00.000Z");
  });

  it("reuses the previous time for speaker-only lines and skips text before the first message", () => {
    const { messages, skipped } = parseTranscript(
      ["Subject: order LG-10482", "2026-09-14 10:22 Customer: Hello", "Me: Hi there"].join("\n"),
    );
    expect(skipped).toEqual(["Subject: order LG-10482"]);
    expect(messages[1]).toMatchObject({ speaker: "Me", occurredAt: "2026-09-14T10:23:00.000Z" });
  });

  it("guesses direction from common speaker labels and names", () => {
    expect(speakerDirection("Larkspur Goods", { merchantName: "Larkspur Goods" })).toBe("outbound");
    expect(speakerDirection("Jordan", { customerName: "Jordan Ellis" })).toBe("inbound");
    expect(speakerDirection("Customer Care")).toBe("outbound");
    expect(speakerDirection("Buyer")).toBe("inbound");
  });

  it("converts wall-clock times across DST", () => {
    expect(zonedTimeToUtc(2026, 7, 1, 12, 0, 0, "Europe/London").toISOString()).toBe("2026-07-01T11:00:00.000Z");
    expect(zonedTimeToUtc(2026, 12, 1, 12, 0, 0, "Europe/London").toISOString()).toBe("2026-12-01T12:00:00.000Z");
    expect(zonedTimeToUtc(2026, 12, 1, 12, 0, 0, "Not/AZone").toISOString()).toBe("2026-12-01T12:00:00.000Z");
  });
});
