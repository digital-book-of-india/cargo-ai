"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Bell, ChevronRight, RefreshCw } from "lucide-react";
import { DemoBadge } from "@/components/common/DemoBadge";
import { PageHeader } from "@/components/common/PageHeader";
import { Alert, ApiErrorState, EmptyState, LoadingState } from "@/components/common/States";
import { EVENT_TYPE_LABEL, EventStatusBadge, SeverityBadge } from "@/components/common/StatusBadges";
import { Button, Card, Checkbox, SelectField } from "@/components/ui";
import { ApiError } from "@/lib/api/client";
import { eventsApi } from "@/lib/api/events";
import type { EventQuery } from "@/lib/api/events";
import { friendlyMessage } from "@/lib/api/messages";
import { timeAgo } from "@/lib/camera";
import { DATE_RANGE_OPTIONS, applyLatest, mergeEvents, rangeStart, sortEvents } from "@/lib/events";
import type { DateRange } from "@/lib/events";
import { useSite } from "@/lib/site/SiteProvider";
import { cn } from "@/lib/utils/cn";
import { formatInTimezone } from "@/lib/utils/time";
import type { CargoEventSeverity, CargoEventStatus, CargoEventSummary, CargoEventType, EventSummaryCounts } from "@/types";

const PAGE_SIZE = 20;
const REFRESH_MS = Number(process.env.NEXT_PUBLIC_ALERTS_REFRESH_MS ?? 30000);

const STATUS_TABS: Array<{ value: CargoEventStatus | "ALL"; label: string }> = [
  { value: "ALL", label: "All" },
  { value: "open", label: "Open" },
  { value: "acknowledged", label: "Acknowledged" },
  { value: "in_review", label: "In review" },
  { value: "escalated", label: "Escalated" },
  { value: "resolved", label: "Resolved" },
  { value: "false_positive", label: "False alarm" },
];

const SEVERITY_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "ALL", label: "Any severity" },
  { value: "critical", label: "Critical" },
  { value: "high", label: "High" },
  { value: "medium", label: "Medium" },
  { value: "low", label: "Low" },
];

const TYPE_OPTIONS = [
  { value: "ALL", label: "Any type" },
  ...(Object.keys(EVENT_TYPE_LABEL) as CargoEventType[]).map((t) => ({ value: t, label: EVENT_TYPE_LABEL[t] })),
];

