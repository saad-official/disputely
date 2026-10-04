import type { Metadata } from "next";
import Link from "next/link";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { safeNextPath } from "../safe-next";
import { SignInForm } from "./sign-in-form";

export const metadata: Metadata = {
  title: "Sign in",
};

export default async function SignInPage({ searchParams }: PageProps<"/sign-in">) {
  const params = await searchParams;
  const next = safeNextPath(typeof params.next === "string" ? params.next : undefined);
  const expired = params.expired !== undefined;
  const signUpHref = next === "/dashboard" ? "/sign-up" : `/sign-up?next=${encodeURIComponent(next)}`;

  return (
    <Card className="shadow-card">
      <CardHeader>
        <p className="font-mono text-xs tracking-wide text-muted-foreground uppercase">Sign in</p>
        <CardTitle className="font-heading text-2xl font-bold tracking-tight">Welcome back</CardTitle>
        <CardDescription>Pick up where your last packet left off.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        {expired ? (
          <p role="status" className="rounded-lg border bg-muted px-3 py-2 text-sm text-muted-foreground">
            Your session ended. Sign in again to continue.
          </p>
        ) : null}
        <SignInForm next={next} />
      </CardContent>
      <CardFooter className="justify-center text-sm text-muted-foreground">
        New to Disputely?&nbsp;
        <Link href={signUpHref} className="font-medium text-foreground underline-offset-4 hover:underline">
          Create an account
        </Link>
      </CardFooter>
    </Card>
  );
}
