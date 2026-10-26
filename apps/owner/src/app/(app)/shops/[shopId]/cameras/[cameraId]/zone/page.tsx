"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { toast } from "sonner";
import { ArrowLeft, ImagePlus, Save, X } from "lucide-react";
import { ZoneEditor } from "@/components/camera/ZoneEditor";
import { CameraStatusBadge } from "@/components/common/StatusBadges";
import { PageHeader } from "@/components/common/PageHeader";
import { Alert, ApiErrorState, EmptyState, LoadingState } from "@/components/common/States";
import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle, SelectField, Switch } from "@/components/ui";
import { useAsync } from "@/hooks/useAsync";
import { useUnsavedChangesGuard } from "@/hooks/useUnsavedChangesGuard";
import { camerasApi } from "@/lib/api/cameras";
import { friendlyMessage } from "@/lib/api/messages";
import {
  canvasAspect,
  checkGuideImage,
  polygonArea,
  toZonePayload,
  validateZonePoints,
} from "@/lib/zone";
import { getStoredZone, markZoneSaved, setStoredZone } from "@/lib/utils/storage";
import type { Camera, Point, Zone } from "@/types";

const ZONE_TYPES: Array<{ value: Zone["zoneType"]; label: string }> = [
  { value: "SHUTTER", label: "Shutter" },
  { value: "GATE", label: "Gate" },
  { value: "ENTRANCE", label: "Entrance" },
  { value: "CUSTOM", label: "Custom area" },
];

const SENSITIVITY: Array<{ value: Zone["sensitivity"]; label: string }> = [
  { value: "LOW", label: "Low: fewer alerts" },
  { value: "MEDIUM", label: "Medium: balanced" },
  { value: "HIGH", label: "High: more alerts" },
];

