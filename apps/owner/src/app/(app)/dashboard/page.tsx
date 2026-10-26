"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { DemoBadge } from "@/components/common/DemoBadge";
import { PageHeader } from "@/components/common/PageHeader";
import { ApiErrorState, LoadingState } from "@/components/common/States";
import {
  CameraHealthCard,
  LatestAlertsCard,
  ScheduleCard,
} from "@/components/dashboard/DashboardCards";
import { SecurityStatusCard } from "@/components/dashboard/SecurityStatusCard";
import { OnboardingChecklist } from "@/components/onboarding/OnboardingChecklist";
import { useAsync } from "@/hooks/useAsync";
import { ApiError } from "@/lib/api/errors";
import { camerasApi, loadZoneCameraIds } from "@/lib/api/cameras";
import { eventsApi } from "@/lib/api/events";
import { scheduleApi } from "@/lib/api/schedule";
import { shopsApi } from "@/lib/api/shops";
import { computeOnboarding } from "@/lib/onboarding";
import { deriveSecurityView } from "@/lib/security";
import type { OverrideTarget, SecurityState } from "@/lib/security";
import { useShop } from "@/lib/shop/ShopProvider";
import type { Shop } from "@/types";

// How often the live status is re-read while the page is visible.
const SECURITY_REFRESH_MS = Number(process.env.NEXT_PUBLIC_SECURITY_REFRESH_MS ?? 30000);

function DashboardContent({ shop }: { shop: Shop }) {
  const shopId = shop.id;
  const [state, setState] = useState<SecurityState | null>(null);
  const [firstError, setFirstError] = useState<ApiError | null>(null);
  const [refreshFailed, setRefreshFailed] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [, setClock] = useState(0);
  const [zoneIds, setZoneIds] = useState<string[]>([]);
  const mounted = useRef(true);

  const schedule = useAsync(() => scheduleApi.getOrNull(shopId), [shopId]);
  const cameras = useAsync(async () => (await camerasApi.list(shopId)).cameras, [shopId]);
  const events = useAsync(async () => (await eventsApi.list(shopId, { limit: 3 })).items, [shopId]);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // which cameras have a saved zone (read from the API)
  const cameraIdsKey = (cameras.data ?? []).map((c) => c.id).join(",");
  useEffect(() => {
    if (!cameras.data) return;
    let cancelled = false;
    void loadZoneCameraIds(cameras.data).then((ids) => {
      if (!cancelled) setZoneIds(ids);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cameraIdsKey]);

  const camerasReload = cameras.reload;
  const eventsReload = events.reload;

  const readState = useCallback(
    async (opts: { manual?: boolean; quiet?: boolean } = {}): Promise<SecurityState | null> => {
      if (opts.manual) setRefreshing(true);
      try {
        const next = await shopsApi.securityState(shopId);
        if (!mounted.current) return next;
        setState(next);
        setRefreshFailed(false);
        setFirstError(null);
        // camera status and alerts move with the security state
        if (!opts.quiet) {
          camerasReload();
          eventsReload();
        }
        return next;
      } catch (err) {
        if (!mounted.current) return null;
        setRefreshFailed(true);
        if (err instanceof ApiError) setFirstError(err);
        return null;
      } finally {
        if (mounted.current && opts.manual) setRefreshing(false);
      }
    },
    [shopId, camerasReload, eventsReload]
  );

  useEffect(() => {
    setState(null);
    setFirstError(null);
    setRefreshFailed(false);
    void readState({ quiet: true });
  }, [readState]);

  useEffect(() => {
    const poll = setInterval(() => {
      if (document.visibilityState === "visible") void readState();
    }, SECURITY_REFRESH_MS);
    const clock = setInterval(() => setClock((c) => c + 1), 30000); // keeps "x ago" and staleness honest
    const onVisible = () => {
      if (document.visibilityState === "visible") void readState();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(poll);
      clearInterval(clock);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [readState]);

  async function override(target: OverrideTarget, minutes: number, reason: string) {
    await shopsApi.override(shopId, {
      action: target === "ARMED" ? "ARM" : "DISARM",
      durationMinutes: minutes,
      reason,
    });
    // Never trust the answer to the request: re-read the real state and compare.
    const next = await readState({ manual: true });
    if (next && next.desiredState !== target) {
      toast.warning("The override was accepted, but your status did not change", {
        description: "The server is still following your schedule. Check the status shown above.",
      });
      return;
    }
    toast.success(target === "DISARMED" ? "Monitoring paused" : "Monitoring armed", {
      description: "The normal schedule resumes when the override ends.",
    });
  }

  const view = deriveSecurityView({ state, refreshFailed });
  const hasAnswer = state !== null || refreshFailed;

  const onboarding =
    !schedule.loading && !cameras.loading && cameras.data
      ? computeOnboarding({
          shop,
          schedule: schedule.data,
          cameras: cameras.data,
          zoneSavedCameraIds: zoneIds,
        })
      : null;

  // The very first read failed with a clear API error (not just a network blip).
  if (!state && firstError && (firstError.status === 403 || firstError.status === 404)) {
    return <ApiErrorState error={firstError} />;
  }

  return (
    <div className="animate-fade-up space-y-6">
      <PageHeader
        title={shop.name}
        description="Your monitoring status right now."
        actions={shop.demo ? <DemoBadge /> : undefined}
      />

      {!hasAnswer ? (
        <LoadingState label="Checking your security status..." />
      ) : (
        <SecurityStatusCard
          view={view}
          state={state}
          timezone={shop.timezone}
          refreshing={refreshing}
          onRefresh={() => void readState({ manual: true })}
          onOverride={override}
        />
      )}

      {onboarding && !onboarding.complete && (
        <section aria-label="Finish setup" className="space-y-3">
          <h2 className="text-lg font-semibold">Finish setting up</h2>
          <OnboardingChecklist state={onboarding} />
        </section>
      )}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <ScheduleCard shop={shop} result={schedule} nextChange={schedule.data?.nextTransitionAt} />
        <CameraHealthCard shop={shop} result={cameras} />
        <LatestAlertsCard shop={shop} result={events} />
      </div>
    </div>
  );
}

export default function DashboardPage() {
  const { status, current, error, reload } = useShop();
  const router = useRouter();

  // A brand new owner has no shop yet: send them to setup.
  useEffect(() => {
    if (status === "ready" && !current) router.replace("/onboarding");
  }, [status, current, router]);

  if (status === "error" && !current) {
    return <ApiErrorState error={error!} onRetry={() => void reload()} />;
  }
  if (status !== "ready" || !current) return <LoadingState />;

  return <DashboardContent key={current.id} shop={current} />;
}
