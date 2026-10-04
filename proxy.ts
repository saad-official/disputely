import { getSessionCookie } from "better-auth/cookies";
import { NextResponse, type NextRequest } from "next/server";

/** Paths that require a signed-in user. */
const PROTECTED_PREFIXES = ["/dashboard", "/disputes", "/library", "/analytics", "/settings", "/billing"];

/**
 * Machine endpoints, passed straight through whatever cookies the caller has:
 * Stripe webhooks, cron (Bearer CRON_SECRET) and the health probe. Every
 * other path is marketing, auth or a protected app page.
 */
const PUBLIC_PREFIXES = ["/api/webhooks", "/api/cron", "/api/health"];

/** Paths a signed-in user is bounced away from. */
const AUTH_PATHS = ["/sign-in", "/sign-up"];

/** Must match `advanced.cookiePrefix` in lib/auth/server.ts. */
const COOKIE_PREFIX = "disputely";

function matchesPrefix(pathname: string, prefixes: readonly string[]) {
  return prefixes.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

export function isProtectedPath(pathname: string) {
  return matchesPrefix(pathname, PROTECTED_PREFIXES);
}

export function isPublicPath(pathname: string) {
  return matchesPrefix(pathname, PUBLIC_PREFIXES);
}

/**
 * Optimistic routing on session-cookie presence only: no database call here.
 * Pages verify the session server-side (requireOrgContext), so a forged or
 * expired cookie gets past this check but not past the page.
 */
export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  if (isPublicPath(pathname)) return NextResponse.next();

  const hasSession = Boolean(getSessionCookie(request, { cookiePrefix: COOKIE_PREFIX }));

  if (!hasSession && isProtectedPath(pathname)) {
    const url = request.nextUrl.clone();
    url.pathname = "/sign-in";
    url.search = "";
    url.searchParams.set("next", `${pathname}${search}`);
    return NextResponse.redirect(url);
  }

  // `?expired=1` comes from requireOrgContext when the cookie no longer maps to
  // a valid session; bouncing that back to /dashboard would loop.
  if (hasSession && AUTH_PATHS.includes(pathname) && !request.nextUrl.searchParams.has("expired")) {
    const url = request.nextUrl.clone();
    url.pathname = "/dashboard";
    url.search = "";
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    // Everything except static assets, images and public files.
    "/((?!_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|txt|xml)$).*)",
  ],
};
