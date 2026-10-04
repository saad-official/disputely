import type { CSSProperties } from "react";

/**
 * Shared constants and class strings for the marketing site, so the header,
 * footer and pages all link to the same places and share one focus style.
 */

export const links = {
  repo: "https://github.com/saad-official/disputely",
  series: "https://github.com/saad-official/vibe-build-series",
  signIn: "/sign-in",
  signUp: "/sign-up",
  howItWorks: "/#how-it-works",
  pricing: "/pricing",
  privacy: "/privacy",
  terms: "/terms",
} as const;

/** Page container: max-w-6xl with a 16px gutter on phones. */
export const container = "mx-auto w-full max-w-6xl px-4 sm:px-6 lg:px-8";

/**
 * High-contrast focus outline (slate, solid) for links, summaries and CTAs.
 * The global outline is oxide at 50%, which is too faint on linen.
 */
export const focusRing =
  "rounded-sm outline-none focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-4 focus-visible:outline-foreground";

/** Inline text link: underlined, darker on hover, visible focus. */
export const textLink =
  "rounded-sm underline decoration-foreground/35 decoration-1 underline-offset-4 hover:decoration-foreground outline-none focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-foreground";

/**
 * Oxide as set in globals.css sits right at the 4.5:1 line against linen and
 * white text, which is fine for countdown numerals and large type but leaves
 * no margin for button labels, chips and small text. `--oxide-ink` (set on
 * the marketing layout wrapper) is the same hue and chroma at a lower
 * lightness: roughly 6.5:1 on linen and under white text. (Mixing toward
 * slate in oklch would swing the hue through magenta, so it is set directly.) `--oxide-glow` is the lighter
 * oxide for deadline figures on the slate bands, about 6:1 against slate.
 */
export const oxideInkVar = {
  "--oxide-ink": "oklch(0.46 0.15 30)",
  "--oxide-glow": "oklch(0.74 0.13 32)",
} as CSSProperties;

/** Example figures used on more than one page, so the arithmetic is written once. */
export const feeExample = {
  recovered: 4800,
  vendorRate: 0.25,
  flat: 29,
} as const;

export const usd = (n: number, digits = 0) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: digits, maximumFractionDigits: digits });
