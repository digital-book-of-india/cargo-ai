"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  Activity,
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  BarChart3,
  Boxes,
  Camera,
  CheckCircle2,
  Clock,
  Eye,
} from "lucide-react";
import { PageHeader } from "@/components/common/PageHeader";
import { ApiErrorState, LoadingState } from "@/components/common/States";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, SelectField } from "@/components/ui";
import { useAsync } from "@/hooks/useAsync";
import { eventsApi } from "@/lib/api/events";
import { visionApi } from "@/lib/api/vision";
import { useShop } from "@/lib/shop/ShopProvider";
import type { SecurityEvent, Shop, VisionCameraMonitoringStatus, VisionCountSummaryRow } from "@dbi/api-types";

function DashboardContent({ shop }: { shop: Shop }) {
  const shopId = shop.id;
  const [range, setRange] = useState<"today" | "week" | "month">("week");

  const fromIso =
    range === "today"
      ? new Date(new Date().setHours(0, 0, 0, 0)).toISOString()
      : range === "week"
        ? new Date(Date.now() - 7 * 86400000).toISOString()
        : new Date(Date.now() - 30 * 86400000).toISOString();
  const toIso = new Date().toISOString();

  // Zone Summary
  const countsQuery = useAsync(async () => {
    try {
      const res = await visionApi.getSummary(shopId, "zone", fromIso, toIso);
      return res.items;
    } catch {
      return [] as VisionCountSummaryRow[];
    }
  }, [shopId, range]);

  // Daily Trend Summary (FR-09 / Section 13 Count Trend)
  const trendQuery = useAsync(async () => {
    try {
      const res = await visionApi.getSummary(shopId, "day", fromIso, toIso);
      return res.items;
    } catch {
      return [] as VisionCountSummaryRow[];
    }
  }, [shopId, range]);

  // Shift Breakdown Summary
  const shiftQuery = useAsync(async () => {
    try {
      const res = await visionApi.getSummary(shopId, "shift", fromIso, toIso);
      return res.items;
    } catch {
      return [] as VisionCountSummaryRow[];
    }
  }, [shopId, range]);

  // Camera & AI Health Status (including QA-12 limitations)
  const monitoringQuery = useAsync(async () => {
    try {
      const res = await visionApi.getStatus(shopId);
      return res.items;
    } catch {
      return [] as VisionCameraMonitoringStatus[];
    }
  }, [shopId]);

  // Unresolved Alerts from Dev 1 Events API
  const alertsQuery = useAsync(async () => {
    try {
      const res = await eventsApi.list(shopId, { limit: 6 });
      return res.items as SecurityEvent[];
    } catch {
      return [] as SecurityEvent[];
    }
  }, [shopId]);

  const counts = countsQuery.data ?? [];
  const totalIn = counts.reduce((acc, c) => acc + c.in, 0);
  const totalOut = counts.reduce((acc, c) => acc + c.out, 0);
  const totalMovement = totalIn + totalOut;

  const trendRows = trendQuery.data ?? [];
  const maxTrendTotal = Math.max(1, ...trendRows.map((r) => r.total));

  const shiftRows = shiftQuery.data ?? [];

  const monitors = monitoringQuery.data ?? [];
  const liveCount = monitors.filter((m) => m.coverage === "LIVE").length;
  const totalMonitors = monitors.length;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <PageHeader
          title={`${shop.name} — Cargo Intelligence`}
          description="Operational package tracking, line-crossing counts, count trends, and camera security health."
        />
        <div className="w-44">
          <SelectField
            label=""
            value={range}
            onValueChange={(v) => setRange(v as "today" | "week" | "month")}
            options={[
              { value: "today", label: "Today" },
              { value: "week", label: "Past 7 Days" },
              { value: "month", label: "Past 30 Days" },
            ]}
          />
        </div>
      </div>

      {/* Primary KPI Cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Total Movement</CardTitle>
            <Boxes className="h-4 w-4 text-primary" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{totalMovement}</div>
            <p className="text-xs text-muted-foreground mt-1">Observed package crossings</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Inbound (IN)</CardTitle>
            <ArrowDownRight className="h-4 w-4 text-emerald-500" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-emerald-600 dark:text-emerald-400">{totalIn}</div>
            <p className="text-xs text-muted-foreground mt-1">Received into warehouse</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Outbound (OUT)</CardTitle>
            <ArrowUpRight className="h-4 w-4 text-blue-500" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-blue-600 dark:text-blue-400">{totalOut}</div>
            <p className="text-xs text-muted-foreground mt-1">Dispatched from loading bays</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Monitoring Coverage</CardTitle>
            <Activity className="h-4 w-4 text-amber-500" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">
              {liveCount} <span className="text-sm font-normal text-muted-foreground">/ {totalMonitors} Live</span>
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              {monitors.some((m) => m.coverage === "OFFLINE")
                ? "Cameras require attention"
                : "All active cameras nominal"}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Count Trend & Shift Breakdown */}
      <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <BarChart3 className="h-4 w-4 text-primary" /> Daily Count Trend
                </CardTitle>
                <CardDescription>Package IN/OUT movement grouped by site date ({shop.timezone || "Asia/Kolkata"})</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {trendRows.length === 0 ? (
              <p className="text-sm text-muted-foreground py-8 text-center">
                No package crossings recorded for the selected date range.
              </p>
            ) : (
              <div className="space-y-3">
                {trendRows.map((row) => {
                  const pct = Math.max(4, Math.round((row.total / maxTrendTotal) * 100));
                  return (
                    <div key={row.key} className="space-y-1 text-xs">
                      <div className="flex items-center justify-between font-medium">
                        <span>{row.key}</span>
                        <span className="font-mono">
                          <span className="text-emerald-500">IN: {row.in}</span> •{" "}
                          <span className="text-blue-500">OUT: {row.out}</span> •{" "}
                          <strong>Total: {row.total}</strong>
                        </span>
                      </div>
                      <div className="h-2.5 w-full overflow-hidden rounded-full bg-muted">
                        <div
                          className="h-full bg-primary transition-all"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Shift Summary</CardTitle>
            <CardDescription>Counts grouped by warehouse shift</CardDescription>
          </CardHeader>
          <CardContent>
            {shiftRows.length === 0 ? (
              <p className="text-sm text-muted-foreground py-8 text-center">
                No shift activity in this window.
              </p>
            ) : (
              <div className="divide-y divide-border text-sm">
                {shiftRows.map((s) => (
                  <div key={s.key} className="py-3 flex items-center justify-between">
                    <div>
                      <div className="font-medium">{s.key}</div>
                      <div className="text-xs text-muted-foreground">
                        IN: {s.in} • OUT: {s.out}
                      </div>
                    </div>
                    <div className="text-lg font-bold font-mono">{s.total}</div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Camera Monitoring Status Grid with QA-12 Limitations */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle>Camera & AI Monitoring Health</CardTitle>
                <CardDescription>Live stream status, frame rates, worker status, and coverage limitations (QA-12)</CardDescription>
              </div>
              <Link href={`/shops/${shopId}/cameras`} className="text-xs text-primary hover:underline">
                Manage
              </Link>
            </div>
          </CardHeader>
          <CardContent>
            {monitors.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4">No cameras configured for this site.</p>
            ) : (
              <div className="divide-y divide-border">
                {monitors.map((m) => (
                  <div key={m.cameraId} className="py-3 text-sm space-y-2">
                    <div className="flex items-center justify-between">
                      <div className="space-y-0.5">
                        <div className="font-medium flex items-center gap-2">
                          <Camera className="h-4 w-4 text-muted-foreground" />
                          <Link
                            href={`/shops/${shopId}/cameras/${m.cameraId}/live`}
                            className="hover:underline"
                          >
                            {m.cameraName}
                          </Link>
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {m.activeZoneCount} active zone(s) •{" "}
                          {m.frameRate ? `${m.frameRate.toFixed(1)} fps` : "No frame rate"} • Worker:{" "}
                          {m.workerStatus}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <Link
                          href={`/shops/${shopId}/cameras/${m.cameraId}/live`}
                          className="text-xs border rounded px-2 py-0.5 hover:bg-muted inline-flex items-center gap-1"
                        >
                          <Eye className="h-3 w-3" /> Live
                        </Link>
                        <span
                          className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                            m.coverage === "LIVE"
                              ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20"
                              : m.coverage === "DEGRADED"
                                ? "bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20"
                                : "bg-destructive/10 text-destructive border border-destructive/20"
                          }`}
                        >
                          {m.coverage}
                        </span>
                      </div>
                    </div>
                    {m.limitations && m.limitations.length > 0 && (
                      <div className="flex flex-wrap items-center gap-1.5 pl-6">
                        {m.limitations.map((lim) => (
                          <span
                            key={lim}
                            className="inline-flex items-center gap-1 rounded bg-amber-500/10 px-2 py-0.5 text-[11px] font-mono text-amber-600 dark:text-amber-400 border border-amber-500/20"
                          >
                            <AlertTriangle className="h-3 w-3" />
                            {lim}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Recent Events & Alerts */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle>Unresolved Cargo Alerts & Events</CardTitle>
                <CardDescription>Line crossing activity and restricted zone anomalies</CardDescription>
              </div>
              <Link href={`/shops/${shopId}/alerts`} className="text-xs text-primary hover:underline">
                View all
              </Link>
            </div>
          </CardHeader>
          <CardContent>
            {!alertsQuery.data || alertsQuery.data.length === 0 ? (
              <div className="text-center py-6 text-muted-foreground text-sm">
                <CheckCircle2 className="mx-auto h-8 w-8 text-emerald-500 mb-2 opacity-80" />
                No unresolved cargo alerts.
              </div>
            ) : (
              <div className="divide-y divide-border">
                {alertsQuery.data.map((evt) => (
                  <div key={evt.id} className="flex items-center justify-between py-3 text-sm">
                    <div className="space-y-0.5">
                      <div className="font-medium capitalize">
                        {evt.eventType.replace(/_/g, " ")}
                      </div>
                      <div className="text-xs text-muted-foreground flex items-center gap-2">
                        <Clock className="h-3 w-3" />
                        {new Date(evt.startedAt).toLocaleTimeString()} • Status: {evt.reviewStatus}
                      </div>
                    </div>
                    <Link
                      href={`/shops/${shopId}/alerts/${evt.id}`}
                      className="text-xs border rounded px-2.5 py-1 hover:bg-muted"
                    >
                      Review
                    </Link>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

export default function DashboardPage() {
  const { status, current, error, reload } = useShop();
  const router = useRouter();

  useEffect(() => {
    if (status === "ready" && !current) router.replace("/onboarding");
  }, [status, current, router]);

  if (status === "error" && !current) {
    return <ApiErrorState error={error!} onRetry={() => void reload()} />;
  }
  if (status !== "ready" || !current) return <LoadingState />;

  return <DashboardContent key={current.id} shop={current} />;
}
