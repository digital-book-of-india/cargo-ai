"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { shopsApi } from "@/lib/api/shops";
import { ApiError } from "@/lib/api/client";
import { getStoredShopId, setStoredShopId } from "@/lib/utils/storage";
import type { Shop } from "@/types";

type Status = "loading" | "ready" | "error";

interface ShopContextValue {
  status: Status;
  shops: Shop[];
  /** the shop the owner is working on (null until they create one) */
  current: Shop | null;
  error: ApiError | null;
  select: (shopId: string) => void;
  reload: () => Promise<void>;
  /** add or replace a shop after a create/update call */
  upsert: (shop: Shop) => void;
}

const ShopContext = createContext<ShopContextValue | null>(null);

export function ShopProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status>("loading");
  const [shops, setShops] = useState<Shop[]>([]);
  const [error, setError] = useState<ApiError | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setStatus("loading");
    try {
      const res = await shopsApi.list();
      setShops(res.shops);
      setError(null);
      setStatus("ready");
    } catch (err) {
      setError(err instanceof ApiError ? err : new ApiError(0, "UNKNOWN_ERROR", "Unknown error"));
      setStatus("error");
    }
  }, []);

  useEffect(() => {
    setSelectedId(getStoredShopId());
    void reload();
  }, [reload]);

  const select = useCallback((shopId: string) => {
    setSelectedId(shopId);
    setStoredShopId(shopId);
  }, []);

  const upsert = useCallback((shop: Shop) => {
    setShops((prev) =>
      prev.some((s) => s.id === shop.id)
        ? prev.map((s) => (s.id === shop.id ? shop : s))
        : [...prev, shop]
    );
  }, []);

  const current = useMemo(
    () => shops.find((s) => s.id === selectedId) ?? shops[0] ?? null,
    [shops, selectedId]
  );

  const value = useMemo<ShopContextValue>(
    () => ({ status, shops, current, error, select, reload, upsert }),
    [status, shops, current, error, select, reload, upsert]
  );

  return <ShopContext.Provider value={value}>{children}</ShopContext.Provider>;
}

export function useShop(): ShopContextValue {
  const ctx = useContext(ShopContext);
  if (!ctx) throw new Error("useShop must be used inside <ShopProvider>");
  return ctx;
}
