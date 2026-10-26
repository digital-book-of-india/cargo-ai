"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { Bell, ChevronRight, RefreshCw } from "lucide-react";
import { PageHeader } from "@/components/common/PageHeader";
import { Alert, ApiErrorState, EmptyState, LoadingState } from "@/components/common/States";
import { Badge, Button, Card } from "@/components/ui";
import { useAsync } from "@/hooks/useAsync";
import { notificationsApi } from "@/lib/api/notifications";
import { timeAgo } from "@/lib/camera";
import {
  CHANNEL_LABEL,
  DELIVERY_META,
  applyLatestNotifications,
  countFailed,
  notificationShopId,
  sortNotifications,
} from "@/lib/notifications";
import type { OwnerNotification } from "@/lib/notifications";
import { useShop } from "@/lib/shop/ShopProvider";
import { formatInTimezone } from "@/lib/utils/time";

// How often the list is re-read while the page is open and visible.
const NOTIFICATIONS_REFRESH_MS = Number(process.env.NEXT_PUBLIC_NOTIFICATIONS_REFRESH_MS ?? 30000);

export default function NotificationsPage() {
  const { current, shops } = useShop();
  const first = useAsync(async () => {
    const res = await notificationsApi.list();
    return sortNotifications((res.notifications ?? []) as OwnerNotification[]);
  }, []);
  const { error, loading, reload } = first;

  const [items, setItems] = useState<OwnerNotification[] | null>(null);
  const [newCount, setNewCount] = useState(0);
  const [refreshFailed, setRefreshFailed] = useState(false);
  const [, setClock] = useState(0);
  const itemsRef = useRef<OwnerNotification[] | null>(null);
  itemsRef.current = items;
  const busy = useRef(false);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // a full (manual) load replaces what is shown
  useEffect(() => {
    if (first.data) {
      setItems(first.data);
      setNewCount(0);
      setRefreshFailed(false);
    }
  }, [first.data]);

  // quiet re-read: no spinner, new rows are counted
  const refreshQuietly = useCallback(async () => {
    if (busy.current || document.visibilityState !== "visible" || !itemsRef.current) return;
    busy.current = true;
    try {
      const res = await notificationsApi.list();
      if (!mounted.current) return;
      const merged = applyLatestNotifications(itemsRef.current ?? [], (res.notifications ?? []) as OwnerNotification[]);
      setItems(merged.items);
      if (merged.newCount > 0) setNewCount((n) => n + merged.newCount);
      setRefreshFailed(false);
    } catch {
      if (mounted.current) setRefreshFailed(true);
    } finally {
      busy.current = false;
    }
  }, []);

  useEffect(() => {
    const poll = setInterval(() => void refreshQuietly(), NOTIFICATIONS_REFRESH_MS);
    const clock = setInterval(() => setClock((c) => c + 1), 30000);
    const onVisible = () => {
      if (document.visibilityState === "visible") void refreshQuietly();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(poll);
      clearInterval(clock);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [refreshQuietly]);

  if (loading && !items) return <LoadingState label="Loading notifications..." />;
  if (error && !items) return <ApiErrorState error={error} onRetry={reload} />;
  if (!items) return null;
  const data = items;

  const failed = countFailed(data);

  return (
    <div className="animate-fade-up space-y-5">
      <PageHeader
        title="Notifications"
        description="Everything we have told you about."
        actions={
          <>
            <Button asChild variant="ghost" size="sm">
              <Link href="/settings">Settings</Link>
            </Button>
            <Button variant="outline" size="sm" loading={loading} onClick={reload}>
              <RefreshCw aria-hidden /> Refresh
            </Button>
          </>
        }
      />

      {(error || refreshFailed) && (
        <Alert tone="warning">Could not refresh. This list may be out of date.</Alert>
      )}
      {newCount > 0 && (
        <Alert tone="info">
          {newCount} new notification{newCount === 1 ? "" : "s"} arrived.
        </Alert>
      )}
      {failed > 0 && (
        <Alert tone="warning">
          {failed} message{failed === 1 ? "" : "s"} could not be delivered. Check your alerts so you do
          not miss anything.
        </Alert>
      )}

      {data.length === 0 ? (
        <EmptyState
          icon={<Bell className="size-6" aria-hidden />}
          title="No notifications yet"
          hint="When we notify you about an alert, it will be listed here."
        />
      ) : (
        <Card>
          <ul className="divide-y" aria-label="Notifications">
            {data.map((n) => {
              const d = DELIVERY_META[n.status] ?? DELIVERY_META.PENDING;
              const shopId = notificationShopId(n, current?.id ?? null);
              // time in the zone of the shop the notification belongs to
              const tz = shops.find((s) => s.id === shopId)?.timezone ?? current?.timezone ?? "UTC";
              const href = n.eventId && shopId ? `/shops/${shopId}/alerts/${n.eventId}` : null;
              const inner = (
                <>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">
                        {n.eventId ? "Alert notification" : "Notification"}
                      </span>
                      <Badge tone="neutral">{CHANNEL_LABEL[n.channel] ?? n.channel}</Badge>
                      <Badge tone={d.tone} dot>
                        {d.label}
                      </Badge>
                    </div>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {formatInTimezone(n.createdAt, tz)} ({timeAgo(n.createdAt)})
                    </p>
                    {d.hint && n.status === "FAILED" && (
                      <p className="mt-1 text-xs font-medium text-destructive">{d.hint}</p>
                    )}
                  </div>
                  {href && <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />}
                </>
              );
              return (
                <li key={n.id}>
                  {href ? (
                    <Link
                      href={href}
                      className="flex items-center gap-3 p-4 transition-colors hover:bg-accent/50 sm:p-5"
                    >
                      {inner}
                    </Link>
                  ) : (
                    <div className="flex items-center gap-3 p-4 sm:p-5">{inner}</div>
                  )}
                </li>
              );
            })}
          </ul>
        </Card>
      )}
    </div>
  );
}
