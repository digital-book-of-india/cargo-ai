"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { authApi } from "@/lib/api/auth";
import { ApiError, setUnauthorizedHandler } from "@/lib/api/client";
import { clearOwnerStorage } from "@/lib/utils/storage";
import { can as roleCan, canAccessSite } from "@/types";
import type { CompanyMembership, CompanyRole, Permission, User } from "@/types";

// loading: checking the session | error: could not check (server/network down)
type Status = "loading" | "authenticated" | "unauthenticated" | "error";

interface AuthContextValue {
  status: Status;
  user: User | null;
  error: ApiError | null;
  /** true when a signed-in session was rejected by the server (401) */
  sessionExpired: boolean;
  /** true right after the owner chose to sign out (no "come back to this page" needed) */
  signedOutByUser: boolean;
  /** the companies this user belongs to (usually one) */
  memberships: CompanyMembership[];
  /** the company the panel is working in */
  membership: CompanyMembership | null;
  role: CompanyRole | null;
  /** does the active role allow this? Used to hide controls the API would refuse. */
  can: (permission: Permission) => boolean;
  /** same, for one site (members of some roles only reach the sites they are assigned to) */
  canAtSite: (permission: Permission, siteId: string) => boolean;
  login: (input: { email: string; password: string }) => Promise<void>;
  register: (input: { name: string; email: string; password: string; companyName?: string }) => Promise<void>;
  acceptInvitation: (input: { token: string; name: string; password: string }) => Promise<void>;
  logout: () => Promise<void>;
  /** re-check the session (used for "Try again" after an error) */
  refresh: () => Promise<void>;
  /** replace the signed-in user after a profile change */
  updateUser: (user: User) => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status>("loading");
  const [user, setUser] = useState<User | null>(null);
  const [memberships, setMemberships] = useState<CompanyMembership[]>([]);
  const [error, setError] = useState<ApiError | null>(null);
  const [sessionExpired, setSessionExpired] = useState(false);
  const [signedOutByUser, setSignedOutByUser] = useState(false);

  const signedIn = useCallback((u: User, m: CompanyMembership[]) => {
    setUser(u);
    setMemberships(m);
    setError(null);
    setSessionExpired(false);
    setSignedOutByUser(false);
    setStatus("authenticated");
  }, []);

  const signedOut = useCallback(() => {
    setUser(null);
    setMemberships([]);
    setStatus("unauthenticated");
  }, []);

  const refresh = useCallback(async () => {
    setStatus("loading");
    try {
      const me = await authApi.me();
      signedIn(me.user, me.memberships);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        signedOut();
      } else {
        // Do not pretend the user is signed out when we simply could not check.
        setError(err instanceof ApiError ? err : new ApiError(0, "UNKNOWN_ERROR", "Unknown error"));
        setStatus("error");
      }
    }
  }, [signedIn, signedOut]);

  // Check the existing session once on load.
  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Any later 401 from a data request means the session is gone.
  useEffect(() => {
    setUnauthorizedHandler(() => {
      setSessionExpired(true);
      signedOut();
    });
    return () => setUnauthorizedHandler(null);
  }, [signedOut]);

  const login = useCallback(
    async (input: { email: string; password: string }) => {
      const res = await authApi.login(input);
      signedIn(res.user, res.memberships);
    },
    [signedIn]
  );

  const register = useCallback(
    async (input: { name: string; email: string; password: string; companyName?: string }) => {
      const res = await authApi.register(input);
      signedIn(res.user, res.memberships);
    },
    [signedIn]
  );

  const acceptInvitation = useCallback(
    async (input: { token: string; name: string; password: string }) => {
      const res = await authApi.acceptInvitation(input);
      signedIn(res.user, res.memberships);
    },
    [signedIn]
  );

  const logout = useCallback(async () => {
    try {
      await authApi.logout();
    } catch {
      // The user asked to leave: clear the local session even if the call failed.
    }
    // a shared device must not show the previous owner's site or zone markers
    clearOwnerStorage();
    setSignedOutByUser(true);
    setSessionExpired(false);
    signedOut();
  }, [signedOut]);

  const updateUser = useCallback((u: User) => setUser(u), []);

  const membership = memberships[0] ?? null;
  const role = membership?.role ?? null;
  const can = useCallback((permission: Permission) => roleCan(role, permission), [role]);
  const canAtSite = useCallback(
    (permission: Permission, siteId: string) =>
      role !== null && roleCan(role, permission) && canAccessSite(role, membership?.siteIds ?? [], siteId),
    [role, membership]
  );

  const value = useMemo<AuthContextValue>(
    () => ({
      status,
      user,
      error,
      sessionExpired,
      signedOutByUser,
      memberships,
      membership,
      role,
      can,
      canAtSite,
      login,
      register,
      acceptInvitation,
      logout,
      refresh,
      updateUser,
    }),
    [status, user, error, sessionExpired, signedOutByUser, memberships, membership, role, can, canAtSite, login, register, acceptInvitation, logout, refresh, updateUser]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}
