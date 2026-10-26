"use client";

import Link from "next/link";
import { ArrowRight, Bell, Camera as CameraIcon } from "lucide-react";
import { DemoBadge } from "@/components/common/DemoBadge";
import { EVENT_TYPE_LABEL, CameraStatusBadge, EventStatusBadge } from "@/components/common/StatusBadges";
import { Alert } from "@/components/common/States";
import { Button, Card, Skeleton } from "@/components/ui";
import { friendlyMessage } from "@/lib/api/messages";
import { TEST_RESULT_MESSAGE, displayStatus, timeAgo } from "@/lib/camera";
import { formatInTimezone } from "@/lib/utils/time";
import type { ApiError } from "@/lib/api/errors";
import type { Camera, CargoEventSummary, Site } from "@/types";

function CardShell({
  icon,
  title,
  action,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <Card className="flex flex-col p-5">
      <div className="mb-3 flex items-center gap-2">
        <span className="flex size-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
          {icon}
        </span>
        <h3 className="font-semibold">{title}</h3>
        {action && <div className="ml-auto">{action}</div>}
      </div>
      <div className="flex-1 text-sm">{children}</div>
    </Card>
  );
}

function CardLoading() {
  return (
    <div role="status" className="space-y-2">
      <span className="sr-only">Loading...</span>
      <Skeleton className="h-5 w-2/3" />
      <Skeleton className="h-4 w-full" />
    </div>
  );
}

// A failed card must not look like an empty one.
function CardError({ error, onRetry }: { error: ApiError; onRetry: () => void }) {
  return (
    <div className="space-y-2">
      <Alert tone="warning">{friendlyMessage(error)}</Alert>
      <Button variant="outline" size="sm" onClick={onRetry}>
        Try again
      </Button>
    </div>
  );
}

interface Loadable<T> {
  data: T | null;
  loading: boolean;
  error: ApiError | null;
  reload: () => void;
}

// ---- Camera health

export function CameraHealthCard({
  site,
  result,
}: {
  site: Site;
  result: Loadable<Camera[]>;
}) {
  const { data, loading, error, reload } = result;
  const link = (
    <Button asChild variant="ghost" size="sm">
      <Link href={`/sites/${site.id}/cameras`}>Manage</Link>
    </Button>
  );

  let body: React.ReactNode;
  if (loading && !data) body = <CardLoading />;
  else if (error && !data) body = <CardError error={error} onRetry={reload} />;
  else if (!data || data.length === 0) {
    body = (
      <>
        <p className="text-muted-foreground">No camera connected. Nothing is watching this site.</p>
        <Button asChild size="sm" className="mt-3">
          <Link href={`/sites/${site.id}/cameras`}>Add camera</Link>
        </Button>
      </>
    );
  } else {
    body = (
      <>
        <ul className="space-y-3">
          {data.map((c) => (
            <li key={c.id} className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="font-medium">{c.name}</span>
              <CameraStatusBadge status={displayStatus(c)} />
              <span className="w-full text-xs text-muted-foreground">
                {displayStatus(c) === "ONLINE"
                  ? c.lastHealthAt
                    ? `Last checked ${timeAgo(c.lastHealthAt)}`
                    : "Online"
                  : TEST_RESULT_MESSAGE[displayStatus(c)]}
              </span>
            </li>
          ))}
        </ul>
        {error && (
          <p className="mt-2 text-xs font-medium text-warning">Could not refresh. This may be out of date.</p>
        )}
      </>
    );
  }

  return (
    <CardShell icon={<CameraIcon className="size-4" aria-hidden />} title="Camera health" action={link}>
      {body}
    </CardShell>
  );
}

// ---- Latest alerts

export function LatestAlertsCard({
  site,
  result,
}: {
  site: Site;
  result: Loadable<CargoEventSummary[]>;
}) {
  const { data, loading, error, reload } = result;
  const link = (
    <Button asChild variant="ghost" size="sm">
      <Link href={`/sites/${site.id}/alerts`}>
        All alerts <ArrowRight aria-hidden />
      </Link>
    </Button>
  );

  let body: React.ReactNode;
  if (loading && !data) body = <CardLoading />;
  else if (error && !data) body = <CardError error={error} onRetry={reload} />;
  else if (!data || data.length === 0) {
    body = <p className="text-muted-foreground">No alerts yet. Alerts appear here when something is detected.</p>;
  } else {
    body = (
      <ul className="divide-y">
        {data.map((e) => (
          <li key={e.id} className="py-2 first:pt-0 last:pb-0">
            <Link
              href={`/sites/${site.id}/alerts/${e.id}`}
              className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-md hover:text-primary"
            >
              <span className="font-medium">{EVENT_TYPE_LABEL[e.eventType] ?? "Alert"}</span>
              <EventStatusBadge status={e.status} />
              {e.demo && <DemoBadge />}
              <span className="w-full text-xs text-muted-foreground">
                {formatInTimezone(e.occurredAt, site.timezone)}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    );
  }

  return (
    <CardShell icon={<Bell className="size-4" aria-hidden />} title="Latest alerts" action={link}>
      {body}
    </CardShell>
  );
}
