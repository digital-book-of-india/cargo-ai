"use client";

import { useEffect, useMemo, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Alert, ApiErrorState, LoadingState } from "@/components/common/States";
import { EVENT_TYPE_LABEL } from "@/components/common/StatusBadges";
import { Button, Card, Checkbox, SelectField, TextField } from "@/components/ui";
import { useAsync } from "@/hooks/useAsync";
import { companyApi } from "@/lib/api/company";
import { friendlyMessage } from "@/lib/api/messages";
import { useAuth } from "@/lib/auth/AuthProvider";
import { CARGO_EVENT_TYPES, SETTINGS_LIMITS, UNMUTABLE_EVENT_TYPES, validateShifts } from "@/types";
import type { CargoEventSeverity, CargoEventType, CompanySettings, Shift } from "@/types";

const SEVERITIES: Array<{ value: CargoEventSeverity; label: string }> = [
  { value: "low", label: "Everything (low and above)" },
  { value: "medium", label: "Medium and above" },
  { value: "high", label: "High and above" },
  { value: "critical", label: "Critical only" },
];

export function OperatingSettingsCard() {
  const { can } = useAuth();
  const editable = can("settings:write");
  const loaded = useAsync(async () => (await companyApi.getSettings()).settings, []);

  const [tolerance, setTolerance] = useState("0");
  const [retention, setRetention] = useState("90");
  const [confidence, setConfidence] = useState("55");
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [minSeverity, setMinSeverity] = useState<CargoEventSeverity>("low");
  const [muted, setMuted] = useState<CargoEventType[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function fill(s: CompanySettings) {
    setTolerance(String(s.mismatchTolerance));
    setRetention(String(s.retentionDays));
    setConfidence(String(Math.round(s.defaultConfidence * 100)));
    setShifts(s.shifts);
    setMinSeverity(s.notificationRules.inAppMinSeverity);
    setMuted(s.notificationRules.mutedEventTypes);
  }

  useEffect(() => {
    if (loaded.data) fill(loaded.data);
  }, [loaded.data]);

  // What would be sent: only the fields that differ from what is stored.
  const { changes, problem } = useMemo(() => {
    const base = loaded.data;
    if (!base) return { changes: {}, problem: null as string | null };
    const out: Record<string, unknown> = {};
    let issue: string | null = null;

    const tol = Number(tolerance);
    if (!Number.isInteger(tol) || tol < SETTINGS_LIMITS.mismatchTolerance.min || tol > SETTINGS_LIMITS.mismatchTolerance.max) {
      issue = "Count tolerance must be a whole number, 0 or more.";
    } else if (tol !== base.mismatchTolerance) out.mismatchTolerance = tol;

    const days = Number(retention);
    if (!issue && (!Number.isInteger(days) || days < SETTINGS_LIMITS.retentionDays.min || days > SETTINGS_LIMITS.retentionDays.max)) {
      issue = `Keep evidence for ${SETTINGS_LIMITS.retentionDays.min} to ${SETTINGS_LIMITS.retentionDays.max} days.`;
    } else if (days !== base.retentionDays) out.retentionDays = days;

    const pct = Number(confidence);
    if (!issue && (!Number.isFinite(pct) || pct < 0 || pct > 100)) issue = "Confidence must be between 0 and 100.";
    else if (Math.round(pct) / 100 !== base.defaultConfidence) out.defaultConfidence = Math.round(pct) / 100;

    if (JSON.stringify(shifts) !== JSON.stringify(base.shifts)) {
      const shiftProblem = validateShifts(shifts);
      if (shiftProblem) issue = issue ?? shiftProblem;
      else out.shifts = shifts;
    }

    const rulesChanged =
      minSeverity !== base.notificationRules.inAppMinSeverity ||
      JSON.stringify([...muted].sort()) !== JSON.stringify([...base.notificationRules.mutedEventTypes].sort());
    if (rulesChanged) out.notificationRules = { inAppMinSeverity: minSeverity, mutedEventTypes: muted };

    return { changes: out, problem: issue };
  }, [loaded.data, tolerance, retention, confidence, shifts, minSeverity, muted]);

  if (loaded.loading && !loaded.data) return <Card className="p-5"><LoadingState label="Loading settings..." /></Card>;
  if (loaded.error && !loaded.data) return <ApiErrorState error={loaded.error} onRetry={loaded.reload} />;
  if (!loaded.data) return null;

  const dirty = Object.keys(changes).length > 0;
  const mutable = CARGO_EVENT_TYPES.filter((t) => !UNMUTABLE_EVENT_TYPES.includes(t));

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const res = await companyApi.updateSettings(changes);
      fill(res.settings);
      loaded.reload();
      toast.success("Settings saved");
    } catch (err) {
      setError(friendlyMessage(err));
    } finally {
      setSaving(false);
    }
  }

  function updateShift(i: number, patch: Partial<Shift>) {
    setShifts((prev) => prev.map((s, idx) => (idx === i ? { ...s, ...patch } : s)));
  }

  return (
    <Card className="p-5">
      <h2 className="font-semibold">How your company operates</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        {editable ? "Changes apply to the whole company." : "Only owners and admins can change these. You can see what is set."}
      </p>

      {error && <div className="mt-3"><Alert tone="danger">{error}</Alert></div>}
      {problem && dirty === false && null}

      <div className="mt-4 grid gap-4 sm:grid-cols-3">
        <TextField
          label="Count tolerance"
          hint="Packages an observed count may differ from the expected count before a review is needed."
          inputMode="numeric"
          value={tolerance}
          onChange={(e) => setTolerance(e.target.value)}
          disabled={!editable || saving}
        />
        <TextField
          label="Keep evidence (days)"
          hint="Pictures and clips older than this are deleted. The alert and its history stay."
          inputMode="numeric"
          value={retention}
          onChange={(e) => setRetention(e.target.value)}
          disabled={!editable || saving}
        />
        <TextField
          label="Default confidence (%)"
          hint="A starting point for new zones. Tune it with real footage from each camera."
          inputMode="numeric"
          value={confidence}
          onChange={(e) => setConfidence(e.target.value)}
          disabled={!editable || saving}
        />
      </div>

      <div className="mt-6">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold">Shifts</h3>
          {editable && shifts.length < SETTINGS_LIMITS.maxShifts && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShifts((p) => [...p, { name: `Shift ${p.length + 1}`, start: "06:00", end: "14:00" }])}
              disabled={saving}
            >
              <Plus aria-hidden /> Add shift
            </Button>
          )}
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          Used to split reports by shift, in your company time zone. A shift may run past midnight, for example 22:00 to 06:00.
        </p>
        {shifts.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">No shifts set. Reports then show the whole day.</p>
        ) : (
          <ul className="mt-3 space-y-3">
            {shifts.map((s, i) => (
              <li key={i} className="grid grid-cols-[1fr_auto_auto_auto] items-end gap-2">
                <TextField label="Name" value={s.name} onChange={(e) => updateShift(i, { name: e.target.value })} disabled={!editable || saving} />
                <TextField label="From" type="time" value={s.start} onChange={(e) => updateShift(i, { start: e.target.value })} disabled={!editable || saving} />
                <TextField label="To" type="time" value={s.end} onChange={(e) => updateShift(i, { end: e.target.value })} disabled={!editable || saving} />
                {editable && (
                  <Button variant="outline" size="sm" aria-label={`Remove ${s.name}`} onClick={() => setShifts((p) => p.filter((_, idx) => idx !== i))} disabled={saving}>
                    <Trash2 aria-hidden />
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="mt-6 space-y-3">
        <h3 className="text-sm font-semibold">Notifications</h3>
        <SelectField
          label="Tell people about"
          value={minSeverity}
          onValueChange={(v) => setMinSeverity(v as CargoEventSeverity)}
          options={SEVERITIES}
          disabled={!editable || saving}
        />
        <fieldset className="space-y-2">
          <legend className="mb-1 text-sm font-medium">Do not notify me about</legend>
          {mutable.map((t) => {
            const id = `mute-${t}`;
            return (
              <div key={t} className="flex items-center gap-2">
                <Checkbox
                  id={id}
                  checked={muted.includes(t)}
                  disabled={!editable || saving}
                  onCheckedChange={(v) => setMuted((p) => (v === true ? [...p, t] : p.filter((x) => x !== t)))}
                />
                <label htmlFor={id} className="text-sm">
                  {EVENT_TYPE_LABEL[t]}
                </label>
              </div>
            );
          })}
          <p className="text-xs text-muted-foreground">
            Camera and AI health notices are always sent, because they tell you the system is not watching.
          </p>
        </fieldset>
      </div>

      {problem && <div className="mt-4"><Alert tone="warning">{problem}</Alert></div>}
      {editable && (
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="outline" onClick={() => fill(loaded.data!)} disabled={!dirty || saving}>
            Reset
          </Button>
          <Button onClick={() => void save()} loading={saving} disabled={!dirty || !!problem}>
            Save settings
          </Button>
        </div>
      )}
    </Card>
  );
}
