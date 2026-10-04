import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/app/page-header";
import { CreateDemoButton, SyncButton } from "@/components/disputes/api-buttons";
import { CompletenessMeter, Countdown, DemoTag, DisputeState, ReasonChip } from "@/components/disputes/parts";
import { Button } from "@/components/ui/button";
import { requireOrgContext } from "@/lib/auth/session";
import * as disputesRepo from "@/lib/db/repositories/disputes";
import * as packetsRepo from "@/lib/db/repositories/packets";
import { CLOSED_DISPUTE_STATUSES, NEEDS_RESPONSE_STATUSES, OPEN_DISPUTE_STATUSES } from "@/lib/db/schema";
import type { DisputeStatus } from "@/lib/db/types";
import { deadlineLabel } from "@/lib/domain/reminders";
import { formatDate, formatMoney } from "@/lib/format";
import { requestTime } from "@/lib/request-time";
import { playbookSize } from "@/lib/services/metrics";
import { connectedKeyMode } from "@/lib/services/stripe-connection";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Disputes" };

const PAGE_SIZE = 25;

const FILTERS: { key: string; label: string; statuses: readonly DisputeStatus[] | null }[] = [
  { key: "needs_response", label: "Needs response", statuses: NEEDS_RESPONSE_STATUSES },
  { key: "open", label: "Open", statuses: OPEN_DISPUTE_STATUSES },
  { key: "won", label: "Won", statuses: ["won"] },
  { key: "lost", label: "Lost", statuses: ["lost"] },
  { key: "closed", label: "All closed", statuses: CLOSED_DISPUTE_STATUSES },
  { key: "all", label: "All", statuses: null },
];

