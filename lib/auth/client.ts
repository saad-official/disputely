"use client";

import { inferAdditionalFields } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";
import type { Auth } from "./server";

/**
 * Browser auth client. Same-origin: requests go to /api/auth/* on the page's
 * own origin, so no baseURL is needed. `inferAdditionalFields` types
 * `businessName` on `signUp.email`.
 */
export const authClient = createAuthClient({
  plugins: [inferAdditionalFields<Auth>()],
});

export const { signIn, signUp, useSession } = authClient;
