"use client";

import { useCallback, useEffect, useState } from "react";
import { notificationsApi } from "@/lib/api/notifications";

const REFRESH_MS = Number(process.env.NEXT_PUBLIC_NOTIFICATIONS_REFRESH_MS ?? 60000);

// The number on the notifications menu item. A failed read keeps the last number: it never
// invents one.
export function useUnreadCount(enabled = true): { count: number; refresh: () => void } {
  const [count, setCount] = useState(0);

  const refresh = useCallback(() => {
    if (!enabled || document.visibilityState !== "visible") return;
    notificationsApi
      .unreadCount()
      .then(setCount)
      .catch(() => undefined);
  }, [enabled]);

  useEffect(() => {
    refresh();
    const timer = setInterval(refresh, REFRESH_MS);
    const onVisible = () => refresh();
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("dbi:notifications-changed", refresh);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("dbi:notifications-changed", refresh);
    };
  }, [refresh]);

  return { count, refresh };
}