function one(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function DisputesPage({ searchParams }: PageProps<"/disputes">) {
  const { org } = await requireOrgContext();
  const params = await searchParams;
  const filter = FILTERS.find((f) => f.key === one(params.status)) ?? FILTERS[1];
  const page = Math.max(1, Math.floor(Number(one(params.page)) || 1));
  const now = requestTime();
  const mode = connectedKeyMode(org);

  const { items, total } = await disputesRepo.listAll(org.id, {
    status: filter.statuses ?? undefined,
    limit: PAGE_SIZE,
    offset: (page - 1) * PAGE_SIZE,
  });
  // Open views read best soonest-deadline first; closed views newest first.
  const rows = filter.key === "needs_response" || filter.key === "open"
    ? [...items].sort((a, b) => (a.dueBy?.getTime() ?? Infinity) - (b.dueBy?.getTime() ?? Infinity))
    : items;
  const packets = await packetsRepo.listSummaries(org.id, rows.map((d) => d.id));
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const href = (key: string, p = 1) => `/disputes?status=${key}${p > 1 ? `&page=${p}` : ""}`;

  return (
    <>
      <PageHeader
        title="Disputes"
        description="Every dispute Disputely has synced from Stripe, with its evidence deadline and how complete its packet is."
        actions={mode ? <SyncButton /> : <Button asChild><Link href="/settings#stripe">Connect Stripe</Link></Button>}
      />

      <nav aria-label="Filter by status" className="-mx-1 mb-4 flex gap-1 overflow-x-auto px-1 pb-1">
        {FILTERS.map((f) => {
          const active = f.key === filter.key;
          return (
            <Link
              key={f.key}
              href={href(f.key)}
              aria-current={active ? "page" : undefined}
              className={cn(
                "inline-flex h-8 shrink-0 items-center rounded-md px-3 text-sm font-medium outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
                active ? "bg-foreground text-background" : "text-foreground/75 hover:bg-secondary hover:text-foreground",
              )}
            >
              {f.label}
            </Link>
          );
        })}
      </nav>

      {rows.length === 0 ? (
        <section className="grid place-items-center gap-3 rounded-xl border border-dashed bg-card/60 px-6 py-14 text-center">
          <h2 className="font-heading text-xl">{total === 0 && filter.key === "all" ? "No disputes yet" : `Nothing under “${filter.label}”`}</h2>
          <p className="max-w-md text-sm text-muted-foreground">
            {mode
              ? "Sync to pull the latest from Stripe. New disputes also arrive by webhook and with the daily sync."
              : "Connect your Stripe account in Settings to list your disputes here."}
          </p>
          {mode === "test" && total === 0 && filter.key === "all" ? <CreateDemoButton /> : null}
        </section>
      ) : (
        <div className="overflow-hidden rounded-lg bg-card shadow-card ring-1 ring-foreground/10">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[40rem] text-sm">
              <caption className="sr-only">Disputes, {filter.label.toLowerCase()}</caption>
              <thead>
                <tr className="border-b border-border text-left text-xs text-foreground/70">
                  <th scope="col" className="px-4 py-2.5 font-semibold">Due in</th>
                  <th scope="col" className="px-3 py-2.5 text-right font-semibold">Amount</th>
                  <th scope="col" className="px-3 py-2.5 font-semibold">Reason</th>
                  <th scope="col" className="px-3 py-2.5 font-semibold">Status</th>
                  <th scope="col" className="w-28 px-3 py-2.5 font-semibold">Packet</th>
                  <th scope="col" className="px-4 py-2.5 font-semibold">Customer</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {rows.map((d) => {
                  const packet = packets.get(d.id);
                  const of = playbookSize(d.reason);
                  const have = packet ? Math.max(0, of - packet.missing.length) : 0;
                  const open = (OPEN_DISPUTE_STATUSES as readonly string[]).includes(d.status);
                  const demo = Boolean(d.charge.demo) && !d.livemode;
                  return (
                    <tr key={d.id} className="group relative align-top hover:bg-secondary/50">
                      <td className="px-4 py-3">
                        {open ? (
                          <Countdown deadline={deadlineLabel(d.dueBy, now)} hasDeadline={Boolean(d.dueBy)} size="md" />
                        ) : (
                          <span className="font-mono text-xs text-foreground/65">closed {formatDate(d.closedAt, org.timezone)}</span>
                        )}
                      </td>
                      <td className="tabular px-3 py-3 text-right font-mono whitespace-nowrap">{formatMoney(d.amountCents, d.currency)}</td>
                      <td className="px-3 py-3">
                        <ReasonChip reason={d.reason} stripeReason={d.stripeReason} />
                      </td>
                      <td className="px-3 py-3">
                        <DisputeState status={d.status} packetSubmitted={packet?.status === "submitted"} />
                      </td>
                      <td className="px-3 py-3">
                        {packet ? (
                          <CompletenessMeter have={have} of={of} percent={packet.completeness} compact />
                        ) : (
                          <span className="text-xs text-muted-foreground">Not built</span>
                        )}
                      </td>
                      <td className="max-w-48 px-4 py-3">
                        <Link
                          href={`/disputes/${d.id}`}
                          className="block truncate font-medium outline-none after:absolute after:inset-0 after:content-[''] focus-visible:underline"
                        >
                          {d.customer.name ?? d.customer.email ?? "Unknown customer"}
                        </Link>
                        <span className="mt-0.5 flex items-center gap-1.5">
                          <span className="truncate font-mono text-[0.6875rem] text-foreground/65">{d.stripeDisputeId}</span>
                          {demo ? <DemoTag /> : null}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {pages > 1 ? (
            <nav aria-label="Pages" className="flex items-center justify-between gap-3 border-t border-border px-4 py-2.5 text-sm">
              <span className="text-muted-foreground">
                Page {page} of {pages} · {total} disputes
              </span>
              <span className="flex gap-2">
                {page > 1 ? (
                  <Button variant="outline" size="sm" asChild>
                    <Link href={href(filter.key, page - 1)}>Previous</Link>
                  </Button>
                ) : null}
                {page < pages ? (
                  <Button variant="outline" size="sm" asChild>
                    <Link href={href(filter.key, page + 1)}>Next</Link>
                  </Button>
                ) : null}
              </span>
            </nav>
          ) : null}
        </div>
      )}
    </>
  );
}
