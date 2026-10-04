"use client";

import { RouteError } from "@/components/app/route-error";

export default function ErrorBoundary({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return <RouteError error={error} retry={retry} title="Disputes didn't load" />;
}
