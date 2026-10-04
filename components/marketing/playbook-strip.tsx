import { cn } from "@/lib/utils";
import { type Reason, ReasonChip } from "./mocks/parts";

const playbooks: { reason: Reason; claim: string; needs: string; fields: string[] }[] = [
  {
    reason: "fraudulent",
    claim: "The cardholder says they did not make the purchase.",
    needs: "Proof the buyer was the cardholder.",
    fields: ["billing_address", "customer_purchase_ip", "shipping_address", "access_activity_log"],
  },
  {
    reason: "product_not_received",
    claim: "They paid and say nothing arrived.",
    needs: "Carrier, tracking and the delivery scan.",
    fields: ["shipping_carrier", "shipping_tracking_number", "shipping_date", "shipping_documentation"],
  },
  {
    reason: "product_unacceptable",
    claim: "It arrived, but they say it was faulty or not as described.",
    needs: "What you described, your refund policy and where they saw it.",
    fields: ["product_description", "refund_policy", "refund_policy_disclosure", "customer_communication"],
  },
  {
    reason: "subscription_canceled",
    claim: "They say they cancelled before the charge.",
    needs: "The cancellation terms they accepted, and use after the date they claim.",
    fields: ["cancellation_policy", "cancellation_policy_disclosure", "cancellation_rebuttal", "access_activity_log"],
  },
  {
    reason: "duplicate",
    claim: "They say one purchase was charged twice.",
    needs: "The other charge, and why the two are separate.",
    fields: ["duplicate_charge_id", "duplicate_charge_explanation", "duplicate_charge_documentation"],
  },
  {
    reason: "credit_not_processed",
    claim: "They say a refund you promised never came.",
    needs: "Your refund terms and why this order did not qualify.",
    fields: ["refund_policy", "refund_policy_disclosure", "refund_refusal_explanation", "customer_communication"],
  },
  {
    reason: "unrecognized",
    claim: "They do not recognise the charge on their statement.",
    needs: "A receipt and proof the account holder received it.",
    fields: ["customer_name", "customer_email_address", "receipt", "shipping_documentation"],
  },
  {
    reason: "general",
    claim: "Any reason that does not fit the others.",
    needs: "A clear account of the purchase and what was said.",
    fields: ["receipt", "customer_communication", "uncategorized_text"],
  },
];

/**
 * The eight Stripe reason codes, each with what the bank needs to see and the
 * Stripe evidence fields the playbook fills. Drawn as one ruled sheet rather
 * than separate cards.
 */
export function PlaybookStrip({ className }: { className?: string }) {
  return (
    <ul
      className={cn(
        "grid gap-px overflow-hidden rounded-lg bg-border ring-1 ring-border sm:grid-cols-2 lg:grid-cols-4",
        className,
      )}
    >
      {playbooks.map((p) => (
        <li key={p.reason} className="flex min-w-0 flex-col bg-card p-4 sm:p-5">
          <h3 className="font-sans text-base tracking-normal">
            <ReasonChip reason={p.reason} className="text-xs" />
          </h3>
          <p className="mt-3 text-sm leading-relaxed text-foreground/80">{p.claim}</p>
          <p className="mt-2 text-sm leading-snug font-semibold text-foreground">{p.needs}</p>
          <ul className="mt-3 space-y-1 border-t border-dashed border-foreground/20 pt-3" aria-label="Stripe evidence fields">
            {p.fields.map((f) => (
              <li key={f} className="font-mono text-[0.6875rem] leading-snug break-all text-foreground/75">
                {f}
              </li>
            ))}
          </ul>
        </li>
      ))}
    </ul>
  );
}
