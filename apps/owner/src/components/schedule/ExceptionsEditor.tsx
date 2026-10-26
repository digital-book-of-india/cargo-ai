"use client";

import { CalendarOff, Plus, Trash2 } from "lucide-react";
import { Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui";
import { Checkbox, Input, Label, Switch } from "@/components/ui";
import { blankException, MAX_NOTE_LENGTH } from "@/lib/schedule";
import type { ExceptionForm, ExceptionsValidation } from "@/lib/schedule";

interface Props {
  items: ExceptionForm[];
  onChange: (items: ExceptionForm[]) => void;
  errors: ExceptionsValidation | null;
  /** today in the shop timezone, to mark entries that already passed */
  today: string;
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

export function ExceptionsEditor({ items, onChange, errors, today, disabled }: Props) {
  function update(key: string, patch: Partial<ExceptionForm>) {
    onChange(items.map((e) => (e.key === key ? { ...e, ...patch } : e)));
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle>Holidays and special days</CardTitle>
            <CardDescription className="mt-1.5">
              On these dates the hours below replace your weekly hours. A closed day keeps monitoring armed
              all day.
            </CardDescription>
          </div>
          <Button
            variant="outline"
            size="sm"
            disabled={disabled}
            onClick={() => onChange([...items, blankException()])}
          >
            <Plus aria-hidden /> Add day
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {items.length === 0 ? (
          <div className="flex items-center gap-3 rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
            <CalendarOff className="size-5 shrink-0" aria-hidden />
            No special days. Add one for festivals, holidays or a day you open late.
          </div>
        ) : (
          <ul className="space-y-3">
            {items.map((e, i) => {
              const err = errors?.byKey[e.key] ?? {};
              const base = `exception-${e.key}`;
              const past = !!e.date && e.date < today;
              return (
                <li key={e.key} className="rounded-lg border bg-muted/30 p-4">
                  <div className="grid gap-4 sm:grid-cols-[11rem_1fr_auto] sm:items-start">
                    <div>
                      <Label htmlFor={`${base}-date`}>Date</Label>
                      <Input
                        id={`${base}-date`}
                        type="date"
                        className="mt-1.5"
                        value={e.date}
                        onChange={(ev) => update(e.key, { date: ev.target.value })}
                        aria-invalid={err.date ? true : undefined}
                        aria-describedby={err.date ? `${base}-date-error` : undefined}
                        disabled={disabled}
                      />
                      <FieldError id={`${base}-date-error`} message={err.date} />
                      {past && (
                        <Badge tone="neutral" className="mt-2">
                          Already passed
                        </Badge>
                      )}
                    </div>

                    <div className="space-y-3">
                      <label className="flex items-center gap-2 text-sm">
                        <Switch
                          checked={e.closed}
                          onCheckedChange={(v) => update(e.key, { closed: v })}
                          disabled={disabled}
                          aria-label={`Special day ${i + 1} closed all day`}
                        />
                        Closed all day
                      </label>

                      {!e.closed && (
                        <div className="space-y-3">
                          <div className="grid grid-cols-2 gap-3">
                            <div>
                              <Label htmlFor={`${base}-open`}>Opens</Label>
                              <Input
                                id={`${base}-open`}
                                type="time"
                                className="mt-1.5"
                                value={e.openTime}
                                onChange={(ev) => update(e.key, { openTime: ev.target.value })}
                                aria-invalid={err.openTime ? true : undefined}
                                aria-describedby={err.openTime ? `${base}-open-error` : undefined}
                                disabled={disabled}
                              />
                              <FieldError id={`${base}-open-error`} message={err.openTime} />
                            </div>
                            <div>
                              <Label htmlFor={`${base}-close`}>Closes</Label>
                              <Input
                                id={`${base}-close`}
                                type="time"
                                className="mt-1.5"
                                value={e.closeTime}
                                onChange={(ev) => update(e.key, { closeTime: ev.target.value })}
                                aria-invalid={err.closeTime ? true : undefined}
                                aria-describedby={err.closeTime ? `${base}-close-error` : undefined}
                                disabled={disabled}
                              />
                              <FieldError id={`${base}-close-error`} message={err.closeTime} />
                            </div>
                          </div>
                          <label className="flex items-center gap-2 text-sm">
                            <Checkbox
                              checked={e.closesNextDay}
                              onCheckedChange={(v) => update(e.key, { closesNextDay: v === true })}
                              disabled={disabled}
                            />
                            Closes after midnight (next day)
                          </label>
                        </div>
                      )}

                      <div>
                        <Label htmlFor={`${base}-note`}>Note (optional)</Label>
                        <Input
                          id={`${base}-note`}
                          className="mt-1.5"
                          placeholder="Diwali, stock-taking..."
                          maxLength={MAX_NOTE_LENGTH}
                          value={e.note}
                          onChange={(ev) => update(e.key, { note: ev.target.value })}
                          disabled={disabled}
                        />
                      </div>
                    </div>

                    <Button
                      variant="ghost"
                      size="icon"
                      className="justify-self-end text-muted-foreground hover:text-destructive"
                      disabled={disabled}
                      aria-label={`Remove special day ${e.date || i + 1}`}
                      onClick={() => onChange(items.filter((x) => x.key !== e.key))}
                    >
                      <Trash2 aria-hidden />
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
