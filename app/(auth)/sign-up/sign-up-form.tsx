"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { signUp } from "@/lib/auth/client";
import { Field, FormError, SubmitButton, formText, looksLikeEmail } from "../form-parts";

const MIN_PASSWORD = 10;
const MAX_PASSWORD = 128;

type Errors = { form?: string; businessName?: string; email?: string; password?: string };

function errorsFor(error: { code?: string; status?: number; message?: string }): Errors {
  if (error.status === 429) return { form: "Too many attempts. Wait a minute and try again." };
  switch (error.code) {
    case "USER_ALREADY_EXISTS":
    case "USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL":
      return { email: "An account with this email already exists. Sign in instead." };
    case "INVALID_EMAIL":
      return { email: "Enter a valid email address." };
    case "PASSWORD_TOO_SHORT":
      return { password: `Use at least ${MIN_PASSWORD} characters.` };
    case "PASSWORD_TOO_LONG":
      return { password: `Use ${MAX_PASSWORD} characters or fewer.` };
    default:
      return { form: "We couldn't create your account. Try again in a moment." };
  }
}

export function SignUpForm({ next }: { next: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [errors, setErrors] = useState<Errors>({});

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const form = new FormData(event.currentTarget);
    const businessName = formText(form, "businessName").trim();
    const email = formText(form, "email").trim();
    const password = formText(form, "password");

    const fieldErrors: Errors = {};
    if (!businessName) fieldErrors.businessName = "Enter your shop or business name.";
    else if (businessName.length > 120) fieldErrors.businessName = "Keep it under 120 characters.";
    if (!looksLikeEmail(email)) fieldErrors.email = "Enter a valid email address.";
    if (password.length < MIN_PASSWORD) fieldErrors.password = `Use at least ${MIN_PASSWORD} characters.`;
    else if (password.length > MAX_PASSWORD) fieldErrors.password = `Use ${MAX_PASSWORD} characters or fewer.`;
    setErrors(fieldErrors);
    if (Object.keys(fieldErrors).length > 0) return;

    setPending(true);
    try {
      const { error } = await signUp.email({ name: businessName, email, password, businessName });
      if (error) {
        setErrors(errorsFor(error));
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
        id="businessName"
        label="Company name"
        autoComplete="organization"
        required
        maxLength={120}
        disabled={pending}
        error={errors.businessName}
        hint="Names your workspace. You can change it later."
      />
      <Field
        id="email"
        label="Work email"
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
        autoComplete="new-password"
        required
        minLength={MIN_PASSWORD}
        maxLength={MAX_PASSWORD}
        disabled={pending}
        error={errors.password}
        hint={`At least ${MIN_PASSWORD} characters.`}
      />
      <SubmitButton pending={pending} pendingLabel="Creating your account">
        Create account
      </SubmitButton>
    </form>
  );
}
