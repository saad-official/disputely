import Link from "next/link";
import { cn } from "@/lib/utils";
import { focusRing } from "./site";

/**
 * The mark: an evidence sheet with a folded corner, and an oxide rule along
 * its foot for the deadline it is filed against.
 */
export function Mark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 24" aria-hidden="true" className={cn("h-6 w-5 shrink-0", className)} fill="none">
      <path d="M2 2.5h10.5L18 8v13.5H2z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
      <path d="M12.5 2.5V8H18" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
      <path d="M5.5 12.5h6M5.5 15.5h9" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" opacity="0.55" />
      <rect x="2" y="19" width="16" height="2.5" fill="var(--oxide)" />
    </svg>
  );
}

export function Wordmark({ className }: { className?: string }) {
  return (
    <Link href="/" aria-label="Disputely, home" className={cn("inline-flex items-center gap-2", focusRing, className)}>
      <Mark />
      <span className="font-heading text-[1.3rem] leading-none font-semibold tracking-[-0.03em]">Disputely</span>
    </Link>
  );
}
