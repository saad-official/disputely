import Link from "next/link";
import { cn } from "@/lib/utils";
import { CtaLink } from "./cta-link";
import { container, focusRing, links } from "./site";
import { Wordmark } from "./wordmark";

const navLink = cn("text-sm font-medium text-foreground/75 hover:text-foreground motion-safe:transition-colors", focusRing);

function NavLinks({ className }: { className?: string }) {
  return (
    <ul className={className}>
      <li>
        <Link href={links.howItWorks} className={navLink}>
          How it works
        </Link>
      </li>
      <li>
        <Link href={links.pricing} className={navLink}>
          Pricing
        </Link>
      </li>
      <li>
        <a href={links.repo} className={navLink}>
          GitHub
        </a>
      </li>
    </ul>
  );
}

export function SiteHeader() {
  return (
    <header className="border-b border-border bg-background">
      <div className={cn(container, "flex h-16 items-center gap-8")}>
        <Wordmark />
        <nav aria-label="Main" className="hidden md:block">
          <NavLinks className="flex items-center gap-7" />
        </nav>
        <div className="ml-auto flex items-center gap-4 sm:gap-5">
          <Link href={links.signIn} className={navLink}>
            Sign in
          </Link>
          <CtaLink href={links.signUp} size="md">
            Start free
          </CtaLink>
        </div>
      </div>
      {/* Phones: the same links on their own row, so no menu button is needed. */}
      <nav aria-label="Main" className="border-t border-border md:hidden">
        <NavLinks className={cn(container, "flex h-11 items-center gap-6")} />
      </nav>
    </header>
  );
}
