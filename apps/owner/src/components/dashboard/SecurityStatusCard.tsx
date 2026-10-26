"use client";

import { useState } from "react";
import { RefreshCw, ShieldAlert, ShieldCheck, ShieldOff, ShieldQuestion } from "lucide-react";
import { Alert } from "@/components/common/States";
import { Badge, Button, Card, Modal } from "@/components/ui";
import { friendlyMessage } from "@/lib/api/messages";
import { timeAgo } from "@/lib/camera";
import {
  DEFAULT_OVERRIDE_MINUTES,
  activeOverrideUntil,
  subsystemHealth,
  OVERRIDE_DURATIONS,
  availableOverride,
  reasonCode,
  overrideCopy,
} from "@/lib/security";
import type { OverrideTarget, SecurityState, SecurityView } from "@/lib/security";
import { formatInTimezone } from "@/lib/utils/time";
import { cn } from "@/lib/utils/cn";

const TONE_BOX: Record<SecurityView["tone"], string> = {
  success: "border-success/30 bg-success/5",
  neutral: "border-border bg-card",
  warning: "border-warning/35 bg-warning/5",
  danger: "border-destructive/35 bg-destructive/5",
};

const TONE_ICON: Record<SecurityView["tone"], string> = {
  success: "bg-success/15 text-success",
  neutral: "bg-muted text-muted-foreground",
  warning: "bg-warning/15 text-warning",
  danger: "bg-destructive/15 text-destructive",
};

function StatusIcon({ view }: { view: SecurityView }) {
  const cls = "size-7";
  if (view.state === "UNKNOWN") return <ShieldQuestion className={cls} aria-hidden />;
  if (view.protectedNow) return <ShieldCheck className={cls} aria-hidden />;
  if (view.state === "DISARMED") return <ShieldOff className={cls} aria-hidden />;
  return <ShieldAlert className={cls} aria-hidden />;
}

interface Props {
  view: SecurityView;
  state: SecurityState | null;
  timezone: string;
  /** a manual re-read is running */
  refreshing: boolean;
  onRefresh: () => void;
  /** throws on failure so the dialog can show the message */
  onOverride: (target: OverrideTarget, minutes: number, reason: string) => Promise<void>;
}

