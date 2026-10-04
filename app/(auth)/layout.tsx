import Link from "next/link";
import { ArrowLeft } from "lucide-react";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-svh flex-1 flex-col bg-background lg:grid lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
      <aside className="relative hidden flex-col justify-between bg-slate p-12 text-linen lg:flex">
        <Link
          href="/"
          className="inline-flex items-center gap-2 font-heading text-2xl font-semibold tracking-tight text-linen outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          <span aria-hidden className="inline-flex size-4 items-center justify-center rounded-[3px] bg-oxide text-[10px] font-bold text-oxide-foreground">✓</span>
          Disputely
        </Link>
        <div className="max-w-md space-y-4">
          <p className="font-heading text-4xl font-semibold leading-tight tracking-tight">
            Win more chargebacks, pay a flat fee.
          </p>
          <p className="text-sm text-linen/70">
            Every open dispute, its deadline and the evidence its reason code needs, assembled from Stripe and
            your own records. The narrative only states facts it can verify.
          </p>
          <dl className="grid grid-cols-3 gap-3 pt-2 font-mono text-xs text-linen/70">
            <div>
              <dt className="text-linen/50">Assembles</dt>
              <dd>the playbook</dd>
            </div>
            <div>
              <dt className="text-linen/50">Verifies</dt>
              <dd>every fact</dd>
            </div>
            <div>
              <dt className="text-linen/50">Submits</dt>
              <dd>you</dd>
            </div>
          </dl>
        </div>
        <p className="text-xs text-linen/50">For online merchants on Stripe, from $5k to $500k a month.</p>
      </aside>

      <div className="flex flex-1 flex-col px-4 py-8 sm:px-8">
        <header className="flex items-center justify-between">
          <Link href="/" className="font-heading text-xl font-semibold tracking-tight lg:invisible">
            Disputely
          </Link>
          <Link
            href="/"
            className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            <ArrowLeft className="size-4" aria-hidden />
            Back to home
          </Link>
        </header>
        <main className="flex flex-1 items-center justify-center py-10">
          <div className="w-full max-w-sm rounded-lg bg-background/85 backdrop-blur-sm">{children}</div>
        </main>
      </div>
    </div>
  );
}
