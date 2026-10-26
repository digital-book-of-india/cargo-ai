"use client";

import { useEffect } from "react";
import type { ReactNode } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { LoadingState } from "@/components/common/States";
import { safeNextPath } from "@/lib/auth";
import { useAuth } from "@/lib/auth/AuthProvider";

// Wraps /login and /register: signed-in users go straight to the app.
export function RedirectIfAuthed({ children }: { children: ReactNode }) {
  const { status } = useAuth();
  const router = useRouter();
  const params = useSearchParams();

  useEffect(() => {
    if (status === "authenticated") {
      router.replace(safeNextPath(params.get("next")));
    }
  }, [status, params, router]);

  if (status === "loading" || status === "authenticated") {
    return <LoadingState label="Loading..." />;
  }
  return <>{children}</>;
}
