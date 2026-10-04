import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { Plan } from "@/lib/db/types";
import { MobileNav } from "./mobile-nav";
import { NavLinks } from "./nav-links";
import { UserMenu } from "./user-menu";

export type SidebarProps = {
  orgName: string;
  plan: Plan;
  email: string | null;
  /** Questions needing evidence across in-review questionnaires. */
  openEvidenceCount: number;
};

function PlanBadge({ plan }: { plan: Plan }) {
  const pro = plan === "pro";
  return (
    <Badge asChild variant={pro ? "default" : "secondary"} className="font-mono tracking-wide uppercase">
      <Link href="/billing" aria-label={`${pro ? "Pro" : "Free"} plan. Manage billing`}>
        {pro ? "Pro" : "Free"}
      </Link>
    </Badge>
  );
}

function RailWordmark({ className }: { className?: string }) {
  return (
    <Link
      href="/dashboard"
      className={cn(
        "inline-flex items-center gap-2 font-heading font-bold tracking-tight text-sidebar-foreground outline-none focus-visible:ring-3 focus-visible:ring-sidebar-ring/50",
        className,
      )}
    >
      <span aria-hidden className="size-2.5 rounded-full bg-primary" />
      Disputely
    </Link>
  );
}

/** Rail contents, shared by the desktop rail and the mobile drawer. */
function RailBody({ orgName, plan, email, openEvidenceCount }: SidebarProps) {
  return (
    <>
      <div className="px-4 pt-5 pb-4">
        <RailWordmark className="text-xl leading-none" />
        <div className="mt-3 flex items-center gap-2">
          <p className="min-w-0 flex-1 truncate text-sm text-sidebar-foreground/70" title={orgName}>
            {orgName}
          </p>
          <PlanBadge plan={plan} />
        </div>
      </div>
      <div className="flex-1 overflow-y-auto px-2">
        <NavLinks openEvidenceCount={openEvidenceCount} />
      </div>
      <div className="border-t border-sidebar-border p-2">
        <UserMenu email={email} />
      </div>
    </>
  );
}

/** Left rail at md and up. */
export function Sidebar(props: SidebarProps) {
  return (
    <aside className="sticky top-0 hidden h-svh w-60 shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground md:flex">
      <RailBody {...props} />
    </aside>
  );
}

/** Top bar with a drawer below md. */
export function MobileTopBar(props: SidebarProps) {
  return (
    <header className="sticky top-0 z-40 flex h-14 items-center gap-2 border-b border-sidebar-border bg-sidebar/95 px-2 backdrop-blur md:hidden">
      <MobileNav>
        <RailBody {...props} />
      </MobileNav>
      <RailWordmark className="text-lg" />
      <span className="ml-auto truncate pr-2 text-sm text-muted-foreground">{props.orgName}</span>
    </header>
  );
}
