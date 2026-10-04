import { cn } from "@/lib/utils";
import { SectionLabel } from "./section-heading";
import { container } from "./site";

/**
 * Shared shell for Privacy and Terms: a reading column with a short note
 * column on wide screens. Styles child prose without a typography plugin.
 */
export function LegalPage({
  label,
  title,
  updated,
  children,
}: {
  label: string;
  title: string;
  updated: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn(container, "grid gap-10 py-14 md:grid-cols-12 md:py-20")}>
      <header className="md:col-span-4">
        <SectionLabel>{label}</SectionLabel>
        <h1 className="mt-4 text-4xl leading-tight tracking-[-0.035em] text-balance sm:text-5xl">{title}</h1>
        <p className="mt-4 text-sm text-foreground/75">
          Last updated <time dateTime={updated} className="tabular font-mono">{updated}</time>
        </p>
        <p className="hatch mt-8 rounded-md bg-card px-4 py-3 text-sm leading-relaxed text-foreground/85 ring-1 ring-foreground/10">
          Disputely is a portfolio demo. This page describes how the demo behaves; it is not legal advice.
        </p>
      </header>
      <div
        className={cn(
          "max-w-2xl min-w-0 text-[0.9375rem] leading-relaxed text-foreground/85 md:col-span-7 md:col-start-6",
          "[&_h2]:mt-10 [&_h2]:mb-3 [&_h2]:text-2xl [&_h2]:text-foreground [&>h2:first-child]:mt-0",
          "[&_p]:mt-3 [&_ul]:mt-3 [&_ul]:list-disc [&_ul]:space-y-1.5 [&_ul]:pl-5 [&_li]:marker:text-foreground/60",
          "[&_strong]:font-semibold [&_strong]:text-foreground [&_code]:font-mono [&_code]:text-[0.8125rem]",
        )}
      >
        {children}
      </div>
    </div>
  );
}
