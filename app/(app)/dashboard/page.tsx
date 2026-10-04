import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, KeyRound } from "lucide-react";
import { PageHeader } from "@/components/app/page-header";
import { ActivityList } from "@/components/disputes/activity";
import { CreateDemoButton, SyncButton } from "@/components/disputes/api-buttons";
import { CompletenessMeter, Countdown, DemoTag, ReasonChip, StatusChip } from "@/components/disputes/parts";
import { Button } from "@/components/ui/button";
import { requireOrgContext } from "@/lib/auth/session";
import { formatDateTime, formatMoney, formatMoneyList, formatPercent } from "@/lib/format";
import { requestTime } from "@/lib/request-time";
import { getDashboard, type OpenDisputeRow } from "@/lib/services/metrics";
import { connectedKeyMode } from "@/lib/services/stripe-connection";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Dashboard" };

function Tile({ label, children, caption, className }: { label: string; children: React.ReactNode; caption?: React.ReactNode; className?: string }) {
  return (
    <div className={cn("min-w-0 rounded-lg bg-card p-4 shadow-card ring-1 ring-foreground/10", className)}>
      <p className="text-xs font-semibold text-foreground/70">{label}</p>
      <div className="mt-2 min-w-0">{children}</div>
      {caption ? <p className="mt-2 text-xs text-muted-foreground">{caption}</p> : null}
    </div>
  );
}

function NextDeadline({ row, timezone }: { row: OpenDisputeRow; timezone: string }) {
  return (
    <article className="relative min-w-0 overflow-hidden rounded-lg bg-card shadow-card ring-1 ring-foreground/10">
      <div aria-hidden="true" className={cn("h-1", row.deadline.tone === "ok" ? "bg-foreground/20" : "bg-oxide")} />
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-b border-border px-4 py-3 sm:px-6">
        <span className="flex min-w-0 items-center gap-2">
          <span className="min-w-0 truncate font-mono text-xs text-foreground/75">{row.stripeDisputeId}</span>
          {row.demo ? <DemoTag /> : null}
        </span>
        <StatusChip status={row.status} />
      </div>
      <div className="px-4 pt-5 pb-6 sm:px-6">
        <p className="text-xs font-semibold text-foreground/75">Evidence due in</p>
        <Countdown deadline={row.deadline} hasDeadline={Boolean(row.dueBy)} size="xl" className="mt-2" />
        <p className="mt-3 font-mono text-xs text-foreground/75">
          Stripe <span className="text-foreground">due_by</span> {formatDateTime(row.dueBy, timezone)}
        </p>
        <dl className="mt-6 grid grid-cols-2 gap-x-4 gap-y-4 border-t border-border pt-5 sm:grid-cols-3">
          <div className="min-w-0">
            <dt className="text-[0.6875rem] font-semibold text-foreground/70">Amount</dt>
            <dd className="tabular mt-1 truncate font-mono text-sm">{formatMoney(row.amountCents, row.currency)}</dd>
          </div>
          <div className="min-w-0">
            <dt className="text-[0.6875rem] font-semibold text-foreground/70">Customer</dt>
            <dd className="mt-1 truncate text-sm">{row.customerName ?? row.customerEmail ?? "Unknown"}</dd>
          </div>
          <div className="col-span-2 min-w-0 sm:col-span-1">
            <dt className="text-[0.6875rem] font-semibold text-foreground/70">Reason</dt>
            <dd className="mt-1">
              <ReasonChip reason={row.reason} stripeReason={row.stripeReason} />
            </dd>
          </div>
        </dl>
        <div className="mt-6 grid gap-4 rounded-md bg-secondary p-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
          {row.packet ? (
            <CompletenessMeter have={row.packet.have} of={row.packet.of} percent={row.packet.completeness} />
          ) : (
            <p className="text-sm text-foreground/80">No packet yet. Opening the dispute assembles one from Stripe and your records.</p>
          )}
          <Button asChild>
            <Link href={`/disputes/${row.id}`}>
              Review packet
              <ArrowRight aria-hidden />
            </Link>
          </Button>
        </div>
      </div>
    </article>
  );
}

