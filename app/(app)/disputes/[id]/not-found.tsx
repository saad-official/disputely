import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function DisputeNotFound() {
  return (
    <section className="grid place-items-center gap-3 rounded-xl border border-dashed bg-card/60 px-6 py-14 text-center">
      <h1 className="font-heading text-2xl">Dispute not found</h1>
      <p className="max-w-md text-sm text-muted-foreground">It may belong to another workspace, or demo data was cleared.</p>
      <Button asChild>
        <Link href="/disputes">All disputes</Link>
      </Button>
    </section>
  );
}
