"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { sitesApi } from "@/lib/api/sites";
import { ApiError } from "@/lib/api/client";
import { getStoredSiteId, setStoredSiteId } from "@/lib/utils/storage";
import type { Site } from "@/types";

type Status = "loading" | "ready" | "error";

interface SiteContextValue {
  status: Status;
  sites: Site[];
  /** the site the owner is working on (null until they create one) */
  current: Site | null;
  error: ApiError | null;
  select: (siteId: string) => void;
  reload: () => Promise<void>;
  /** add or replace a site after a create/update call */
  upsert: (site: Site) => void;
}

const SiteContext = createContext<SiteContextValue | null>(null);

export function SiteProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status>("loading");
  const [sites, setSites] = useState<Site[]>([]);
  const [error, setError] = useState<ApiError | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setStatus("loading");
    try {
      const res = await sitesApi.list();
      setSites(res.sites);
      setError(null);
      setStatus("ready");
    } catch (err) {
      setError(err instanceof ApiError ? err : new ApiError(0, "UNKNOWN_ERROR", "Unknown error"));
      setStatus("error");
    }
  }, []);

  useEffect(() => {
    setSelectedId(getStoredSiteId());
    void reload();
  }, [reload]);

  const select = useCallback((siteId: string) => {
    setSelectedId(siteId);
    setStoredSiteId(siteId);
  }, []);

  const upsert = useCallback((site: Site) => {
    setSites((prev) =>
      prev.some((s) => s.id === site.id)
        ? prev.map((s) => (s.id === site.id ? site : s))
        : [...prev, site]
    );
  }, []);

  const current = useMemo(
    () => sites.find((s) => s.id === selectedId) ?? sites[0] ?? null,
    [sites, selectedId]
  );

  const value = useMemo<SiteContextValue>(
    () => ({ status, sites, current, error, select, reload, upsert }),
    [status, sites, current, error, select, reload, upsert]
  );

  return <SiteContext.Provider value={value}>{children}</SiteContext.Provider>;
}

export function useSite(): SiteContextValue {
  const ctx = useContext(SiteContext);
  if (!ctx) throw new Error("useSite must be used inside <SiteProvider>");
  return ctx;
}
