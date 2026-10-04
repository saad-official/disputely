import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { eq } from "drizzle-orm";
import { ensureOrganizationForUser, findMembershipForUser, organizationNameFor, slugify } from "@/lib/auth/organization";
import { AUTH_COOKIE_PREFIX, getAuth, resetAuthForTests, trustedOrigins } from "@/lib/auth/server";
import type { DbHandle } from "@/lib/db/client";
import { account, memberships, organizations, session, user } from "@/lib/db/schema";
import { startTestDb, stopTestDb } from "./helpers";

let handle: DbHandle;

beforeAll(async () => {
  process.env.BETTER_AUTH_SECRET = "test-secret-0123456789-abcdefghijklmnopqrstuvwxyz";
  handle = await startTestDb();
  resetAuthForTests();
}, 60_000);

afterAll(async () => {
  resetAuthForTests();
  await stopTestDb(handle);
});

describe("Better Auth on PGlite", () => {
  it("signUpEmail creates the user and, via the hook, one org with an owner membership", async () => {
    const auth = await getAuth();
    const result = await auth.api.signUpEmail({
      body: {
        name: "Ada Larkspur",
        email: "ada@larkspur.example",
        password: "correct horse battery",
        businessName: "Larkspur Goods",
      },
    });
    expect(result.user.email).toBe("ada@larkspur.example");
    expect(result.token).toBeTruthy();

    const [stored] = await handle.db.select().from(user).where(eq(user.id, result.user.id));
    expect(stored).toMatchObject({ businessName: "Larkspur Goods", emailVerified: false });

    const [credential] = await handle.db.select().from(account).where(eq(account.userId, result.user.id));
    expect(credential.providerId).toBe("credential");
    expect(credential.password).not.toContain("correct horse");

    const rows = await handle.db
      .select({ org: organizations, role: memberships.role })
      .from(memberships)
      .innerJoin(organizations, eq(organizations.id, memberships.orgId))
      .where(eq(memberships.userId, result.user.id));
    expect(rows).toHaveLength(1);
    expect(rows[0].role).toBe("owner");
    expect(rows[0].org).toMatchObject({
      name: "Larkspur Goods",
      plan: "free",
      timezone: "UTC",
      stripeRestrictedKeyCiphertext: null,
      remindersEnabled: true,
    });
    expect(rows[0].org.slug).toMatch(/^larkspur-goods-[a-z0-9]{6}$/);

    const sessions = await handle.db.select().from(session).where(eq(session.userId, result.user.id));
    expect(sessions).toHaveLength(1);
  });

  it("falls back to the email local part; each user gets their own org", async () => {
    const auth = await getAuth();
    const first = await auth.api.signUpEmail({
      body: { name: "Bo", email: "bo.shop@example.com", password: "another long password" },
    });
    const second = await auth.api.signUpEmail({
      body: { name: "Bo 2", email: "bo.shop@example.org", password: "another long password" },
    });
    const a = await findMembershipForUser(handle.db, first.user.id);
    const b = await findMembershipForUser(handle.db, second.user.id);
    expect(a?.org.name).toBe("bo.shop");
    expect(b?.org.name).toBe("bo.shop");
    expect(a?.org.id).not.toBe(b?.org.id);
    expect(a?.org.slug).not.toBe(b?.org.slug);
  });

  it("is idempotent when the repair path runs again", async () => {
    const [owner] = await handle.db.select().from(user).where(eq(user.email, "ada@larkspur.example"));
    const before = await findMembershipForUser(handle.db, owner.id);
    const again = await ensureOrganizationForUser(handle.db, owner);
    expect(again.org.id).toBe(before?.org.id);
    const all = await handle.db.select().from(memberships).where(eq(memberships.userId, owner.id));
    expect(all).toHaveLength(1);
  });

  it("rejects short passwords and duplicate emails", async () => {
    const auth = await getAuth();
    await expect(
      auth.api.signUpEmail({ body: { name: "Short", email: "short@example.com", password: "123456789" } }),
    ).rejects.toMatchObject({ body: { code: "PASSWORD_TOO_SHORT" } });
    await expect(
      auth.api.signUpEmail({ body: { name: "Dup", email: "ada@larkspur.example", password: "correct horse battery" } }),
    ).rejects.toMatchObject({ body: { code: expect.stringMatching(/^USER_ALREADY_EXISTS/) } });
  });

  it("signs in and resolves the session from the disputely cookie", async () => {
    const auth = await getAuth();
    const response = await auth.api.signInEmail({
      body: { email: "ada@larkspur.example", password: "correct horse battery" },
      asResponse: true,
    });
    expect(response.status).toBe(200);
    const setCookie = response.headers.getSetCookie();
    expect(setCookie.find((c) => c.startsWith("disputely.session_token="))).toBeTruthy();

    const cookieHeader = setCookie.map((c) => c.split(";")[0]).join("; ");
    const current = await auth.api.getSession({ headers: new Headers({ cookie: cookieHeader }) });
    expect(current?.user.email).toBe("ada@larkspur.example");
    expect((current?.user as { businessName?: string }).businessName).toBe("Larkspur Goods");
  });
});

describe("organization naming", () => {
  it("prefers the business name, falls back to the email local part", () => {
    expect(organizationNameFor({ email: "a@b.c", businessName: "  Larkspur Goods " })).toBe("Larkspur Goods");
    expect(organizationNameFor({ email: "jean.dupont@b.c", businessName: "   " })).toBe("jean.dupont");
    expect(organizationNameFor({ email: "x@b.c", businessName: 42 })).toBe("x");
  });

  it("slugifies to lower-case ASCII", () => {
    expect(slugify("Larkspur Goods Ltd")).toBe("larkspur-goods-ltd");
    expect(slugify("Grüner Laden GmbH")).toBe("gruner-laden-gmbh");
    expect(slugify("日本")).toBe("");
  });
});

describe("auth config", () => {
  it("uses the disputely cookie prefix and trusts the app URL plus localhost", () => {
    expect(AUTH_COOKIE_PREFIX).toBe("disputely");
    const previous = process.env.NEXT_PUBLIC_APP_URL;
    process.env.NEXT_PUBLIC_APP_URL = "https://getdisputely.example.com/some/path";
    try {
      expect(trustedOrigins()).toEqual(
        expect.arrayContaining(["https://getdisputely.example.com", "http://localhost:3000"]),
      );
    } finally {
      if (previous === undefined) delete process.env.NEXT_PUBLIC_APP_URL;
      else process.env.NEXT_PUBLIC_APP_URL = previous;
    }
  });
});
