import { cn } from "@/lib/utils";
import { narrativeLength } from "./narrative-mock";
import { DisputeRow, FauxButton, FieldMark, MockCard, type Reason, SourceTag, Stamp, StatusChip } from "./parts";

/* 1. Connect ---------------------------------------------------------------- */

const permissions = [
  { resource: "Disputes", access: "Write" },
  { resource: "Charges", access: "Read" },
  { resource: "Customers", access: "Read" },
  { resource: "PaymentIntents", access: "Read" },
  { resource: "Everything else", access: "None" },
];

export function ConnectMock() {
  return (
    <MockCard label="Settings · Stripe connection" meta="test mode">
      <p className="text-[0.6875rem] font-semibold text-foreground/70">Restricted API key</p>
      <p className="mt-1 rounded-md border border-input bg-background px-2.5 py-2 font-mono text-xs break-all text-foreground">
        rk_test_51Q8x&bull;&bull;&bull;&bull;&bull;&bull;&bull;&bull;&bull;&bull;&bull;&bull;&bull;&bull;Zt3a
      </p>
      <table className="mt-4 w-full border-collapse text-left text-xs">
        <caption className="sr-only">Permissions the restricted key needs</caption>
        <thead>
          <tr className="border-b border-border text-foreground/70">
            <th scope="col" className="py-1.5 font-semibold">
              Resource
            </th>
            <th scope="col" className="py-1.5 text-right font-semibold">
              Permission
            </th>
          </tr>
        </thead>
        <tbody>
          {permissions.map((p) => (
            <tr key={p.resource} className="border-b border-border last:border-b-0">
              <th scope="row" className="py-1.5 font-normal text-foreground">
                {p.resource}
              </th>
              <td
                className={cn(
                  "py-1.5 text-right font-mono",
                  p.access === "None" ? "text-foreground/70" : "font-medium text-foreground",
                )}
              >
                {p.access}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-4 flex items-start gap-2 rounded-md bg-secondary px-3 py-2 text-xs leading-relaxed text-foreground/85">
        <svg viewBox="0 0 16 16" aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" fill="none">
          <rect x="3" y="7" width="10" height="7" rx="1.2" stroke="currentColor" strokeWidth="1.4" />
          <path d="M5.5 7V5a2.5 2.5 0 015 0v2" stroke="currentColor" strokeWidth="1.4" />
        </svg>
        Encrypted at rest with a key derived for your organisation. Shown only as its last four characters.
      </p>
    </MockCard>
  );
}

/* 2. Sync ------------------------------------------------------------------- */

const openDisputes: { d: number; h: number; reason: Reason; amount: string; customer: string }[] = [
  { d: 2, h: 5, reason: "fraudulent", amount: "$62.50", customer: "Theo Lindqvist" },
  { d: 6, h: 14, reason: "product_not_received", amount: "$184.00", customer: "Mara Okafor" },
  { d: 13, h: 2, reason: "subscription_canceled", amount: "$24.00", customer: "Priya Nair" },
];

export function SyncMock() {
  return (
    <MockCard label="Disputes · open, soonest deadline first" meta="synced 09:12 UTC">
      <ul className="-my-1 divide-y divide-border">
        {openDisputes.map((x) => (
          <li key={x.customer} className="py-3">
            <DisputeRow days={x.d} hours={x.h} customer={x.customer} reason={x.reason} amount={x.amount} />
          </li>
        ))}
      </ul>
      <p className="mt-3 border-t border-border pt-3 font-mono text-[0.6875rem] leading-relaxed break-words text-foreground/75">
        webhook <span className="text-foreground">charge.dispute.updated</span> &middot; du_&hellip;aTn3fP &middot;
        evidence_details refreshed
      </p>
    </MockCard>
  );
}

/* 3. Assemble --------------------------------------------------------------- */

const required: { field: string; value?: string; source?: string }[] = [
  { field: "customer_name", value: "Mara Okafor", source: "Stripe customer" },
  { field: "shipping_address", value: "14 Alder Lane, Portland, OR 97211", source: "Checkout session" },
  { field: "shipping_carrier", value: "USPS", source: "Shipment record" },
  { field: "shipping_tracking_number", value: "9400 1112 0261 7840 2210 55", source: "Shipment record" },
  { field: "shipping_date", value: "2026-09-12", source: "Shipment record" },
  { field: "customer_communication", value: "2 messages, 18 Sep 2026", source: "Message log" },
  { field: "shipping_documentation" },
];

const supporting = [
  { field: "refund_policy", source: "Policy library" },
  { field: "refund_policy_disclosure", source: "Policy library" },
  { field: "uncategorized_text", source: "Narrative, verified" },
];

export function AssembleMock() {
  return (
    <MockCard
      label={
        <>
          <span className="hidden sm:inline">Playbook </span>
          <span className="font-mono font-normal">product_not_received</span>
        </>
      }
      meta="6 of 7 required"
    >
      <ul className="space-y-3">
        {required.map((r) => {
          const present = Boolean(r.value);
          return (
            <li key={r.field} className="flex gap-2.5">
              <FieldMark present={present} />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="min-w-0 font-mono text-xs break-all text-foreground/80">{r.field}</span>
                  {r.source ? <SourceTag>{r.source}</SourceTag> : null}
                </div>
                {present ? (
                  <p className="mt-0.5 text-sm break-words text-foreground">{r.value}</p>
                ) : (
                  <p className="mt-0.5 text-sm font-medium text-(--oxide-ink)">
                    Missing: carrier delivery scan (PDF or image, up to 5 MB)
                  </p>
                )}
              </div>
            </li>
          );
        })}
      </ul>
      <div className="mt-4 border-t border-border pt-3">
        <p className="text-[0.6875rem] font-semibold text-foreground/70">Also included</p>
        <ul className="mt-2 flex flex-wrap gap-1.5">
          {supporting.map((s) => (
            <li key={s.field} className="inline-flex max-w-full flex-wrap items-center gap-x-1.5 rounded-sm border border-border px-1.5 py-1">
              <span className="font-mono text-[0.6875rem] break-all text-foreground/85">{s.field}</span>
              <span className="text-[0.6875rem] text-foreground/70">&middot; {s.source}</span>
            </li>
          ))}
        </ul>
      </div>
    </MockCard>
  );
}

/* 4. Submit and track ------------------------------------------------------- */

export function SubmitMock() {
  return (
    <div className="grid min-w-0 gap-4 sm:grid-cols-2">
      <MockCard label="Confirm submission">
        <p className="text-sm leading-relaxed text-foreground">
          Send this packet to Stripe for <span className="font-mono text-xs">du_&hellip;aTn3fP</span>?
        </p>
        <p className="mt-2 text-xs leading-relaxed text-foreground/80">
          Stripe accepts one submission per dispute. After this, the evidence cannot be edited.
        </p>
        <dl className="mt-3 space-y-1 font-mono text-[0.6875rem] text-foreground/80">
          <div className="flex justify-between gap-3">
            <dt>fields</dt>
            <dd className="text-foreground">10</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt>attachments</dt>
            <dd className="text-foreground">2 files</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt>narrative</dt>
            <dd className="text-foreground">{narrativeLength.toLocaleString("en-US")} / 2,500 chars</dd>
          </div>
        </dl>
        <div className="mt-4 flex flex-wrap gap-2">
          <FauxButton>Submit to Stripe</FauxButton>
          <FauxButton tone="outline">Keep editing</FauxButton>
        </div>
      </MockCard>

      <MockCard label="Timeline" meta="du_…aTn3fP">
        <ol className="relative space-y-5 border-l border-border pl-4">
          <li className="relative">
            <span aria-hidden="true" className="absolute top-1.5 -left-[1.3rem] size-2 rounded-full bg-steel" />
            <p className="font-mono text-[0.6875rem] text-foreground/75">4 Oct 2026 &middot; 10:42 UTC</p>
            <div className="mt-1.5 flex flex-wrap items-center gap-2">
              <Stamp tone="steel">Submitted</Stamp>
              <StatusChip status="under_review" />
            </div>
            <p className="mt-1.5 text-xs text-foreground/80">Snapshot of the sent packet saved.</p>
          </li>
          <li className="relative">
            <span aria-hidden="true" className="absolute top-1.5 -left-[1.3rem] size-2 rounded-full bg-olive" />
            <p className="font-mono text-[0.6875rem] text-foreground/75">charge.dispute.closed</p>
            <div className="mt-1.5 flex flex-wrap items-center gap-2">
              <Stamp tone="olive" className="rotate-[1.5deg]">
                Won
              </Stamp>
              <span className="tabular font-mono text-sm text-foreground">$184.00</span>
            </div>
            <p className="mt-1.5 text-xs text-foreground/80">Counted in the win rate for product_not_received.</p>
          </li>
        </ol>
      </MockCard>
    </div>
  );
}