export default function ZonePage() {
  const { shopId, cameraId } = useParams<{ shopId: string; cameraId: string }>();
  const { data, error, loading, reload } = useAsync<Camera | null>(async () => {
    const { cameras } = await camerasApi.list(shopId);
    return cameras.find((c) => c.id === cameraId) ?? null;
  }, [shopId, cameraId]);

  const savedZone = useAsync<Zone | null>(() => camerasApi.getZone(cameraId), [cameraId]);

  const [points, setPoints] = useState<Point[]>([]);
  const [zoneType, setZoneType] = useState<Zone["zoneType"]>("SHUTTER");
  const [sensitivity, setSensitivity] = useState<Zone["sensitivity"]>("MEDIUM");
  const [enabled, setEnabled] = useState(true);
  const [fromStorage, setFromStorage] = useState(false);
  const [initial, setInitial] = useState(
    JSON.stringify({ points: [], zoneType: "SHUTTER", sensitivity: "MEDIUM", enabled: true })
  );
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  // Optional guide picture. It stays in this browser (object URL) and is never uploaded.
  const [guideUrl, setGuideUrl] = useState<string | undefined>(undefined);
  const [guideAspect, setGuideAspect] = useState(16 / 9);
  const [guideError, setGuideError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    return () => {
      if (guideUrl) URL.revokeObjectURL(guideUrl);
    };
  }, [guideUrl]);

  function onPickGuide(file: File | undefined) {
    if (!file) return;
    const problem = checkGuideImage(file);
    if (problem) {
      setGuideError(problem);
      return;
    }
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      setGuideAspect(canvasAspect(img.naturalWidth, img.naturalHeight));
      setGuideUrl(url);
      setGuideError(null);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      setGuideError("This file could not be read as a picture.");
    };
    img.src = url;
  }

  function clearGuide() {
    setGuideUrl(undefined);
    setGuideAspect(16 / 9);
    if (fileInput.current) fileInput.current.value = "";
  }

  // Prefill with the zone saved on the server. Only if that read fails for another reason than
  // "no zone yet", the last zone saved from this browser is used instead (and says so).
  useEffect(() => {
    if (savedZone.loading) return;
    const zone: { polygon: Point[]; zoneType: string; sensitivity: string; enabled: boolean } | null =
      savedZone.data ?? (savedZone.error ? getStoredZone(cameraId) : null);
    if (!zone) return;
    setPoints(zone.polygon);
    setZoneType(zone.zoneType as Zone["zoneType"]);
    setSensitivity(zone.sensitivity as Zone["sensitivity"]);
    setEnabled(zone.enabled);
    setFromStorage(true);
    setInitial(
      JSON.stringify({
        points: zone.polygon,
        zoneType: zone.zoneType,
        sensitivity: zone.sensitivity,
        enabled: zone.enabled,
      })
    );
    if (savedZone.data) markZoneSaved(cameraId);
  }, [cameraId, savedZone.loading, savedZone.data, savedZone.error]);

  const problem = useMemo(() => (points.length === 0 ? null : validateZonePoints(points)), [points]);
  const dirty = JSON.stringify({ points, zoneType, sensitivity, enabled }) !== initial;
  const coverage = points.length >= 3 ? Math.round(polygonArea(points) * 100) : 0;
  const leaveDialog = useUnsavedChangesGuard(dirty);

  if ((loading && !data) || savedZone.loading) return <LoadingState label="Loading camera..." />;
  if (error) return <ApiErrorState error={error} onRetry={reload} />;
  if (!data) {
    return (
      <EmptyState
        title="Camera not found"
        hint="It may have been removed."
        action={
          <Button asChild variant="outline">
            <Link href={`/shops/${shopId}/cameras`}>Back to cameras</Link>
          </Button>
        }
      />
    );
  }
  const camera = data;

  async function save() {
    setSaveError(null);
    const message = validateZonePoints(points);
    if (message) {
      setSaveError(message);
      return;
    }
    setSaving(true);
    try {
      const payload = toZonePayload(points, { zoneType, sensitivity, enabled });
      await camerasApi.saveZone(cameraId, payload);
      markZoneSaved(cameraId);
      setStoredZone(cameraId, payload);
      setInitial(JSON.stringify({ points, zoneType, sensitivity, enabled }));
      setFromStorage(true);
      setSaved(true);
      toast.success("Shutter zone saved");
    } catch (err) {
      setSaveError(friendlyMessage(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="animate-fade-up space-y-6">
      {leaveDialog}
      <Button asChild variant="ghost" size="sm" className="-ml-2">
        <Link href={`/shops/${shopId}/cameras`}>
          <ArrowLeft aria-hidden /> Cameras
        </Link>
      </Button>

      <PageHeader
        title="Shutter zone"
        description={`Outline the area of ${camera.name} that should be watched.`}
        actions={<CameraStatusBadge status={camera.status} />}
      />

      {camera.status !== "ONLINE" && (
        <Alert tone="warning">
          This camera is not online yet, so monitoring will not work even after you save a zone. Test the
          connection first.
        </Alert>
      )}
      {saveError && saveError !== problem && <Alert tone="danger">{saveError}</Alert>}
      {saved && !dirty && (
        <Alert tone="success">
          Zone saved. It applies from the next time monitoring arms.{" "}
          <Link href="/onboarding" className="font-medium underline">
            Back to setup
          </Link>
        </Alert>
      )}

      <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
        <div className="space-y-3">
          <ZoneEditor
            points={points}
            onChange={setPoints}
            invalid={!!problem}
            disabled={saving}
            backgroundUrl={guideUrl}
            aspect={guideAspect}
          />
          <div className="flex flex-wrap items-center gap-2">
            <input
              ref={fileInput}
              type="file"
              accept="image/*"
              className="sr-only"
              aria-label="Choose a guide picture"
              onChange={(e) => onPickGuide(e.target.files?.[0])}
            />
            <Button variant="outline" size="sm" onClick={() => fileInput.current?.click()}>
              <ImagePlus aria-hidden /> {guideUrl ? "Change guide picture" : "Use a picture as a guide"}
            </Button>
            {guideUrl && (
              <Button variant="ghost" size="sm" onClick={clearGuide}>
                <X aria-hidden /> Remove picture
              </Button>
            )}
            <span className="text-xs text-muted-foreground">
              Optional. Use a full screenshot of your camera view. It stays in your browser and is not uploaded.
            </span>
          </div>
          {guideError && (
            <p role="alert" className="text-sm font-medium text-destructive">
              {guideError}
            </p>
          )}
          {problem ? (
            <p role="alert" className="text-sm font-medium text-destructive">
              {problem}
            </p>
          ) : (
            <p className="text-sm text-muted-foreground">
              {points.length === 0
                ? "Click on the picture to place points around the shutter or gate, or pick a quick start."
                : `${points.length} point${points.length === 1 ? "" : "s"} placed${
                    coverage ? `, covering about ${coverage}% of the picture` : ""
                  }. Drag a point to adjust it.`}
            </p>
          )}
          <p className="text-xs text-muted-foreground">
            {guideUrl
              ? "The outline is saved as a position inside the camera frame, so it lines up when your picture is the full camera view."
              : "A live preview from your camera is not available yet, so the area is a plain stand-in. Add a screenshot as a guide if you have one."}
            {fromStorage &&
              (!savedZone.error
                ? " Showing the zone saved for this camera."
                : " The saved zone could not be read from the server, so this is the last zone saved from this browser.")}
          </p>
        </div>

        <Card className="h-fit">
          <CardHeader>
            <CardTitle>Zone settings</CardTitle>
            <CardDescription>How this area is watched.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <SelectField
              label="Area type"
              value={zoneType}
              onValueChange={(v) => setZoneType(v as Zone["zoneType"])}
              options={ZONE_TYPES}
              disabled={saving}
            />
            <SelectField
              label="Sensitivity"
              hint="Higher sensitivity can create more false alarms."
              value={sensitivity}
              onValueChange={(v) => setSensitivity(v as Zone["sensitivity"])}
              options={SENSITIVITY}
              disabled={saving}
            />
            <label className="flex items-center justify-between gap-3 text-sm font-medium">
              Watch this zone
              <Switch checked={enabled} onCheckedChange={setEnabled} disabled={saving} aria-label="Watch this zone" />
            </label>
            <Button
              className="w-full"
              loading={saving}
              disabled={points.length === 0 || (!dirty && fromStorage)}
              onClick={() => void save()}
            >
              <Save aria-hidden /> Save zone
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
