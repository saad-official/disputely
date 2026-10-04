import type { Metadata } from "next";
import Link from "next/link";
import { Lock } from "lucide-react";
import { PageHeader } from "@/components/app/page-header";
import { DemoTag, DisputeState, ReasonChip, Stamp } from "@/components/disputes/parts";
import { Button } from "@/components/ui/button";
import { requireOrgContext } from "@/lib/auth/session";
import { formatDate, formatMoney, formatMoneyList, formatPercent } from "@/lib/format";
import { getAnalytics } from "@/lib/services/metrics";
import { limitsFor } from "@/lib/services/plan-limits";

export const metadata: Metadata = { title: "Analytics" };

function Card({ label, meta, children }: { label: string; meta?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="min-w-0 rounded-lg bg-card shadow-card ring-1 ring-foreground/10">
      <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-2.5">
        <h2 className="font-sans text-xs font-semibold tracking-normal text-foreground/75">{label}</h2>
        {meta ? <span className="font-mono text-[0.6875rem] text-foreground/70">{meta}</span> : null}
      </div>
      <div className="p-4">{children}</div>
    </section>
  );
}

export default async function AnalyticsPage() {
  const { org } = await requireOrgContext();
  const pro = limitsFor(org.plan).analytics;

  if (!pro) {
    return (
      <>
        <PageHeader title="Analytics" description="Win rate by reason code, packet completeness and money recovered." />
        <section className="hatch grid place-items-center gap-3 rounded-xl border border-dashed bg-card/70 px-6 py-14 text-center">
          <Lock className="size-6 text-foreground/60" aria-hidden />
          <h2 className="font-heading text-xl">Win-rate analytics are part of Pro</h2>
          <p className="max-w-md text-sm text-muted-foreground">
            See which reason codes you win, how complete your submitted packets were, and what you recovered, per currency.
            Your dashboard still shows the overall win rate and recoveries.
          </p>
          <Button asChild>
            <Link href="/billing">See Pro</Link>
          </Button>
        </section>
      </>
    );
  }

  const data = await getAnalytics(org.id);
  const decided = data.overall.won + data.overall.lost;

  return (
    <>
      <PageHeader title="Analytics" description="Every decided dispute: what you won by reason code, how complete the packets were, and what came back." />

      <div className="grid gap-4 lg:grid-cols-12">
        <div className="min-w-0 lg:col-span-7">
          <Card label="Win rate by reason" meta={decided ? `${data.overall.won} of ${decided} won · ${formatPercent(data.overall.winRate)}` : "nothing decided yet"}>
            {data.byReason.length === 0 ? (
              <p className="text-sm text-muted-foreground">Bars appear once the bank decides a dispute (won or lost).</p>
            ) : (
              <ul className="space-y-4">
                {data.byReason.map((r) => {
                  const total = r.rate.won + r.rate.lost;
                  const pct = total ? (r.rate.won / total) * 100 : 0;
                  return (
                    <li key={r.reason} className="min-w-0">
                      <div className="flex items-center justify-between gap-3">
                        <span className="flex min-w-0 items-center gap-2">
                          <ReasonChip reason={r.reason} />
                          <span className="hidden truncate text-xs text-muted-foreground sm:inline">{r.title}</span>
                        </span>
                        <span className="tabular shrink-0 font-mono text-xs">
                          {r.rate.won} of {total} · {formatPercent(r.rate.winRate)}
                        </span>
                      </div>
                      <div
                        role="img"
                        aria-label={`${r.reason}: ${r.rate.won} won of ${total} decided`}
                        className="hatch mt-1.5 h-2.5 overflow-hidden rounded-[2px] bg-secondary"
                      >
                        <div className="h-full bg-olive" style={{ width: `${pct}%` }} />
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>
        </div>
        <div className="grid min-w-0 content-start gap-4 lg:col-span-5">
          <Card label="Recovered" meta="won disputes">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <p className="tabular font-mono text-2xl leading-tight font-semibold break-words text-olive">{formatMoneyList(data.recovered)}</p>
              {data.overall.won ? <Stamp tone="olive">Won × {data.overall.won}</Stamp> : null}
            </div>
            <p className="mt-2 text-xs text-muted-foreground">Amounts in different currencies are never added together.</p>
          </Card>
          <Card label="Submitted packets" meta="median completeness">
            <p className="tabular font-mono text-3xl leading-none font-semibold">
              {data.medianCompleteness === null ? "—" : `${Math.round(data.medianCompleteness)}%`}
            </p>
            <p className="mt-2 text-xs text-muted-foreground">
              Required fields weigh 70, recommended 30. Higher completeness tends to win more: compare with the bars.
            </p>
          </Card>
          <Card label="By status">
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
              {(
                [
                  ["Needs response", data.counts.needs_response + data.counts.warning_needs_response],
                  ["Under review", data.counts.under_review + data.counts.warning_under_review],
                  ["Won", data.counts.won],
                  ["Lost", data.counts.lost],
                  ["Refunded / prevented", data.counts.charge_refunded + data.counts.prevented],
                  ["Inquiries closed", data.counts.warning_closed],
                ] as const
              ).map(([label, n]) => (
                <div key={label} className="flex items-baseline justify-between gap-2">
                  <dt className="text-muted-foreground">{label}</dt>
                  <dd className="tabular font-mono">{n}</dd>
                </div>
              ))}
            </dl>
          </Card>
        </div>
      </div>

      <section aria-labelledby="outcomes" className="mt-8 grid gap-3">
        <h2 id="outcomes" className="text-lg">
          Outcomes
        </h2>
        {data.outcomes.length === 0 ? (
          <p className="text-sm text-muted-foreground">No closed disputes yet.</p>
        ) : (
          <div className="overflow-x-auto rounded-lg bg-card shadow-card ring-1 ring-foreground/10">
            <table className="w-full min-w-[40rem] text-sm">
              <caption className="sr-only">Closed disputes, most recent first</caption>
              <thead>
                <tr className="border-b border-border text-left text-xs text-foreground/70">
                  <th scope="col" className="px-4 py-2.5 font-semibold">Closed</th>
                  <th scope="col" className="px-3 py-2.5 font-semibold">Outcome</th>
                  <th scope="col" className="px-3 py-2.5 font-semibold">Reason</th>
                  <th scope="col" className="px-3 py-2.5 text-right font-semibold">Amount</th>
                  <th scope="col" className="px-3 py-2.5 text-right font-semibold">Packet</th>
                  <th scope="col" className="px-4 py-2.5 font-semibold">Customer</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {data.outcomes.map((o) => (
                  <tr key={o.id}>
                    <td className="px-4 py-2.5 font-mono text-xs whitespace-nowrap">{formatDate(o.closedAt, org.timezone)}</td>
                    <td className="px-3 py-2.5">
                      <DisputeState status={o.status} packetSubmitted={false} />
                    </td>
                    <td className="px-3 py-2.5">
                      <ReasonChip reason={o.reason} />
                    </td>
                    <td className="tabular px-3 py-2.5 text-right font-mono whitespace-nowrap">{formatMoney(o.amountCents, o.currency)}</td>
                    <td className="tabular px-3 py-2.5 text-right font-mono text-xs">{o.completeness === null ? "—" : `${o.completeness}%`}</td>
                    <td className="max-w-56 px-4 py-2.5">
                      <Link href={`/disputes/${o.id}`} className="block truncate underline-offset-3 hover:underline">
                        {o.customerName ?? o.stripeDisputeId}
                      </Link>
                      {o.demo ? <DemoTag className="mt-0.5" /> : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
