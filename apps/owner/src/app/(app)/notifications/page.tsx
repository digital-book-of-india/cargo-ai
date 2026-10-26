"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Bell, CheckCheck, RefreshCw } from "lucide-react";
import { PageHeader } from "@/components/common/PageHeader";
import { Alert, ApiErrorState, EmptyState, LoadingState } from "@/components/common/States";
import { EVENT_TYPE_LABEL, EventStatusBadge, SeverityBadge } from "@/components/common/StatusBadges";
import { Badge, Button, Card, Checkbox } from "@/components/ui";
import { useAsync } from "@/hooks/useAsync";
import { notificationsApi } from "@/lib/api/notifications";
import { friendlyMessage } from "@/lib/api/messages";
import { timeAgo } from "@/lib/camera";
import { deliveryNote, sortNotifications } from "@/lib/notifications";
import type { AppNotification } from "@/types";

// How often the list is re-read while the page is open and visible.
const REFRESH_MS = Number(process.env.NEXT_PUBLIC_NOTIFICATIONS_REFRESH_MS ?? 30000);

function announceChange() {
  window.dispatchEvent(new Event("dbi:notifications-changed"));
}

export default function NotificationsPage() {
  const [unreadOnly, setUnreadOnly] = useState(false);
  const loaded = useAsync(() => notificationsApi.list({ unread: unreadOnly, limit: 50 }), [unreadOnly]);
  const [items, setItems] = useState<AppNotification[]>([]);
  const [unread, setUnread] = useState(0);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (loaded.data) {
      setItems(sortNotifications(loaded.data.items));
      setUnread(loaded.data.unreadCount);
    }
  }, [loaded.data]);

  const reloadQuietly = loaded.reload;
  useEffect(() => {
    const poll = setInterval(() => {
      if (document.visibilityState === "visible") reloadQuietly();
    }, REFRESH_MS);
    return () => clearInterval(poll);
  }, [reloadQuietly]);

  const markRead = useCallback(async (n: AppNotification) => {
    if (n.readAt) return;
    try {
      await notificationsApi.markRead(n.id);
      setItems((prev) => prev.map((x) => (x.id === n.id ? { ...x, readAt: new Date().toISOString() } : x)));
      setUnread((c) => Math.max(0, c - 1));
      announceChange();
    } catch {
      // opening the alert still works; the badge catches up on the next refresh
    }
  }, []);

  async function markAllRead() {
    setBusy(true);
    setActionError(null);
    try {
      await notificationsApi.readAll();
      setItems((prev) => prev.map((x) => ({ ...x, readAt: x.readAt ?? new Date().toISOString() })));
      setUnread(0);
      announceChange();
    } catch (err) {
      setActionError(friendlyMessage(err));
    } finally {
      setBusy(false);
    }
  }

  if (loaded.loading && !loaded.data) return <LoadingState label="Loading notifications..." />;
  if (loaded.error && !loaded.data) return <ApiErrorState error={loaded.error} onRetry={loaded.reload} />;

  return (
    <div className="animate-fade-up space-y-5">
      <PageHeader
        title="Notifications"
        description="Everything we have told you about."
        actions={
          <>
            <Button variant="outline" size="sm" onClick={() => void markAllRead()} loading={busy} disabled={unread === 0}>
              <CheckCheck aria-hidden /> Mark all as read
            </Button>
            <Button variant="outline" size="sm" loading={loaded.loading} onClick={loaded.reload}>
              <RefreshCw aria-hidden /> Refresh
            </Button>
          </>
        }
      />

      {loaded.error && <Alert tone="warning">Could not refresh. These may be out of date.</Alert>}
      {actionError && <Alert tone="danger">{actionError}</Alert>}

      <div className="flex items-center gap-2">
        <Checkbox id="unread-only" checked={unreadOnly} onCheckedChange={(v) => setUnreadOnly(v === true)} />
        <label htmlFor="unread-only" className="text-sm">
          Show unread only
        </label>
        <span role="status" aria-live="polite" className="ml-auto text-sm text-muted-foreground">
          {unread === 0 ? "You are all caught up." : `${unread} unread`}
        </span>
      </div>

      {items.length === 0 ? (
        <EmptyState
          icon={<Bell className="size-6" aria-hidden />}
          title={unreadOnly ? "Nothing unread" : "No notifications yet"}
          hint="When the system finds something worth a look, you will be told here."
        />
      ) : (
        <Card>
          <ul className="divide-y" aria-label="Notifications">
            {items.map((n) => {
              const note = deliveryNote(n.status);
              const body = n.event ? (
                <>
                  <div className="flex flex-wrap items-center gap-2">
                    {!n.readAt && <Badge tone="primary">New</Badge>}
                    <span className={n.readAt ? "font-medium" : "font-semibold"}>{EVENT_TYPE_LABEL[n.event.eventType]}</span>
                    <SeverityBadge severity={n.event.severity} />
                    <EventStatusBadge status={n.event.status} />
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {n.event.siteName} · {timeAgo(n.createdAt)}
                  </p>
                </>
              ) : (
                <>
                  <div className="flex flex-wrap items-center gap-2">
                    {!n.readAt && <Badge tone="primary">New</Badge>}
                    <span className="font-medium">An alert you can no longer open</span>
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">{timeAgo(n.createdAt)}</p>
                </>
              );
              return (
                <li key={n.id} className="p-4 sm:p-5">
                  {n.event ? (
                    <Link
                      href={`/sites/${n.event.siteId}/alerts/${n.event.id}`}
                      onClick={() => void markRead(n)}
                      className="block rounded-md hover:text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
                    >
                      {body}
                    </Link>
                  ) : (
                    <div>{body}</div>
                  )}
                  {note && <p className="mt-1 text-xs text-warning">{note}</p>}
                  {!n.readAt && (
                    <Button variant="ghost" size="sm" className="mt-1 -ml-2" onClick={() => void markRead(n)}>
                      Mark as read
                    </Button>
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
