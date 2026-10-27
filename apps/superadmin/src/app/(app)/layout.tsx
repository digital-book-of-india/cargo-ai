"use client";

import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { API_BASE_URL, clearLegacyAdminToken } from "@/lib/api/client";

type AdminUser = { name: string; role: string; email: string };
type Session =
  | { kind: "checking" }
  | { kind: "ready"; user: AdminUser }
  | { kind: "error"; message: string };

const NAV_LINKS = [
  { name: "Overview", href: "/overview" },
  { name: "Companies", href: "/companies" },
  { name: "Sites", href: "/sites" },
  { name: "Camera & AI Health", href: "/health" },
  { name: "Audit Logs", href: "/audit-logs" },
  { name: "Support Access", href: "/support" },
];

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [session, setSession] = useState<Session>({ kind: "checking" });

  // Who is signed in? The answer comes from the API, using the httpOnly admin cookie. A network problem or a server
  // error shows a retry screen: it is NOT treated as "signed out", so a short outage does not throw anyone off.
  const checkSession = useCallback(async () => {
    setSession({ kind: "checking" });
    try {
      const res = await fetch(`${API_BASE_URL}/admin/me`, { credentials: "include" });
      if (res.status === 401) {
        router.replace("/login");
        return;
      }
      if (res.status === 403) {
        router.replace("/access-denied");
        return;
      }
      if (!res.ok) {
        setSession({ kind: "error", message: "The server could not check your session. Please try again." });
        return;
      }
      const json = await res.json().catch(() => null);
      const user = json?.data?.user;
      if (!user) {
        setSession({ kind: "error", message: "The server answered in an unexpected way. Please try again." });
        return;
      }
      setSession({ kind: "ready", user });
    } catch {
      setSession({ kind: "error", message: "Cannot reach the server. Check your connection and try again." });
    }
  }, [router]);

  useEffect(() => {
    clearLegacyAdminToken();
    void checkSession();
  }, [checkSession]);

  const handleLogout = async () => {
    try {
      await fetch(`${API_BASE_URL}/auth/logout`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ panel: "admin" }),
        credentials: "include",
      });
    } catch {
      // the cookie also expires on its own
    }
    router.replace("/login");
  };

  if (session.kind === "checking") {
    return (
      <div role="status" className="min-h-screen bg-[#F8FAFC] flex items-center justify-center text-sm font-semibold text-gray-500">
        Checking your session...
      </div>
    );
  }

  if (session.kind === "error") {
    return (
      <div className="min-h-screen bg-[#F8FAFC] flex items-center justify-center p-4">
        <div role="alert" className="max-w-md w-full bg-white border border-red-200 rounded-xl p-6 text-center space-y-4">
          <p className="text-sm text-red-800">{session.message}</p>
          <button
            onClick={() => void checkSession()}
            className="px-4 py-2 bg-[#2563EB] text-white text-sm font-semibold rounded-lg hover:bg-blue-700 transition"
          >
            Try again
          </button>
        </div>
      </div>
    );
  }

  const user = session.user;

  return (
    <div className="min-h-screen bg-[#F8FAFC] text-[#0F172A] flex flex-col md:flex-row">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-2 focus:top-2 focus:z-50 focus:rounded-md focus:bg-white focus:px-3 focus:py-2 focus:text-sm focus:font-semibold focus:text-[#2563EB] focus:shadow"
      >
        Skip to content
      </a>

      <aside className="hidden md:flex flex-col w-64 bg-white border-r border-[#DBEAFE] shadow-sm">
        <div className="p-6 border-b border-[#DBEAFE]">
          <p className="text-xl font-bold text-[#2563EB] tracking-tight">CargoSense AI</p>
          <p className="text-xs text-gray-500 font-medium">Super Admin Portal</p>
        </div>
        <nav aria-label="Main" className="flex-1 p-4 space-y-1">
          {NAV_LINKS.map((link) => {
            const isActive = pathname.startsWith(link.href);
            return (
              <Link
                key={link.name}
                href={link.href}
                aria-current={isActive ? "page" : undefined}
                className={`flex items-center px-4 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                  isActive
                    ? "bg-[#EFF6FF] text-[#2563EB] font-semibold"
                    : "text-gray-600 hover:bg-[#F8FAFC] hover:text-[#0F172A]"
                }`}
              >
                {link.name}
              </Link>
            );
          })}
        </nav>
        <div className="p-4 border-t border-[#DBEAFE] text-xs text-gray-500">Security Operations</div>
      </aside>

      <div className="flex-1 flex flex-col min-w-0">
        <header className="h-16 bg-white border-b border-[#DBEAFE] flex items-center justify-between px-4 sm:px-6 z-10">
          <div className="flex items-center space-x-3">
            <button
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              aria-label={mobileMenuOpen ? "Close menu" : "Open menu"}
              aria-expanded={mobileMenuOpen}
              aria-controls="mobile-nav"
              className="md:hidden p-2 rounded-md text-gray-600 hover:bg-gray-100"
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16m-7 6h7" />
              </svg>
            </button>
            <span className="text-lg font-semibold text-[#0F172A] md:hidden">CargoSense AI</span>
          </div>

          <div className="flex items-center space-x-4">
            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-[#EFF6FF] text-[#2563EB] border border-[#DBEAFE]">
              {user.role}
            </span>
            <div className="flex items-center space-x-2">
              <div className="w-8 h-8 rounded-full bg-[#2563EB] text-white flex items-center justify-center font-bold text-sm" aria-hidden="true">
                {user.name ? user.name[0].toUpperCase() : "A"}
              </div>
              <span className="hidden sm:inline text-sm font-medium text-gray-700">{user.name || "Administrator"}</span>
            </div>
            <button
              onClick={handleLogout}
              className="text-xs text-red-700 hover:text-red-900 font-medium ml-2 px-2.5 py-1 rounded border border-red-200 hover:bg-red-50 transition"
            >
              Sign out
            </button>
          </div>
        </header>

        {mobileMenuOpen && (
          <nav id="mobile-nav" aria-label="Main" className="md:hidden bg-white border-b border-[#DBEAFE] p-4 space-y-2">
            {NAV_LINKS.map((link) => (
              <Link
                key={link.name}
                href={link.href}
                onClick={() => setMobileMenuOpen(false)}
                aria-current={pathname.startsWith(link.href) ? "page" : undefined}
                className="block px-3 py-2 rounded-md text-base font-medium text-gray-700 hover:bg-[#EFF6FF] hover:text-[#2563EB]"
              >
                {link.name}
              </Link>
            ))}
          </nav>
        )}

        <main id="main" tabIndex={-1} className="flex-1 p-4 sm:p-6 lg:p-8 max-w-7xl w-full mx-auto focus:outline-none">
          {children}
        </main>
      </div>
    </div>
  );
}
