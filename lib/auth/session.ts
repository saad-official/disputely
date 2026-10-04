import "server-only";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { getDb } from "@/lib/db/client";
import { countNeedsResponse } from "@/lib/db/repositories/disputes";
import type { MembershipRole, Organization } from "@/lib/db/types";
import { ensureOrganizationForUser } from "./organization";
import { getAuth, type AuthSession } from "./server";

export type SessionUser = AuthSession["user"];

export type OrgContext = {
  user: SessionUser;
  org: Organization;
  role: MembershipRole;
};

/** The verified session for this request (cookie cache, then database). Deduplicated per render. */
export const getSession = cache(async (): Promise<AuthSession | null> => {
  // headers() first: it marks the route dynamic, so prerendering stops here
  // instead of reaching for a database at build time.
  const requestHeaders = await headers();
  const auth = await getAuth();
  return auth.api.getSession({ headers: requestHeaders });
});

export async function getSessionUser(): Promise<SessionUser | null> {
  return (await getSession())?.user ?? null;
}

/**
 * Signed-in user plus their organization, or null when signed out. If the
 * sign-up hook never created the organization (it failed mid-way), it is
 * created here so the user is never stranded.
 */
export const getOrgContext = cache(async (): Promise<OrgContext | null> => {
  const user = await getSessionUser();
  if (!user) return null;
  const db = await getDb();
  const membership = await ensureOrganizationForUser(db, user);
  return { user, org: membership.org, role: membership.role };
});

/**
 * For pages and layouts behind sign-in. Redirects to /sign-in when there is
 * no valid session. `expired=1` tells the proxy not to bounce a stale
 * session cookie straight back to /dashboard.
 */
export async function requireOrgContext(): Promise<OrgContext> {
  const ctx = await getOrgContext();
  if (!ctx) redirect("/sign-in?expired=1");
  return ctx;
}

/** Disputes that still need a response (the Disputes badge in the app shell). Deduplicated per render. */
export const getOpenDisputeCount = cache(async (orgId: string): Promise<number> => {
  return countNeedsResponse(orgId);
});
