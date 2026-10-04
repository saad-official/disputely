import { toNextJsHandler } from "better-auth/next-js";
import { getAuth } from "@/lib/auth/server";

/** Better Auth endpoints (/api/auth/sign-in/email, /api/auth/get-session, ...). */
export const { GET, POST, PATCH, PUT, DELETE } = toNextJsHandler(async (request: Request) =>
  (await getAuth()).handler(request),
);
