"use client";

import { useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Camera as CameraIcon, RefreshCw } from "lucide-react";
import { CameraStatusBadge } from "@/components/common/StatusBadges";
import { PageHeader } from "@/components/common/PageHeader";
import { ApiErrorState, EmptyState, LoadingState } from "@/components/common/States";
import { Button, Card } from "@/components/ui";
import { useAsync } from "@/hooks/useAsync";
import { camerasApi } from "@/lib/api/cameras";
import { connectWebRtc, describeWebRtcError } from "@/lib/webrtc";
import type { Camera } from "@dbi/api-types";

const KEEP_ALIVE_MS = 10_000;
const FRAME_POLL_MS = 1000;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type Mode = "connecting" | "video" | "pictures";

function LiveTile({ camera, autoVideo }: { camera: Camera; autoVideo: boolean }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [wantVideo, setWantVideo] = useState(autoVideo);
  const [mode, setMode] = useState<Mode>(autoVideo ? "connecting" : "pictures");
  const [attempt, setAttempt] = useState(0);
  const [reason, setReason] = useState<string | null>(null);
  const [src, setSrc] = useState<string | null>(null);
  const [frameAt, setFrameAt] = useState<number | null>(null);
  const [, setTick] = useState(0);

  // Live WebRTC Video
  useEffect(() => {
    const video = videoRef.current;
    if (!wantVideo || !video) return;
    let closed = false;
    let stop: (() => void) | null = null;
    setMode("connecting");
    setReason(null);

    connectWebRtc(camera.id, video, () => {
      if (!closed) setMode("pictures");
    })
      .then((close) => {
        if (closed) close();
        else {
          stop = close;
          setMode("video");
        }
      })
      .catch((err) => {
        if (closed) return;
        setReason(describeWebRtcError(err));
        setMode("pictures");
      });

    return () => {
      closed = true;
      stop?.();
    };
  }, [camera.id, attempt, wantVideo]);

  // Fallback Pictures (1 frame per second)
  useEffect(() => {
    if (mode !== "pictures") return;
    let stopped = false;
    let currentUrl: string | null = null;

    const keepAlive = () => void camerasApi.requestLive(camera.id).catch(() => undefined);
    keepAlive();
    const keepAliveTimer = setInterval(keepAlive, KEEP_ALIVE_MS);
    const clock = setInterval(() => setTick((t) => t + 1), 1000);

    void (async () => {
      while (!stopped) {
        if (document.visibilityState === "visible") {
          try {
            const frame = await camerasApi.fetchLiveFrame(camera.id);
            if (frame && !stopped) {
              const next = URL.createObjectURL(frame.blob);
              setSrc(next);
              setFrameAt(frame.at);
              if (currentUrl) URL.revokeObjectURL(currentUrl);
              currentUrl = next;
            }
          } catch {
            // Keep trying on intermittent frame read issues
          }
        }
        await sleep(FRAME_POLL_MS);
      }
    })();

    return () => {
      stopped = true;
      clearInterval(keepAliveTimer);
      clearInterval(clock);
      if (currentUrl) URL.revokeObjectURL(currentUrl);
    };
  }, [camera.id, mode]);

  const age = frameAt ? Math.max(0, Math.round((Date.now() - frameAt) / 1000)) : null;
  const stale = age !== null && age > 10;

  return (
    <Card className="overflow-hidden">
      <div className="flex items-center justify-between gap-2 border-b px-4 py-3">
        <h3 className="truncate font-semibold">{camera.name}</h3>
        <CameraStatusBadge status={camera.status} />
      </div>
      <div className="relative aspect-video bg-black">
        <video
          ref={videoRef}
          autoPlay
          muted
          playsInline
          className={`size-full object-contain ${mode === "video" ? "" : "hidden"}`}
        />
        {mode === "connecting" && (
          <div className="absolute inset-0 flex items-center justify-center text-sm text-white/80">
            Starting live WebRTC video...
          </div>
        )}
        {mode === "pictures" &&
          (src ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={src} alt={`Latest frame from ${camera.name}`} className="size-full object-contain" />
          ) : (
            <div className="absolute inset-0 flex items-center justify-center p-4 text-center text-sm text-white/80">
              Waiting for live video stream...
            </div>
          ))}
        {mode === "video" && (
          <span className="absolute bottom-2 left-2 rounded bg-red-600 px-2 py-0.5 text-xs font-medium text-white shadow">
            Live WebRTC
          </span>
        )}
        {mode === "pictures" && age !== null && (
          <span
            className={`absolute bottom-2 left-2 rounded px-2 py-0.5 text-xs font-medium text-white shadow ${
              stale ? "bg-amber-600" : "bg-black/60"
            }`}
          >
            {stale ? `Last frame ${age}s ago` : "Live frames (1 fps)"}
          </span>
        )}
      </div>
      {mode === "pictures" && (
        <div className="flex items-start justify-between gap-2 px-4 py-2 text-xs text-muted-foreground">
          <span>{wantVideo ? reason ?? "Live video is connecting..." : "Showing picture feed to conserve network."}</span>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setWantVideo(true);
              setAttempt((a) => a + 1);
            }}
          >
            <RefreshCw className="mr-1 h-3 w-3" /> {wantVideo ? "Retry WebRTC" : "Watch Live Video"}
          </Button>
        </div>
      )}
    </Card>
  );
}

const MAX_AUTO_VIDEO = 4;

export default function SiteCamerasLiveViewPage() {
  const { siteId } = useParams<{ siteId: string }>();
  const { data, error, loading, reload } = useAsync<{ cameras: Camera[] }>(
    () => camerasApi.list(siteId),
    [siteId]
  );

  if (loading && !data) return <LoadingState label="Loading cameras..." />;
  if (error) return <ApiErrorState error={error} onRetry={reload} />;
  if (!data) return null;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <PageHeader title="Live View" description="Real-time WebRTC camera streams and optical fallback." />
        <Button asChild variant="outline" size="sm">
          <Link href={`/sites/${siteId}/cameras`}>
            <ArrowLeft className="mr-1 h-4 w-4" /> Back to Cameras
          </Link>
        </Button>
      </div>

      {data.cameras.length === 0 ? (
        <EmptyState
          icon={<CameraIcon className="size-6" />}
          title="No cameras connected"
          hint="Add a camera first to see live WebRTC video."
        />
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {data.cameras.map((c) => (
            <LiveTile key={c.id} camera={c} autoVideo={data.cameras.length <= MAX_AUTO_VIDEO} />
          ))}
        </div>
      )}
    </div>
  );
}
