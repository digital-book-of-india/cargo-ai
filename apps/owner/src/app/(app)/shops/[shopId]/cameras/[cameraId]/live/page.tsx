"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { toast } from "sonner";
import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  Boxes,
  Camera as CameraIcon,
  Pause,
  Play,
  RefreshCw,
  Sliders,
} from "lucide-react";
import { PageHeader } from "@/components/common/PageHeader";
import { Alert, ApiErrorState, EmptyState, LoadingState } from "@/components/common/States";
import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui";
import { useAsync } from "@/hooks/useAsync";
import { camerasApi } from "@/lib/api/cameras";
import { visionApi } from "@/lib/api/vision";
import { friendlyMessage } from "@/lib/api/messages";
import type { Camera, VisionCameraMonitoringStatus, VisionCountLedgerRow, VisionZone } from "@dbi/api-types";

const W = 1600;
const H = 900;

export default function LiveMonitoringPage() {
  const { shopId, cameraId } = useParams<{ shopId: string; cameraId: string }>();

  const cameraQuery = useAsync<Camera | null>(async () => {
    const { cameras } = await camerasApi.list(shopId);
    return cameras.find((c) => c.id === cameraId) ?? null;
  }, [shopId, cameraId]);

  const [zones, setZones] = useState<VisionZone[]>([]);
  const [monitor, setMonitor] = useState<VisionCameraMonitoringStatus | null>(null);
  const [ledger, setLedger] = useState<VisionCountLedgerRow[]>([]);
  const [actionLoading, setActionLoading] = useState(false);

  async function loadData() {
    try {
      const [zonesRes, statusRes, ledgerRes] = await Promise.all([
        visionApi.listZones(shopId, cameraId),
        visionApi.getStatus(shopId),
        visionApi.getLedger(shopId, { cameraId }),
      ]);
      setZones(zonesRes.items.filter((z) => z.status === "active"));
      setMonitor(statusRes.items.find((m) => m.cameraId === cameraId) ?? null);
      setLedger(ledgerRes.items.slice(0, 10));
    } catch (err) {
      console.error(err);
    }
  }

  useEffect(() => {
    loadData();
    const interval = setInterval(loadData, 5000);
    return () => clearInterval(interval);
  }, [shopId, cameraId]);

  async function handleToggleMonitoring() {
    if (!monitor) return;
    setActionLoading(true);
    try {
      if (monitor.enabled) {
        await visionApi.stopMonitoring(cameraId);
        toast.info("Camera monitoring stopped");
      } else {
        await visionApi.startMonitoring(cameraId);
        toast.success("Camera monitoring started");
      }
      await loadData();
    } catch (err) {
      toast.error(friendlyMessage(err));
    } finally {
      setActionLoading(false);
    }
  }

  if (cameraQuery.loading && !cameraQuery.data) return <LoadingState label="Loading camera stream..." />;
  if (cameraQuery.error) return <ApiErrorState error={cameraQuery.error} onRetry={cameraQuery.reload} />;
  if (!cameraQuery.data) return <EmptyState title="Camera not found" />;

  const camera = cameraQuery.data;
  const isLive = monitor?.coverage === "LIVE";

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <Button asChild variant="ghost" size="sm" className="-ml-2">
          <Link href={`/shops/${shopId}/cameras`}>
            <ArrowLeft className="mr-1 h-4 w-4" /> Cameras
          </Link>
        </Button>
        <div className="flex items-center gap-2">
          <Button asChild variant="outline" size="sm">
            <Link href={`/shops/${shopId}/cameras/${cameraId}/zone`}>
              <Sliders className="mr-1 h-4 w-4" /> Zone & Rules Editor
            </Link>
          </Button>
          <Button
            size="sm"
            variant={monitor?.enabled ? "outline" : "primary"}
            loading={actionLoading}
            onClick={handleToggleMonitoring}
          >
            {monitor?.enabled ? (
              <>
                <Pause className="mr-1 h-4 w-4" /> Stop Monitoring
              </>
            ) : (
              <>
                <Play className="mr-1 h-4 w-4" /> Start Monitoring
              </>
            )}
          </Button>
        </div>
      </div>

      <PageHeader
        title={`Live Monitoring — ${camera.name}`}
        description="Real-time optical stream monitoring, active zone boundaries, and live crossing ledger."
      />

      {monitor?.limitations && monitor.limitations.length > 0 && (
        <Alert tone={monitor.coverage === "DEGRADED" ? "warning" : "danger"}>
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4" />
            <span>
              Coverage: <strong>{monitor.coverage}</strong>. Limitations detected:{" "}
              {monitor.limitations.join(", ")}.
            </span>
          </div>
        </Alert>
      )}

      <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
        {/* Stream Canvas View with SVG Zone Overlays */}
        <div className="space-y-3">
          <div className="relative overflow-hidden rounded-xl border bg-slate-950 shadow-card">
            <svg viewBox={`0 0 ${W} ${H}`} className="block w-full select-none">
              <rect width={W} height={H} fill="#090d16" />

              {/* Grid guide */}
              {[1, 2].map((i) => (
                <g key={i} stroke="#1e293b" strokeWidth={2} strokeDasharray="8 8">
                  <line x1={(W / 3) * i} y1={0} x2={(W / 3) * i} y2={H} />
                  <line x1={0} y1={(H / 3) * i} x2={W} y2={(H / 3) * i} />
                </g>
              ))}

              {/* Render each active zone polygon or line */}
              {zones.map((z) => {
                if ("line" in z.geometry && z.geometry.line) {
                  const [pA, pB] = z.geometry.line;
                  return (
                    <g key={z.id}>
                      <line
                        x1={pA[0] * W}
                        y1={pA[1] * H}
                        x2={pB[0] * W}
                        y2={pB[1] * H}
                        stroke="#38bdf8"
                        strokeWidth={6}
                        strokeDasharray="12 6"
                      />
                      <circle cx={pA[0] * W} cy={pA[1] * H} r={10} fill="#38bdf8" />
                      <circle cx={pB[0] * W} cy={pB[1] * H} r={10} fill="#38bdf8" />
                      <text
                        x={((pA[0] + pB[0]) / 2) * W}
                        y={((pA[1] + pB[1]) / 2) * H - 15}
                        fill="#38bdf8"
                        fontSize={26}
                        fontWeight={700}
                        textAnchor="middle"
                      >
                        {z.name} (Line)
                      </text>
                    </g>
                  );
                }
                if ("polygon" in z.geometry && z.geometry.polygon) {
                  const pts = z.geometry.polygon.map((p) => `${p[0] * W},${p[1] * H}`).join(" ");
                  return (
                    <g key={z.id}>
                      <polygon
                        points={pts}
                        fill="rgba(56, 189, 248, 0.15)"
                        stroke="#38bdf8"
                        strokeWidth={4}
                      />
                      <text
                        x={z.geometry.polygon[0][0] * W + 10}
                        y={z.geometry.polygon[0][1] * H + 30}
                        fill="#38bdf8"
                        fontSize={26}
                        fontWeight={700}
                      >
                        {z.name}
                      </text>
                    </g>
                  );
                }
                return null;
              })}

              {/* Watermark / HUD */}
              <text x={30} y={50} fill="#64748b" fontSize={24} fontWeight={600}>
                {camera.name.toUpperCase()} • {monitor?.frameRate ? `${monitor.frameRate.toFixed(1)} FPS` : "OFFLINE"}
              </text>
            </svg>

            <div className="absolute top-4 right-4 flex items-center gap-2">
              <span
                className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-wider ${
                  isLive
                    ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30"
                    : "bg-destructive/20 text-destructive border border-destructive/30"
                }`}
              >
                <span className={`h-2 w-2 rounded-full ${isLive ? "bg-emerald-400 animate-pulse" : "bg-destructive"}`} />
                {monitor?.coverage ?? "OFFLINE"}
              </span>
            </div>
          </div>
          <p className="text-xs text-muted-foreground flex items-center justify-between">
            <span>Active zones: {zones.length}</span>
            <span>Worker: {monitor?.workerId ?? "None"} ({monitor?.workerStatus ?? "UNKNOWN"})</span>
          </p>
        </div>

        {/* Right: Live Ticker Ledger */}
        <Card className="h-fit">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Boxes className="h-4 w-4 text-primary" /> Live Crossing Ledger
            </CardTitle>
            <CardDescription className="text-xs">
              Recent line crossings verified and persisted
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {ledger.length === 0 ? (
              <p className="text-xs text-muted-foreground py-6 text-center">
                No crossings recorded yet for this camera.
              </p>
            ) : (
              <div className="divide-y divide-border text-xs">
                {ledger.map((row) => (
                  <div key={row.id} className="py-2.5 flex items-center justify-between">
                    <div>
                      <div className="font-semibold flex items-center gap-1.5">
                        <span
                          className={`inline-block px-1.5 py-0.5 rounded font-mono text-[10px] ${
                            row.direction === "OUT"
                              ? "bg-blue-500/10 text-blue-400 border border-blue-500/20"
                              : "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
                          }`}
                        >
                          {row.direction}
                        </span>
                        <span>Track {row.trackId.slice(-8)}</span>
                      </div>
                      <span className="text-[11px] text-muted-foreground">
                        {new Date(row.occurredAt).toLocaleTimeString()}
                      </span>
                    </div>
                    <span className="font-mono text-muted-foreground">
                      {row.confidence ? `${Math.round(row.confidence * 100)}%` : "—"}
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
