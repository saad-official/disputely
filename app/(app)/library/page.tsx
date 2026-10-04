import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/app/page-header";
import { PoliciesPanel } from "@/components/library/policies";
import { MessagesPanel, ShipmentsPanel, type DisputeOption } from "@/components/library/records";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { requireOrgContext } from "@/lib/auth/session";
import * as disputesRepo from "@/lib/db/repositories/disputes";
import * as libraryRepo from "@/lib/db/repositories/library";
import * as messageLogsRepo from "@/lib/db/repositories/messageLogs";
import * as shipmentsRepo from "@/lib/db/repositories/shipments";
import { LIBRARY_KINDS } from "@/lib/db/schema";
import type { LibraryKind } from "@/lib/db/types";
import { formatMoney } from "@/lib/format";
import { limitsFor } from "@/lib/services/plan-limits";

export const metadata: Metadata = { title: "Library" };

const TABS = ["policies", "shipments", "messages"] as const;

function one(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function LibraryPage({ searchParams }: PageProps<"/library">) {
  const { org } = await requireOrgContext();
  const sp = await searchParams;
  const tabParam = one(sp.tab);
  const newKind = one(sp.new);
  const initialNewKind = newKind && (LIBRARY_KINDS as readonly string[]).includes(newKind) ? (newKind as LibraryKind) : null;
  const tab = (TABS as readonly string[]).includes(tabParam ?? "") ? (tabParam as (typeof TABS)[number]) : "policies";
  const limits = limitsFor(org.plan);

  const [items, shipments, messages, disputes] = await Promise.all([
    libraryRepo.list(org.id),
    shipmentsRepo.listRecent(org.id, 100),
    messageLogsRepo.listRecent(org.id, 100),
    disputesRepo.listAll(org.id, { limit: 100 }),
  ]);
  const options: DisputeOption[] = disputes.items.map((d) => ({
    id: d.id,
    label: `${d.customer.name ?? d.customer.email ?? "Unknown"} · ${formatMoney(d.amountCents, d.currency)}${d.charge.orderRef ? ` · ${d.charge.orderRef}` : ""}`,
    chargeId: d.chargeId,
    email: d.customer.email ?? null,
    customerName: d.customer.name ?? null,
  }));
  const disputeLabels = new Map(disputes.items.map((d) => [d.id, d.stripeDisputeId]));

  return (
    <>
      <PageHeader
        title="Library"
        description="Your policies, where customers saw them, and the records Disputely draws on: shipments and customer messages. Packets pick these up when they are built or rebuilt."
      />
      {!limits.library ? (
        <p className="mb-6 rounded-lg bg-steel/8 px-4 py-3 text-sm ring-1 ring-steel/30">
          Saving policies is a Pro feature; on Free, enter them on each packet instead. Shipments and messages are free.{" "}
          <Link href="/billing" className="font-semibold underline underline-offset-3">
            See plans
          </Link>
        </p>
      ) : null}
      <Tabs defaultValue={tab} id="records" className="scroll-mt-20">
        <TabsList aria-label="Library sections">
          <TabsTrigger value="policies">Policies ({items.length})</TabsTrigger>
          <TabsTrigger value="shipments">Shipments ({shipments.length})</TabsTrigger>
          <TabsTrigger value="messages">Messages ({messages.length})</TabsTrigger>
        </TabsList>
        <TabsContent value="policies" id="policies" className="mt-4 scroll-mt-20">
          <PoliciesPanel
            items={items.map((i) => ({
              id: i.id,
              kind: i.kind,
              title: i.title,
              text: i.text,
              url: i.url,
              productLine: i.productLine,
              updatedAt: i.updatedAt.toISOString(),
            }))}
            initialNewKind={initialNewKind}
            canWrite={limits.library}
            canUseProductLines={limits.productLineTemplates}
          />
        </TabsContent>
        <TabsContent value="shipments" className="mt-4">
          <ShipmentsPanel
            shipments={shipments.map((s) => ({
              id: s.id,
              chargeId: s.chargeId,
              carrier: s.carrier,
              trackingNumber: s.trackingNumber,
              shippedAt: s.shippedAt?.toISOString() ?? null,
              deliveredAt: s.deliveredAt?.toISOString() ?? null,
              proofUrl: s.proofUrl,
            }))}
            disputes={options}
            initialChargeId={one(sp.charge) ?? null}
            timezone={org.timezone}
          />
        </TabsContent>
        <TabsContent value="messages" className="mt-4">
          <MessagesPanel
            messages={messages.map((m) => ({
              id: m.id,
              customerEmail: m.customerEmail,
              channel: m.channel,
              occurredAt: m.occurredAt.toISOString(),
              direction: m.direction,
              body: m.body,
              disputeLabel: m.disputeId ? (disputeLabels.get(m.disputeId) ?? null) : null,
            }))}
            disputes={options}
            initialEmail={one(sp.email) ?? null}
            initialDisputeId={one(sp.dispute) ?? null}
            timezone={org.timezone}
            merchantName={org.name}
          />
        </TabsContent>
      </Tabs>
    </>
  );
}
