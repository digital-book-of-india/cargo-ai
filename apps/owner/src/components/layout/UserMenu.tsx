"use client";

import { useState } from "react";
import Link from "next/link";
import { Bell, ChevronsUpDown, LogOut, Settings } from "lucide-react";
import {
  Avatar,
  AvatarFallback,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui";
import { useAuth } from "@/lib/auth/AuthProvider";
import { cn } from "@/lib/utils/cn";

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const first = (parts[0]?.[0] ?? "?").toUpperCase();
  const last = parts.length > 1 ? parts[parts.length - 1][0].toUpperCase() : "";
  return first + last;
}

export function UserMenu({ compact = false, className }: { compact?: boolean; className?: string }) {
  const { user, logout } = useAuth();
  const [signingOut, setSigningOut] = useState(false);
  if (!user) return null;

  async function onSignOut() {
    setSigningOut(true);
    await logout(); // RequireAuth then redirects to /login
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label="Account menu"
          className={cn(
            "flex items-center gap-3 rounded-lg text-left transition-colors hover:bg-accent",
            compact ? "p-0.5" : "w-full p-2",
            className
          )}
        >
          <Avatar>
            <AvatarFallback>{initials(user.name)}</AvatarFallback>
          </Avatar>
          {!compact && (
            <>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">{user.name}</span>
                <span className="block truncate text-xs text-muted-foreground">{user.email}</span>
              </span>
              <ChevronsUpDown className="size-4 shrink-0 text-muted-foreground" aria-hidden />
            </>
          )}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align={compact ? "end" : "start"} className="w-60">
        <DropdownMenuLabel>
          <span className="block truncate">{user.name}</span>
          <span className="block truncate text-xs font-normal text-muted-foreground">{user.email}</span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/notifications">
            <Bell aria-hidden /> Notifications
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href="/settings">
            <Settings aria-hidden /> Settings
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={signingOut}
          onSelect={(e) => {
            e.preventDefault();
            void onSignOut();
          }}
          className="text-destructive focus:text-destructive"
        >
          <LogOut aria-hidden /> {signingOut ? "Signing out..." : "Sign out"}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
