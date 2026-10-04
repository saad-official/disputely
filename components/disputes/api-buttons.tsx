"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FlaskConical, Loader2, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { readApiResult } from "@/components/app/action-result";
import { FormMessage } from "@/components/app/form-message";
import { Button } from "@/components/ui/button";

type SyncResult = { synced: number; created: number; closed: number; failed: number };

/** POST /api/disputes/sync, then refresh the page's server data. */
export function SyncButton({ variant = "outline", label = "Sync now" }: { variant?: "outline" | "default" | "secondary"; label?: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [, startTransition] = useTransition();

  async function sync() {
    setPending(true);
    try {
      const result = await readApiResult<SyncResult>(await fetch("/api/disputes/sync", { method: "POST" }));
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      const { synced, created, closed, failed } = result.data;
      toast.success(
        synced === 0
          ? "Stripe has no disputes on this account yet."
          : `Synced ${synced} ${synced === 1 ? "dispute" : "disputes"}${created ? `, ${created} new` : ""}${closed ? `, ${closed} closed` : ""}.`,
        failed ? { description: `${failed} could not be read; they will be retried on the next sync.` } : undefined,
      );
      startTransition(() => router.refresh());
    } catch {
      toast.error("Could not reach the server. Check your connection and try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <Button variant={variant} onClick={sync} disabled={pending} aria-busy={pending}>
      {pending ? <Loader2 className="animate-spin" aria-hidden /> : <RefreshCw aria-hidden />}
      {pending ? "Syncing" : label}
    </Button>
  );
}

type DemoResult = { created: boolean; disputes: number; pending: string[]; errors: string[] };

/**
 * POST /api/demo: creates three real Stripe test disputes for the fictional
 * Larkspur Goods (takes up to ~30 s while Stripe opens them).
 */
export function CreateDemoButton({ disabled = false }: { disabled?: boolean }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<{ error: string; upgradeUrl?: string } | null>(null);
  const [, startTransition] = useTransition();

  async function create() {
    setPending(true);
    setError(null);
    try {
      const result = await readApiResult<DemoResult>(await fetch("/api/demo", { method: "POST" }));
      if (!result.ok) {
        setError(result);
        return;
      }
      const { created, disputes, pending: waiting } = result.data;
      if (!created) toast.info(`Demo disputes already exist (${disputes}).`);
      else
        toast.success(`Created ${disputes} test ${disputes === 1 ? "dispute" : "disputes"} for Larkspur Goods.`, {
          description: waiting.length
            ? `Stripe is still opening ${waiting.join(", ")}; press Sync in a minute.`
            : "Packets are assembled. Open one to review it.",
        });
      startTransition(() => router.refresh());
    } catch {
      setError({ error: "Could not reach the server. Check your connection and try again." });
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="grid gap-2">
      <Button onClick={create} disabled={pending || disabled} aria-busy={pending}>
        {pending ? <Loader2 className="animate-spin" aria-hidden /> : <FlaskConical aria-hidden />}
        {pending ? "Creating test disputes (about 20 s)" : "Create demo disputes"}
      </Button>
      <FormMessage error={error?.error} upgradeUrl={error?.upgradeUrl} />
    </div>
  );
}

export function ConnectStripeLink() {
  return (
    <Button asChild>
      <Link href="/settings#stripe">Connect Stripe</Link>
    </Button>
  );
}
