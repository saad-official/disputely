import { Skeleton } from "@/components/ui/skeleton";

/** Loading state for a signed-in page: header, a row of tiles, then a list. */
export function PageSkeleton({ tiles = 4, rows = 5, label }: { tiles?: number; rows?: number; label: string }) {
  return (
    <div role="status" aria-label={label} className="grid gap-6">
      <div className="grid gap-2 pb-2">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-4 w-80 max-w-full" />
      </div>
      {tiles > 0 ? (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          {Array.from({ length: tiles }, (_, i) => (
            <Skeleton key={i} className="h-24 rounded-xl" />
          ))}
        </div>
      ) : null}
      <div className="grid gap-2 rounded-xl bg-card p-4 ring-1 ring-foreground/10">
        {Array.from({ length: rows }, (_, i) => (
          <Skeleton key={i} className="h-12" />
        ))}
      </div>
      <span className="sr-only">Loading</span>
    </div>
  );
}
