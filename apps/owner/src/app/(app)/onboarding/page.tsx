"use client";

import Link from "next/link";
import { Store } from "lucide-react";
import { PageHeader } from "@/components/common/PageHeader";
import { ApiErrorState, EmptyState, LoadingState } from "@/components/common/States";
import { OnboardingChecklist } from "@/components/onboarding/OnboardingChecklist";
import { Button } from "@/components/ui";
import { useAsync } from "@/hooks/useAsync";
import { camerasApi, loadZoneCameraIds } from "@/lib/api/cameras";
import { scheduleApi } from "@/lib/api/schedule";
import { computeOnboarding } from "@/lib/onboarding";
import { useShop } from "@/lib/shop/ShopProvider";
import type { Camera, Schedule } from "@/types";

function Checklist({ shopId, shopName }: { shopId: string; shopName: string }) {
  const { current } = useShop();
  const { data, error, loading, reload } = useAsync<{
    schedule: Schedule | null;
    cameras: Camera[];
    zoneIds: string[];
  }>(
    async () => {
      const [schedule, cams] = await Promise.all([scheduleApi.getOrNull(shopId), camerasApi.list(shopId)]);
      return {
        schedule,
        cameras: cams.cameras,
        zoneIds: await loadZoneCameraIds(cams.cameras),
      };
    },
    [shopId]
  );

  if (loading && !data) return <LoadingState label="Checking your setup..." />;
  if (error) return <ApiErrorState error={error} onRetry={reload} />;
  if (!data) return null;

  const state = computeOnboarding({
    shop: current,
    schedule: data.schedule,
    cameras: data.cameras,
    zoneSavedCameraIds: data.zoneIds,
  });

  return (
    <>
      <PageHeader
        title={`Set up ${shopName}`}
        description="A few steps and your shutter is watched after closing time."
      />
      <OnboardingChecklist state={state} />
      {state.complete && (
        <div className="mt-4 flex justify-end">
          <Button asChild>
            <Link href="/dashboard">Go to dashboard</Link>
          </Button>
        </div>
      )}
    </>
  );
}

export default function OnboardingPage() {
  const { status, current, error, reload } = useShop();

  if (status === "loading" && !current) return <LoadingState label="Loading your shops..." />;
  if (status === "error") return <ApiErrorState error={error!} onRetry={() => void reload()} />;

  if (!current) {
    return (
      <div className="animate-fade-up">
        <PageHeader title="Welcome to DBI Intelligence" description="Let us get your shop set up." />
        <EmptyState
          icon={<Store className="size-6" aria-hidden />}
          title="Start by creating your shop"
          hint="It takes a minute. Then you will set opening hours and connect your camera."
          action={
            <Button asChild>
              <Link href="/shops/new">Create shop</Link>
            </Button>
          }
        />
      </div>
    );
  }

  return (
    <div className="animate-fade-up">
      <Checklist shopId={current.id} shopName={current.name} />
    </div>
  );
}
