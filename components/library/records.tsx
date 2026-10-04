"use client";

import { useActionState, useEffect, useId, useMemo, useRef, useState, useTransition } from "react";
import { Trash2 } from "lucide-react";
import { toast } from "sonner";
import { deleteMessageAction, deleteShipmentAction, saveMessagesAction, saveShipmentAction } from "@/app/(app)/library/actions";
import { initialFormState } from "@/components/app/action-result";
import { FormMessage } from "@/components/app/form-message";
import { SubmitButton } from "@/components/app/submit-button";
import { SourceTag } from "@/components/disputes/parts";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { parseTranscript } from "@/lib/domain/transcript";
import { formatDate, formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";

export type DisputeOption = { id: string; label: string; chargeId: string; email: string | null; customerName: string | null };

export type ShipmentRow = {
  id: string;
  chargeId: string;
  carrier: string | null;
  trackingNumber: string | null;
  shippedAt: string | null;
  deliveredAt: string | null;
  proofUrl: string | null;
};

export type MessageRow = {
  id: string;
  customerEmail: string;
  channel: string;
  occurredAt: string;
  direction: "inbound" | "outbound";
  body: string;
  disputeLabel: string | null;
};

function useToastOnSuccess(state: { ok?: boolean; message?: string }, after?: () => void) {
  const last = useRef(state);
  useEffect(() => {
    if (state !== last.current && state.ok) {
      toast.success(state.message ?? "Saved.");
      after?.();
    }
    last.current = state;
  }, [state, after]);
}

function DeleteButton({ label, run }: { label: string; run: () => Promise<{ ok: boolean; error?: string }> }) {
  const [pending, startTransition] = useTransition();
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      aria-label={label}
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          const result = await run();
          if (!result.ok) toast.error(result.error ?? "Could not delete it.");
        })
      }
    >
      <Trash2 aria-hidden />
    </Button>
  );
}

/* ------------------------------------------------------------------ */
/* Shipments                                                           */
/* ------------------------------------------------------------------ */

