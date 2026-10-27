"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
  ArrowLeft,
  Camera as CameraIcon,
  CheckCircle2,
  Clock,
  Radio,
  Video,
} from "lucide-react";
import { CameraStatusBadge } from "@/components/common/StatusBadges";
import { PageHeader } from "@/components/common/PageHeader";
import { ApiErrorState, EmptyState, LoadingState } from "@/components/common/States";
import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui";
import { useAsync } from "@/hooks/useAsync";
import { camerasApi } from "@/lib/api/cameras";
import { visionApi } from "@/lib/api/vision";
import type { Camera, VisionCountLedgerRow, VisionZone } from "@dbi/api-types";

export default function CameraLivePage() {
  const { shopId, cameraId } = useParams<{ shopId: string; cameraId: string }>();

  const cameraQuery = useAsync<Camera | null>(async () => {
    const { cameras } = await camerasApi.list(shopId);
    return cameras.find((c) => c.id === cameraId) ?? null;
  }, [shopId, cameraId]);

  const zonesQuery = useAsync<VisionZone[]>(async () => {
    const res = await visionApi.listZones(shopId, cameraId);
    return res.items;
  }, [shopId, cameraId]);

  const ledgerQuery = useAsync<VisionCountLedgerRow[]>(async () => {
    const res = await visionApi.getLedger(shopId, { cameraId });
    return res.items;
  }, [shopId, cameraId]);

  if (cameraQuery.loading && !cameraQuery.data) return <LoadingState label="Loading camera live HUD..." />;
  if (cameraQuery.error) return <ApiErrorState error={cameraQuery.error} onRetry={cameraQuery.reload} />;
  if (!cameraQuery.data) return <EmptyState title="Camera not found" />;

  const camera = cameraQuery.data;
  const zones = zonesQuery.data ?? [];
  const ledgerItems = ledgerQuery.data ?? [];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <Button asChild variant="ghost" size="sm" className="-ml-2">
          <Link href={`/shops/${shopId}/cameras/${cameraId}/zone`}>
            <ArrowLeft className="mr-1 h-4 w-4" /> Back to Zone Editor
          </Link>
        </Button>
        <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-3 py-1 text-xs font-semibold text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
          <Radio className="h-3.5 w-3.5 animate-pulse text-emerald-500" /> LIVE STREAM HUD
        </span>
      </div>

      <PageHeader
        title={`Live Monitoring: ${camera.name}`}
        description="Real-time video feed HUD, active counting lines, polygon coverage overlays, and crossing events."
        actions={<CameraStatusBadge status={camera.status} />}
      />

      <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
        <div className="space-y-4">
          <div className="relative aspect-video w-full overflow-hidden rounded-xl border bg-slate-950 shadow-inner flex items-center justify-center">
            <div className="h-full w-full flex items-center justify-center bg-slate-900 text-slate-400">
              <svg className="h-full w-full" viewBox="0 0 1280 720">
                <rect width="1280" height="720" fill="#0b0f19" />
                <line x1="0" y1="360" x2="1280" y2="360" stroke="#1e293b" strokeWidth="2" strokeDasharray="8 8" />
                <line x1="640" y1="0" x2="640" y2="720" stroke="#1e293b" strokeWidth="2" strokeDasharray="8 8" />
                <circle cx="640" cy="360" r="120" fill="none" stroke="#0ea5e9" strokeWidth="2" opacity="0.4" />
                <text x="640" y="350" fill="#f8fafc" fontSize="26" fontFamily="sans-serif" fontWeight="600" textAnchor="middle">
                  LIVE CAMERA FEED: {camera.name}
                </text>
                <text x="640" y="385" fill="#64748b" fontSize="16" fontFamily="monospace" textAnchor="middle">
                  ID: {camera.id}
                </text>

                {zones.map((z) => {
                  if (z.status !== "active") return null;
                  if ("line" in z.geometry) {
                    const [p1, p2] = z.geometry.line;
                    return (
                      <g key={z.id}>
                        <line
                          x1={p1[0] * 1280}
                          y1={p1[1] * 720}
                          x2={p2[0] * 1280}
                          y2={p2[1] * 720}
                          stroke="#22c55e"
                          strokeWidth="4"
                          strokeDasharray="6 6"
                        />
                        <circle cx={p1[0] * 1280} cy={p1[1] * 720} r="6" fill="#22c55e" />
                        <circle cx={p2[0] * 1280} cy={p2[1] * 720} r="6" fill="#22c55e" />
                        <text
                          x={p1[0] * 1280 + 10}
                          y={p1[1] * 720 - 10}
                          fill="#4ade80"
                          fontSize="15"
                          fontWeight="600"
                          fontFamily="sans-serif"
                        >
                          {z.name} ({z.rules.countDirection || "COUNT"})
                        </text>
                      </g>
                    );
                  } else if ("polygon" in z.geometry) {
                    const ptsStr = z.geometry.polygon.map(([x, y]) => `${x * 1280},${y * 720}`).join(" ");
                    return (
                      <polygon
                        key={z.id}
                        points={ptsStr}
                        fill="rgba(56, 189, 248, 0.15)"
                        stroke="#38bdf8"
                        strokeWidth="3"
                      />
                    );
                  }
                  return null;
                })}
              </svg>
            </div>

            <div className="absolute top-3 left-3 flex items-center gap-2 rounded bg-slate-900/90 px-3 py-1.5 text-xs font-mono text-white backdrop-blur border border-slate-700">
              <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
              <span>ACTIVE - 25.0 FPS</span>
            </div>
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Active Monitoring Zones ({zones.length})</CardTitle>
              <CardDescription>Configured lines and boundary polygons active on this camera</CardDescription>
            </CardHeader>
            <CardContent>
              {zones.length === 0 ? (
                <p className="text-sm text-muted-foreground py-2">No active zones enabled yet. Go to Zone Editor to configure lines.</p>
              ) : (
                <div className="grid gap-3 sm:grid-cols-2">
                  {zones.map((z) => (
                    <div key={z.id} className="rounded-lg border p-3 bg-muted/30 text-sm space-y-1">
                      <div className="font-medium flex items-center justify-between">
                        <span>{z.name}</span>
                        <span className="text-xs uppercase font-mono px-2 py-0.5 rounded bg-primary/10 text-primary">
                          {z.zoneType}
                        </span>
                      </div>
                      <div className="text-xs text-muted-foreground flex items-center justify-between">
                        <span>Classes: {z.rules.objectClasses.join(", ")}</span>
                        <span>Confidence: {Math.round(z.rules.minimumConfidence * 100)}%</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        <Card className="h-fit">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Clock className="h-4 w-4 text-primary" /> Live Crossing Ledger
            </CardTitle>
            <CardDescription>Recent package movements recorded across zones</CardDescription>
          </CardHeader>
          <CardContent>
            {ledgerItems.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground text-sm">
                <Video className="mx-auto h-8 w-8 text-muted-foreground/50 mb-2" />
                No crossings recorded in current session.
              </div>
            ) : (
              <div className="divide-y divide-border text-sm space-y-3">
                {ledgerItems.map((item) => (
                  <div key={item.id} className="pt-3 first:pt-0 flex items-center justify-between">
                    <div className="space-y-0.5">
                      <div className="font-mono text-xs text-muted-foreground">
                        {new Date(item.occurredAt).toLocaleTimeString()}
                      </div>
                      <div className="font-medium text-xs">
                        Track: {item.trackId.slice(-6)}
                      </div>
                    </div>
                    <span
                      className={`inline-flex items-center rounded px-2 py-0.5 text-xs font-bold font-mono ${
                        item.direction === "IN"
                          ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20"
                          : item.direction === "OUT"
                            ? "bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-500/25"
                            : "bg-muted text-muted-foreground"
                      }`}
                    >
                      {item.direction}
                    </span>
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
