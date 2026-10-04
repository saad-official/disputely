"use client";

import { useActionState } from "react";
import { ArrowUpRight, Loader2 } from "lucide-react";
import { openPortal, startCheckout } from "@/app/(app)/billing/actions";
import { initialFormState } from "@/components/app/action-result";
import { FormMessage } from "@/components/app/form-message";
import { Button } from "@/components/ui/button";

function StripeButton({
  action,
  field,
  label,
  pendingLabel,
  disabled,
  variant,
}: {
  action: typeof startCheckout;
  field: { name: string; value: string };
  label: string;
  pendingLabel: string;
  disabled: boolean;
  variant: "default" | "outline";
}) {
  const [state, formAction, pending] = useActionState(action, initialFormState);
  return (
    <form action={formAction} className="grid gap-2">
      <input type="hidden" name={field.name} value={field.value} />
      <Button type="submit" size="lg" variant={variant} disabled={disabled || pending} className="h-10 w-full sm:w-auto">
        {pending ? (
          <>
            <Loader2 className="animate-spin" aria-hidden />
            {pendingLabel}
          </>
        ) : (
          <>
            {label}
            <ArrowUpRight aria-hidden />
          </>
        )}
      </Button>
      <FormMessage error={state.ok ? null : state.error} />
    </form>
  );
}

export function UpgradeButton({ disabled }: { disabled: boolean }) {
  return (
    <StripeButton
      action={startCheckout}
      field={{ name: "plan", value: "pro" }}
      label="Upgrade to Pro"
      pendingLabel="Opening Stripe Checkout"
      disabled={disabled}
      variant="default"
    />
  );
}

export function ManageButton({ disabled }: { disabled: boolean }) {
  return (
    <StripeButton
      action={openPortal}
      field={{ name: "intent", value: "manage" }}
      label="Manage subscription"
      pendingLabel="Opening Stripe"
      disabled={disabled}
      variant="outline"
    />
  );
}
