"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [user, setUser] = useState<{ name: string; role: string; email: string } | null>(null);
  const [authChecking, setAuthChecking] = useState(true);

  useEffect(() => {
    const base = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4000/api/v1";
    const token = typeof window !== "undefined" ? localStorage.getItem("dbi_admin_token") : null;

    fetch(`${base}/auth/me`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      credentials: "include",
    })
      .then(async (res) => {
        if (res.status === 401) {
          if (typeof window !== "undefined") localStorage.removeItem("dbi_admin_token");
          router.replace("/login");
          return;
        }
        if (res.status === 403) {
          router.replace("/access-denied");
          return;
        }
        if (!res.ok) {
          router.replace("/login");
          return;
        }

        const json = await res.json().catch(() => null);
        const fetchedUser = json?.data?.user;

        if (!fetchedUser) {
          router.replace("/login");
          return;
        }

        if (fetchedUser.role !== "PLATFORM_ADMIN") {
          router.replace("/access-denied");
          return;
        }

        setUser(fetchedUser);
        setAuthChecking(false);
      })
      .catch(() => {
        router.replace("/login");
      });
  }, [router]);

  const handleLogout = async () => {
    try {
      const base = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4000/api/v1";
      await fetch(`${base}/auth/logout`, { method: "POST", credentials: "include" });
    } catch {}
    if (typeof window !== "undefined") {
      localStorage.removeItem("dbi_admin_token");
    }
    router.replace("/login");
  };

  const navLinks = [
    { name: "Overview", href: "/overview" },
    { name: "Companies", href: "/companies" },
    { name: "Sites", href: "/sites" },
    { name: "Camera & AI Health", href: "/health" },
    { name: "Audit Logs", href: "/audit-logs" },
    { name: "Support Access", href: "/support" },
  ];

  if (authChecking) {
    return (
      <div className="min-h-screen bg-[#F8FAFC] flex items-center justify-center text-sm font-semibold text-gray-500">
        Authenticating administrative session...
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#F8FAFC] text-[#0F172A] flex flex-col md:flex-row">
      <aside className="hidden md:flex flex-col w-64 bg-white border-r border-[#DBEAFE] shadow-sm">
        <div className="p-6 border-b border-[#DBEAFE]">
          <h1 className="text-xl font-bold text-[#2563EB] tracking-tight">CargoSense AI</h1>
          <p className="text-xs text-gray-500 font-medium">Super Admin Portal</p>
        </div>
        <nav className="flex-1 p-4 space-y-1">
          {navLinks.map((link) => {
            const isActive = pathname.startsWith(link.href);
            return (
              <Link
                key={link.name}
                href={link.href}
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
        <div className="p-4 border-t border-[#DBEAFE] text-xs text-gray-400">
          v2.0 • Security Operations
        </div>
      </aside>

      <div className="flex-1 flex flex-col min-w-0">
        <header className="h-16 bg-white border-b border-[#DBEAFE] flex items-center justify-between px-4 sm:px-6 z-10">
          <div className="flex items-center space-x-3">
            <button
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              className="md:hidden p-2 rounded-md text-gray-600 hover:bg-gray-100"
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16m-7 6h7" />
              </svg>
            </button>
            <span className="text-lg font-semibold text-[#0F172A] md:hidden">CargoSense AI</span>
          </div>

          <div className="flex items-center space-x-4">
            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-[#EFF6FF] text-[#2563EB] border border-[#DBEAFE]">
              {user?.role ?? "PLATFORM_ADMIN"}
            </span>
            <div className="flex items-center space-x-2">
              <div className="w-8 h-8 rounded-full bg-[#2563EB] text-white flex items-center justify-center font-bold text-sm">
                {user?.name ? user.name[0].toUpperCase() : "A"}
              </div>
              <span className="hidden sm:inline text-sm font-medium text-gray-700">
                {user?.name ?? "Administrator"}
              </span>
            </div>
            <button
              onClick={handleLogout}
              className="text-xs text-red-600 hover:text-red-800 font-medium ml-2 px-2.5 py-1 rounded border border-red-200 hover:bg-red-50 transition"
            >
              Logout
            </button>
          </div>
        </header>

        {mobileMenuOpen && (
          <div className="md:hidden bg-white border-b border-[#DBEAFE] p-4 space-y-2">
            {navLinks.map((link) => (
              <Link
                key={link.name}
                href={link.href}
                onClick={() => setMobileMenuOpen(false)}
                className="block px-3 py-2 rounded-md text-base font-medium text-gray-700 hover:bg-[#EFF6FF] hover:text-[#2563EB]"
              >
                {link.name}
              </Link>
            ))}
          </div>
        )}

        <main className="flex-1 p-4 sm:p-6 lg:p-8 max-w-7xl w-full mx-auto">{children}</main>
      </div>
    </div>
  );
}