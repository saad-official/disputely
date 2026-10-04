import { cn } from "@/lib/utils";

/** Calm, text-only placeholder for a list or page with nothing in it yet. */
export function EmptyState({
  title,
  description,
  action,
  className,
}: {
  title: string;
  description?: React.ReactNode;
  /** Primary action, e.g. a Button wrapping a Link. */
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <section
      className={cn(
        "flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed bg-card/60 px-6 py-14 text-center",
        className,
      )}
    >
      <h2 className="font-heading text-xl">{title}</h2>
      {description ? (
        <p className="max-w-md text-sm text-muted-foreground">{description}</p>
      ) : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </section>
  );
}