// The alerts inbox. With a siteId it shows one site; without, every site this person can see.
// Filtering happens on the server, so the counts and the list always agree.
export function EventInbox({ siteId }: { siteId?: string }) {
  const { sites } = useSite();
  const [status, setStatus] = useState<CargoEventStatus | "ALL">("ALL");
  const [severity, setSeverity] = useState("ALL");
  const [type, setType] = useState("ALL");
  const [siteFilter, setSiteFilter] = useState("ALL");
  const [range, setRange] = useState<DateRange>("ALL");
  const [mine, setMine] = useState(false);

  const [items, setItems] = useState<CargoEventSummary[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [counts, setCounts] = useState<EventSummaryCounts | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [moreError, setMoreError] = useState<string | null>(null);
  const [refreshFailed, setRefreshFailed] = useState(false);
  const [newCount, setNewCount] = useState(0);
  const [, setClock] = useState(0);
  const [retryTick, setRetryTick] = useState(0);
  const mounted = useRef(true);
  const busy = useRef(false);
  const itemsRef = useRef<CargoEventSummary[]>([]);
  itemsRef.current = items;

  const effectiveSite = siteId ?? (siteFilter === "ALL" ? undefined : siteFilter);
  const filterKey = [effectiveSite, status, severity, type, range, mine].join("|");

  const baseQuery = useMemo<EventQuery>(
    () => ({
      siteId: effectiveSite,
      status: status === "ALL" ? undefined : status,
      severity: severity === "ALL" ? undefined : (severity as CargoEventSeverity),
      eventType: type === "ALL" ? undefined : (type as CargoEventType),
      assignedTo: mine ? "me" : undefined,
      from: rangeStart(range),
    }),
    // rangeStart depends on the clock; the key changes only when a filter changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [filterKey]
  );

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const loadCounts = useCallback(async () => {
    try {
      const c = await eventsApi.summary({ siteId: baseQuery.siteId, assignedTo: baseQuery.assignedTo, from: baseQuery.from });
      if (mounted.current) setCounts(c);
    } catch {
      // the list still works; the tab numbers just stay as they were
    }
  }, [baseQuery]);

  // a filter change starts over
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setMoreError(null);
    setNewCount(0);
    setRefreshFailed(false);
    eventsApi
      .query({ ...baseQuery, limit: PAGE_SIZE })
      .then((page) => {
        if (cancelled) return;
        setItems(sortEvents(page.items));
        setNextCursor(page.nextCursor ?? null);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof ApiError ? err : new ApiError(0, "UNKNOWN_ERROR", "Something went wrong."));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    void loadCounts();
    return () => {
      cancelled = true;
    };
  }, [baseQuery, loadCounts, retryTick]);

  // new alerts and review changes made elsewhere appear without a click
  const refreshQuietly = useCallback(async () => {
    if (busy.current || document.visibilityState !== "visible") return;
    busy.current = true;
    try {
      const page = await eventsApi.query({ ...baseQuery, limit: PAGE_SIZE });
      if (!mounted.current) return;
      const res = applyLatest(itemsRef.current, page.items);
      setItems(res.items);
      if (res.newCount > 0) setNewCount((n) => n + res.newCount);
      setRefreshFailed(false);
      void loadCounts();
    } catch {
      if (mounted.current) setRefreshFailed(true);
    } finally {
      busy.current = false;
    }
  }, [baseQuery, loadCounts]);

  useEffect(() => {
    const poll = setInterval(() => void refreshQuietly(), REFRESH_MS);
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
      const page = await eventsApi.query({ ...baseQuery, limit: PAGE_SIZE, cursor: nextCursor });
      setItems((prev) => sortEvents(mergeEvents(prev, page.items)));
      setNextCursor(page.nextCursor ?? null);
    } catch (err) {
      setMoreError(friendlyMessage(err));
    } finally {
      setLoadingMore(false);
    }
  }

  const siteName = sites.find((s) => s.id === siteId)?.name;
  const filtered = status !== "ALL" || severity !== "ALL" || type !== "ALL" || range !== "ALL" || mine || siteFilter !== "ALL";

  function clearFilters() {
    setStatus("ALL");
    setSeverity("ALL");
    setType("ALL");
    setRange("ALL");
    setMine(false);
    setSiteFilter("ALL");
  }

  return (
    <div className="animate-fade-up space-y-5">
      <PageHeader
        title="Alerts"
        description={
          siteName
            ? `Alerts for ${siteName}. Each one is an automatic suggestion that needs a person to check it.`
            : "Alerts from every site you can see. Each one is an automatic suggestion that needs a person to check it."
        }
        actions={
          <Button variant="outline" size="sm" loading={loading} onClick={() => void refreshQuietly()}>
            <RefreshCw aria-hidden /> Refresh
          </Button>
        }
      />

      {(refreshFailed || (error && items.length > 0)) && (
        <Alert tone="warning">Could not refresh. These alerts may be out of date.</Alert>
      )}
      {newCount > 0 && (
        <Alert tone="info">
          {newCount} new alert{newCount === 1 ? "" : "s"} arrived.
        </Alert>
      )}

      <div role="group" aria-label="Filter by status" className="flex flex-wrap gap-2">
        {STATUS_TABS.map((t) => {
          const active = status === t.value;
          const n = counts ? (t.value === "ALL" ? counts.total : counts.byStatus[t.value]) : null;
          return (
            <button
              key={t.value}
              type="button"
              aria-pressed={active}
              onClick={() => setStatus(t.value)}
              className={cn(
                "rounded-full border px-3 py-1.5 text-sm font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary",
                active ? "border-primary bg-primary text-primary-foreground" : "bg-background hover:bg-accent"
              )}
            >
              {t.label}
              {n !== null && (
                <span className={cn("ml-1.5 tabular-nums", active ? "opacity-90" : "text-muted-foreground")}>{n}</span>
              )}
            </button>
          );
        })}
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {!siteId && sites.length > 1 && (
          <SelectField
            label="Site"
            value={siteFilter}
            onValueChange={setSiteFilter}
            options={[{ value: "ALL", label: "All sites" }, ...sites.map((s) => ({ value: s.id, label: s.name }))]}
          />
        )}
        <SelectField label="Severity" value={severity} onValueChange={setSeverity} options={SEVERITY_OPTIONS} />
        <SelectField label="Type" value={type} onValueChange={setType} options={TYPE_OPTIONS} />
        <SelectField label="When" value={range} onValueChange={(v) => setRange(v as DateRange)} options={DATE_RANGE_OPTIONS} />
      </div>
      <div className="flex items-center gap-2">
        <Checkbox id="assigned-to-me" checked={mine} onCheckedChange={(v) => setMine(v === true)} />
        <label htmlFor="assigned-to-me" className="text-sm">
          Assigned to me
        </label>
      </div>

      <p role="status" aria-live="polite" className="sr-only">
        {loading ? "Loading alerts" : `${items.length} alert${items.length === 1 ? "" : "s"} shown`}
      </p>

      {loading && items.length === 0 ? (
        <LoadingState label="Loading alerts..." />
      ) : error && items.length === 0 ? (
        <ApiErrorState error={error} onRetry={() => setRetryTick((t) => t + 1)} />
      ) : items.length === 0 ? (
        filtered ? (
          <EmptyState
            title="No alerts match these filters"
            hint="Try a different status, severity or time range."
            action={
              <Button variant="outline" onClick={clearFilters}>
                Clear filters
              </Button>
            }
          />
        ) : (
          <EmptyState
            icon={<Bell className="size-6" aria-hidden />}
            title="No alerts yet"
            hint="When the system detects something worth a look, it shows up here. No alerts does not guarantee that nothing happened."
          />
        )
      ) : (
        <>
          <Card>
            <ul className="divide-y" aria-label="Alerts">
              {items.map((e) => (
                <li key={e.id}>
                  <Link
                    href={`/sites/${e.siteId}/alerts/${e.id}`}
                    className="flex items-center gap-3 p-4 transition-colors hover:bg-accent/50 focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary sm:p-5"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className={cn("font-medium", e.status === "open" && "font-semibold")}>
                          {EVENT_TYPE_LABEL[e.eventType] ?? "Alert"}
                        </span>
                        <EventStatusBadge status={e.status} />
                        <SeverityBadge severity={e.severity} />
                        {e.demo && <DemoBadge />}
                      </div>
                      <p className="mt-1 text-sm text-muted-foreground">
                        {formatInTimezone(e.occurredAt, sites.find((s) => s.id === e.siteId)?.timezone ?? "UTC")} (
                        {timeAgo(e.occurredAt)}) · {!siteId ? `${e.site.name} · ` : ""}
                        {e.camera.name}
                        {e.assignedTo ? ` · assigned to ${e.assignedTo.name}` : ""}
                      </p>
                    </div>
                    <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                  </Link>
                </li>
              ))}
            </ul>
          </Card>

          {moreError && <Alert tone="danger">{moreError}</Alert>}
          {nextCursor ? (
            <div className="flex justify-center">
              <Button variant="outline" loading={loadingMore} onClick={() => void loadMore()}>
                Load more
              </Button>
            </div>
          ) : (
            items.length > PAGE_SIZE && <p className="text-center text-sm text-muted-foreground">That is all the alerts.</p>
          )}
        </>
      )}
    </div>
  );
}
