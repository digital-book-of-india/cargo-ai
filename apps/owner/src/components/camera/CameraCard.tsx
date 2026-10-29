"use client";

import Link from "next/link";
import { useState } from "react";
import { Camera as CameraIcon, Crosshair, MoveRight, Pencil, PlugZap, Trash2 } from "lucide-react";
import { Alert } from "@/components/common/States";
import { CameraStatusBadge } from "@/components/common/StatusBadges";
import { Button, Card } from "@/components/ui";
import { TEST_RESULT_MESSAGE, displayStatus, timeAgo } from "@/lib/camera";
import { friendlyMessage } from "@/lib/api/messages";
import { formatInTimezone } from "@/lib/utils/time";
import type { Camera, Site } from "@/types";

export type TestPhase = "idle" | "starting" | "waiting";

interface Props {
  camera: Camera;
  siteId: string;
  timezone: string;
  phase: TestPhase;
  zoneSaved: boolean;
  /** may this person test, edit, delete and move the camera? */
  canManage: boolean;
  /** may this person draw the zone? */
  canDrawZone: boolean;
  /** other sites of the company the camera can move to (empty hides the control) */
  moveTargets?: Site[];
  onMove?: (siteId: string) => Promise<void>;
  onTest: () => void;
  onEdit: () => void;
  onDelete?: () => void;
}

export function CameraCard({
  camera,
  siteId,
  timezone,
  phase,
  zoneSaved,
  canManage,
  canDrawZone,
  moveTargets = [],
  onMove,
  onTest,
  onEdit,
  onDelete,
}: Props) {
  const busy = phase !== "idle";
  const status = displayStatus(camera);
  const showResult = status !== "PENDING_TEST";
  const [moving, setMoving] = useState(false);
  const [moveError, setMoveError] = useState<string | null>(null);

  async function move(targetId: string) {
    if (!onMove || !targetId) return;
    setMoving(true);
    setMoveError(null);
    try {
      await onMove(targetId);
    } catch (err) {
      setMoveError(friendlyMessage(err));
    } finally {
      setMoving(false);
    }
  }

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
              <CameraStatusBadge status={status} />
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

        {canManage && (
        <div className="flex shrink-0 flex-wrap gap-2">
          <Button asChild variant="outline" size="sm"><Link href={`/sites/${siteId}/cameras/live`}>Live View</Link></Button>
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
        )}
      </div>

      <div className="mt-4 space-y-3">
        {phase === "waiting" && (
          <Alert tone="info">
            The test is queued. We are waiting for the monitoring service to answer.
          </Alert>
        )}
        {phase === "idle" && showResult && (
          <Alert tone={status === "ONLINE" ? "success" : status === "DEGRADED" ? "warning" : "danger"}>
            {TEST_RESULT_MESSAGE[status]}
          </Alert>
        )}
        {phase === "idle" && !showResult && (
          <Alert tone="warning">
            This camera has not been tested. Until it is online, it is not being watched.
          </Alert>
        )}
        {moveError && <Alert tone="danger">{moveError}</Alert>}

        <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-3">
          <p className="text-sm text-muted-foreground">
            {zoneSaved ? "A zone is saved for this camera." : "No zone yet. Draw the area the camera should watch."}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            {canManage && moveTargets.length > 0 && onMove && (
              <label className="flex items-center gap-2 text-sm text-muted-foreground">
                <MoveRight className="size-4" aria-hidden />
                <span className="sr-only">Move this camera to another site</span>
                <select
                  aria-label="Move this camera to another site"
                  className="rounded-lg border bg-background px-2 py-1.5 text-sm"
                  value=""
                  disabled={moving || busy}
                  onChange={(e) => void move(e.target.value)}
                >
                  <option value="">Move to site...</option>
                  {moveTargets.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {canDrawZone && (
              <Button asChild variant={zoneSaved ? "outline" : "secondary"} size="sm">
                <Link href={`/sites/${siteId}/cameras/${camera.id}/zone`}>
                  <Crosshair aria-hidden /> {zoneSaved ? "Edit zone" : "Draw zone"}
                </Link>
              </Button>
            )}
          </div>
        </div>
      </div>
    </Card>
  );
}