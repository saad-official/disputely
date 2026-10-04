"use client";

import { useActionState, useEffect, useId, useState, useTransition } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { deleteLibraryItemAction, saveLibraryItemAction } from "@/app/(app)/library/actions";
import { initialFormState } from "@/components/app/action-result";
import { ConfirmDialog } from "@/components/app/confirm-dialog";
import { FormMessage } from "@/components/app/form-message";
import { SubmitButton } from "@/components/app/submit-button";
import { SourceTag } from "@/components/disputes/parts";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type { LibraryKind } from "@/lib/db/types";
import { KIND_INFO, KIND_ORDER } from "./library-kinds";

export type LibraryItemRow = {
  id: string;
  kind: LibraryKind;
  title: string;
  text: string;
  url: string | null;
  productLine: string | null;
  updatedAt: string;
};

function ItemDialog({
  open,
  onOpenChange,
  item,
  initialKind,
  canWrite,
  canUseProductLines,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  item: LibraryItemRow | null;
  initialKind: LibraryKind;
  canWrite: boolean;
  canUseProductLines: boolean;
}) {
  const [state, action] = useActionState(saveLibraryItemAction, initialFormState);
  const [kind, setKind] = useState<LibraryKind>(item?.kind ?? initialKind);
  const id = useId();

  useEffect(() => {
    if (state.ok) {
      toast.success(state.message ?? "Saved.");
      onOpenChange(false);
    }
  }, [state, onOpenChange]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="text-lg">{item ? "Edit library item" : "Add to the library"}</DialogTitle>
          <DialogDescription>{KIND_INFO[kind].hint}</DialogDescription>
        </DialogHeader>
        <form action={action} className="grid gap-4">
          {item ? <input type="hidden" name="id" value={item.id} /> : null}
          <input type="hidden" name="kind" value={kind} />
          <div className="grid gap-1.5">
            <Label htmlFor={`${id}-kind`}>Kind</Label>
            <Select value={kind} onValueChange={(v) => setKind(v as LibraryKind)}>
              <SelectTrigger id={`${id}-kind`} className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {KIND_ORDER.map((k) => (
                  <SelectItem key={k} value={k}>
                    {KIND_INFO[k].label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              Fills <span className="font-mono">{KIND_INFO[kind].fills}</span>
            </p>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor={`${id}-title`}>Title</Label>
            <Input id={`${id}-title`} name="title" required maxLength={200} defaultValue={item?.title ?? ""} placeholder={kind === "disclosure" ? "Refund policy shown at checkout" : "Returns & refunds"} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor={`${id}-text`}>{kind === "disclosure" ? "Where the customer saw it" : "Text"}</Label>
            <Textarea
              id={`${id}-text`}
              name="text"
              required
              rows={kind === "disclosure" ? 3 : 8}
              maxLength={50_000}
              defaultValue={item?.text ?? ""}
              placeholder={
                kind === "disclosure"
                  ? "The refund policy is linked directly above the Pay button, and the customer must tick “I agree to the returns policy” before paying."
                  : undefined
              }
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label htmlFor={`${id}-url`}>Published at (optional)</Label>
              <Input id={`${id}-url`} name="url" type="url" inputMode="url" defaultValue={item?.url ?? ""} placeholder="https://" />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor={`${id}-line`}>Product line (Pro, optional)</Label>
              <Input
                id={`${id}-line`}
                name="productLine"
                maxLength={120}
                defaultValue={item?.productLine ?? ""}
                disabled={!canUseProductLines}
                placeholder={canUseProductLines ? "e.g. home-textiles" : "Pro feature"}
              />
            </div>
          </div>
          <FormMessage error={state.error} upgradeUrl={state.upgradeUrl} />
          <div className="flex flex-wrap justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <SubmitButton pendingLabel="Saving" disabled={!canWrite}>
              {item ? "Save changes" : "Add item"}
            </SubmitButton>
          </div>
          {!canWrite ? <FormMessage error="Saving policies to the library is a Pro feature." upgradeUrl="/billing" /> : null}
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function PoliciesPanel({
  items,
  initialNewKind,
  canWrite,
  canUseProductLines,
}: {
  items: LibraryItemRow[];
  /** Opens the add dialog for this kind (deep link from a packet's missing list). */
  initialNewKind: LibraryKind | null;
  canWrite: boolean;
  canUseProductLines: boolean;
}) {
  const [dialog, setDialog] = useState<{ item: LibraryItemRow | null; kind: LibraryKind; n: number } | null>(
    initialNewKind ? { item: null, kind: initialNewKind, n: 0 } : null,
  );
  const [deleting, setDeleting] = useState<LibraryItemRow | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const byKind = KIND_ORDER.map((kind) => ({ kind, items: items.filter((i) => i.kind === kind) })).filter((g) => g.items.length > 0);

  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-2xl text-sm text-muted-foreground">
          The assembler takes the newest item of each kind, preferring one tagged with the dispute&apos;s product line. A
          disclosure says where the customer saw a policy before paying; banks weigh it as heavily as the policy itself.
        </p>
        <Button onClick={() => setDialog({ item: null, kind: "refund_policy", n: Date.now() })}>
          <Plus aria-hidden />
          Add item
        </Button>
      </div>

      {byKind.length === 0 ? (
        <div className="rounded-xl border border-dashed bg-card/60 px-6 py-10 text-center text-sm text-muted-foreground">
          Nothing saved yet. Start with your refund policy and where customers see it at checkout.
        </div>
      ) : (
        byKind.map((group) => (
          <section key={group.kind} aria-labelledby={`kind-${group.kind}`} className="grid gap-2">
            <h3 id={`kind-${group.kind}`} className="text-base">
              {KIND_INFO[group.kind].label}
              <span className="ml-2 font-mono text-xs font-normal text-foreground/60">{KIND_INFO[group.kind].fills}</span>
            </h3>
            <ul className="divide-y divide-border rounded-lg bg-card shadow-card ring-1 ring-foreground/10">
              {group.items.map((item) => (
                <li key={item.id} className="grid gap-2 px-4 py-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-medium">{item.title}</p>
                      <p className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                        {item.productLine ? <SourceTag>{item.productLine}</SourceTag> : <span>All product lines</span>}
                        {item.url ? (
                          <a href={item.url} target="_blank" rel="noreferrer noopener" className="max-w-64 truncate underline underline-offset-3">
                            {item.url}
                          </a>
                        ) : null}
                      </p>
                    </div>
                    <span className="flex gap-1">
                      <Button variant="ghost" size="icon-sm" aria-label={`Edit ${item.title}`} onClick={() => setDialog({ item, kind: item.kind, n: Date.now() })}>
                        <Pencil aria-hidden />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={`Delete ${item.title}`}
                        onClick={() => {
                          setDeleteError(null);
                          setDeleting(item);
                        }}
                      >
                        <Trash2 aria-hidden />
                      </Button>
                    </span>
                  </div>
                  <p className="line-clamp-4 text-sm leading-relaxed whitespace-pre-wrap text-foreground/85">{item.text}</p>
                </li>
              ))}
            </ul>
          </section>
        ))
      )}

      {dialog ? (
        <ItemDialog
          key={`${dialog.item?.id ?? "new"}-${dialog.n}`}
          open
          onOpenChange={(open) => (open ? undefined : setDialog(null))}
          item={dialog.item}
          initialKind={dialog.kind}
          canWrite={canWrite}
          canUseProductLines={canUseProductLines}
        />
      ) : null}
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => (open ? undefined : setDeleting(null))}
        title="Delete this item?"
        description={deleting ? `“${deleting.title}” will no longer be used in packets. Submitted packets keep what they sent.` : ""}
        confirmLabel="Delete"
        pendingLabel="Deleting"
        destructive
        pending={pending}
        error={deleteError}
        onConfirm={() => {
          if (!deleting) return;
          startTransition(async () => {
            const result = await deleteLibraryItemAction(deleting.id);
            if (result.ok) {
              toast.success("Deleted.");
              setDeleting(null);
            } else setDeleteError(result.error);
          });
        }}
      />
    </div>
  );
}
