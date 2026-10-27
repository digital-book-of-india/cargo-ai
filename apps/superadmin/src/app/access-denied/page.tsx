"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { API_BASE_URL } from "@/lib/api/client";

export default function AccessDeniedPage() {
  const router = useRouter();

  const handleLogout = async () => {
    try {
      await fetch(`${API_BASE_URL}/auth/logout`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ panel: "admin" }),
        credentials: "include",
      });
    } catch {
      // the cookie also expires on its own; go to the sign-in page either way
    }
    router.replace("/login");
  };

  return (
    <main className="min-h-screen bg-[#F8FAFC] flex items-center justify-center p-4">
      <div className="max-w-md w-full bg-white border border-[#DBEAFE] rounded-xl shadow-sm p-8 text-center space-y-5">
        <div className="w-12 h-12 bg-red-100 text-red-600 rounded-full flex items-center justify-center mx-auto" aria-hidden="true">
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
            />
          </svg>
        </div>

        <div>
          <h1 className="text-xl font-bold text-[#0F172A]">Access denied</h1>
          <p className="text-sm text-gray-600 mt-2">
            This account is not a platform administrator, so it cannot use this portal.
          </p>
        </div>

        <div className="pt-2 flex justify-center">
          <button
            onClick={handleLogout}
            className="px-4 py-2 bg-[#2563EB] text-white text-sm font-semibold rounded-lg hover:bg-blue-700 transition"
          >
            Sign out and switch account
          </button>
        </div>
      </div>
    </main>
  );
}