export function ShipmentsPanel({
  shipments,
  disputes,
  initialChargeId,
  timezone,
}: {
  shipments: ShipmentRow[];
  disputes: DisputeOption[];
  initialChargeId: string | null;
  timezone: string;
}) {
  const [state, action] = useActionState(saveShipmentAction, initialFormState);
  const formRef = useRef<HTMLFormElement>(null);
  const [chargeId, setChargeId] = useState(initialChargeId ?? "");
  useToastOnSuccess(state, () => formRef.current?.reset());
  const id = useId();
  const byCharge = new Map(disputes.map((d) => [d.chargeId, d]));

  return (
    <div className="grid gap-6">
      <form ref={formRef} action={action} className="grid gap-4 rounded-lg bg-card p-4 shadow-card ring-1 ring-foreground/10 sm:grid-cols-2 lg:grid-cols-3">
        <div className="grid gap-1.5 sm:col-span-2 lg:col-span-1">
          <Label htmlFor={`${id}-charge`}>Stripe charge id</Label>
          <Input
            id={`${id}-charge`}
            name="chargeId"
            required
            value={chargeId}
            onChange={(e) => setChargeId(e.target.value.trim())}
            placeholder="ch_..."
            className="font-mono"
            list={`${id}-charges`}
            autoComplete="off"
          />
          <datalist id={`${id}-charges`}>
            {disputes.map((d) => (
              <option key={d.id} value={d.chargeId}>
                {d.label}
              </option>
            ))}
          </datalist>
          <p className="text-xs text-muted-foreground">{byCharge.get(chargeId)?.label ?? "One shipment record per charge; saving again replaces it."}</p>
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor={`${id}-carrier`}>Carrier</Label>
          <Input id={`${id}-carrier`} name="carrier" placeholder="UPS, USPS, FedEx…" maxLength={80} />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor={`${id}-tracking`}>Tracking number</Label>
          <Input id={`${id}-tracking`} name="trackingNumber" className="font-mono" maxLength={80} />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor={`${id}-shipped`}>Shipped on</Label>
          <Input id={`${id}-shipped`} name="shippedAt" type="date" />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor={`${id}-delivered`}>Delivered on (optional)</Label>
          <Input id={`${id}-delivered`} name="deliveredAt" type="date" />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor={`${id}-proof`}>Proof of delivery link (optional)</Label>
          <Input id={`${id}-proof`} name="proofUrl" type="url" inputMode="url" placeholder="https://" />
        </div>
        <div className="grid gap-2 sm:col-span-2 lg:col-span-3">
          <FormMessage error={state.error} upgradeUrl={state.upgradeUrl} />
          <div>
            <SubmitButton pendingLabel="Saving">Save shipment</SubmitButton>
          </div>
        </div>
      </form>

      {shipments.length === 0 ? (
        <p className="text-sm text-muted-foreground">No shipment records yet.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg bg-card shadow-card ring-1 ring-foreground/10">
          <table className="w-full min-w-[40rem] text-sm">
            <caption className="sr-only">Shipment records</caption>
            <thead>
              <tr className="border-b border-border text-left text-xs text-foreground/70">
                <th scope="col" className="px-4 py-2.5 font-semibold">Charge</th>
                <th scope="col" className="px-3 py-2.5 font-semibold">Carrier</th>
                <th scope="col" className="px-3 py-2.5 font-semibold">Tracking</th>
                <th scope="col" className="px-3 py-2.5 font-semibold">Shipped</th>
                <th scope="col" className="px-3 py-2.5 font-semibold">Delivered</th>
                <th scope="col" className="px-3 py-2.5">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {shipments.map((s) => (
                <tr key={s.id}>
                  <td className="px-4 py-2.5">
                    <span className="font-mono text-xs">{s.chargeId}</span>
                    {byCharge.get(s.chargeId) ? <span className="block text-xs text-muted-foreground">{byCharge.get(s.chargeId)!.label}</span> : null}
                  </td>
                  <td className="px-3 py-2.5">{s.carrier ?? "—"}</td>
                  <td className="px-3 py-2.5 font-mono text-xs break-all">{s.trackingNumber ?? "—"}</td>
                  <td className="px-3 py-2.5 font-mono text-xs whitespace-nowrap">{formatDate(s.shippedAt, timezone)}</td>
                  <td className="px-3 py-2.5 font-mono text-xs whitespace-nowrap">
                    {s.proofUrl ? (
                      <a href={s.proofUrl} target="_blank" rel="noreferrer noopener" className="underline underline-offset-3">
                        {s.deliveredAt ? formatDate(s.deliveredAt, timezone) : "proof"}
                      </a>
                    ) : (
                      formatDate(s.deliveredAt, timezone)
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-right">
                    <DeleteButton label={`Delete shipment for ${s.chargeId}`} run={() => deleteShipmentAction(s.id)} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Message logs                                                        */
/* ------------------------------------------------------------------ */

const CHANNELS = ["email", "chat", "phone", "sms", "other"] as const;

export function MessagesPanel({
  messages,
  disputes,
  initialEmail,
  initialDisputeId,
  timezone,
  merchantName,
}: {
  messages: MessageRow[];
  disputes: DisputeOption[];
  initialEmail: string | null;
  initialDisputeId: string | null;
  timezone: string;
  merchantName: string;
}) {
  const [state, action] = useActionState(saveMessagesAction, initialFormState);
  const [transcript, setTranscript] = useState("");
  const [channel, setChannel] = useState<string>("email");
  const initialDispute = disputes.find((d) => d.id === initialDisputeId) ?? null;
  const [disputeId, setDisputeId] = useState<string>(initialDispute?.id ?? "none");
  const [email, setEmail] = useState(initialEmail ?? initialDispute?.email ?? "");
  useToastOnSuccess(state, () => setTranscript(""));
  const id = useId();
  const linked = disputes.find((d) => d.id === disputeId) ?? null;
  const preview = useMemo(
    () => parseTranscript(transcript, { timeZone: timezone, customerName: linked?.customerName ?? null, merchantName }),
    [transcript, timezone, linked, merchantName],
  );

  return (
    <div className="grid gap-6">
      <form action={action} className="grid gap-4 rounded-lg bg-card p-4 shadow-card ring-1 ring-foreground/10">
        <input type="hidden" name="channel" value={channel} />
        <input type="hidden" name="disputeId" value={disputeId === "none" ? "" : disputeId} />
        <div className="grid gap-4 sm:grid-cols-3">
          <div className="grid gap-1.5">
            <Label htmlFor={`${id}-dispute`}>Dispute (optional)</Label>
            <Select
              value={disputeId}
              onValueChange={(v) => {
                setDisputeId(v);
                const d = disputes.find((x) => x.id === v);
                if (d?.email) setEmail(d.email);
              }}
            >
              <SelectTrigger id={`${id}-dispute`} className="w-full min-w-0 overflow-hidden">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Not linked</SelectItem>
                {disputes.map((d) => (
                  <SelectItem key={d.id} value={d.id}>
                    {d.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor={`${id}-email`}>Customer email</Label>
            <Input id={`${id}-email`} name="customerEmail" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor={`${id}-channel`}>Channel</Label>
            <Select value={channel} onValueChange={setChannel}>
              <SelectTrigger id={`${id}-channel`} className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CHANNELS.map((c) => (
                  <SelectItem key={c} value={c}>
                    {c}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor={`${id}-transcript`}>Conversation</Label>
          <Textarea
            id={`${id}-transcript`}
            name="transcript"
            rows={8}
            value={transcript}
            onChange={(e) => setTranscript(e.target.value)}
            className="font-mono text-xs"
            placeholder={"2026-09-14 10:22 Customer: Where is my order?\n2026-09-14 10:25 Me: It shipped yesterday with UPS, tracking 1Z999…"}
          />
          <p className="text-xs text-muted-foreground">
            One message per line, starting with a date, a time and who spoke. Times are read in {timezone}. “Customer” or the
            customer&apos;s name counts as from them; “Me”, “Support” or your store name as from you.
          </p>
        </div>

        {transcript.trim() ? (
          <div className="rounded-md bg-secondary p-3">
            <p className="text-xs font-semibold text-foreground/75">
              Preview: {preview.messages.length} {preview.messages.length === 1 ? "message" : "messages"}
              {preview.skipped.length ? `, ${preview.skipped.length} ${preview.skipped.length === 1 ? "line" : "lines"} skipped` : ""}
            </p>
            <ol className="mt-2 grid max-h-72 gap-2 overflow-y-auto">
              {preview.messages.map((m, i) => (
                <li key={i} className={cn("rounded-md px-3 py-2 text-sm ring-1", m.direction === "inbound" ? "bg-card ring-foreground/10" : "ml-6 bg-steel/8 ring-steel/25")}>
                  <span className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    <SourceTag>{m.direction === "inbound" ? "customer" : "you"}</SourceTag>
                    <span>{m.speaker}</span>
                    <span className="font-mono">{formatDateTime(m.occurredAt, timezone)}</span>
                  </span>
                  <span className="mt-1 block whitespace-pre-wrap">{m.body}</span>
                </li>
              ))}
            </ol>
          </div>
        ) : null}

        <FormMessage error={state.error} upgradeUrl={state.upgradeUrl} />
        <div>
          <SubmitButton pendingLabel="Saving" disabled={preview.messages.length === 0}>
            Save {preview.messages.length || ""} {preview.messages.length === 1 ? "message" : "messages"}
          </SubmitButton>
        </div>
      </form>

      {messages.length === 0 ? (
        <p className="text-sm text-muted-foreground">No messages saved yet.</p>
      ) : (
        <ul className="divide-y divide-border rounded-lg bg-card shadow-card ring-1 ring-foreground/10">
          {messages.map((m) => (
            <li key={m.id} className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 px-4 py-2.5">
              <div className="min-w-0">
                <p className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <SourceTag>{m.direction === "inbound" ? "customer" : "you"}</SourceTag>
                  <span className="truncate">{m.customerEmail}</span>
                  <span>{m.channel}</span>
                  <span className="font-mono">{formatDateTime(m.occurredAt, timezone)}</span>
                  {m.disputeLabel ? <span className="font-mono">{m.disputeLabel}</span> : null}
                </p>
                <p className="mt-1 line-clamp-3 text-sm whitespace-pre-wrap">{m.body}</p>
              </div>
              <DeleteButton label="Delete message" run={() => deleteMessageAction(m.id)} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
