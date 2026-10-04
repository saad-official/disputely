import type { Metadata } from "next";
import Link from "next/link";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { safeNextPath } from "../safe-next";
import { SignUpForm } from "./sign-up-form";

export const metadata: Metadata = {
  title: "Create your account",
};

export default async function SignUpPage({ searchParams }: PageProps<"/sign-up">) {
  const params = await searchParams;
  const next = safeNextPath(typeof params.next === "string" ? params.next : undefined);
  const signInHref = next === "/dashboard" ? "/sign-in" : `/sign-in?next=${encodeURIComponent(next)}`;

  return (
    <Card className="shadow-card">
      <CardHeader>
        <p className="font-mono text-xs tracking-wide text-muted-foreground uppercase">Free account</p>
        <CardTitle className="font-heading text-2xl font-bold tracking-tight">Answer the next questionnaire in hours, not days</CardTitle>
        <CardDescription>One questionnaire a month with 25 policy pages on Free. No card needed.</CardDescription>
      </CardHeader>
      <CardContent>
        <SignUpForm next={next} />
      </CardContent>
      <CardFooter className="justify-center text-sm text-muted-foreground">
        Already have an account?&nbsp;
        <Link href={signInHref} className="font-medium text-foreground underline-offset-4 hover:underline">
          Sign in
        </Link>
      </CardFooter>
    </Card>
  );
}