// The headline card. Only a fresh MONITORING answer is shown as protected (see lib/security.ts).
export function SecurityStatusCard({ view, state, timezone, refreshing, onRefresh, onOverride }: Props) {
  const [target, setTarget] = useState<OverrideTarget | null>(null);
  const [minutes, setMinutes] = useState(DEFAULT_OVERRIDE_MINUTES);
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const offer = availableOverride(view, state);
  const overrideUntil = view.stale ? null : activeOverrideUntil(state);
  const minutesLabel = OVERRIDE_DURATIONS.find((d) => d.minutes === minutes)?.label ?? `${minutes} minutes`;
  const copy = target ? overrideCopy(target, minutesLabel) : null;

  function openDialog() {
    if (!offer) return;
    setError(null);
    setMinutes(DEFAULT_OVERRIDE_MINUTES);
    setReason("");
    setTarget(offer);
  }

  async function confirm() {
    if (!target || submitting) return;
    if (!reason.trim()) {
      setError("Please give a short reason. It is kept in the audit log.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await onOverride(target, minutes, reason.trim());
      setTarget(null);
    } catch (err) {
      setError(friendlyMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card className={cn("p-5 sm:p-6", TONE_BOX[view.tone])}>
      <div className="flex flex-col gap-5 sm:flex-row sm:items-start">
        <div
          className={cn(
            "flex size-14 shrink-0 items-center justify-center rounded-2xl",
            TONE_ICON[view.tone]
          )}
        >
          <StatusIcon view={view} />
        </div>

        <div className="min-w-0 flex-1">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Security status
          </p>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <h2 className="text-2xl font-semibold tracking-tight" data-testid="security-label">
              {view.label}
            </h2>
            {reasonCode(state?.reason) === "MANUAL_OVERRIDE" && !view.stale && <Badge tone="primary">Override</Badge>}
          </div>
          <p className="mt-1 text-sm text-muted-foreground">{view.hint}</p>
          {view.reason && <p className="mt-1 text-sm text-muted-foreground">{view.reason}</p>}

          {overrideUntil && (
            <p className="mt-1 text-sm font-medium">
              Override ends {formatInTimezone(overrideUntil, timezone)}.
            </p>
          )}

          {state && !view.stale && (
            <p className="mt-2 text-sm">
              <span className="text-muted-foreground">Expected now: </span>
              <span className="font-medium">
                {state.desiredState === "ARMED" ? "Armed (monitoring should be on)" : "Not armed (shop open)"}
              </span>
            </p>
          )}

          {state && (
            <dl className="mt-3 flex flex-wrap gap-x-6 gap-y-2 text-sm" aria-label="Monitoring parts">
              {[
                { name: "Camera", value: state.cameraState },
                { name: "AI monitoring", value: state.aiWorkerState },
              ].map((row) => {
                // an old or failed answer says nothing about the parts either
                const h = view.stale ? { label: "Unknown", tone: "warning" as const } : subsystemHealth(row.value);
                return (
                  <div key={row.name} className="flex items-center gap-2">
                    <dt className="text-muted-foreground">{row.name}</dt>
                    <dd>
                      <Badge tone={h.tone} dot>
                        {h.label}
                      </Badge>
                    </dd>
                  </div>
                );
              })}
            </dl>
          )}

          {view.stale && (
            <div className="mt-3">
              <Alert tone="warning">
                {view.lastKnown
                  ? `Last reported: ${view.lastKnown.label} (${timeAgo(view.lastKnown.evaluatedAt)}). This may no longer be true.`
                  : "No status has been received yet."}
              </Alert>
            </div>
          )}

          <div className="mt-4 flex flex-wrap items-center gap-2">
            {offer && (
              <Button
                variant={offer === "DISARMED" ? "outline" : "primary"}
                size="sm"
                onClick={openDialog}
              >
                {overrideCopy(offer, "").actionLabel}
              </Button>
            )}
            <Button
              variant="ghost"
              size="sm"
              loading={refreshing}
              onClick={onRefresh}
              aria-label="Refresh security status"
            >
              <RefreshCw aria-hidden /> Refresh
            </Button>
            {state && (
              <span className="text-xs text-muted-foreground">
                Checked {timeAgo(state.evaluatedAt)}
              </span>
            )}
          </div>
        </div>
      </div>

      <Modal
        open={target !== null}
        title={copy?.title ?? ""}
        description="This is a temporary manual override. The normal schedule resumes afterwards."
        onClose={() => !submitting && setTarget(null)}
        footer={
          <>
            <Button variant="outline" disabled={submitting} onClick={() => setTarget(null)}>
              Cancel
            </Button>
            <Button
              variant={copy?.tone === "danger" ? "danger" : "primary"}
              loading={submitting}
              disabled={!reason.trim()}
              onClick={() => void confirm()}
            >
              {copy?.confirmLabel}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          {error && <Alert tone="danger">{error}</Alert>}
          <fieldset>
            <legend className="mb-2 text-sm font-medium">For how long?</legend>
            <div className="grid grid-cols-2 gap-2">
              {OVERRIDE_DURATIONS.map((d) => (
                <label
                  key={d.minutes}
                  className={cn(
                    "flex cursor-pointer items-center justify-center rounded-lg border px-3 py-2 text-sm font-medium transition-colors",
                    minutes === d.minutes
                      ? "border-primary bg-primary/10 text-primary"
                      : "hover:bg-accent"
                  )}
                >
                  <input
                    type="radio"
                    name="override-duration"
                    value={d.minutes}
                    checked={minutes === d.minutes}
                    disabled={submitting}
                    onChange={() => setMinutes(d.minutes)}
                    className="sr-only"
                  />
                  {d.label}
                </label>
              ))}
            </div>
          </fieldset>
          <div>
            <label htmlFor="override-reason" className="mb-1.5 block text-sm font-medium">
              Reason
            </label>
            <input
              id="override-reason"
              type="text"
              value={reason}
              maxLength={200}
              disabled={submitting}
              onChange={(e) => setReason(e.target.value)}
              placeholder="For example: staying late for stock check"
              className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm shadow-sm placeholder:text-muted-foreground disabled:opacity-50"
            />
            <p className="mt-1 text-xs text-muted-foreground">Required. It is written to the audit log.</p>
          </div>
          {copy && <Alert tone={copy.tone === "danger" ? "warning" : "info"}>{copy.warning}</Alert>}
        </div>
      </Modal>
    </Card>
  );
}
