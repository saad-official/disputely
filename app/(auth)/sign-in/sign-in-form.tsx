"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { signIn } from "@/lib/auth/client";
import { Field, FormError, SubmitButton, formText, looksLikeEmail } from "../form-parts";

type Errors = { form?: string; email?: string; password?: string };

function messageFor(error: { code?: string; status?: number; message?: string }): string {
  if (error.status === 429) return "Too many attempts. Wait a minute and try again.";
  if (error.code === "INVALID_EMAIL_OR_PASSWORD" || error.status === 401) {
    return "That email and password don't match.";
  }
  return "We couldn't sign you in. Try again in a moment.";
}

export function SignInForm({ next }: { next: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [errors, setErrors] = useState<Errors>({});

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const form = new FormData(event.currentTarget);
    const email = formText(form, "email").trim();
    const password = formText(form, "password");

    const fieldErrors: Errors = {};
    if (!looksLikeEmail(email)) fieldErrors.email = "Enter a valid email address.";
    if (!password) fieldErrors.password = "Enter your password.";
    setErrors(fieldErrors);
    if (fieldErrors.email || fieldErrors.password) return;

    setPending(true);
    try {
      const { error } = await signIn.email({ email, password });
      if (error) {
        setErrors({ form: messageFor(error) });
        setPending(false);
        return;
      }
      router.replace(next);
      router.refresh();
    } catch {
      setErrors({ form: "We couldn't reach the server. Check your connection and try again." });
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="grid gap-4" noValidate>
      <FormError message={errors.form} />
      <Field
        id="email"
        label="Email"
        type="email"
        autoComplete="email"
        inputMode="email"
        required
        disabled={pending}
        error={errors.email}
      />
      <Field
        id="password"
        label="Password"
        type="password"
        autoComplete="current-password"
        required
        disabled={pending}
        error={errors.password}
      />
      <SubmitButton pending={pending} pendingLabel="Signing in">
        Sign in
      </SubmitButton>
    </form>
  );
}
