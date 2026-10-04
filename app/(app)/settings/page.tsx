import type { Metadata } from "next";
import { PageHeader } from "@/components/app/page-header";
import { ClearDemoButton, ProfileForm, RemindersForm, StripeConnectionForm } from "@/components/settings/settings-forms";
import { requireOrgContext } from "@/lib/auth/session";
import * as disputesRepo from "@/lib/db/repositories/disputes";
import * as organizationsRepo from "@/lib/db/repositories/organizations";
import { formatDate } from "@/lib/format";
import { limitsFor } from "@/lib/services/plan-limits";
import { connectedKeyMode, liveKeysAllowed, REQUIRED_KEY_PERMISSIONS } from "@/lib/services/stripe-connection";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Settings" };

function Panel({ id, title, description, children, tone }: { id: string; title: string; description?: React.ReactNode; children: React.ReactNode; tone?: "danger" }) {
  return (
    <section
      id={id}
      aria-labelledby={`${id}-title`}
      className={cn("scroll-mt-20 rounded-lg bg-card p-5 shadow-card ring-1 sm:p-6", tone === "danger" ? "ring-oxide-ink/40" : "ring-foreground/10")}
    >
      <h2 id={`${id}-title`} className="text-lg">
        {title}
      </h2>
      {description ? <div className="mt-1 mb-5 max-w-2xl text-sm text-muted-foreground">{description}</div> : <div className="mb-5" />}
      {children}
    </section>
  );
}

function timezones(current: string): string[] {
  let zones: string[] = [];
  try {
    zones = Intl.supportedValuesOf("timeZone");
  } catch {
    zones = [];
  }
  return [...new Set(["UTC", current, ...zones])];
}

export default async function SettingsPage() {
  const { org, role } = await requireOrgContext();
  const isOwner = role === "owner";
  const mode = connectedKeyMode(org);
  const hasKey = Boolean(org.stripeRestrictedKeyCiphertext);
  const [demo, ownerEmail] = await Promise.all([disputesRepo.listDemo(org.id), organizationsRepo.getOwnerEmail(org.id)]);

  return (
    <>
      <PageHeader title="Settings" description="Your Stripe connection, store profile and deadline reminders." />
      <div className="grid gap-6">
        <Panel
          id="stripe"
          title="Stripe connection"
          description={
            <>
              In Stripe, open <span className="font-medium text-foreground">Developers → API keys → Create restricted key</span>,
              grant exactly these permissions, and paste the key (<span className="font-mono">rk_…</span>) here. It is verified
              with one read call and stored encrypted; Disputely never shows it again. Secret keys (
              <span className="font-mono">sk_…</span>) are refused.
              {liveKeysAllowed() ? null : " This deployment accepts test-mode keys only."}
            </>
          }
        >
          <div className="mb-5 overflow-x-auto rounded-md ring-1 ring-foreground/10">
            <table className="w-full min-w-[30rem] text-sm">
              <caption className="sr-only">Restricted key permissions</caption>
              <thead>
                <tr className="border-b border-border bg-secondary/60 text-left text-xs text-foreground/70">
                  <th scope="col" className="px-3 py-2 font-semibold">Resource</th>
                  <th scope="col" className="px-3 py-2 font-semibold">Permission</th>
                  <th scope="col" className="px-3 py-2 font-semibold">Why</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {REQUIRED_KEY_PERMISSIONS.map((p) => (
                  <tr key={p.resource}>
                    <td className="px-3 py-2 font-medium">{p.resource}</td>
                    <td className={cn("px-3 py-2 font-mono text-xs", p.access === "Write" ? "text-oxide-ink" : "text-foreground/80")}>{p.access}</td>
                    <td className="px-3 py-2 text-muted-foreground">{p.why}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="border-t border-border px-3 py-2 text-xs text-muted-foreground">Leave every other resource at None.</p>
          </div>
          <StripeConnectionForm
            view={{
              connected: hasKey,
              label: org.stripeAccountLabel,
              connectedAt: org.stripeKeyConnectedAt ? formatDate(org.stripeKeyConnectedAt, org.timezone) : null,
              mode,
              unreadable: hasKey && mode === null,
            }}
            isOwner={isOwner}
            liveAllowed={liveKeysAllowed()}
          />
        </Panel>

        <Panel id="profile" title="Store profile">
          <ProfileForm name={org.name} timezone={org.timezone} timezones={timezones(org.timezone)} />
        </Panel>

        <Panel id="reminders" title="Deadline reminders">
          <RemindersForm enabled={org.remindersEnabled} email={org.reminderEmail} ownerEmail={ownerEmail} pro={limitsFor(org.plan).reminders} />
        </Panel>

        <Panel
          id="danger"
          title="Danger zone"
          tone="danger"
          description="Remove the Larkspur Goods demo disputes, their packets, and the demo shipments, messages and library items. Your own data is not touched."
        >
          <ClearDemoButton demoCount={demo.length} isOwner={isOwner} />
        </Panel>
      </div>
    </>
  );
}
