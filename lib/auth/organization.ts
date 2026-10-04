import "server-only";
import { asc, eq } from "drizzle-orm";
import type { Db } from "@/lib/db/client";
import { isUniqueViolation, randomUrlSafeId } from "@/lib/db/repositories/shared";
import { memberships, organizations } from "@/lib/db/schema";
import type { MembershipRole, Organization } from "@/lib/db/types";

/**
 * User-scoped tenancy lookups used by the auth layer. These run before an
 * org id is known, so they live here rather than in the org-scoped
 * repositories.
 */

export type Membership = { org: Organization; role: MembershipRole };

/** The user's first organization (one per user in v1). */
export async function findMembershipForUser(db: Db, userId: string): Promise<Membership | null> {
  const [row] = await db
    .select({ org: organizations, role: memberships.role })
    .from(memberships)
    .innerJoin(organizations, eq(organizations.id, memberships.orgId))
    .where(eq(memberships.userId, userId))
    .orderBy(asc(memberships.createdAt))
    .limit(1);
  return row ?? null;
}

export function organizationNameFor(user: { email: string; businessName?: unknown }): string {
  const business = typeof user.businessName === "string" ? user.businessName.trim() : "";
  if (business) return business.slice(0, 120);
  const local = user.email.split("@")[0]?.trim();
  return local || "My company";
}

/** Lower-case ASCII slug; "" when nothing usable remains. */
export function slugify(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/g, "");
}

function slugCandidate(name: string): string {
  const suffix = randomUrlSafeId(6).toLowerCase().replace(/[^a-z0-9]/g, "x");
  return `${slugify(name) || "org"}-${suffix}`;
}

/**
 * Creates the user's organization and owner membership, once. Called from
 * Better Auth's `databaseHooks.user.create.after`, and again (as a repair)
 * by `getOrgContext` if that hook ever failed. The slug gets a random suffix
 * and is retried on the (unlikely) unique collision.
 */
export async function ensureOrganizationForUser(
  db: Db,
  user: { id: string; email: string; businessName?: unknown },
): Promise<Membership> {
  const existing = await findMembershipForUser(db, user.id);
  if (existing) return existing;

  const name = organizationNameFor(user);
  for (let attempt = 0; ; attempt++) {
    try {
      return await db.transaction(async (tx) => {
        const [org] = await tx.insert(organizations).values({ name, slug: slugCandidate(name) }).returning();
        await tx.insert(memberships).values({ orgId: org.id, userId: user.id, role: "owner" });
        return { org, role: "owner" as const };
      });
    } catch (error) {
      if (attempt < 3 && isUniqueViolation(error, "organizations_slug_unique")) continue;
      // A concurrent bootstrap for the same user may have won; use its result.
      const raced = await findMembershipForUser(db, user.id);
      if (raced) return raced;
      throw error;
    }
  }
}
