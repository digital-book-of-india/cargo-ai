"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { toast } from "sonner";
import { Globe, RotateCcw } from "lucide-react";
import { PageHeader } from "@/components/common/PageHeader";
import { Alert, ApiErrorState, LoadingState } from "@/components/common/States";
import { ExceptionsEditor } from "@/components/schedule/ExceptionsEditor";
import { WeeklyScheduleForm } from "@/components/schedule/WeeklyScheduleForm";
import { Badge, Button, Card, CardContent, TextField } from "@/components/ui";
import { useAsync } from "@/hooks/useAsync";
import { useUnsavedChangesGuard } from "@/hooks/useUnsavedChangesGuard";
import { scheduleApi } from "@/lib/api/schedule";
import { friendlyMessage } from "@/lib/api/messages";
import { shopsApi } from "@/lib/api/shops";
import {
  defaultWeek,
  exceptionsEqual,
  exceptionsFromApi,
  isConfigured,
  isReviewed,
  todayInTimezone,
  toExceptionsPayload,
  toWeeklySchedule,
  validateExceptions,
  validateWeek,
  weekFromSchedule,
  weeksEqual,
} from "@/lib/schedule";
import type { ExceptionForm, ExceptionsValidation, WeekForm, WeekValidation } from "@/lib/schedule";
import { formatInTimezone } from "@/lib/utils/time";
import type { Schedule, Shop } from "@/types";

