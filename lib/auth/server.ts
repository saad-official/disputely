import "server-only";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import { getDb, type Db } from "@/lib/db/client";
import { account, session, user, verification } from "@/lib/db/schema";
import { ensureOrganizationForUser } from "./organization";

/** Cookie names become `disputely.session_token` etc., so a shared domain never collides with a sibling app. */
export const AUTH_COOKIE_PREFIX = "disputely";
export const MIN_PASSWORD_LENGTH = 10;
export const MAX_PASSWORD_LENGTH = 128;

/**
 * Development-only fallback so `pnpm dev` works before .env.local exists.
 * High entropy (Better Auth warns on weak secrets) but public: sessions
 * signed with it are worthless outside your machine.
 */
const DEV_FALLBACK_SECRET = "disputely-dev-only-1Yq7vX2pLk9Rm4Tz8Wc3Hn6Bd5Fs0Ga";

function resolveSecret(): string {
  const secret = process.env.BETTER_AUTH_SECRET;
  if (secret) return secret;
  if (process.env.NODE_ENV === "production") {
    throw new Error("BETTER_AUTH_SECRET is not set. Generate one with `openssl rand -base64 32`.");
  }
  console.warn(
    [
      "",
      "################################################################",
      "#  BETTER_AUTH_SECRET is not set: using the public dev secret.  #",
      "#  Sessions are NOT secure. Set it in .env.local before deploy. #",
      "################################################################",
      "",
    ].join("\n"),
  );
  return DEV_FALLBACK_SECRET;
}

function appUrl(): string {
  return process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
}

/**
 * The app's public origin(s) plus localhost. Outside production any local
 * port is trusted, so `next dev -p 3117` works without touching env vars.
 */
export function trustedOrigins(): string[] {
  const origins = new Set<string>(["http://localhost:3000", "http://127.0.0.1:3000"]);
  if (process.env.NODE_ENV !== "production") {
    origins.add("http://localhost:*");
    origins.add("http://127.0.0.1:*");
  }
  for (const value of [process.env.NEXT_PUBLIC_APP_URL, process.env.BETTER_AUTH_URL]) {
    if (!value) continue;
    try {
      origins.add(new URL(value).origin);
    } catch {
      // ignore malformed values; Better Auth validates baseURL itself
    }
  }
  return [...origins];
}

export function createAuth(db: Db) {
  return betterAuth({
    appName: "Disputely",
    baseURL: process.env.BETTER_AUTH_URL ?? appUrl(),
    secret: resolveSecret(),
    trustedOrigins: trustedOrigins(),
    database: drizzleAdapter(db, {
      provider: "pg",
      schema: { user, session, account, verification },
    }),
    emailAndPassword: {
      enabled: true,
      minPasswordLength: MIN_PASSWORD_LENGTH,
      maxPasswordLength: MAX_PASSWORD_LENGTH,
      autoSignIn: true,
    },
    user: {
      additionalFields: {
        businessName: { type: "string", required: false, input: true },
      },
    },
    session: {
      cookieCache: { enabled: true, maxAge: 5 * 60 },
    },
    advanced: {
      cookiePrefix: AUTH_COOKIE_PREFIX,
    },
    databaseHooks: {
      user: {
        create: {
          after: async (created) => {
            await ensureOrganizationForUser(db, created);
          },
        },
      },
    },
    telemetry: { enabled: false },
    // nextCookies must be last: it applies Set-Cookie from Server Actions.
    plugins: [nextCookies()],
  });
}

export type Auth = ReturnType<typeof createAuth>;
export type AuthSession = Auth["$Infer"]["Session"];

let authPromise: Promise<Auth> | undefined;

/**
 * Lazy Better Auth instance bound to the lazy database. Nothing is created
 * (and no secret is required) until the first auth call, so builds and
 * imports never need credentials.
 */
export function getAuth(): Promise<Auth> {
  if (!authPromise) {
    authPromise = getDb()
      .then(createAuth)
      .catch((error: unknown) => {
        authPromise = undefined;
        throw error;
      });
  }
  return authPromise;
}

/** Tests: drop the cached instance (e.g. after swapping the database). */
export function resetAuthForTests(): void {
  authPromise = undefined;
}
