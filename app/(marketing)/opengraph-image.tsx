import { ImageResponse } from "next/og";

export const alt =
  "Disputely: every chargeback, answered before the deadline. A dispute countdown reads 06d 14h in oxide red.";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

// Brand colours from docs/spec.md section 5, as hex: next/og cannot read CSS variables.
const slate = "#1B2430";
const linen = "#F8F6F1";
const oxide = "#B4452E";
const grey = "#4B5563";

/** Each character sits in a fixed-width cell, so the default sans reads like the app's mono countdown. */
function Countdown({ value }: { value: string }) {
  return (
    <div style={{ display: "flex", alignItems: "baseline" }}>
      {value.split("").map((ch, i) => {
        const unit = ch === "d" || ch === "h";
        return (
          <div
            key={i}
            style={{
              width: ch === " " ? 34 : unit ? 52 : 92,
              display: "flex",
              justifyContent: "center",
              fontSize: unit ? 84 : 150,
              fontWeight: 700,
              lineHeight: 1,
              letterSpacing: "-0.02em",
              color: oxide,
            }}
          >
            {ch === " " ? "" : ch}
          </div>
        );
      })}
    </div>
  );
}

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          background: linen,
          color: slate,
          fontFamily: "sans-serif",
        }}
      >
        <div
          style={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            justifyContent: "space-between",
            padding: "60px 72px 52px",
          }}
        >
          {/* Wordmark: the evidence-sheet mark, then the name. */}
          <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
            <div
              style={{
                width: 34,
                height: 42,
                display: "flex",
                flexDirection: "column",
                justifyContent: "flex-end",
                border: `4px solid ${slate}`,
                borderRadius: 3,
              }}
            >
              <div style={{ height: 7, background: oxide }} />
            </div>
            <div style={{ fontSize: 48, fontWeight: 700, letterSpacing: "-0.04em", lineHeight: 1 }}>Disputely</div>
          </div>

          <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 40 }}>
            <div style={{ display: "flex", flexDirection: "column", maxWidth: 470 }}>
              <div style={{ fontSize: 60, fontWeight: 700, lineHeight: 1.04, letterSpacing: "-0.045em" }}>
                Every chargeback, answered before the deadline.
              </div>
              <div style={{ marginTop: 24, fontSize: 25, lineHeight: 1.35, color: grey }}>
                Evidence by reason code. A narrative checked against the facts. $29 a month, flat.
              </div>
            </div>

            <div
              style={{
                display: "flex",
                flexDirection: "column",
                padding: "28px 34px 30px",
                background: "#FFFFFF",
                borderRadius: 10,
                border: "2px solid rgba(27, 36, 48, 0.12)",
                borderTop: `8px solid ${oxide}`,
              }}
            >
              <div style={{ fontSize: 22, fontWeight: 600, color: grey }}>Evidence due in</div>
              <div style={{ display: "flex", marginTop: 10 }}>
                <Countdown value="06d 14h" />
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 14, marginTop: 20 }}>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    padding: "6px 12px",
                    border: `2px solid ${slate}`,
                    borderRadius: 6,
                    fontSize: 20,
                    color: slate,
                  }}
                >
                  <div style={{ width: 10, height: 10, borderRadius: 999, background: slate }} />
                  product_not_received
                </div>
                <div style={{ fontSize: 26, fontWeight: 700 }}>$184.00</div>
              </div>
            </div>
          </div>
        </div>
        <div style={{ height: 14, background: oxide }} />
      </div>
    ),
    size,
  );
}
