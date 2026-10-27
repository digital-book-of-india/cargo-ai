"use client";

import { useEffect, useState } from "react";
import { ImageOff, Info, Video } from "lucide-react";
import { Alert } from "@/components/common/States";
import { Button, Card } from "@/components/ui";
import { apiAssetUrl } from "@/lib/api/client";
import { isSafeEvidenceUrl, isSystemEvent } from "@/lib/events";
import type { OwnerEventDetail } from "@/lib/events";
import { formatInTimezone } from "@/lib/utils/time";

interface Props {
  event: OwnerEventDetail;
  timezone: string;
  /** re-reads the event to get a fresh (not expired) evidence address */
  onReload: () => void;
}

// Shows the picture and clip for an alert. Evidence addresses are short-lived and access
// controlled: they are only used as `src`, never logged, stored or put in the page address.
export function EvidenceViewer({ event, timezone, onReload }: Props) {
  const snapshotUrl = isSafeEvidenceUrl(event.evidence?.snapshotUrl) ? event.evidence?.snapshotUrl : undefined;
  const clipRaw = event.evidence?.clipUrl;
  const clipUrl = isSafeEvidenceUrl(clipRaw) && !clipRaw.startsWith("data:") ? clipRaw : undefined;

  const [imageState, setImageState] = useState<"loading" | "ready" | "failed">("loading");
  const [clipFailed, setClipFailed] = useState(false);

  // a new address (after reload) gets a fresh attempt
  useEffect(() => {
    setImageState("loading");
    setClipFailed(false);
  }, [snapshotUrl, clipUrl]);

  let body: React.ReactNode;

  if (isSystemEvent(event.eventType)) {
    body = (
      <div className="flex items-start gap-3 rounded-lg bg-muted p-4 text-sm text-muted-foreground">
        <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
        <p>
          This is a system notice about your monitoring, not something seen on camera, so it
          has no picture.
        </p>
      </div>
    );
  } else if (!snapshotUrl && !clipUrl) {
    body = (
      <div className="flex flex-col items-center rounded-lg border border-dashed p-8 text-center">
        <ImageOff className="size-8 text-muted-foreground" aria-hidden />
        <p className="mt-3 font-medium">No picture available</p>
        <p className="mt-1 max-w-sm text-sm text-muted-foreground">
          Pictures are kept for a limited time, and a picture may not have been captured for this
          alert.
        </p>
      </div>
    );
  } else {
    body = (
      <div className="space-y-4">
        {snapshotUrl && (
          <figure>
            {imageState === "failed" ? (
              <div role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 p-6 text-center">
                <ImageOff className="mx-auto size-8 text-destructive" aria-hidden />
                <p className="mt-2 text-sm font-medium text-destructive">The picture could not be loaded.</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  It may have expired. Try again to get a fresh link.
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  className="mt-3"
                  onClick={() => {
                    // same address again must get a new attempt too
                    setImageState("loading");
                    onReload();
                  }}
                >
                  Try again
                </Button>
              </div>
            ) : (
              <div className="relative overflow-hidden rounded-lg border bg-slate-900">
                {imageState === "loading" && (
                  <div className="absolute inset-0 animate-pulse bg-slate-800" aria-hidden />
                )}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={apiAssetUrl(snapshotUrl)}
                  alt={`Camera picture for this alert, ${formatInTimezone(event.occurredAt, timezone)}`}
                  className="relative mx-auto max-h-[28rem] w-full object-contain"
                  onLoad={() => setImageState("ready")}
                  onError={() => setImageState("failed")}
                />
              </div>
            )}
            <figcaption className="mt-2 text-xs text-muted-foreground">
              Picture from {formatInTimezone(event.occurredAt, timezone)}.
            </figcaption>
          </figure>
        )}

        {clipUrl && (
          <div>
            {clipFailed ? (
              <Alert tone="warning">The clip could not be played. It may have expired.</Alert>
            ) : (
              <>
                <p className="mb-2 flex items-center gap-2 text-sm font-medium">
                  <Video className="size-4" aria-hidden /> Short clip
                </p>
                <video
                  src={apiAssetUrl(clipUrl)}
                  controls
                  preload="none"
                  className="w-full rounded-lg border bg-black"
                  onError={() => setClipFailed(true)}
                />
              </>
            )}
          </div>
        )}
      </div>
    );
  }

  return (
    <Card className="p-5">
      <h2 className="mb-3 font-semibold">Evidence</h2>
      {body}
      <p className="mt-4 text-xs text-muted-foreground">
        Camera pictures are a guide only. They may not show everything that happened.
      </p>
    </Card>
  );
}
