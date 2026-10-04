import Link from "next/link";
import { ArrowLeft } from "lucide-react";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="ledger-lines flex min-h-svh flex-1 flex-col bg-background lg:grid lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
      <aside className="relative hidden flex-col justify-between bg-ink p-12 text-parchment lg:flex">
        <Link
          href="/"
          className="inline-flex items-center gap-2 font-heading text-2xl font-semibold tracking-tight text-parchment outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          <span aria-hidden className="inline-flex size-4 items-center justify-center rounded-[3px] bg-evergreen text-[10px] font-bold text-evergreen-foreground">✓</span>
          Disputely
        </Link>
        <div className="max-w-md space-y-4">
          <p className="font-heading text-4xl font-semibold leading-tight tracking-tight">
            Security questionnaires, answered with citations.
          </p>
          <p className="text-sm text-parchment/70">
            Every answer is drafted from your own policies and points at the exact passage. Questions with no
            evidence become tasks instead of guesses.
          </p>
          <dl className="grid grid-cols-3 gap-3 pt-2 font-mono text-xs text-parchment/70">
            <div>
              <dt className="text-parchment/50">Drafts</dt>
              <dd>the model</dd>
            </div>
            <div>
              <dt className="text-parchment/50">Verifies</dt>
              <dd>citation rules</dd>
            </div>
            <div>
              <dt className="text-parchment/50">Approves</dt>
              <dd>you</dd>
            </div>
          </dl>
        </div>
        <p className="text-xs text-parchment/50">For small SaaS teams, agencies and MSPs selling to enterprises.</p>
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
