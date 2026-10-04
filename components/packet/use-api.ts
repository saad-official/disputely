"use client";

import { useCallback, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { readApiResult } from "@/components/app/action-result";

export type ApiFailure = { error: string; upgradeUrl?: string };

/**
 * Calls one of the app's JSON routes, tracks pending/error state, and
 * refreshes the server-rendered page on success.
 */
export function useApi() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<ApiFailure | null>(null);
  const [refreshing, startTransition] = useTransition();

  const call = useCallback(
    async <T,>(input: string, init?: RequestInit): Promise<T | null> => {
      setPending(true);
      setError(null);
      try {
        const result = await readApiResult<T>(await fetch(input, init));
        if (!result.ok) {
          setError({ error: result.error, upgradeUrl: result.upgradeUrl });
          return null;
        }
        startTransition(() => router.refresh());
        return result.data;
      } catch {
        setError({ error: "Could not reach the server. Check your connection and try again." });
        return null;
      } finally {
        setPending(false);
      }
    },
    [router],
  );

  return { call, pending: pending || refreshing, error, setError };
}

export function jsonInit(method: string, body?: unknown): RequestInit {
  return body === undefined
    ? { method }
    : { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) };
}
