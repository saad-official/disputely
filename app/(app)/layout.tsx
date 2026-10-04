import { MobileTopBar, Sidebar, type SidebarProps } from "@/components/app/sidebar";
import { getOpenEvidenceCount, requireOrgContext } from "@/lib/auth/session";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { user, org } = await requireOrgContext();
  const openEvidenceCount = await getOpenEvidenceCount(org.id);

  const shell: SidebarProps = {
    orgName: org.name,
    plan: org.plan,
    email: user.email,
    openEvidenceCount,
  };

  return (
    <div className="flex min-h-svh flex-1">
      <Sidebar {...shell} />
      <div className="flex min-w-0 flex-1 flex-col">
        <MobileTopBar {...shell} />
        <main className="flex-1 px-4 py-6 sm:px-6 md:px-10 md:py-10">
          <div className="mx-auto w-full max-w-6xl">{children}</div>
        </main>
      </div>
    </div>
  );
}
