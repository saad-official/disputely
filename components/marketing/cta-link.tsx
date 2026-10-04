import Link from "next/link";
import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

type CtaLinkProps = ComponentProps<typeof Link> & {
  tone?: "oxide" | "slate" | "outline" | "linen" | "linen-outline";
  size?: "md" | "lg";
};

/**
 * A link styled as a call to action. Navigation stays a link (not a button),
 * so it works without JavaScript and announces as a link. Corners are a
 * filing-cabinet 6px, not a pill.
 */
export function CtaLink({ tone = "oxide", size = "lg", className, ...props }: CtaLinkProps) {
  const onDark = tone === "linen" || tone === "linen-outline";
  return (
    <Link
      className={cn(
        "inline-flex shrink-0 items-center justify-center gap-2 rounded-md border font-semibold whitespace-nowrap outline-none select-none",
        "motion-safe:transition-colors",
        "focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2",
        onDark ? "focus-visible:outline-linen" : "focus-visible:outline-foreground",
        size === "lg" ? "h-12 px-5 text-[0.9375rem]" : "h-9 px-3.5 text-sm",
        tone === "oxide" && "border-(--oxide-ink) bg-(--oxide-ink) text-white hover:border-foreground hover:bg-foreground",
        tone === "slate" && "border-foreground bg-foreground text-background hover:bg-foreground/85",
        tone === "outline" && "border-foreground/30 bg-card text-foreground hover:border-foreground",
        tone === "linen" && "border-linen bg-linen text-slate hover:bg-transparent hover:text-linen",
        tone === "linen-outline" && "border-linen/45 bg-transparent text-linen hover:border-linen",
        className,
      )}
      {...props}
    />
  );
}
