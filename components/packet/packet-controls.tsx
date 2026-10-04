"use client";

import { useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import { Download, Eye, FileText, Hammer, Loader2, PencilLine, Sparkles, Trash2, Upload, X } from "lucide-react";
import { toast } from "sonner";
import { FormMessage } from "@/components/app/form-message";
import { SourceTag } from "@/components/disputes/parts";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { EVIDENCE_FIELD_META, fieldKind } from "@/lib/domain/fields";
import { EVIDENCE_FIELD_KEYS, type EvidenceFieldKey } from "@/lib/domain/types";
import { cn } from "@/lib/utils";
import { jsonInit, useApi } from "./use-api";

/* ------------------------------------------------------------------ */
/* Build / narrative                                                   */
/* ------------------------------------------------------------------ */

export function BuildPacketButton({ disputeId, label = "Rebuild packet", variant = "outline", disabled }: {
  disputeId: string;
  label?: string;
  variant?: "outline" | "default";
  disabled?: boolean;
}) {
  const { call, pending, error } = useApi();
  return (
    <div className="grid gap-2">
      <Button
        variant={variant}
        disabled={pending || disabled}
        onClick={async () => {
          const data = await call<{ completeness: number }>(`/api/disputes/${disputeId}/packet`, jsonInit("POST", {}));
          if (data) toast.success(`Packet assembled: ${data.completeness}% complete.`);
        }}
      >
        {pending ? <Loader2 className="animate-spin" aria-hidden /> : <Hammer aria-hidden />}
        {pending ? "Assembling" : label}
      </Button>
      <FormMessage error={error?.error} upgradeUrl={error?.upgradeUrl} />
    </div>
  );
}

export function GenerateNarrativeButton({ disputeId, hasNarrative, disabled }: { disputeId: string; hasNarrative: boolean; disabled?: boolean }) {
  const { call, pending, error } = useApi();
  return (
    <div className="grid justify-items-start gap-2">
      <Button
        variant={hasNarrative ? "outline" : "default"}
        disabled={pending || disabled}
        onClick={async () => {
          const data = await call<{ verified: number; removed: number; ok: boolean }>(`/api/disputes/${disputeId}/narrative`, jsonInit("POST"));
          if (data) {
            if (data.ok) toast.success(`Statement written: ${data.verified} facts verified${data.removed ? `, ${data.removed} claims removed` : ""}.`);
            else toast.warning("The model's statement failed the fact check. Add the missing evidence, then regenerate.");
          }
        }}
      >
        {pending ? <Loader2 className="animate-spin" aria-hidden /> : <Sparkles aria-hidden />}
        {pending ? "Writing and fact-checking" : hasNarrative ? "Regenerate statement" : "Write statement"}
      </Button>
      <FormMessage error={error?.error} upgradeUrl={error?.upgradeUrl} />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Evidence fields with inline overrides                               */
/* ------------------------------------------------------------------ */

export type FieldRowData = {
  key: EvidenceFieldKey;
  value: string;
  source: string;
  sourceDetail: string | null;
  override: boolean;
  /** File-backed (an uploaded attachment satisfies it). */
  file: boolean;
  role: "required" | "recommended" | "extra";
};

const LONG = 360;

function ValueCell({ value }: { value: string }) {
  const [open, setOpen] = useState(false);
  if (value.length <= LONG) return <p className="text-sm leading-relaxed break-words whitespace-pre-wrap">{value}</p>;
  return (
    <div>
      <p className="text-sm leading-relaxed break-words whitespace-pre-wrap">{open ? value : `${value.slice(0, LONG).trimEnd()}…`}</p>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="mt-1 text-xs font-semibold text-foreground/75 underline underline-offset-3 hover:text-foreground"
      >
        {open ? "Show less" : `Show all ${value.length.toLocaleString("en-US")} characters`}
      </button>
    </div>
  );
}

function FieldEditor({
  disputeId,
  fieldKey,
  initial,
  canClear,
  onDone,
}: {
  disputeId: string;
  fieldKey: EvidenceFieldKey;
  initial: string;
  canClear: boolean;
  onDone: () => void;
}) {
  const { call, pending, error } = useApi();
  const [value, setValue] = useState(initial);
  const id = useId();
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    ref.current?.focus();
  }, []);
  const meta = EVIDENCE_FIELD_META[fieldKey];

  async function save(next: string) {
    const data = await call(`/api/disputes/${disputeId}/packet`, jsonInit("POST", { manual: { [fieldKey]: next } }));
    if (data) {
      toast.success(next ? `${meta.label} saved.` : `${meta.label} override cleared.`);
      onDone();
    }
  }

  return (
    <form
      className="grid gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        void save(value.trim());
      }}
    >
      <Label htmlFor={id} className="text-xs text-muted-foreground">
        {meta.howToFix}
      </Label>
      <Textarea id={id} ref={ref} value={value} onChange={(e) => setValue(e.target.value)} rows={Math.min(10, Math.max(3, value.split("\n").length + 1))} maxLength={20_000} />
      <FormMessage error={error?.error} upgradeUrl={error?.upgradeUrl} />
      <div className="flex flex-wrap gap-2">
        <Button type="submit" size="sm" disabled={pending || !value.trim()}>
          {pending ? <Loader2 className="animate-spin" aria-hidden /> : null}
          Save value
        </Button>
        {canClear ? (
          <Button type="button" size="sm" variant="ghost" disabled={pending} onClick={() => void save("")}>
            Clear my value
          </Button>
        ) : null}
        <Button type="button" size="sm" variant="ghost" disabled={pending} onClick={onDone}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

const ROLE_LABEL = { required: "required", recommended: "recommended", extra: null } as const;

export function EvidenceFields({
  disputeId,
  rows,
  editKey,
  frozen,
}: {
  disputeId: string;
  rows: FieldRowData[];
  /** Opens the editor for this field (deep link from the missing list). */
  editKey: EvidenceFieldKey | null;
  frozen: boolean;
}) {
  const [editing, setEditing] = useState<EvidenceFieldKey | null>(frozen ? null : editKey);
  const [adding, setAdding] = useState<EvidenceFieldKey | "">("");
  const present = new Set(rows.map((r) => r.key));
  const editingAbsent = editing && !present.has(editing) ? editing : null;
  const addable = EVIDENCE_FIELD_KEYS.filter((k) => k !== "uncategorized_text" && !present.has(k));

  return (
    <div className="grid gap-3">
      <ul className="divide-y divide-border rounded-lg bg-card shadow-card ring-1 ring-foreground/10">
        {rows.length === 0 && !editingAbsent ? (
          <li className="px-4 py-6 text-sm text-muted-foreground">No evidence assembled yet.</li>
        ) : null}
        {rows.map((row) => (
          <li key={row.key} id={`field-${row.key}`} className="grid gap-2 px-4 py-3 sm:grid-cols-[11rem_minmax(0,1fr)] sm:gap-4">
            <div className="min-w-0">
              <p className="text-sm font-semibold">{EVIDENCE_FIELD_META[row.key].label}</p>
              <p className="truncate font-mono text-[0.6875rem] text-foreground/60">{row.key}</p>
              {ROLE_LABEL[row.role] ? <p className="mt-0.5 text-[0.6875rem] text-foreground/60">{ROLE_LABEL[row.role]}</p> : null}
            </div>
            <div className="min-w-0">
              {editing === row.key ? (
                <FieldEditor
                  disputeId={disputeId}
                  fieldKey={row.key}
                  initial={row.override || !row.file ? row.value : ""}
                  canClear={row.override}
                  onDone={() => setEditing(null)}
                />
              ) : (
                <>
                  <ValueCell value={row.value} />
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <SourceTag>{row.source}</SourceTag>
                    {row.sourceDetail ? <span className="min-w-0 truncate text-xs text-muted-foreground">{row.sourceDetail}</span> : null}
                    {fieldKind(row.key) === "file" && !row.file ? (
                      <span className="text-xs text-muted-foreground">sent as text inside the statement until a file is attached</span>
                    ) : null}
                    {!frozen ? (
                      <button
                        type="button"
                        onClick={() => setEditing(row.key)}
                        className="ml-auto inline-flex items-center gap-1 text-xs font-semibold text-foreground/75 underline-offset-3 hover:text-foreground hover:underline"
                      >
                        <PencilLine className="size-3.5" aria-hidden />
                        {row.override ? "Edit my value" : "Override"}
                        <span className="sr-only"> {EVIDENCE_FIELD_META[row.key].label}</span>
                      </button>
                    ) : null}
                  </div>
                </>
              )}
            </div>
          </li>
        ))}
        {editingAbsent ? (
          <li id={`field-${editingAbsent}`} className="grid gap-2 bg-accent/30 px-4 py-3 sm:grid-cols-[11rem_minmax(0,1fr)] sm:gap-4">
            <div className="min-w-0">
              <p className="text-sm font-semibold">{EVIDENCE_FIELD_META[editingAbsent].label}</p>
              <p className="truncate font-mono text-[0.6875rem] text-foreground/60">{editingAbsent}</p>
            </div>
            <FieldEditor disputeId={disputeId} fieldKey={editingAbsent} initial="" canClear={false} onDone={() => setEditing(null)} />
          </li>
        ) : null}
      </ul>
      {!frozen && addable.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2">
          <Select value={adding} onValueChange={(v) => setAdding(v as EvidenceFieldKey)}>
            <SelectTrigger className="w-64 max-w-full" aria-label="Add another evidence field">
              <SelectValue placeholder="Add another field…" />
            </SelectTrigger>
            <SelectContent>
              {addable.map((k) => (
                <SelectItem key={k} value={k}>
                  {EVIDENCE_FIELD_META[k].label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            variant="outline"
            size="sm"
            disabled={!adding}
            onClick={() => {
              if (adding) setEditing(adding);
              setAdding("");
            }}
          >
            Enter a value
          </Button>
        </div>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Attachments                                                         */
/* ------------------------------------------------------------------ */

export type AttachmentRow = {
  id: string;
  fileName: string;
  field: string;
  mimeType: string;
  sizeBytes: number;
  stripeFileId: string | null;
};

const FILE_FIELDS = EVIDENCE_FIELD_KEYS.filter((k) => fieldKind(k) === "file");

function sizeLabel(bytes: number): string {
  return bytes >= 1_048_576 ? `${(bytes / 1_048_576).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

export function AttachmentsPanel({
  disputeId,
  attachments,
  initialField,
  frozen,
  connected,
  disabled,
}: {
  disputeId: string;
  attachments: AttachmentRow[];
  initialField: EvidenceFieldKey | null;
  frozen: boolean;
  connected: boolean;
  disabled?: boolean;
}) {
  const upload = useApi();
  const remove = useApi();
  const [field, setField] = useState<string>(initialField && FILE_FIELDS.includes(initialField) ? initialField : "shipping_documentation");
  const [file, setFile] = useState<File | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const fileId = useId();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!file) return;
    const form = new FormData();
    form.set("file", file);
    form.set("field", field);
    const data = await upload.call<{ stripeFileId: string | null; warning: string | null }>(`/api/disputes/${disputeId}/attachments`, {
      method: "POST",
      body: form,
    });
    if (data) {
      if (data.warning) toast.warning(data.warning);
      else toast.success(`Uploaded to Stripe as ${data.stripeFileId}.`);
      setFile(null);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  return (
    <div className="grid gap-4">
      {attachments.length > 0 ? (
        <ul className="divide-y divide-border rounded-lg bg-card shadow-card ring-1 ring-foreground/10">
          {attachments.map((a) => (
            <li key={a.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3">
              <FileText className="size-4 shrink-0 text-foreground/60" aria-hidden />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">{a.fileName}</span>
                <span className="block text-xs text-muted-foreground">
                  {EVIDENCE_FIELD_META[a.field as EvidenceFieldKey]?.label ?? a.field} · {sizeLabel(a.sizeBytes)}
                </span>
              </span>
              {a.stripeFileId ? (
                <SourceTag className="text-steel">{a.stripeFileId}</SourceTag>
              ) : (
                <span className="text-xs font-medium text-oxide-ink">Not on Stripe yet</span>
              )}
              {!frozen ? (
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Remove ${a.fileName}`}
                  disabled={remove.pending}
                  onClick={async () => {
                    const ok = await remove.call(`/api/disputes/${disputeId}/attachments?attachmentId=${encodeURIComponent(a.id)}`, jsonInit("DELETE"));
                    if (ok) toast.success(`${a.fileName} removed.`);
                  }}
                >
                  <Trash2 aria-hidden />
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">No files yet. Stripe takes one PDF, PNG or JPEG of up to 5 MB per evidence field.</p>
      )}
      <FormMessage error={remove.error?.error} />

      {!frozen ? (
        <form onSubmit={submit} className="grid gap-3 rounded-lg border border-dashed bg-card/60 p-4 sm:grid-cols-2 sm:items-end">
          <div className="grid gap-1.5">
            <Label htmlFor={`${fileId}-field`}>Evidence field</Label>
            <Select value={field} onValueChange={setField}>
              <SelectTrigger id={`${fileId}-field`} className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {FILE_FIELDS.map((k) => (
                  <SelectItem key={k} value={k}>
                    {EVIDENCE_FIELD_META[k].label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor={fileId}>File (PDF, PNG or JPEG, 5 MB max)</Label>
            <input
              id={fileId}
              ref={inputRef}
              type="file"
              accept="application/pdf,image/png,image/jpeg"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              className="block w-full text-sm file:mr-3 file:rounded-md file:border file:border-border file:bg-background file:px-3 file:py-1.5 file:text-sm file:font-medium"
            />
          </div>
          <div className="sm:col-span-2">
            <Button type="submit" disabled={!file || upload.pending || disabled}>
              {upload.pending ? <Loader2 className="animate-spin" aria-hidden /> : <Upload aria-hidden />}
              {upload.pending ? "Uploading to Stripe" : "Upload"}
            </Button>
          </div>
          <div className="sm:col-span-2">
            <FormMessage error={upload.error?.error} upgradeUrl={upload.error?.upgradeUrl} />
            {!connected ? (
              <p className="text-xs text-muted-foreground">Stripe is not connected: files are kept here and in the PDF until you connect it.</p>
            ) : null}
          </div>
        </form>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* PDF                                                                 */
/* ------------------------------------------------------------------ */

export function PdfPanel({ disputeId, disabled }: { disputeId: string; disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  const [nonce, setNonce] = useState(0);
  const src = `/api/disputes/${disputeId}/pdf`;
  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          disabled={disabled}
          onClick={() => {
            setNonce((n) => n + 1);
            setOpen((v) => !v);
          }}
          aria-expanded={open}
        >
          {open ? <X aria-hidden /> : <Eye aria-hidden />}
          {open ? "Close preview" : "Preview PDF"}
        </Button>
        <Button variant="outline" asChild>
          <a href={`${src}?download=1`} aria-disabled={disabled} className={cn(disabled && "pointer-events-none opacity-50")}>
            <Download aria-hidden />
            Download
          </a>
        </Button>
      </div>
      {open ? (
        <iframe
          key={nonce}
          title="Packet PDF preview"
          src={`${src}?v=${nonce}`}
          className="h-[36rem] w-full rounded-lg bg-card ring-1 ring-foreground/10"
        />
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Submit                                                              */
/* ------------------------------------------------------------------ */

export type SubmitGate =
  | { kind: "ok" }
  | { kind: "plan"; message: string }
  | { kind: "closed"; message: string }
  | { kind: "role"; message: string };

export function SubmitPanel({
  disputeId,
  stripeDisputeId,
  gate,
  demo,
  livemode,
  requiredMissing,
  fieldCount,
  fileCount,
  narrativeChars,
}: {
  disputeId: string;
  stripeDisputeId: string;
  gate: SubmitGate;
  demo: boolean;
  livemode: boolean;
  requiredMissing: string[];
  fieldCount: number;
  fileCount: number;
  narrativeChars: number;
}) {
  const { call, pending, error, setError } = useApi();
  const [open, setOpen] = useState(false);
  const [reviewed, setReviewed] = useState(false);
  const [outcome, setOutcome] = useState<"winning_evidence" | "losing_evidence" | "real">(demo ? "winning_evidence" : "real");
  const dashboardUrl = `https://dashboard.stripe.com/${livemode ? "" : "test/"}disputes/${encodeURIComponent(stripeDisputeId)}`;

  if (gate.kind !== "ok") {
    return (
      <div className="grid gap-3 rounded-lg bg-secondary p-4 text-sm">
        <p className="text-foreground/85">{gate.message}</p>
        {gate.kind === "plan" ? (
          <div className="flex flex-wrap gap-2">
            <Button asChild>
              <Link href="/billing">Upgrade to Pro</Link>
            </Button>
            <Button variant="outline" asChild>
              <a href={dashboardUrl} target="_blank" rel="noreferrer">
                Open in Stripe Dashboard
              </a>
            </Button>
          </div>
        ) : null}
      </div>
    );
  }

  async function submit() {
    const data = await call<{ status: string }>(
      `/api/disputes/${disputeId}/submit`,
      jsonInit("POST", { confirm: true, testOutcome: outcome === "real" ? null : outcome }),
    );
    if (data) {
      setOpen(false);
      toast.success(`Submitted to Stripe. Dispute status: ${data.status.replaceAll("_", " ")}.`);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (pending) return;
        if (next) setError(null);
        setOpen(next);
      }}
    >
      <DialogTrigger asChild>
        <Button size="lg">Review and submit to Stripe</Button>
      </DialogTrigger>
      <DialogContent showCloseButton={!pending} className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-lg">Submit this packet to Stripe?</DialogTitle>
          <DialogDescription>
            Stripe takes one submission per dispute. Afterwards the packet is frozen and kept exactly as sent.
          </DialogDescription>
        </DialogHeader>
        <ul className="grid gap-1.5 text-sm text-foreground/85">
          <li>
            <span className="tabular font-mono">{fieldCount}</span> evidence fields, <span className="tabular font-mono">{fileCount}</span>{" "}
            {fileCount === 1 ? "file" : "files"} on Stripe, a statement of{" "}
            <span className="tabular font-mono">{narrativeChars.toLocaleString("en-US")}</span> characters.
          </li>
          {requiredMissing.length > 0 ? (
            <li className="font-medium text-oxide-ink">
              Still missing {requiredMissing.length} required {requiredMissing.length === 1 ? "field" : "fields"}: {requiredMissing.join(", ")}.
            </li>
          ) : null}
          {narrativeChars === 0 ? <li className="font-medium text-oxide-ink">There is no statement yet; the bank reads it first.</li> : null}
        </ul>

        {demo ? (
          <fieldset className="grid gap-2 rounded-md bg-secondary p-3">
            <legend className="px-1 text-xs font-semibold text-foreground/75">Demo dispute (Stripe test mode)</legend>
            {(
              [
                ["winning_evidence", "Simulate win", "Sends only “winning_evidence”; Stripe closes the dispute as won."],
                ["losing_evidence", "Simulate loss", "Sends only “losing_evidence”; Stripe closes it as lost."],
                ["real", "Send the real packet", "Stripe test mode then holds it under review, like a bank would."],
              ] as const
            ).map(([value, label, hint]) => (
              <label key={value} className="flex cursor-pointer items-start gap-2 text-sm">
                <input
                  type="radio"
                  name={`outcome-${disputeId}`}
                  value={value}
                  checked={outcome === value}
                  onChange={() => setOutcome(value)}
                  className="mt-1 accent-(--oxide-ink)"
                />
                <span>
                  <span className="font-medium">{label}</span>
                  <span className="block text-xs text-muted-foreground">{hint}</span>
                </span>
              </label>
            ))}
          </fieldset>
        ) : null}

        <label className="flex cursor-pointer items-start gap-2 text-sm">
          <input type="checkbox" checked={reviewed} onChange={(e) => setReviewed(e.target.checked)} className="mt-1 accent-(--oxide-ink)" />
          <span>
            I have reviewed every field, the statement and the files, and I want to submit them for{" "}
            <span className="font-mono text-xs">{stripeDisputeId}</span>.
          </span>
        </label>
        <FormMessage error={error?.error} upgradeUrl={error?.upgradeUrl} />
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={pending}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={!reviewed || pending}>
            {pending ? <Loader2 className="animate-spin" aria-hidden /> : null}
            {pending ? "Submitting" : "Submit to Stripe"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
