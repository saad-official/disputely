"use client";

import { useTransition } from "react";
import { ChevronsUpDown, LogOut } from "lucide-react";
import { signOut } from "@/app/(auth)/actions";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export function UserMenu({ email }: { email: string | null }) {
  const [pending, startTransition] = useTransition();
  const display = email ?? "Signed in";
  const initial = (email?.[0] ?? "?").toUpperCase();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className="flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left text-sm outline-none transition-colors hover:bg-sidebar-accent focus-visible:ring-3 focus-visible:ring-sidebar-ring/50 aria-expanded:bg-sidebar-accent"
        aria-label="Account menu"
      >
        <span
          className="flex size-7 shrink-0 items-center justify-center rounded-full bg-ink text-xs font-semibold text-parchment"
          aria-hidden
        >
          {initial}
        </span>
        <span className="min-w-0 flex-1 truncate text-sidebar-foreground/85">{display}</span>
        <ChevronsUpDown className="size-4 shrink-0 text-sidebar-foreground/50" aria-hidden />
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="start" className="w-(--radix-dropdown-menu-trigger-width) min-w-56">
        <DropdownMenuLabel className="truncate">{display}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          disabled={pending}
          onSelect={(event) => {
            event.preventDefault();
            startTransition(async () => {
              await signOut();
            });
          }}
        >
          <LogOut aria-hidden />
          {pending ? "Signing out" : "Sign out"}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
