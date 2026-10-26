"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { DemoBadge } from "@/components/common/DemoBadge";
import { PageHeader } from "@/components/common/PageHeader";
import { ApiErrorState, LoadingState } from "@/components/common/States";
import { CameraHealthCard, LatestAlertsCard } from "@/components/dashboard/DashboardCards";
import { useAsync } from "@/hooks/useAsync";
import { camerasApi } from "@/lib/api/cameras";
import { eventsApi } from "@/lib/api/events";
import { useShop } from "@/lib/shop/ShopProvider";
import type { Shop } from "@/types";

function DashboardContent({ shop }: { shop: Shop }) {
  const shopId = shop.id;
  const cameras = useAsync(async () => (await camerasApi.list(shopId)).cameras, [shopId]);
  const events = useAsync(async () => (await eventsApi.list(shopId, { limit: 3 })).items, [shopId]);

  return (
    <div className="animate-fade-up space-y-6">
      <PageHeader
        title={shop.name}
        description="Camera health and the latest alerts."
        actions={shop.demo ? <DemoBadge /> : undefined}
      />

      <div className="grid gap-4 md:grid-cols-2">
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
