"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { Bell, ChevronRight, RefreshCw } from "lucide-react";
import { DemoBadge } from "@/components/common/DemoBadge";
import { PageHeader } from "@/components/common/PageHeader";
import { Alert, ApiErrorState, EmptyState, LoadingState } from "@/components/common/States";
import { EVENT_TYPE_LABEL, ReviewStatusBadge } from "@/components/common/StatusBadges";
import { Badge, Button, Card, SelectField } from "@/components/ui";
import { useAsync } from "@/hooks/useAsync";
import { camerasApi } from "@/lib/api/cameras";
import { eventsApi } from "@/lib/api/events";
import { friendlyMessage } from "@/lib/api/messages";
import { shopsApi } from "@/lib/api/shops";
import { timeAgo } from "@/lib/camera";
import {
  NO_FILTER,
  applyLatest,
  confidenceLabel,
  countByReview,
  filterEvents,
  isFiltered,
  mergeEvents,
  sortEvents,
} from "@/lib/events";
import type { EventFilter, OwnerEvent } from "@/lib/events";
import { cn } from "@/lib/utils/cn";
import { formatInTimezone } from "@/lib/utils/time";
import type { Camera, EventType, ReviewStatus, Shop } from "@/types";

const PAGE_SIZE = 10;
// How often the newest alerts are re-read while the page is open and visible.
const ALERTS_REFRESH_MS = Number(process.env.NEXT_PUBLIC_ALERTS_REFRESH_MS ?? 30000);

const REVIEW_TABS: Array<{ value: ReviewStatus | "ALL"; label: string }> = [
  { value: "ALL", label: "All" },
  { value: "NEW", label: "New" },
  { value: "REVIEWED", label: "Reviewed" },
  { value: "CONFIRMED", label: "Confirmed" },
  { value: "FALSE_ALARM", label: "False alarm" },
];

const TYPE_OPTIONS = [
  { value: "ALL", label: "All types" },
  ...(Object.keys(EVENT_TYPE_LABEL) as EventType[]).map((t) => ({ value: t, label: EVENT_TYPE_LABEL[t] })),
];

interface FirstPage {
  shop: Shop;
  cameras: Camera[];
  items: OwnerEvent[];
  nextCursor: string | null;
}

