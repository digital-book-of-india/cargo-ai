"use client";

import { useEffect } from "react";
import type { ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import { ErrorState, LoadingState } from "@/components/common/States";
import { Button } from "@/components/ui/Button";
import { friendlyMessage } from "@/lib/api/messages";
import { useAuth } from "@/lib/auth/AuthProvider";

// Client-side route guard for the owner area. This is UX only: the backend
// enforces authorization on every endpoint.
export function RequireAuth({ children }: { children: ReactNode }) {
  const { status, user, error, sessionExpired, signedOutByUser, refresh, logout } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (status !== "unauthenticated") return;
    // a deliberate sign out goes to a clean sign in page; an expired or missing session returns here after sign in
    if (signedOutByUser) {
      router.replace("/login");
      return;
    }
    const next = encodeURIComponent(pathname || "/dashboard");
    router.replace(`/login?next=${next}${sessionExpired ? "&reason=expired" : ""}`);
  }, [status, pathname, router, sessionExpired, signedOutByUser]);

  if (status === "loading") {
    return (
      <div className="mx-auto max-w-md p-6">
        <LoadingState label="Checking your session..." />
      </div>
    );
  }

  if (status === "error") {
    return (
      <div className="mx-auto max-w-md p-6">
        <ErrorState
          message={friendlyMessage(error)}
          requestId={error?.requestId}
          onRetry={() => void refresh()}
        />
      </div>
    );
  }

  if (status === "unauthenticated" || !user) return null; // redirecting to /login

  if (user.role === "SUPER_ADMIN") {
    return (
      <div className="mx-auto max-w-md space-y-3 p-6">
        <h1 className="text-lg font-semibold">This is the shop owner panel</h1>
        <p className="text-sm text-slate-600">
          You are signed in as a platform admin. Use the Super Admin panel instead, or sign in
          with a shop owner account.
        </p>
        <Button variant="secondary" onClick={() => void logout()}>
          Sign out
        </Button>
      </div>
    );
  }

  if (user.role !== "SHOP_OWNER") {
    return (
      <div className="mx-auto max-w-md space-y-3 p-6">
        <h1 className="text-lg font-semibold">This account cannot use the owner panel</h1>
        <p className="text-sm text-slate-600">
          The owner panel is for shop owners. Please sign in with the shop owner account.
        </p>
        <Button variant="secondary" onClick={() => void logout()}>
          Sign out
        </Button>
      </div>
    );
  }

  return <>{children}</>;
}
