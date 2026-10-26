"use client";

import Link from "next/link";
import { ArrowRight, Bell, CalendarClock, Camera as CameraIcon } from "lucide-react";
import { DemoBadge } from "@/components/common/DemoBadge";
import { EVENT_TYPE_LABEL, CameraStatusBadge, ReviewStatusBadge } from "@/components/common/StatusBadges";
import { Alert } from "@/components/common/States";
import { Button, Card, Skeleton } from "@/components/ui";
import { friendlyMessage } from "@/lib/api/messages";
import { TEST_RESULT_MESSAGE, timeAgo } from "@/lib/camera";
import { todayHours } from "@/lib/schedule";
import { formatInTimezone } from "@/lib/utils/time";
import type { ApiError } from "@/lib/api/errors";
import type { Camera, Schedule, SecurityEvent, Shop } from "@/types";

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

// ---- Today's schedule

export function ScheduleCard({
  shop,
  result,
  nextChange,
}: {
  shop: Shop;
  result: Loadable<Schedule | null>;
  /** from the live security state, when the API provides it */
  nextChange?: string;
}) {
  const { data, loading, error, reload } = result;
  const link = (
    <Button asChild variant="ghost" size="sm">
      <Link href={`/shops/${shop.id}/schedule`}>Edit</Link>
    </Button>
  );

  let body: React.ReactNode;
  if (loading && !data) body = <CardLoading />;
  else if (error && !data) body = <CardError error={error} onRetry={reload} />;
  else {
    const today = todayHours(data, shop.timezone);
    if (!today) {
      body = (
        <p className="text-muted-foreground">
          No opening hours set yet. Monitoring cannot arm until you set them.
        </p>
      );
    } else if (today.closed) {
      body = (
        <>
          <p className="text-lg font-semibold">Closed today</p>
          {today.note && <p className="text-muted-foreground">{today.note}</p>}
          {today.source === "EXCEPTION" && <p className="text-muted-foreground">Special day</p>}
        </>
      );
    } else {
      body = (
        <>
          <p className="text-lg font-semibold tabular-nums">
            {today.openTime} to {today.closeTime}
            {today.closesNextDay ? " (next day)" : ""}
          </p>
          {today.note && <p className="text-muted-foreground">{today.note}</p>}
          {today.source === "EXCEPTION" && <p className="text-muted-foreground">Special day</p>}
          {data && (
            <p className="mt-1 text-muted-foreground">
              Monitoring arms {data.gracePeriodMinutes} minutes after closing.
            </p>
          )}
        </>
      );
    }
    if (nextChange) {
      body = (
        <>
          {body}
          <p className="mt-2 text-muted-foreground">
            Next change: {formatInTimezone(nextChange, shop.timezone)}
          </p>
        </>
      );
    }
    if (error) {
      body = (
        <>
          {body}
          <p className="mt-2 text-xs font-medium text-warning">Could not refresh. This may be out of date.</p>
        </>
      );
    }
  }

  return (
    <CardShell icon={<CalendarClock className="size-4" aria-hidden />} title="Today's hours" action={link}>
      {body}
    </CardShell>
  );
}

// ---- Camera health

export function CameraHealthCard({
  shop,
  result,
}: {
  shop: Shop;
  result: Loadable<Camera[]>;
}) {
  const { data, loading, error, reload } = result;
  const link = (
    <Button asChild variant="ghost" size="sm">
      <Link href={`/shops/${shop.id}/cameras`}>Manage</Link>
    </Button>
  );

  let body: React.ReactNode;
  if (loading && !data) body = <CardLoading />;
  else if (error && !data) body = <CardError error={error} onRetry={reload} />;
  else if (!data || data.length === 0) {
    body = (
      <>
        <p className="text-muted-foreground">No camera connected. Nothing is watching your shutter.</p>
        <Button asChild size="sm" className="mt-3">
          <Link href={`/shops/${shop.id}/cameras`}>Add camera</Link>
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
              <CameraStatusBadge status={c.status} />
              <span className="w-full text-xs text-muted-foreground">
                {c.status === "ONLINE"
                  ? c.lastFrameAt
                    ? `Last picture ${timeAgo(c.lastFrameAt)}`
                    : "Online"
                  : TEST_RESULT_MESSAGE[c.status]}
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
  shop,
  result,
}: {
  shop: Shop;
  result: Loadable<SecurityEvent[]>;
}) {
  const { data, loading, error, reload } = result;
  const link = (
    <Button asChild variant="ghost" size="sm">
      <Link href={`/shops/${shop.id}/alerts`}>
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
              href={`/shops/${shop.id}/alerts/${e.id}`}
              className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-md hover:text-primary"
            >
              <span className="font-medium">{EVENT_TYPE_LABEL[e.eventType] ?? "Alert"}</span>
              <ReviewStatusBadge status={e.reviewStatus} />
              {e.demoFlag && <DemoBadge />}
              <span className="w-full text-xs text-muted-foreground">
                {formatInTimezone(e.startedAt, shop.timezone)}
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