export default function AlertsPage() {
  const { shopId } = useParams<{ shopId: string }>();
  const { data, error, loading, reload } = useAsync<FirstPage>(async () => {
    const [{ shop }, { cameras }, page] = await Promise.all([
      shopsApi.get(shopId),
      camerasApi.list(shopId),
      eventsApi.list(shopId, { limit: PAGE_SIZE }),
    ]);
    return { shop, cameras, items: page.items, nextCursor: page.nextCursor ?? null };
  }, [shopId]);

  const [items, setItems] = useState<OwnerEvent[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [filter, setFilter] = useState<EventFilter>(NO_FILTER);
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreError, setMoreError] = useState<string | null>(null);
  const [newCount, setNewCount] = useState(0);
  const [refreshFailed, setRefreshFailed] = useState(false);
  const [, setClock] = useState(0);
  const mounted = useRef(true);
  const busy = useRef(false);
  const itemsRef = useRef<OwnerEvent[]>([]);
  itemsRef.current = items;

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    if (data) {
      setItems(sortEvents(data.items));
      setNextCursor(data.nextCursor);
      setMoreError(null);
      setNewCount(0);
      setRefreshFailed(false);
    }
  }, [data]);

  // New alerts and review changes made elsewhere show up without a click.
  const refreshQuietly = useCallback(async () => {
    if (busy.current || document.visibilityState !== "visible") return;
    busy.current = true;
    try {
      const page = await eventsApi.list(shopId, { limit: PAGE_SIZE });
      if (!mounted.current) return;
      const res = applyLatest(itemsRef.current, page.items);
      setItems(res.items);
      if (res.newCount > 0) setNewCount((n) => n + res.newCount);
      setRefreshFailed(false);
    } catch {
      if (mounted.current) setRefreshFailed(true);
    } finally {
      busy.current = false;
    }
  }, [shopId]);

  useEffect(() => {
    const poll = setInterval(() => void refreshQuietly(), ALERTS_REFRESH_MS);
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

  async function loadMore() {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    setMoreError(null);
    try {
      const page = await eventsApi.list(shopId, { limit: PAGE_SIZE, cursor: nextCursor });
      setItems((prev) => sortEvents(mergeEvents(prev, page.items)));
      setNextCursor(page.nextCursor ?? null);
    } catch (err) {
      setMoreError(friendlyMessage(err));
    } finally {
      setLoadingMore(false);
    }
  }

  if (loading && !data) return <LoadingState label="Loading alerts..." />;
  if (error && !data) return <ApiErrorState error={error} onRetry={reload} />;
  if (!data) return null;

  const { shop, cameras } = data;
  const cameraName = (id: string) => cameras.find((c) => c.id === id)?.name;
  const counts = countByReview(items);
  const visible = filterEvents(items, filter);
  const filtered = isFiltered(filter);

  return (
    <div className="animate-fade-up space-y-5">
      <PageHeader
        title="Alerts"
        description={`Suspected activity near the shutter at ${shop.name}.`}
        actions={
          <Button variant="outline" size="sm" loading={loading} onClick={reload}>
            <RefreshCw aria-hidden /> Refresh
          </Button>
        }
      />

      {(error || refreshFailed) && (
        <Alert tone="warning">Could not refresh. These alerts may be out of date.</Alert>
      )}
      {newCount > 0 && (
        <Alert tone="info">
          {newCount} new alert{newCount === 1 ? "" : "s"} arrived.
        </Alert>
      )}

      {items.length === 0 ? (
        <EmptyState
          icon={<Bell className="size-6" aria-hidden />}
          title="No alerts yet"
          hint="When something is detected near your shutter after closing time, it will show up here. No alerts does not guarantee that nothing happened."
        />
      ) : (
        <>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div role="group" aria-label="Filter by review status" className="flex flex-wrap gap-2">
              {REVIEW_TABS.map((t) => {
                const active = filter.review === t.value;
                return (
                  <button
                    key={t.value}
                    type="button"
                    aria-pressed={active}
                    onClick={() => setFilter((f) => ({ ...f, review: t.value }))}
                    className={cn(
                      "rounded-full border px-3 py-1.5 text-sm font-medium transition-colors",
                      active
                        ? "border-primary bg-primary text-primary-foreground"
                        : "bg-background hover:bg-accent"
                    )}
                  >
                    {t.label}{" "}
                    <span className={cn("tabular-nums", active ? "opacity-90" : "text-muted-foreground")}>
                      {counts[t.value]}
                    </span>
                  </button>
                );
              })}
            </div>
            <div className="sm:w-64">
              <SelectField
                label="Type"
                value={filter.type}
                onValueChange={(v) => setFilter((f) => ({ ...f, type: v as EventFilter["type"] }))}
                options={TYPE_OPTIONS}
              />
            </div>
          </div>

          {filtered && nextCursor && (
            <p className="text-sm text-muted-foreground">
              Filters apply to the alerts loaded so far. Load more to search older alerts.
            </p>
          )}

          {visible.length === 0 ? (
            <EmptyState
              title="No alerts match these filters"
              hint="Try a different status or type."
              action={
                <Button variant="outline" onClick={() => setFilter(NO_FILTER)}>
                  Clear filters
                </Button>
              }
            />
          ) : (
            <Card>
              <ul className="divide-y" aria-label="Alerts">
                {visible.map((e) => {
                  const conf = confidenceLabel(e.confidence);
                  const camera = cameraName(e.cameraId);
                  return (
                    <li key={e.id}>
                      <Link
                        href={`/shops/${shopId}/alerts/${e.id}`}
                        className="flex items-center gap-3 p-4 transition-colors hover:bg-accent/50 sm:p-5"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className={cn("font-medium", e.reviewStatus === "NEW" && "font-semibold")}>
                              {EVENT_TYPE_LABEL[e.eventType] ?? "Alert"}
                            </span>
                            <ReviewStatusBadge status={e.reviewStatus} />
                            {e.demoFlag && <DemoBadge />}
                          </div>
                          <p className="mt-1 text-sm text-muted-foreground">
                            {formatInTimezone(e.startedAt, shop.timezone)} ({timeAgo(e.startedAt)})
                            {camera ? ` · ${camera}` : ""}
                          </p>
                        </div>
                        {conf && (
                          <Badge tone="neutral" className="hidden sm:inline-flex">
                            {conf} confidence
                          </Badge>
                        )}
                        <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </Card>
          )}

          {moreError && <Alert tone="danger">{moreError}</Alert>}

          {nextCursor && (
            <div className="flex justify-center">
              <Button variant="outline" loading={loadingMore} onClick={() => void loadMore()}>
                Load more
              </Button>
            </div>
          )}
          {!nextCursor && items.length > PAGE_SIZE && (
            <p className="text-center text-sm text-muted-foreground">That is all the alerts.</p>
          )}
        </>
      )}
    </div>
  );
}
