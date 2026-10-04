import Link from "next/link";
import { cn } from "@/lib/utils";

/** Inline error from a Server Action or API call, with an upgrade link when a plan limit was hit. */
export function FormMessage({
  error,
  upgradeUrl,
  message,
  className,
}: {
  error?: string | null;
  upgradeUrl?: string | null;
  /** A success note, shown when there is no error. */
  message?: string | null;
  className?: string;
}) {
  if (!error && !message) return null;
  if (!error) {
    return (
      <p role="status" className={cn("rounded-lg bg-olive/10 px-3 py-2 text-sm text-foreground ring-1 ring-olive/30", className)}>
        {message}
      </p>
    );
  }
  return (
    <p
      role="alert"
      className={cn(
        "rounded-lg border px-3 py-2 text-sm",
        upgradeUrl ? "border-steel/40 bg-steel/8 text-foreground" : "border-oxide-ink/30 bg-oxide/5 text-oxide-ink",
        className,
      )}
    >
      {error}
      {upgradeUrl ? (
        <>
          {" "}
          <Link href={upgradeUrl} className="font-semibold whitespace-nowrap underline underline-offset-3">
            See plans
          </Link>
        </>
      ) : null}
    </p>
  );
}
