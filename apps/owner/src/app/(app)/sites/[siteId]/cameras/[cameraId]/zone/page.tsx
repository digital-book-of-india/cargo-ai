"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { toast } from "sonner";
import {
  ArrowLeft,
  CheckCircle2,
  CheckSquare,
  Clock,
  Eye,
  Play,
  Plus,
  ShieldCheck,
  Square,
  XCircle,
} from "lucide-react";
import { ZoneEditor } from "@/components/camera/ZoneEditor";
import { CameraStatusBadge } from "@/components/common/StatusBadges";
import { PageHeader } from "@/components/common/PageHeader";
import { ApiErrorState, EmptyState, LoadingState } from "@/components/common/States";
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  SelectField,
} from "@/components/ui";
import { useAsync } from "@/hooks/useAsync";
import { camerasApi } from "@/lib/api/cameras";
import { visionApi } from "@/lib/api/vision";
import { friendlyMessage } from "@/lib/api/messages";
import type {
  Camera,
  VisionCountDirection,
  VisionGeometry,
  VisionObjectClass,
  VisionPoint,
  VisionZone,
  VisionZoneRules,
  VisionZoneType,
} from "@dbi/api-types";

const ZONE_TYPES: Array<{ value: VisionZoneType; label: string }> = [
  { value: "counting_line", label: "Counting Line (Transit counter)" },
  { value: "loading_bay", label: "Loading / Unloading Bay" },
  { value: "restricted", label: "Restricted Security Zone" },
  { value: "storage", label: "Storage Area" },
  { value: "polygon", label: "General Polygon Area" },
];

const ALL_CLASSES: VisionObjectClass[] = ["package", "box", "pallet"];