export default function SchedulePage() {
  const { shopId } = useParams<{ shopId: string }>();
  const { data, error, loading, reload } = useAsync<{ shop: Shop; schedule: Schedule | null }>(
    async () => {
      const [{ shop }, schedule] = await Promise.all([shopsApi.get(shopId), scheduleApi.getOrNull(shopId)]);
      return { shop, schedule };
    },
    [shopId]
  );

  // `hasSchedule`: the server has hours for this shop (possibly the default it created).
  // `configured`: the owner has saved them at least once.
  const hasSchedule = isConfigured(data?.schedule ?? null);
  const configured = isReviewed(data?.schedule ?? null);

  // What the server has (or the suggested defaults when nothing is saved yet).
  const baseline = useMemo<WeekForm | null>(() => {
    if (!data) return null;
    return hasSchedule && data.schedule ? weekFromSchedule(data.schedule) : defaultWeek();
  }, [data, hasSchedule]);

  // The API may or may not return `exceptions`. We only write them back when it did,
  // or when the owner added some, so saving never wipes holidays we could not see.
  const apiExceptions = (data?.schedule as unknown as { exceptions?: unknown } | undefined)?.exceptions;
  const exceptionsKnown = Array.isArray(apiExceptions);
  const baselineExceptions = useMemo<ExceptionForm[]>(
    () => exceptionsFromApi(apiExceptions),
    [apiExceptions]
  );

  const [week, setWeek] = useState<WeekForm | null>(null);
  const [exceptions, setExceptions] = useState<ExceptionForm[]>([]);
  const [errors, setErrors] = useState<WeekValidation | null>(null);
  const [exceptionErrors, setExceptionErrors] = useState<ExceptionsValidation | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    setWeek(baseline);
    setExceptions(baselineExceptions);
    setErrors(null);
    setExceptionErrors(null);
  }, [baseline, baselineExceptions]);

  const weekDirty = !!week && !!baseline && !weeksEqual(week, baseline);
  const exceptionsDirty = !exceptionsEqual(exceptions, baselineExceptions);
  const dirty = weekDirty || exceptionsDirty;
  const canSave = dirty || !configured;

  const leaveDialog = useUnsavedChangesGuard(dirty);

  if (loading && !data) return <LoadingState label="Loading opening hours..." />;
  if (error) return <ApiErrorState error={error} onRetry={reload} />;
  if (!data || !week || !baseline) return null;

  const { shop, schedule } = data;
  const nextChange = schedule?.nextTransitionAt;
  const allClosed = week.days.every((d) => d.closed);

  async function save() {
    if (!week) return;
    setSaveError(null);
    const result = validateWeek(week);
    const exResult = validateExceptions(exceptions);
    if (!result.valid || !exResult.valid) {
      setErrors(result);
      setExceptionErrors(exResult);
      toast.error("Please fix the highlighted fields");
      return;
    }
    setErrors(null);
    setExceptionErrors(null);
    setSaving(true);
    try {
      const sendExceptions = exceptionsKnown || exceptions.length > 0;
      await scheduleApi.update(shopId, {
        weeklySchedule: toWeeklySchedule(week),
        gracePeriodMinutes: week.gracePeriodMinutes,
        ...(sendExceptions ? { exceptions: toExceptionsPayload(exceptions) } : {}),
      });
      const sentExceptions = sendExceptions ? toExceptionsPayload(exceptions) : [];
      const fresh = await scheduleApi.getOrNull(shopId);
      const kept = Array.isArray((fresh as { exceptions?: unknown } | null)?.exceptions)
        ? ((fresh as { exceptions: unknown[] }).exceptions as Array<{ date?: string }>).map((e) => e.date)
        : [];
      const lost = sentExceptions.filter((e) => !kept.includes(e.date));
      if (lost.length > 0) {
        toast.warning("Opening hours saved, but holidays were not kept", {
          description: "The server did not store your holidays and special days. Please tell support.",
        });
        setSaveError(
          `The server did not keep ${lost.length} holiday or special day${lost.length === 1 ? "" : "s"}. Your weekly hours were saved.`
        );
      } else {
        toast.success("Opening hours saved");
      }
      reload(); // show exactly what the server stored
    } catch (err) {
      setSaveError(friendlyMessage(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="animate-fade-up space-y-6">
      {leaveDialog}
      <PageHeader
        title="Opening hours"
        description={`Monitoring arms after you close and switches off when you open. ${shop.name}`}
        actions={
          configured && schedule ? (
            <Badge tone="primary">Saved version {schedule.version}</Badge>
          ) : (
            <Badge tone="warning">Default hours</Badge>
          )
        }
      />

      {!configured && (
        <Alert tone="warning">
          {hasSchedule
            ? "These are default hours created for your shop. Check them and save, so monitoring follows your real opening and closing times."
            : "You have not saved opening hours yet. The hours below are suggestions, and monitoring cannot follow a schedule until you save."}
        </Alert>
      )}
      {saveError && <Alert tone="danger">{saveError}</Alert>}
      {allClosed && (
        <Alert tone="info">
          Every day is marked closed, so monitoring will stay armed all week.
        </Alert>
      )}

      <Card>
        <CardContent className="flex flex-col gap-4 pt-5 sm:flex-row sm:items-end sm:justify-between">
          <div className="flex items-start gap-3">
            <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-lg bg-accent text-primary">
              <Globe className="size-[18px]" aria-hidden />
            </span>
            <div>
              <p className="text-sm font-medium">Times are in {shop.timezone}</p>
              <p className="text-sm text-muted-foreground">
                <Link href={`/shops/${shop.id}`} className="font-medium text-primary hover:underline">
                  Change timezone
                </Link>{" "}
                in your shop details.
              </p>
              {configured && nextChange && (
                <p className="mt-1 text-sm text-muted-foreground">
                  Next change: {formatInTimezone(nextChange, shop.timezone)}
                </p>
              )}
            </div>
          </div>
          <div className="sm:w-56">
            <TextField
              label="Grace period (minutes)"
              type="number"
              inputMode="numeric"
              min={0}
              max={60}
              step={1}
              hint="Extra time after closing before monitoring arms."
              value={Number.isNaN(week.gracePeriodMinutes) ? "" : String(week.gracePeriodMinutes)}
              onChange={(e) =>
                setWeek({
                  ...week,
                  gracePeriodMinutes: e.target.value === "" ? NaN : Number(e.target.value),
                })
              }
              error={errors?.grace}
              disabled={saving}
            />
          </div>
        </CardContent>
      </Card>

      <WeeklyScheduleForm week={week} onChange={setWeek} errors={errors} disabled={saving} />

      <ExceptionsEditor
        items={exceptions}
        onChange={setExceptions}
        errors={exceptionErrors}
        today={todayInTimezone(shop.timezone)}
        disabled={saving}
      />

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-muted-foreground">
          {dirty ? "You have unsaved changes." : configured ? "All changes saved." : ""}
        </p>
        <div className="flex flex-col-reverse gap-2 sm:flex-row">
          {dirty && (
            <Button
              variant="outline"
              disabled={saving}
              onClick={() => {
                setWeek(baseline);
                setExceptions(baselineExceptions);
                setErrors(null);
                setExceptionErrors(null);
              }}
            >
              <RotateCcw aria-hidden /> Discard changes
            </Button>
          )}
          <Button loading={saving} disabled={!canSave} onClick={() => void save()}>
            {configured ? "Save opening hours" : "Save and continue"}
          </Button>
        </div>
      </div>
    </div>
  );
}
