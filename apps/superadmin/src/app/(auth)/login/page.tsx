"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";

export default function AdminLoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const base = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4000/api/v1";

    try {
      const res = await fetch(`${base}/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim(), password }),
        credentials: "include",
      });

      const json = await res.json().catch(() => null);

      if (!res.ok) {
        throw new Error(json?.error?.message || "Invalid administrative credentials");
      }

      const user = json?.data?.user;

      if (user?.role !== "PLATFORM_ADMIN") {
        await fetch(`${base}/auth/logout`, { method: "POST", credentials: "include" }).catch(() => {});
        throw new Error("Access restricted: Account is not a platform admin");
      }

      if (json?.data?.token) {
        localStorage.setItem("dbi_admin_token", json.data.token);
      }

      router.push("/overview");
    } catch (err: any) {
      setError(err.message || "Authentication failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#F8FAFC] flex items-center justify-center p-4">
      <div className="max-w-md w-full bg-white rounded-xl border border-[#DBEAFE] shadow-sm p-8 space-y-6">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-[#2563EB] tracking-tight">CargoSense AI</h1>
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mt-1">
            Privileged Super Admin Portal
          </p>
        </div>

        {error && (
          <div className="p-3 bg-red-50 border border-red-200 text-red-700 text-xs rounded-lg font-medium">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-bold text-[#0F172A] mb-1">Email Address</label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="admin@dbi-intelligence.com"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#2563EB]"
            />
          </div>

          <div>
            <label className="block text-xs font-bold text-[#0F172A] mb-1">Password</label>
            <input
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••••••"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#2563EB]"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full py-2.5 bg-[#2563EB] text-white text-sm font-semibold rounded-lg hover:bg-blue-700 transition disabled:opacity-50"
          >
            {loading ? "Authenticating..." : "Sign in to Dashboard"}
          </button>
        </form>

        <p className="text-center text-[11px] text-gray-400">
          Strictly restricted to authorized security platform personnel.
        </p>
      </div>
    </div>
  );
}