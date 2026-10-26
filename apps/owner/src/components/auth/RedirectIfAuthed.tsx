"use client";

import { useEffect } from "react";
import type { ReactNode } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { LoadingState } from "@/components/common/States";
import { safeNextPath } from "@/lib/auth";
import { useAuth } from "@/lib/auth/AuthProvider";

// Wraps /login and /register: signed-in users go straight to the app.
// The invitation page is the exception: someone signed in as another account must still be
// able to open an invitation link and accept it.
export function RedirectIfAuthed({ children }: { children: ReactNode }) {
  const { status } = useAuth();
  const router = useRouter();
  const params = useSearchParams();
  const accepting = usePathname()?.startsWith("/accept-invitation") ?? false;

  useEffect(() => {
    if (status === "authenticated" && !accepting) {
      router.replace(safeNextPath(params.get("next")));
    }
  }, [status, accepting, params, router]);

  if (status === "loading" || (status === "authenticated" && !accepting)) {
    return <LoadingState label="Loading..." />;
  }
  return <>{children}</>;
}
