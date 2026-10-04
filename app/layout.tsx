import type { Metadata } from "next";
import { IBM_Plex_Mono, Inter, Sora } from "next/font/google";
import { Analytics } from "@vercel/analytics/next";
import { Toaster } from "@/components/ui/sonner";
import "./globals.css";

const heading = Sora({ variable: "--font-heading", subsets: ["latin"], weight: ["500", "600", "700"], display: "swap" });
const body = Inter({ variable: "--font-body", subsets: ["latin"], display: "swap" });
const mono = IBM_Plex_Mono({ variable: "--font-mono", subsets: ["latin"], weight: ["400", "500", "600"], display: "swap" });

const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

export const metadata: Metadata = {
  metadataBase: new URL(appUrl),
  title: {
    default: "Disputely — win more chargebacks, pay a flat fee",
    template: "%s · Disputely",
  },
  description:
    "Disputely connects to your Stripe account, assembles the evidence packet each dispute needs by reason code, writes a narrative verified against the facts, submits through Stripe, and tracks what you win. Flat monthly price, never a cut of your recoveries.",
  openGraph: {
    title: "Disputely — win more chargebacks, pay a flat fee",
    description: "Evidence packets by reason code, fact-checked narratives, one-click submission through the Stripe Disputes API.",
    type: "website",
    url: appUrl,
  },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${heading.variable} ${body.variable} ${mono.variable} h-full antialiased`} suppressHydrationWarning>
      <body className="min-h-full flex flex-col bg-background text-foreground font-sans">
        {children}
        <Toaster position="bottom-right" richColors closeButton />
        <Analytics />
      </body>
    </html>
  );
}
