"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { LoadingState } from "@/components/common/States";
import { useAuth } from "@/lib/auth/AuthProvider";

// Entry point: send the visitor to the app or to sign in.
export default function Home() {
  const { status } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (status === "authenticated") router.replace("/dashboard");
    else if (status === "unauthenticated") router.replace("/login");
  }, [status, router]);

  return (
    <div className="mx-auto max-w-md p-6">
      <LoadingState />
    </div>
  );
}
