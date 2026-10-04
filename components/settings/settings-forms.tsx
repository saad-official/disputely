"use client";

import { useActionState, useEffect, useId, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CircleCheck, KeyRound } from "lucide-react";
import { toast } from "sonner";
import { connectStripeAction, disconnectStripeAction, updateProfileAction, updateRemindersAction } from "@/app/(app)/settings/actions";
import { initialFormState, readApiResult, type FormActionState } from "@/components/app/action-result";
import { ConfirmDialog } from "@/components/app/confirm-dialog";
import { FormMessage } from "@/components/app/form-message";
import { SubmitButton } from "@/components/app/submit-button";
import { SourceTag } from "@/components/disputes/parts";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

function useSavedToast(state: FormActionState, after?: () => void) {
  const last = useRef(state);
  useEffect(() => {
    if (state !== last.current && state.ok) {
      toast.success(state.message ?? "Saved.");
      after?.();
    }
    last.current = state;
  }, [state, after]);
}

export type StripeConnectionView = {
  connected: boolean;
  label: string | null;
  connectedAt: string | null;
  mode: "test" | "live" | null;
  /** The stored key exists but cannot be decrypted (APP_ENCRYPTION_KEY changed). */
  unreadable: boolean;
};

export function StripeConnectionForm({ view, isOwner, liveAllowed }: { view: StripeConnectionView; isOwner: boolean; liveAllowed: boolean }) {
  const [state, action] = useActionState(connectStripeAction, initialFormState);
  const [replacing, setReplacing] = useState(!view.connected);
  const [confirm, setConfirm] = useState(false);
  const [disconnectError, setDisconnectError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);
  useSavedToast(state, () => {
    formRef.current?.reset();
    setReplacing(false);
  });
  const id = useId();

  return (
    <div className="grid gap-4">
      {view.connected ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-md bg-secondary px-4 py-3">
          <div className="flex min-w-0 items-start gap-2.5">
            <CircleCheck className="mt-0.5 size-4 shrink-0 text-olive" aria-hidden />
            <div className="min-w-0">
              <p className="text-sm font-medium">
                Connected <span className="font-mono text-xs">{view.label}</span>
              </p>
              <p className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                {view.mode ? <SourceTag>{view.mode} mode</SourceTag> : null}
                {view.connectedAt ? <span>since {view.connectedAt}</span> : null}
                {view.unreadable ? <span className="font-semibold text-oxide-ink">The stored key can no longer be read. Paste it again.</span> : null}
              </p>
            </div>
          </div>
          {isOwner ? (
            <div className="flex gap-2">
              {!replacing ? (
                <Button variant="outline" size="sm" onClick={() => setReplacing(true)}>
                  Replace key
                </Button>
              ) : null}
              <Button variant="destructive" size="sm" onClick={() => setConfirm(true)}>
                Disconnect
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}

      {replacing && isOwner ? (
        <form ref={formRef} action={action} className="grid gap-4" autoComplete="off">
          <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,14rem)]">
            <div className="grid gap-1.5">
              <Label htmlFor={`${id}-key`}>Restricted key</Label>
              <Input
                id={`${id}-key`}
                name="key"
                type="password"
                required
                autoComplete="off"
                spellCheck={false}
                placeholder={liveAllowed ? "rk_test_… or rk_live_…" : "rk_test_…"}
                className="font-mono"
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor={`${id}-label`}>Label (optional)</Label>
              <Input id={`${id}-label`} name="label" maxLength={80} placeholder="Main store" />
            </div>
          </div>
          <FormMessage error={state.error} />
          <div className="flex flex-wrap gap-2">
            <SubmitButton pendingLabel="Checking with Stripe">
              <KeyRound aria-hidden />
              {view.connected ? "Replace key" : "Connect"}
            </SubmitButton>
            {view.connected ? (
              <Button type="button" variant="ghost" onClick={() => setReplacing(false)}>
                Cancel
              </Button>
            ) : null}
          </div>
        </form>
      ) : null}
      {!isOwner ? <p className="text-sm text-muted-foreground">Only the workspace owner can change the Stripe connection.</p> : null}

      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        title="Disconnect Stripe?"
        description="The encrypted key is deleted. Synced disputes and packets stay, but syncing, uploads and submission stop until you connect again."
        confirmLabel="Disconnect"
        pendingLabel="Disconnecting"
        destructive
        pending={pending}
        error={disconnectError}
        onConfirm={() =>
          startTransition(async () => {
            const result = await disconnectStripeAction();
            if (result.ok) {
              toast.success(result.message ?? "Disconnected.");
              setConfirm(false);
              setReplacing(true);
            } else setDisconnectError(result.error);
          })
        }
      />
    </div>
  );
}

