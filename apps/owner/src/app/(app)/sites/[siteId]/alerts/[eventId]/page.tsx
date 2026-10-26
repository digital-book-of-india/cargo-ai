"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { ArrowLeft } from "lucide-react";
import { toast } from "sonner";
import { EvidenceViewer } from "@/components/alerts/EvidenceViewer";
import { EventCollaboration } from "@/components/alerts/EventCollaboration";
import { ReviewActions } from "@/components/alerts/ReviewActions";
import { DemoBadge } from "@/components/common/DemoBadge";
import { PageHeader } from "@/components/common/PageHeader";
import { Alert, ApiErrorState, EmptyState, LoadingState } from "@/components/common/States";
import { EVENT_TYPE_LABEL, EventStatusBadge, SeverityBadge } from "@/components/common/StatusBadges";
import { Button, Card } from "@/components/ui";
import { useAsync } from "@/hooks/useAsync";
import { useAuth } from "@/lib/auth/AuthProvider";
import { useSite } from "@/lib/site/SiteProvider";
import { camerasApi } from "@/lib/api/cameras";
import { eventsApi } from "@/lib/api/events";
import { sitesApi } from "@/lib/api/sites";
import { isSystemEvent } from "@/lib/events";
import type { OwnerEventDetail, ReviewAction } from "@/lib/events";
import { formatInTimezone } from "@/lib/utils/time";
import type { Camera, Site } from "@/types";

interface Loaded {
  site: Site;
  cameras: Camera[];
  event: OwnerEventDetail;
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
  const { siteId, eventId } = useParams<{ siteId: string; eventId: string }>();
  const { data, error, loading, reload } = useAsync<Loaded>(async () => {
    const [{ site }, { cameras }, { event }] = await Promise.all([
      sitesApi.get(siteId),
      camerasApi.list(siteId),
      eventsApi.get(eventId),
    ]);
    return { site, cameras, event };
  }, [siteId, eventId]);

  // the event can change locally (after a review) without re-reading everything
  const [event, setEvent] = useState<OwnerEventDetail | null>(null);
  useEffect(() => {
    if (data) setEvent(data.event);
  }, [data]);

  // The API only returns events of this owner, so an event of another site of theirs is
  // opened under its own site (for example from a notification while another site is selected).
  const router = useRouter();
  const { sites, select } = useSite();
  const { canAtSite } = useAuth();
  const canReview = canAtSite("events:review", siteId);
  const ownSite = !!data && data.event.siteId !== siteId && sites.some((s) => s.id === data.event.siteId);
  useEffect(() => {
    if (ownSite && data) {
      select(data.event.siteId);
      router.replace(`/sites/${data.event.siteId}/alerts/${eventId}`);
    }
  }, [ownSite, data, eventId, router, select]);

  async function review(action: ReviewAction, note: string) {
    // The screen only changes after the server accepted the action and returned the new state.
    const res = await eventsApi.act(eventId, action.id, note);
    setEvent(res.event);
    toast.success("Review saved");
  }

  const back = (
    <Button asChild variant="ghost" size="sm" className="-ml-2">
      <Link href={`/sites/${siteId}/alerts`}>
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
  if (ownSite) return <LoadingState label="Opening alert..." />;

  const { site, cameras } = data;

  // an alert that belongs to another site is treated as missing
  if (event.siteId !== siteId) {
    return (
      <div className="space-y-4">
        {back}
        <EmptyState title="Alert not found" hint="This alert may have been removed." />
      </div>
    );
  }

  const camera = cameras.find((c) => c.id === event.cameraId);
  const system = isSystemEvent(event.eventType);

  return (
    <div className="animate-fade-up space-y-5">
      {back}
      <PageHeader
        title={EVENT_TYPE_LABEL[event.eventType] ?? "Alert"}
        description={event.summary}
        actions={
          <div className="flex items-center gap-2">
            <EventStatusBadge status={event.status} />
            <SeverityBadge severity={event.severity} />
            {event.demo && <DemoBadge />}
          </div>
        }
      />

      {error && <Alert tone="warning">Could not refresh. This may be out of date.</Alert>}

      {!system && (
        <Alert tone="info">
          This is an automatic suggestion and it can be wrong. Look at the evidence before you act.
        </Alert>
      )}

      <EvidenceViewer event={event} timezone={site.timezone} onReload={reload} />

      <Card className="p-5">
        <h2 className="mb-1 font-semibold">Details</h2>
        <dl className="divide-y">
          <Row label="When">{formatInTimezone(event.occurredAt, site.timezone)}</Row>
          <Row label="Camera">{camera?.name ?? event.camera.name}</Row>
          {event.assignedTo && <Row label="Assigned to">{event.assignedTo.name}</Row>}
          {event.resolution && (
            <Row label="Outcome">
              {event.resolution.outcome.replace(/_/g, " ")}
              {event.resolution.note ? ` - ${event.resolution.note}` : ""}
            </Row>
          )}
          <Row label="Time zone">{site.timezone}</Row>
        </dl>
      </Card>

      {canReview && <ReviewActions status={event.status} onAction={review} />}

      <EventCollaboration event={event} onChange={setEvent} />

      {(event.history.length > 0 || event.notes.length > 0) && (
        <Card className="p-5">
          <h2 className="mb-2 font-semibold">History</h2>
          <ul className="divide-y text-sm">
            {event.history.map((h) => (
              <li key={h.id} className="py-2">
                <span className="font-medium">{h.action.replace(/_/g, " ").toLowerCase()}</span>
                {h.toStatus && h.fromStatus !== h.toStatus ? ` (${h.fromStatus ?? "new"} to ${h.toStatus})` : ""}
                {h.actor ? ` by ${h.actor.name}` : " by the system"}
                <span className="block text-xs text-muted-foreground">
                  {formatInTimezone(h.createdAt, site.timezone)}
                  {h.note ? ` - ${h.note}` : ""}
                </span>
              </li>
            ))}
          </ul>
          {event.notes.length > 0 && (
            <>
              <h3 className="mb-1 mt-4 text-sm font-semibold">Notes</h3>
              <ul className="space-y-2 text-sm">
                {event.notes.map((n) => (
                  <li key={n.id} className="rounded-lg bg-muted p-3">
                    {n.note}
                    <span className="block text-xs text-muted-foreground">
                      {n.author.name}, {formatInTimezone(n.createdAt, site.timezone)}
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </Card>
      )}
    </div>
  );
}
