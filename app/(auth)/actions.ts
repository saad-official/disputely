"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getAuth } from "@/lib/auth/server";

/**
 * Ends the session (database row and cookies; nextCookies applies the
 * Set-Cookie headers) and returns to the landing page. Safe to call when
 * already signed out.
 */
export async function signOut(): Promise<void> {
  const auth = await getAuth();
  const requestHeaders = await headers();
  try {
    await auth.api.signOut({ headers: requestHeaders });
  } catch (error) {
    // No or stale session: nothing to end. Still leave the app.
    console.warn("[auth] signOut:", error instanceof Error ? error.message : error);
  }
  redirect("/");
}