function OpenList({ rows }: { rows: OpenDisputeRow[] }) {
  return (
    <ul className="divide-y divide-border">
      {rows.map((row) => (
        <li key={row.id}>
          <Link
            href={`/disputes/${row.id}`}
            className="grid grid-cols-[5.25rem_minmax(0,1fr)] items-start gap-x-3 px-4 py-3 outline-none hover:bg-secondary/60 focus-visible:bg-secondary sm:grid-cols-[5.75rem_minmax(0,1fr)]"
          >
            <Countdown deadline={row.deadline} hasDeadline={Boolean(row.dueBy)} size="md" className="pt-0.5" />
            <span className="min-w-0">
              <span className="flex items-baseline justify-between gap-3">
                <span className="min-w-0 truncate text-sm">{row.customerName ?? row.customerEmail ?? row.stripeDisputeId}</span>
                <span className="tabular shrink-0 font-mono text-sm">{formatMoney(row.amountCents, row.currency)}</span>
              </span>
              <span className="mt-1.5 flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                <span className="flex items-center gap-1.5">
                  <ReasonChip reason={row.reason} stripeReason={row.stripeReason} />
                  {row.demo ? <DemoTag /> : null}
                </span>
                <span className="font-mono text-[0.6875rem] text-foreground/75">
                  {row.packet ? `packet ${row.packet.have} of ${row.packet.of}` : "no packet yet"}
                </span>
              </span>
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

export default async function DashboardPage() {
  const { org } = await requireOrgContext();
  const now = requestTime();
  const mode = connectedKeyMode(org);
  const connected = mode !== null;
  const data = await getDashboard(org.id, now);
  const hero = data.open.find((r) => r.status === "needs_response" || r.status === "warning_needs_response") ?? data.open[0];
  const rest = data.open.filter((r) => r !== hero);
  const decided = data.winRate.won + data.winRate.lost;

  return (
    <>
      <PageHeader
        title="Dashboard"
        description="Open disputes by deadline, what is at stake, and how your packets are doing."
        actions={connected ? <SyncButton /> : null}
      />

      {!connected ? (
        <section className="hatch grid gap-4 rounded-xl border border-dashed bg-card/70 px-6 py-10 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
          <div className="max-w-xl">
            <h2 className="flex items-center gap-2 font-heading text-xl">
              <KeyRound className="size-5 text-oxide-ink" aria-hidden />
              Connect your Stripe account
            </h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Paste a restricted key with read access to disputes, charges and customers and write access to disputes and
              files. Disputely lists your open disputes with their deadlines and builds each evidence packet from them.
              {data.totalDisputes > 0 ? " Disputes synced earlier stay here." : ""}
            </p>
          </div>
          <Button asChild>
            <Link href="/settings#stripe">Connect Stripe</Link>
          </Button>
        </section>
      ) : data.totalDisputes === 0 ? (
        <section className="grid gap-6 rounded-xl border border-dashed bg-card/70 px-6 py-10 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
          <div className="max-w-xl">
            <h2 className="font-heading text-xl">No disputes on this Stripe account yet</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              {mode === "test"
                ? "Create three real Stripe test disputes for the fictional store Larkspur Goods (fraudulent, an inquiry and product not received), with a policy library, shipments and customer messages, and run the whole flow end to end."
                : "Disputely checks for new disputes every day, and you can sync any time."}
            </p>
          </div>
          <div className="flex flex-wrap items-start gap-2">
            {mode === "test" ? <CreateDemoButton /> : null}
            <SyncButton />
          </div>
        </section>
      ) : null}

      {data.totalDisputes > 0 ? (
        <div className="grid gap-6">
          <section aria-labelledby="open-heading" className="grid gap-4 lg:grid-cols-12">
            <h2 id="open-heading" className="sr-only">
              Open disputes by deadline
            </h2>
            {hero ? (
              <div className="min-w-0 lg:col-span-7">
                <NextDeadline row={hero} timezone={org.timezone} />
              </div>
            ) : (
              <div className="grid min-w-0 place-items-center rounded-lg border border-dashed bg-card/60 px-6 py-12 text-center lg:col-span-7">
                <div>
                  <p className="font-heading text-lg">No open disputes</p>
                  <p className="mt-1 text-sm text-muted-foreground">Every dispute is closed. Outcomes are on the Analytics page.</p>
                </div>
              </div>
            )}
            <div className="min-w-0 rounded-lg bg-card shadow-card ring-1 ring-foreground/10 lg:col-span-5">
              <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-2.5">
                <span className="text-xs font-semibold text-foreground/75">Open, by deadline</span>
                <span className="font-mono text-[0.6875rem] text-foreground/70">{formatMoneyList(data.atStake)} at stake</span>
              </div>
              {rest.length > 0 ? (
                <OpenList rows={rest} />
              ) : (
                <p className="px-4 py-6 text-sm text-muted-foreground">{hero ? "Nothing else is open." : "Nothing is open."}</p>
              )}
              <div className="border-t border-border px-4 py-2.5">
                <Link href="/disputes" className="text-xs font-semibold text-foreground/80 underline underline-offset-3 hover:text-foreground">
                  All disputes
                </Link>
              </div>
            </div>
          </section>

          <section aria-label="Totals" className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <Tile label="Needs response" caption={data.needsResponse === 1 ? "dispute waiting on you" : "disputes waiting on you"}>
              <p className={cn("countdown text-3xl leading-none", data.needsResponse > 0 ? "text-oxide-ink" : "text-foreground")}>
                {data.needsResponse}
              </p>
            </Tile>
            <Tile label="At stake" caption={`${data.openCount} open`}>
              <p className="tabular font-mono text-xl leading-tight font-semibold break-words">{formatMoneyList(data.atStake)}</p>
            </Tile>
            <Tile label="Win rate" caption={decided ? `${data.winRate.won} won of ${decided} decided` : "No decisions yet"}>
              <p className="tabular font-mono text-3xl leading-none font-semibold">{formatPercent(data.winRate.winRate)}</p>
            </Tile>
            <Tile
              label="Recovered"
              caption={data.medianCompleteness === null ? "Won disputes" : `Median submitted packet ${Math.round(data.medianCompleteness)}% complete`}
            >
              <p className="tabular font-mono text-xl leading-tight font-semibold break-words text-olive">{formatMoneyList(data.recovered)}</p>
            </Tile>
          </section>

          <section aria-labelledby="activity-heading" className="rounded-lg bg-card shadow-card ring-1 ring-foreground/10">
            <h2 id="activity-heading" className="border-b border-border px-4 py-2.5 font-sans text-xs font-semibold tracking-normal text-foreground/75">
              Recent activity
            </h2>
            <ActivityList events={data.recent} now={now} />
          </section>
        </div>
      ) : null}
    </>
  );
}
