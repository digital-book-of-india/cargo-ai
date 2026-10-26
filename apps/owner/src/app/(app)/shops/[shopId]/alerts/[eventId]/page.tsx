"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { ArrowLeft } from "lucide-react";
import { toast } from "sonner";
import { EvidenceViewer } from "@/components/alerts/EvidenceViewer";
import { ReviewActions } from "@/components/alerts/ReviewActions";
import { DemoBadge } from "@/components/common/DemoBadge";
import { PageHeader } from "@/components/common/PageHeader";
import { Alert, ApiErrorState, EmptyState, LoadingState } from "@/components/common/States";
import { EVENT_TYPE_LABEL, ReviewStatusBadge } from "@/components/common/StatusBadges";
import { Button, Card } from "@/components/ui";
import { useAsync } from "@/hooks/useAsync";
import { useShop } from "@/lib/shop/ShopProvider";
import { camerasApi } from "@/lib/api/cameras";
import { eventsApi } from "@/lib/api/events";
import { shopsApi } from "@/lib/api/shops";
import { confidenceLabel, eventDurationMinutes, isSystemEvent } from "@/lib/events";
import type { OwnerEvent, ReviewChoice } from "@/lib/events";
import { formatInTimezone } from "@/lib/utils/time";
import type { Camera, Shop } from "@/types";

interface Loaded {
  shop: Shop;
  cameras: Camera[];
  event: OwnerEvent;
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 py-2.5 sm:flex-row sm:gap-4">
      <dt className="w-40 shrink-0 text-sm text-muted-foreground">{label}</dt>
      <dd className="min-w-0 text-sm font-medium">{children}</dd>
    </div>
  );
}

export default function AlertDetailPage() {
  const { shopId, eventId } = useParams<{ shopId: string; eventId: string }>();
  const { data, error, loading, reload } = useAsync<Loaded>(async () => {
    const [{ shop }, { cameras }, { event }] = await Promise.all([
      shopsApi.get(shopId),
      camerasApi.list(shopId),
      eventsApi.get(eventId),
    ]);
    return { shop, cameras, event };
  }, [shopId, eventId]);

  // the event can change locally (after a review) without re-reading everything
  const [event, setEvent] = useState<OwnerEvent | null>(null);
  useEffect(() => {
    if (data) setEvent(data.event);
  }, [data]);

  // The API only returns events of this owner, so an event of another shop of theirs is
  // opened under its own shop (for example from a notification while another shop is selected).
  const router = useRouter();
  const { shops, select } = useShop();
  const ownShop = !!data && data.event.shopId !== shopId && shops.some((s) => s.id === data.event.shopId);
  useEffect(() => {
    if (ownShop && data) {
      select(data.event.shopId);
      router.replace(`/shops/${data.event.shopId}/alerts/${eventId}`);
    }
  }, [ownShop, data, eventId, router, select]);

  async function review(choice: ReviewChoice) {
    const res = await eventsApi.review(eventId, choice);
    // keep the evidence we already have if the response does not repeat it
    setEvent((prev) => {
      const next = res?.event;
      if (next && next.id) return { ...next, evidence: next.evidence ?? prev?.evidence };
      return prev ? { ...prev, reviewStatus: choice } : prev;
    });
    toast.success("Review saved");
  }

  const back = (
    <Button asChild variant="ghost" size="sm" className="-ml-2">
      <Link href={`/shops/${shopId}/alerts`}>
        <ArrowLeft aria-hidden /> All alerts
      </Link>
    </Button>
  );

  if (loading && !data) return <LoadingState label="Loading alert..." />;
  if (error && !data) {
    return (
      <div className="space-y-4">
        {back}
        <ApiErrorState error={error} onRetry={reload} />
      </div>
    );
  }
  if (!data || !event) return null;
  if (ownShop) return <LoadingState label="Opening alert..." />;

  const { shop, cameras } = data;

  // an alert that belongs to another shop is treated as missing
  if (event.shopId !== shopId) {
    return (
      <div className="space-y-4">
        {back}
        <EmptyState title="Alert not found" hint="This alert may have been removed." />
      </div>
    );
  }

  const camera = cameras.find((c) => c.id === event.cameraId);
  const duration = eventDurationMinutes(event);
  const conf = confidenceLabel(event.confidence);
  const system = isSystemEvent(event.eventType);

  return (
    <div className="animate-fade-up space-y-5">
      {back}
      <PageHeader
        title={EVENT_TYPE_LABEL[event.eventType] ?? "Alert"}
        description={formatInTimezone(event.startedAt, shop.timezone)}
        actions={
          <div className="flex items-center gap-2">
            <ReviewStatusBadge status={event.reviewStatus} />
            {event.demoFlag && <DemoBadge />}
          </div>
        }
      />

      {error && <Alert tone="warning">Could not refresh. This may be out of date.</Alert>}

      {!system && (
        <Alert tone="info">
          This is an automatic suggestion and it can be wrong. Look at the evidence before you act.
        </Alert>
      )}

      <EvidenceViewer event={event} timezone={shop.timezone} onReload={reload} />

      <Card className="p-5">
        <h2 className="mb-1 font-semibold">Details</h2>
        <dl className="divide-y">
          <Row label="When">{formatInTimezone(event.startedAt, shop.timezone)}</Row>
          {event.endedAt && <Row label="Ended">{formatInTimezone(event.endedAt, shop.timezone)}</Row>}
          {duration !== null && <Row label="Lasted">{duration} minute{duration === 1 ? "" : "s"}</Row>}
          <Row label="Camera">{camera?.name ?? "Unknown camera"}</Row>
          {conf && !system && <Row label="Confidence">{conf} (an estimate, not a certainty)</Row>}
          <Row label="Time zone">{shop.timezone}</Row>
        </dl>
      </Card>

      <ReviewActions status={event.reviewStatus} onReview={review} />
    </div>
  );
}
