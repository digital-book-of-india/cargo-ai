"use client";

import Link from "next/link";
import { Camera as CameraIcon, Crosshair, Pencil, PlugZap, Trash2 } from "lucide-react";
import { Alert } from "@/components/common/States";
import { CameraStatusBadge } from "@/components/common/StatusBadges";
import { Button, Card } from "@/components/ui";
import { TEST_RESULT_MESSAGE, timeAgo } from "@/lib/camera";
import { formatInTimezone } from "@/lib/utils/time";
import type { Camera } from "@/types";

export type TestPhase = "idle" | "starting" | "waiting";

interface Props {
  camera: Camera;
  shopId: string;
  timezone: string;
  phase: TestPhase;
  zoneSaved: boolean;
  onTest: () => void;
  onEdit: () => void;
  onDelete?: () => void;
}

export function CameraCard({
  camera,
  shopId,
  timezone,
  phase,
  zoneSaved,
  onTest,
  onEdit,
  onDelete,
}: Props) {
  const busy = phase !== "idle";
  const showResult = camera.status !== "PENDING_TEST";

  return (
    <Card className="p-5">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-accent text-primary">
            <CameraIcon className="size-5" aria-hidden />
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="truncate font-semibold">{camera.name}</h3>
              <CameraStatusBadge status={camera.status} />
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              {camera.protocol} camera
              {camera.lastFrameAt ? (
                <>
                  {" "}
                  · last picture{" "}
                  <span title={formatInTimezone(camera.lastFrameAt, timezone)}>
                    {timeAgo(camera.lastFrameAt)}
                  </span>
                </>
              ) : (
                " · no picture received yet"
              )}
            </p>
          </div>
        </div>

        <div className="flex shrink-0 flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={onEdit} disabled={busy}>
            <Pencil aria-hidden /> Edit
          </Button>

          {onDelete && (
            <Button
              variant="outline"
              size="sm"
              onClick={onDelete}
              disabled={busy}
              className="text-destructive hover:bg-destructive/10 hover:text-destructive"
            >
              <Trash2 aria-hidden className="size-4" /> Delete
            </Button>
          )}

          <Button size="sm" onClick={onTest} loading={busy}>
            <PlugZap aria-hidden />
            {phase === "waiting"
              ? "Waiting..."
              : phase === "starting"
              ? "Testing..."
              : "Test connection"}
          </Button>
        </div>
      </div>

      <div className="mt-4 space-y-3">
        {phase === "waiting" && (
          <Alert tone="info">
            The test is queued. We are waiting for the monitoring service to answer.
          </Alert>
        )}
        {phase === "idle" && showResult && (
          <Alert tone={camera.status === "ONLINE" ? "success" : "danger"}>
            {TEST_RESULT_MESSAGE[camera.status]}
          </Alert>
        )}
        {phase === "idle" && !showResult && (
          <Alert tone="warning">
            This camera has not been tested. Until it is online, your shutter is not monitored.
          </Alert>
        )}

        <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-3">
          <p className="text-sm text-muted-foreground">
            {zoneSaved
              ? "A shutter zone was saved for this camera from this browser."
              : "No shutter zone yet. Draw the area the camera should watch."}
          </p>
          <Button asChild variant={zoneSaved ? "outline" : "secondary"} size="sm">
            <Link href={`/shops/${shopId}/cameras/${camera.id}/zone`}>
              <Crosshair aria-hidden /> {zoneSaved ? "Edit zone" : "Draw zone"}
            </Link>
          </Button>
        </div>
      </div>
    </Card>
  );
}