"use client";

import { Copy } from "lucide-react";
import { Button, Card, Checkbox, Input, Label, Switch } from "@/components/ui";
import { DAYS, armsAt, copyDayToOpenDays } from "@/lib/schedule";
import type { DayForm, WeekForm, WeekValidation } from "@/lib/schedule";
import { cn } from "@/lib/utils/cn";

interface Props {
  week: WeekForm;
  onChange: (week: WeekForm) => void;
  /** show validation messages (after the owner tried to save) */
  errors: WeekValidation | null;
  disabled?: boolean;
}

function FieldError({ id, message }: { id: string; message?: string }) {
  if (!message) return null;
  return (
    <p id={id} role="alert" className="mt-1 text-xs font-medium text-destructive">
      {message}
    </p>
  );
}

export function WeeklyScheduleForm({ week, onChange, errors, disabled }: Props) {
  function update(day: DayForm["day"], patch: Partial<DayForm>) {
    onChange({ ...week, days: week.days.map((d) => (d.day === day ? { ...d, ...patch } : d)) });
  }

  function setOpen(d: DayForm, open: boolean) {
    if (open) {
      // Re-opening a day: start from the usual hours instead of blanks.
      update(d.day, {
        closed: false,
        openTime: d.openTime || "10:00",
        closeTime: d.closeTime || "22:00",
      });
    } else {
      update(d.day, { closed: true });
    }
  }

  return (
    <Card>
      <ul className="divide-y">
        {week.days.map((d) => {
          const meta = DAYS.find((x) => x.key === d.day)!;
          const e = errors?.days[d.day] ?? {};
          const arms = armsAt(d, week.gracePeriodMinutes);
          const openId = `${d.day}-open`;
          const closeId = `${d.day}-close`;
          const nextId = `${d.day}-next`;
          return (
            <li key={d.day} className="grid gap-3 p-4 sm:grid-cols-[10rem_1fr] sm:p-5">
              <div className="flex items-center justify-between sm:block">
                <p className="font-medium">{meta.label}</p>
                <label className="flex items-center gap-2 text-sm text-muted-foreground sm:mt-2">
                  <Switch
                    checked={!d.closed}
                    onCheckedChange={(v) => setOpen(d, v)}
                    disabled={disabled}
                    aria-label={`${meta.label} open`}
                  />
                  {d.closed ? "Closed" : "Open"}
                </label>
              </div>

              {d.closed ? (
                <p className="self-center text-sm text-muted-foreground">
                  Closed all day. Monitoring stays armed.
                </p>
              ) : (
                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label htmlFor={openId}>Opens</Label>
                      <Input
                        id={openId}
                        type="time"
                        className="mt-1.5"
                        value={d.openTime}
                        onChange={(ev) => update(d.day, { openTime: ev.target.value })}
                        aria-invalid={e.openTime ? true : undefined}
                        aria-describedby={e.openTime ? `${openId}-error` : undefined}
                        disabled={disabled}
                      />
                      <FieldError id={`${openId}-error`} message={e.openTime} />
                    </div>
                    <div>
                      <Label htmlFor={closeId}>Closes</Label>
                      <Input
                        id={closeId}
                        type="time"
                        className="mt-1.5"
                        value={d.closeTime}
                        onChange={(ev) => update(d.day, { closeTime: ev.target.value })}
                        aria-invalid={e.closeTime ? true : undefined}
                        aria-describedby={e.closeTime ? `${closeId}-error` : undefined}
                        disabled={disabled}
                      />
                      <FieldError id={`${closeId}-error`} message={e.closeTime} />
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
                    <label htmlFor={nextId} className="flex items-center gap-2 text-sm">
                      <Checkbox
                        id={nextId}
                        checked={d.closesNextDay}
                        onCheckedChange={(v) => update(d.day, { closesNextDay: v === true })}
                        disabled={disabled}
                      />
                      Closes after midnight (next day)
                    </label>
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={disabled}
                      onClick={() => onChange(copyDayToOpenDays(week, d.day))}
                    >
                      <Copy aria-hidden /> Copy to other open days
                    </Button>
                  </div>

                  <p className={cn("text-xs", arms ? "text-muted-foreground" : "hidden")}>
                    Monitoring arms at <span className="font-medium text-foreground">{arms}</span>{" "}
                    ({week.gracePeriodMinutes} min after closing).
                  </p>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
