"use client";

import { useEffect, useMemo, useState } from "react";
import { Download } from "lucide-react";
import { toast } from "sonner";
import { NoAccess } from "@/components/common/NoAccess";
import { PageHeader } from "@/components/common/PageHeader";
import { Alert, ApiErrorState, EmptyState, LoadingState } from "@/components/common/States";
import { EVENT_TYPE_LABEL } from "@/components/common/StatusBadges";
import { Badge, Button, Card, SelectField, TextField } from "@/components/ui";
import { useAsync } from "@/hooks/useAsync";
import { companyApi } from "@/lib/api/company";
import { friendlyMessage } from "@/lib/api/messages";
import { reportsApi } from "@/lib/api/reports";
import type { ReportQuery } from "@/lib/api/reports";
import { useAuth } from "@/lib/auth/AuthProvider";
import { dayEnd, dayStart, isoDay } from "@/lib/audit";
import { directionLabel } from "@/lib/shipments";
import { useSite } from "@/lib/site/SiteProvider";
import type { CargoEventType } from "@/types";

const ALL = "ALL";

export default function ReportsPage() {
  const { can } = useAuth();
  const { sites } = useSite();
  const today = new Date();
  const [from, setFrom] = useState(isoDay(new Date(today.getTime() - 6 * 86400_000)));
  const [to, setTo] = useState(isoDay(today));
  const [siteId, setSiteId] = useState(ALL);
  const [eventType, setEventType] = useState(ALL);
  const [shift, setShift] = useState(ALL);
  const [applied, setApplied] = useState<ReportQuery | null>(null);
  const [exporting, setExporting] = useState(false);

  const settings = useAsync(() => companyApi.getSettings(), []);
  const shifts = settings.data?.settings.shifts ?? [];

  const query: ReportQuery = useMemo(
    () => ({
      from: dayStart(from),
      to: dayEnd(to),
      siteId: siteId === ALL ? undefined : siteId,
      eventType: eventType === ALL ? undefined : eventType,
      shift: shift === ALL ? undefined : shift,
    }),
    [from, to, siteId, eventType, shift]
  );

  useEffect(() => {
    setApplied(query); // first load
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const activity = useAsync(() => (applied ? reportsApi.activity(applied) : Promise.resolve(null)), [applied]);
  const mismatches = useAsync(() => (applied ? reportsApi.mismatches(applied) : Promise.resolve([])), [applied]);

  if (!can("reports:read")) return <NoAccess what="reports" />;

  const rangeOk = from <= to;

  async function download() {
    setExporting(true);
    try {
      const { blob, fileName } = await reportsApi.exportEvents(applied ?? query);
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = fileName;
      link.click();
      URL.revokeObjectURL(link.href);
      toast.success("Export downloaded. It was recorded in the audit trail.");
    } catch (err) {
      toast.error(friendlyMessage(err));
    } finally {
      setExporting(false);
    }
  }

  const data = activity.data;

  return (
    <div className="animate-fade-up space-y-5">
      <PageHeader
        title="Reports"
        description="Cargo activity and count differences for the sites you can see. Days and shifts use each site's own time zone."
        actions={
          can("reports:export") ? (
            <Button variant="outline" onClick={download} disabled={exporting || !applied}>
              <Download aria-hidden /> {exporting ? "Preparing..." : "Export events (CSV)"}
            </Button>
          ) : undefined
        }
      />

      <Card className="p-4 sm:p-5">
        <form
          className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5"
          onSubmit={(e) => {
            e.preventDefault();
            if (rangeOk) setApplied(query);
          }}
        >
          <TextField label="From" type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} />
          <TextField label="To" type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} />
          <SelectField
            label="Site"
            value={siteId}
            onValueChange={setSiteId}
            options={[{ value: ALL, label: "All my sites" }, ...sites.map((s) => ({ value: s.id, label: s.name }))]}
          />
          <SelectField
            label="Event type"
            value={eventType}
            onValueChange={setEventType}
            options={[
              { value: ALL, label: "Any type" },
              ...(Object.keys(EVENT_TYPE_LABEL) as CargoEventType[]).map((t) => ({ value: t, label: EVENT_TYPE_LABEL[t] })),
            ]}
          />
          <SelectField
            label="Shift"
            value={shift}
            onValueChange={setShift}
            hint={shifts.length === 0 ? "Add shifts in Settings to filter by shift." : undefined}
            options={[{ value: ALL, label: "All day" }, ...shifts.map((s) => ({ value: s.name, label: `${s.name} (${s.start}-${s.end})` }))]}
          />
          <div className="sm:col-span-2 lg:col-span-5">
            <Button type="submit" disabled={!rangeOk}>
              Run report
            </Button>
            {!rangeOk && <span className="ml-3 text-sm text-destructive">The start date is after the end date.</span>}
          </div>
        </form>
      </Card>

      {activity.loading && !data ? (
        <LoadingState label="Building the report..." />
      ) : activity.error && !data ? (
        <ApiErrorState error={activity.error} onRetry={activity.reload} />
      ) : data ? (
        <>
          {data.truncated && (
            <Alert tone="warning">This range has more events than a report can summarise. Narrow the dates or the site.</Alert>
          )}
          {data.coverageGaps.length > 0 && (
            <Alert tone="warning">
              Coverage gaps: {data.coverageGaps.length} camera or AI outage{data.coverageGaps.length === 1 ? "" : "s"} in this period. Quiet
              times near an outage do not prove nothing happened.
            </Alert>
          )}

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Stat label="Events" value={data.totals.events} />
            <Stat label="Loading sessions" value={data.sessions.total} hint={`${data.sessions.open} still open`} />
            <Stat label="Counts matched" value={data.sessions.matched} />
            <Stat label="Counts need review" value={data.sessions.reviewRequired} tone={data.sessions.reviewRequired > 0 ? "danger" : undefined} hint={`${data.sessions.unverified} not verified`} />
          </div>

          <Card>
            <div className="p-4 font-medium sm:p-5">By day</div>
            {data.days.length === 0 ? (
              <div className="p-4 pt-0 sm:p-5 sm:pt-0">
                <EmptyState title="No events in this period" hint="Try a wider date range, or another site." />
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-y bg-accent/50 text-left">
                      <th className="px-4 py-2 font-medium sm:px-5">Date</th>
                      <th className="px-4 py-2 font-medium">Events</th>
                      <th className="px-4 py-2 font-medium">Camera / AI outage</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.days.map((d) => (
                      <tr key={d.date} className="border-b last:border-0">
                        <td className="px-4 py-2 sm:px-5">{d.date}</td>
                        <td className="px-4 py-2">{d.events}</td>
                        <td className="px-4 py-2">{d.coverageGap ? <Badge tone="warning">Gap</Badge> : "None"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card className="p-4 sm:p-5">
              <p className="mb-2 font-medium">By event type</p>
              <ul className="space-y-1 text-sm">
                {Object.entries(data.totals.byType).map(([type, n]) => (
                  <li key={type} className="flex justify-between">
                    <span>{EVENT_TYPE_LABEL[type as CargoEventType] ?? type}</span>
                    <span>{n}</span>
                  </li>
                ))}
                {Object.keys(data.totals.byType).length === 0 && <li className="text-muted-foreground">Nothing in this period.</li>}
              </ul>
            </Card>
            <Card className="p-4 sm:p-5">
              <p className="mb-2 font-medium">By site</p>
              <ul className="space-y-1 text-sm">
                {data.bySite.map((s) => (
                  <li key={s.siteId} className="flex justify-between">
                    <span>{s.siteName}</span>
                    <span>{s.events}</span>
                  </li>
                ))}
                {data.bySite.length === 0 && <li className="text-muted-foreground">Nothing in this period.</li>}
              </ul>
            </Card>
          </div>

          {data.coverageGaps.length > 0 && (
            <Card className="p-4 sm:p-5">
              <p className="mb-2 font-medium">Outages</p>
              <ul className="space-y-1 text-sm">
                {data.coverageGaps.map((g) => (
                  <li key={g.eventId}>
                    {g.localTime} ({g.timezone}) · {g.siteName} · {g.cameraName} · {EVENT_TYPE_LABEL[g.eventType as CargoEventType] ?? g.eventType}
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </>
      ) : null}

      <Card>
        <div className="p-4 font-medium sm:p-5">Count differences</div>
        <p className="px-4 pb-3 text-sm text-muted-foreground sm:px-5">
          Sessions closed in this period whose camera count did not match the manifest. The count is an estimate, not proof that parcels are missing.
        </p>
        {mismatches.loading && !mismatches.data ? (
          <LoadingState label="Loading count differences..." />
        ) : mismatches.error && !mismatches.data ? (
          <ApiErrorState error={mismatches.error} onRetry={mismatches.reload} />
        ) : (mismatches.data ?? []).length === 0 ? (
          <div className="p-4 pt-0 sm:p-5 sm:pt-0">
            <EmptyState title="No count differences" hint="Every closed session in this period matched or could not be verified." />
          </div>
        ) : (
          <ul className="divide-y border-t" aria-label="Count differences">
            {(mismatches.data ?? []).map((m) => (
              <li key={m.id} className="space-y-1 p-4 text-sm sm:p-5">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{m.manifest?.reference ?? "No manifest"}</span>
                  <Badge tone="danger">
                    {m.observedCount} of {m.expectedCountSnapshot} ({Math.abs(m.difference ?? 0)} {(m.difference ?? 0) < 0 ? "fewer" : "more"})
                  </Badge>
                  {m.coverageGap && <Badge tone="warning">Camera gap</Badge>}
                  {m.eventStatus && <Badge>Alert: {m.eventStatus.replace("_", " ")}</Badge>}
                </div>
                <p className="text-muted-foreground">
                  {m.site.name} · {directionLabel(m.direction)} · closed {m.closedAtLocal} ({m.timezone})
                </p>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

function Stat({ label, value, hint, tone }: { label: string; value: number; hint?: string; tone?: "danger" }) {
  return (
    <Card className="p-4">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className={`text-2xl font-semibold ${tone === "danger" ? "text-destructive" : ""}`}>{value}</p>
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </Card>
  );
}