export default function CargoZonePage() {
  const { siteId, cameraId } = useParams<{ siteId: string; cameraId: string }>();

  const cameraQuery = useAsync<Camera | null>(async () => {
    const { cameras } = await camerasApi.list(siteId);
    return cameras.find((c) => c.id === cameraId) ?? null;
  }, [siteId, cameraId]);

  const [zones, setZones] = useState<VisionZone[]>([]);
  const [selectedZoneId, setSelectedZoneId] = useState<string | null>(null);

  // Form State
  const [name, setName] = useState("Loading Bay Line 1");
  const [zoneType, setZoneType] = useState<VisionZoneType>("counting_line");
  const [points, setPoints] = useState<VisionPoint[]>([]);
  const [classes, setClasses] = useState<VisionObjectClass[]>(["package", "box"]);
  const [confidence, setConfidence] = useState(0.55);
  const [direction, setDirection] = useState<VisionCountDirection>("A_TO_B");
  const [countOnce, setCountOnce] = useState(true);
  const [afterHoursEnabled, setAfterHoursEnabled] = useState(false);
  const [afterHoursStart, setAfterHoursStart] = useState("22:00");
  const [afterHoursEnd, setAfterHoursEnd] = useState("06:00");

  const [saving, setSaving] = useState(false);
  const [validating, setValidating] = useState(false);
  const [enabling, setEnabling] = useState(false);

  async function refreshZones() {
    try {
      const res = await visionApi.listZones(siteId, cameraId);
      setZones(res.items);
      if (res.items.length > 0 && !selectedZoneId) {
        selectZone(res.items[0]);
      }
    } catch (e) {
      console.error(e);
    }
  }

  useEffect(() => {
    refreshZones();
  }, [siteId, cameraId]);

  function selectZone(z: VisionZone) {
    setSelectedZoneId(z.id);
    setName(z.name);
    setZoneType(z.zoneType);
    setClasses(z.rules.objectClasses);
    setConfidence(z.rules.minimumConfidence);
    setDirection(z.rules.countDirection ?? "A_TO_B");
    setCountOnce(z.rules.countOncePerTrackPerRule ?? true);
    setAfterHoursEnabled(z.rules.afterHours?.enabled ?? false);
    setAfterHoursStart(z.rules.afterHours?.start ?? "22:00");
    setAfterHoursEnd(z.rules.afterHours?.end ?? "06:00");

    if ("line" in z.geometry) {
      setPoints([z.geometry.line[0], z.geometry.line[1]]);
    } else if ("polygon" in z.geometry) {
      setPoints(z.geometry.polygon);
    }
  }

  function startNewZone() {
    setSelectedZoneId(null);
    setName("New Counting Line");
    setZoneType("counting_line");
    setPoints([
      [0.15, 0.6],
      [0.9, 0.6],
    ]);
    setClasses(["package", "box"]);
    setConfidence(0.55);
    setDirection("A_TO_B");
    setCountOnce(true);
    setAfterHoursEnabled(false);
    setAfterHoursStart("22:00");
    setAfterHoursEnd("06:00");
  }

  async function handleSave() {
    setSaving(true);
    try {
      const geometry: VisionGeometry =
        zoneType === "counting_line"
          ? {
              coordinateSpace: "normalized_0_1",
              line: [points[0] || [0.1, 0.5], points[1] || [0.9, 0.5]],
            }
          : {
              coordinateSpace: "normalized_0_1",
              polygon: points,
            };

      const rules: VisionZoneRules = {
        objectClasses: classes,
        minimumConfidence: confidence,
        countDirection: zoneType === "counting_line" ? direction : undefined,
        countOncePerTrackPerRule: countOnce,
        afterHours: {
          enabled: afterHoursEnabled,
          start: afterHoursStart,
          end: afterHoursEnd,
        },
      };

      if (selectedZoneId) {
        await visionApi.updateZone(selectedZoneId, { name, zoneType, geometry, rules });
        toast.success("Zone configuration updated (Draft)");
      } else {
        const res = await visionApi.createZone({
          siteId: siteId,
          cameraId,
          name,
          zoneType,
          geometry,
          rules,
        });
        setSelectedZoneId(res.zone.id);
        toast.success("Zone created successfully");
      }
      await refreshZones();
    } catch (err) {
      toast.error(friendlyMessage(err));
    } finally {
      setSaving(false);
    }
  }

  async function handleValidate() {
    if (!selectedZoneId) return;
    setValidating(true);
    try {
      const res = await visionApi.validateZone(selectedZoneId);
      if (res.passed) {
        toast.success("Zone passed geometric and camera validation!");
      } else {
        toast.error(`Validation issues: ${res.zone.validationIssues?.join(", ")}`);
      }
      await refreshZones();
    } catch (err) {
      toast.error(friendlyMessage(err));
    } finally {
      setValidating(false);
    }
  }

  async function handleEnable() {
    if (!selectedZoneId) return;
    setEnabling(true);
    try {
      await visionApi.enableZone(selectedZoneId);
      await visionApi.startMonitoring(cameraId);
      toast.success("Zone enabled & Camera AI monitoring started!");
      await refreshZones();
    } catch (err) {
      toast.error(friendlyMessage(err));
    } finally {
      setEnabling(false);
    }
  }

  const selectedZone = zones.find((z) => z.id === selectedZoneId);

  if (cameraQuery.loading && !cameraQuery.data) return <LoadingState label="Loading camera..." />;
  if (cameraQuery.error) return <ApiErrorState error={cameraQuery.error} onRetry={cameraQuery.reload} />;
  if (!cameraQuery.data) return <EmptyState title="Camera not found" />;

  const camera = cameraQuery.data;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button asChild variant="ghost" size="sm" className="-ml-2">
          <Link href={`/sites/${siteId}/cameras`}>
            <ArrowLeft className="mr-1 h-4 w-4" /> Back to Cameras
          </Link>
        </Button>
        <Button asChild variant="outline" size="sm">
          <Link href={`/sites/${siteId}/cameras/${cameraId}/live`}>
            <Eye className="mr-1 h-4 w-4" /> Open Live Monitoring HUD
          </Link>
        </Button>
      </div>

      <PageHeader
        title={`Cargo Vision Zones: ${camera.name}`}
        description="Configure virtual lines and boundary polygons for automated package counting and cargo security."
        actions={<CameraStatusBadge status={camera.status} />}
      />

      {/* Existing Zones List Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-4">
        <div className="flex flex-wrap items-center gap-2">
          {zones.map((z) => (
            <Button
              key={z.id}
              variant={selectedZoneId === z.id ? "primary" : "outline"}
              size="sm"
              onClick={() => selectZone(z)}
            >
              {z.name}
              <span
                className={`ml-2 inline-block h-2 w-2 rounded-full ${
                  z.status === "active" ? "bg-green-400" : "bg-amber-400"
                }`}
              />
            </Button>
          ))}
          <Button variant="ghost" size="sm" onClick={startNewZone}>
            <Plus className="mr-1 h-4 w-4" /> New Zone
          </Button>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_24rem]">
        {/* Left: Canvas Editor */}
        <div className="space-y-4">
          <ZoneEditor
            zoneType={zoneType}
            points={points}
            countDirection={direction}
            onChange={setPoints}
            disabled={saving}
            backgroundUrl={`/api/v1/cameras/${cameraId}/preview`}
          />

          {selectedZone && (
            <div className="flex flex-wrap items-center gap-3 rounded-lg border bg-muted/40 p-4">
              <div className="flex-1 text-sm">
                <span className="font-semibold">Validation: </span>
                {selectedZone.validationStatus === "valid" ? (
                  <span className="text-green-500 font-medium inline-flex items-center gap-1">
                    <CheckCircle2 className="h-4 w-4" /> Valid
                  </span>
                ) : (
                  <span className="text-amber-500 font-medium inline-flex items-center gap-1">
                    <XCircle className="h-4 w-4" /> {selectedZone.validationStatus}
                  </span>
                )}
                <span className="ml-4 font-semibold">Monitoring: </span>
                <span className={selectedZone.status === "active" ? "text-green-500 font-medium" : "text-muted-foreground"}>
                  {selectedZone.status.toUpperCase()}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  loading={validating}
                  onClick={handleValidate}
                >
                  <ShieldCheck className="mr-1 h-4 w-4" /> Validate
                </Button>
                <Button
                  size="sm"
                  variant="primary"
                  loading={enabling}
                  disabled={selectedZone.validationStatus !== "valid"}
                  onClick={handleEnable}
                >
                  <Play className="mr-1 h-4 w-4" /> Enable
                </Button>
              </div>
            </div>
          )}
        </div>

        {/* Right: Form Settings */}
        <Card className="h-fit">
          <CardHeader>
            <CardTitle>{selectedZoneId ? "Edit Zone & Rules" : "Create Zone"}</CardTitle>
            <CardDescription>Configure counting, classes, confidence, and after-hours schedule.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 text-sm">
            <div>
              <label htmlFor="zone-name" className="font-medium block mb-1">Zone Name</label>
              <input
                id="zone-name"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
              />
            </div>

            <SelectField
              label="Zone Purpose"
              value={zoneType}
              onValueChange={(v) => {
                const nextType = v as VisionZoneType;
                setZoneType(nextType);
                if (nextType === "counting_line" && points.length > 2) {
                  setPoints([points[0], points[1]]);
                }
              }}
              options={ZONE_TYPES}
            />

            {zoneType === "counting_line" && (
              <SelectField
                label="Counting Direction"
                value={direction}
                onValueChange={(v) => setDirection(v as VisionCountDirection)}
                options={[
                  { value: "A_TO_B", label: "A to B (Outbound / OUT)" },
                  { value: "B_TO_A", label: "B to A (Inbound / IN)" },
                  { value: "EITHER", label: "Both directions" },
                ]}
              />
            )}

            <div>
              <label className="font-medium block mb-2">Target Object Classes</label>
              <div className="flex flex-col gap-2">
                {ALL_CLASSES.map((cls) => {
                  const checked = classes.includes(cls);
                  return (
                    <button
                      key={cls}
                      type="button"
                      role="checkbox"
                      aria-checked={checked}
                      className="flex min-h-7 items-center gap-2 text-left"
                      onClick={() => {
                        if (checked) {
                          if (classes.length > 1) setClasses(classes.filter((c) => c !== cls));
                        } else {
                          setClasses([...classes, cls]);
                        }
                      }}
                    >
                      {checked ? (
                        <CheckSquare className="h-4 w-4 text-primary" />
                      ) : (
                        <Square className="h-4 w-4 text-muted-foreground" />
                      )}
                      <span className="capitalize">{cls}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div>
              <div className="flex justify-between font-medium mb-1">
                <span>Minimum Confidence</span>
                <span>{Math.round(confidence * 100)}%</span>
              </div>
              <input
                type="range"
                aria-label="Minimum confidence"
                min="0.30"
                max="0.95"
                step="0.05"
                value={confidence}
                onChange={(e) => setConfidence(parseFloat(e.target.value))}
                className="w-full accent-primary cursor-pointer"
              />
            </div>

            {/* Count-Once Rule */}
            <div className="pt-2 border-t border-border">
              <button
                type="button"
                role="checkbox"
                aria-checked={countOnce}
                className="flex min-h-7 items-center gap-2 text-left font-medium"
                onClick={() => setCountOnce(!countOnce)}
              >
                {countOnce ? (
                  <CheckSquare className="h-4 w-4 text-primary" />
                ) : (
                  <Square className="h-4 w-4 text-muted-foreground" />
                )}
                <span>Count once per track per rule (QA-04)</span>
              </button>
              <p className="text-xs text-muted-foreground mt-1 pl-6">
                Prevents duplicate counts if an object jitters on the line.
              </p>
            </div>

            {/* After-Hours Schedule Window */}
            <div className="pt-2 border-t border-border space-y-3">
              <button
                type="button"
                role="checkbox"
                aria-checked={afterHoursEnabled}
                className="flex min-h-7 items-center gap-2 text-left font-medium"
                onClick={() => setAfterHoursEnabled(!afterHoursEnabled)}
              >
                {afterHoursEnabled ? (
                  <CheckSquare className="h-4 w-4 text-primary" />
                ) : (
                  <Square className="h-4 w-4 text-muted-foreground" />
                )}
                <Clock className="h-4 w-4 text-muted-foreground" />
                <span>After-Hours Alert Window</span>
              </button>

              {afterHoursEnabled && (
                <div className="grid grid-cols-2 gap-3 pl-6">
                  <div>
                    <label htmlFor="after-hours-start" className="text-xs text-muted-foreground block mb-1">Start (HH:mm)</label>
                    <input
                      id="after-hours-start"
                      type="time"
                      value={afterHoursStart}
                      onChange={(e) => setAfterHoursStart(e.target.value)}
                      className="w-full rounded-md border border-input bg-background px-2.5 py-1.5 text-xs"
                    />
                  </div>
                  <div>
                    <label htmlFor="after-hours-end" className="text-xs text-muted-foreground block mb-1">End (HH:mm)</label>
                    <input
                      id="after-hours-end"
                      type="time"
                      value={afterHoursEnd}
                      onChange={(e) => setAfterHoursEnd(e.target.value)}
                      className="w-full rounded-md border border-input bg-background px-2.5 py-1.5 text-xs"
                    />
                  </div>
                </div>
              )}
            </div>

            <Button
              className="w-full mt-4"
              loading={saving}
              disabled={points.length === 0}
              onClick={handleSave}
            >
              {selectedZoneId ? "Save Zone (Reset to Draft)" : "Create Zone"}
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
