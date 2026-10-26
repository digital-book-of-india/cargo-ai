"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { toast } from "sonner";
import { Camera as CameraIcon, Plus, RefreshCw, Trash2 } from "lucide-react";
import { CameraCard } from "@/components/camera/CameraCard";
import type { TestPhase } from "@/components/camera/CameraCard";
import { CameraFormDialog } from "@/components/camera/CameraFormDialog";
import type { CameraFormValues } from "@/components/camera/CameraFormDialog";
import { PageHeader } from "@/components/common/PageHeader";
import { ApiErrorState, EmptyState, LoadingState } from "@/components/common/States";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui";
import { useAsync } from "@/hooks/useAsync";
import { camerasApi, loadZoneCameraIds } from "@/lib/api/cameras";
import { useAuth } from "@/lib/auth/AuthProvider";
import { useSite } from "@/lib/site/SiteProvider";
import { friendlyMessage } from "@/lib/api/messages";
import { sitesApi } from "@/lib/api/sites";
import { TEST_RESULT_MESSAGE, timeAgo } from "@/lib/camera";
import type { Camera, Site } from "@/types";

// How often statuses are re-read while the page is open and visible.
const CAMERA_REFRESH_MS = Number(process.env.NEXT_PUBLIC_CAMERA_REFRESH_MS ?? 15000);
const POLL_INTERVAL_MS = 2000;
const MAX_POLLS = 10;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export default function CamerasPage() {
  const { siteId } = useParams<{ siteId: string }>();
  const { canAtSite } = useAuth();
  const { sites } = useSite();
  const canManage = canAtSite("cameras:write", siteId);
  const canDrawZone = canAtSite("zones:write", siteId);
  // sites the camera could move to: other active sites this person may also manage cameras at
  const moveTargets = sites.filter((x) => x.id !== siteId && x.status === "ACTIVE" && canAtSite("cameras:write", x.id));
  const { data, error, loading, reload } = useAsync<{ site: Site; cameras: Camera[] }>(
    async () => {
      const [{ site }, { cameras }] = await Promise.all([sitesApi.get(siteId), camerasApi.list(siteId)]);
      return { site, cameras };
    },
    [siteId]
  );

  const [cameras, setCameras] = useState<Camera[]>([]);
  const [phases, setPhases] = useState<Record<string, TestPhase>>({});
  const [zoneIds, setZoneIds] = useState<string[]>([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Camera | undefined>(undefined);
  const [deletingCamera, setDeletingCamera] = useState<Camera | null>(null);
  const [deleting, setDeleting] = useState(false);

  const mounted = useRef(true);
  const testsRunning = useRef(0);
  const [lastChecked, setLastChecked] = useState<Date | null>(null);
  const [refreshFailed, setRefreshFailed] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [, setClock] = useState(0);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    if (data) {
      setCameras(data.cameras);
      setLastChecked(new Date());
      setRefreshFailed(false);
    }
  }, [data]);

  // Statuses change on their own (a camera can go offline), so re-read them now and then.
  const refresh = useCallback(
    async (manual = false) => {
      if (!manual && (testsRunning.current > 0 || document.visibilityState !== "visible")) return;
      if (manual) setRefreshing(true);
      try {
        const res = await camerasApi.list(siteId);
        if (!mounted.current) return;
        setCameras(res.cameras);
        setLastChecked(new Date());
        setRefreshFailed(false);
      } catch {
        if (mounted.current) setRefreshFailed(true);
      } finally {
        if (mounted.current && manual) setRefreshing(false);
      }
    },
    [siteId]
  );

  useEffect(() => {
    const interval = setInterval(() => void refresh(), CAMERA_REFRESH_MS);
    const clock = setInterval(() => setClock((c) => c + 1), 30000); // keeps the "x minutes ago" text fresh
    const onVisible = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(interval);
      clearInterval(clock);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [refresh]);

  const cameraIdsKey = cameras.map((c) => c.id).join(",");
  useEffect(() => {
    if (cameras.length === 0) return;
    let cancelled = false;
    void loadZoneCameraIds(cameras).then((ids) => {
      if (!cancelled) setZoneIds(ids);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cameraIdsKey]);

  function setPhase(id: string, phase: TestPhase) {
    if (mounted.current) setPhases((p) => ({ ...p, [id]: phase }));
  }

  // Ask for a test, then re-read the list until the camera leaves PENDING_TEST.
  async function runTest(camera: Camera) {
    testsRunning.current += 1;
    try {
      await runTestInner(camera);
    } finally {
      testsRunning.current -= 1;
    }
  }

  async function runTestInner(camera: Camera) {
    setPhase(camera.id, "starting");
    try {
      await camerasApi.test(camera.id);
    } catch (err) {
      toast.error(friendlyMessage(err));
      setPhase(camera.id, "idle");
      return;
    }

    for (let i = 0; i < MAX_POLLS && mounted.current; i++) {
      try {
        const res = await camerasApi.list(siteId);
        if (!mounted.current) return;
        setCameras(res.cameras);
        setLastChecked(new Date());
        const fresh = res.cameras.find((c) => c.id === camera.id);
        if (fresh && fresh.status !== "PENDING_TEST") {
          setPhase(camera.id, "idle");
          if (fresh.status === "ONLINE") toast.success(`${fresh.name} is online`);
          else toast.error(`${fresh.name}: ${TEST_RESULT_MESSAGE[fresh.status]}`);
          return;
        }
      } catch {
        // keep polling; a single failed read should not end the test
      }
      setPhase(camera.id, "waiting");
      await sleep(POLL_INTERVAL_MS);
    }
    setPhase(camera.id, "idle");
    toast.info("Still waiting for the monitoring service. Check again in a moment.");
  }

  async function saveCamera(values: CameraFormValues) {
    if (editing) {
      await camerasApi.update(editing.id, {
        name: values.name,
        ...(values.host
          ? {
              host: values.host,
              port: values.port,
              username: values.username,
              password: values.password,
              path: values.path,
            }
          : {}),
      });
      toast.success("Camera updated", {
        description: values.host ? "The new connection needs a connection test." : undefined,
      });
    } else {
      await camerasApi.register(siteId, {
        name: values.name,
        protocol: values.protocol,
        host: values.host,
        port: values.port,
        username: values.username,
        password: values.password,
        path: values.path,
      });
      toast.success("Camera added", { description: "Run a connection test to check it." });
    }
    reload();
  }

  async function handleDeleteConfirm() {
    if (!deletingCamera) return;
    setDeleting(true);
    try {
      // Check if delete method exists in api client, else trigger contract call
      if (typeof (camerasApi as unknown as { delete?: (id: string) => Promise<unknown> }).delete === "function") {
        await (camerasApi as unknown as { delete: (id: string) => Promise<unknown> }).delete(deletingCamera.id);
        toast.success("Camera removed");
      } else {
        // Backend catalogue does not include DELETE /cameras/:id endpoint yet
        toast.error("Camera deletion is pending backend endpoint support (DELETE /cameras/:id)");
      }
      setDeletingCamera(null);
      reload();
    } catch (err) {
      toast.error(friendlyMessage(err));
    } finally {
      setDeleting(false);
    }
  }

  // the moved camera now belongs to another site, so it leaves this list
  async function moveCamera(camera: Camera, targetSiteId: string) {
    await camerasApi.assignSite(camera.id, targetSiteId);
    const target = sites.find((s) => s.id === targetSiteId);
    toast.success(`Camera moved to ${target?.name ?? "the other site"}`);
    reload();
  }

  if (loading && !data) return <LoadingState label="Loading cameras..." />;
  if (error) return <ApiErrorState error={error} onRetry={reload} />;
  if (!data) return null;

  const { site } = data;

  return (
    <div className="animate-fade-up space-y-6">
      <PageHeader
        title="Cameras"
        description={`Cameras at ${site.name}.`}
        actions={
          canManage ? (
            <Button
              onClick={() => {
                setEditing(undefined);
                setDialogOpen(true);
              }}
            >
              <Plus aria-hidden /> Add camera
            </Button>
          ) : undefined
        }
      />

      {cameras.length > 0 && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
          {refreshFailed ? (
            <span role="status" className="font-medium text-warning">
              Could not refresh. These statuses may be out of date
              {lastChecked ? ` (last checked ${timeAgo(lastChecked.toISOString())})` : ""}.
            </span>
          ) : (
            <span>
              Statuses checked {lastChecked ? timeAgo(lastChecked.toISOString()) : "just now"}.
            </span>
          )}
          <Button
            variant="ghost"
            size="sm"
            loading={refreshing}
            onClick={() => void refresh(true)}
            aria-label="Refresh camera statuses"
          >
            <RefreshCw aria-hidden /> Refresh
          </Button>
        </div>
      )}

      {cameras.length === 0 ? (
        <EmptyState
          icon={<CameraIcon className="size-6" aria-hidden />}
          title="No camera connected"
          hint={canManage ? "Add the CCTV camera that watches this site. We only need its stream address." : "Ask a manager, admin or owner to add a camera."}
          action={
            canManage ? (
              <Button
                onClick={() => {
                  setEditing(undefined);
                  setDialogOpen(true);
                }}
              >
                <Plus aria-hidden /> Add camera
              </Button>
            ) : undefined
          }
        />
      ) : (
        <ul className="space-y-4">
          {cameras.map((c) => (
            <li key={c.id}>
              <CameraCard
                camera={c}
                siteId={site.id}
                timezone={site.timezone}
                phase={phases[c.id] ?? "idle"}
                zoneSaved={zoneIds.includes(c.id)}
                canManage={canManage}
                canDrawZone={canDrawZone}
                moveTargets={moveTargets}
                onMove={(targetId) => moveCamera(c, targetId)}
                onTest={() => void runTest(c)}
                onEdit={() => {
                  setEditing(c);
                  setDialogOpen(true);
                }}
                onDelete={() => setDeletingCamera(c)}
              />
            </li>
          ))}
        </ul>
      )}

      <CameraFormDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        siteId={siteId}
        camera={editing}
        onSubmit={saveCamera}
      />

      {/* Action 2: Camera Delete Confirmation Modal */}
      <Dialog open={!!deletingCamera} onOpenChange={(open) => !deleting && !open && setDeletingCamera(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-danger">
              <Trash2 className="size-5" aria-hidden /> Delete Camera
            </DialogTitle>
            <DialogDescription>
              Are you sure you want to remove <strong>{deletingCamera?.name}</strong>? Monitoring and alerts for this camera will cease immediately.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              disabled={deleting}
              onClick={() => setDeletingCamera(null)}
            >
              Cancel
            </Button>
            <Button
              variant="danger"
              loading={deleting}
              onClick={handleDeleteConfirm}
            >
              Confirm Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}