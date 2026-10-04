import { PageSkeleton } from "@/components/app/page-skeleton";

export default function Loading() {
  return <PageSkeleton label="Loading dashboard" tiles={4} />;
}