export function ProfileForm({ name, timezone, timezones }: { name: string; timezone: string; timezones: string[] }) {
  const [state, action] = useActionState(updateProfileAction, initialFormState);
  useSavedToast(state);
  const id = useId();
  return (
    <form action={action} className="grid gap-4 sm:grid-cols-2">
      <div className="grid gap-1.5">
        <Label htmlFor={`${id}-name`}>Store name</Label>
        <Input id={`${id}-name`} name="name" required maxLength={120} defaultValue={name} />
        <p className="text-xs text-muted-foreground">Used in packets, statements and the PDF cover.</p>
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor={`${id}-tz`}>Time zone</Label>
        <select
          id={`${id}-tz`}
          name="timezone"
          defaultValue={timezone}
          className="h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          {timezones.map((tz) => (
            <option key={tz} value={tz}>
              {tz}
            </option>
          ))}
        </select>
        <p className="text-xs text-muted-foreground">Deadlines, pasted conversations and reminder emails use it.</p>
      </div>
      <div className="grid gap-2 sm:col-span-2">
        <FormMessage error={state.error} />
        <div>
          <SubmitButton pendingLabel="Saving">Save profile</SubmitButton>
        </div>
      </div>
    </form>
  );
}

export function RemindersForm({ enabled, email, ownerEmail, pro }: { enabled: boolean; email: string | null; ownerEmail: string | null; pro: boolean }) {
  const [state, action] = useActionState(updateRemindersAction, initialFormState);
  const [on, setOn] = useState(enabled);
  useSavedToast(state);
  const id = useId();
  return (
    <form action={action} className="grid gap-4">
      <input type="hidden" name="enabled" value={on ? "on" : "off"} />
      <div className="flex items-start gap-3">
        <Switch id={`${id}-on`} checked={on} onCheckedChange={setOn} />
        <div>
          <Label htmlFor={`${id}-on`}>Email me 7, 3 and 1 day before a deadline</Label>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {pro ? "Sent by the daily job for every dispute that still needs a response." : "A Pro feature: the setting is kept and starts working when you upgrade."}
          </p>
        </div>
      </div>
      <div className="grid max-w-md gap-1.5">
        <Label htmlFor={`${id}-email`}>Send to</Label>
        <Input id={`${id}-email`} name="email" type="email" defaultValue={email ?? ""} placeholder={ownerEmail ?? "you@example.com"} />
        <p className="text-xs text-muted-foreground">Leave empty to use the owner&apos;s sign-in email.</p>
      </div>
      <FormMessage error={state.error} />
      <div>
        <SubmitButton pendingLabel="Saving">Save reminders</SubmitButton>
      </div>
    </form>
  );
}

export function ClearDemoButton({ demoCount, isOwner }: { demoCount: number; isOwner: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <>
      <Button variant="destructive" disabled={demoCount === 0 || !isOwner} onClick={() => setOpen(true)}>
        Clear demo data
      </Button>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title="Clear the demo data?"
        description={`Deletes the ${demoCount} Larkspur Goods demo ${demoCount === 1 ? "dispute" : "disputes"} with their packets, plus the demo shipments, messages and library items. The test objects in Stripe stay.`}
        confirmLabel="Clear demo data"
        pendingLabel="Clearing"
        destructive
        pending={pending}
        error={error}
        onConfirm={async () => {
          setPending(true);
          setError(null);
          try {
            const result = await readApiResult<{ disputes: number }>(await fetch("/api/demo", { method: "DELETE" }));
            if (!result.ok) {
              setError(result.error);
              return;
            }
            toast.success(`Removed ${result.data.disputes} demo ${result.data.disputes === 1 ? "dispute" : "disputes"}.`);
            setOpen(false);
            router.refresh();
          } catch {
            setError("Could not reach the server. Try again.");
          } finally {
            setPending(false);
          }
        }}
      />
    </>
  );
}
