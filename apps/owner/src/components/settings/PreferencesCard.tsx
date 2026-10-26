"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Alert, EmptyState, ErrorState } from "@/components/common/States";
import { Button, Card, Modal, Skeleton, Switch } from "@/components/ui";
import { useAsync } from "@/hooks/useAsync";
import { useUnsavedChangesGuard } from "@/hooks/useUnsavedChangesGuard";
import { notificationsApi } from "@/lib/api/notifications";
import { friendlyMessage } from "@/lib/api/messages";
import {
  DEFAULT_PREFERENCES,
  PREFERENCE_TYPES,
  mutedSafetyTypes,
  normalizePreferences,
  preferencesEqual,
  silencesEverything,
} from "@/lib/notifications";
import type { NotificationPreferences } from "@/lib/notifications";
import { cn } from "@/lib/utils/cn";

function Row({
  id,
  label,
  hint,
  checked,
  disabled,
  onChange,
  warn,
}: {
  id: string;
  label: string;
  hint?: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (v: boolean) => void;
  warn?: boolean;
}) {
  return (
    <div className="flex items-start justify-between gap-4 py-3">
      <label htmlFor={id} className="min-w-0 flex-1 cursor-pointer">
        <span className={cn("block text-sm font-medium", warn && !checked && "text-warning")}>{label}</span>
        {hint && <span className="mt-0.5 block text-xs text-muted-foreground">{hint}</span>}
      </label>
      <Switch id={id} checked={checked} disabled={disabled} onCheckedChange={onChange} aria-label={label} />
    </div>
  );
}

// What the owner is told about. Safety notices (camera / AI offline) carry a warning when off.
export function PreferencesCard() {
  const { data, error, loading, reload } = useAsync(async () => {
    const res = (await notificationsApi.getPreferences()) as { preferences?: unknown } | null;
    return normalizePreferences(res && "preferences" in res ? res.preferences : res);
  }, []);

  const [saved, setSaved] = useState<NotificationPreferences>(DEFAULT_PREFERENCES);
  const [draft, setDraft] = useState<NotificationPreferences>(DEFAULT_PREFERENCES);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);

  useEffect(() => {
    if (data) {
      setSaved(data);
      setDraft(data);
    }
  }, [data]);

  const dirty = !preferencesEqual(saved, draft);
  const leaveDialog = useUnsavedChangesGuard(dirty);
  const muted = mutedSafetyTypes(draft);
  const silent = silencesEverything(draft);

  async function save() {
    setSaving(true);
    setSaveError(null);
    try {
      await notificationsApi.updatePreferences(draft);
      setSaved(draft);
      setConfirm(false);
      toast.success("Preferences saved");
    } catch (err) {
      setSaveError(friendlyMessage(err));
      setConfirm(false);
    } finally {
      setSaving(false);
    }
  }

  function onSave() {
    if (silent) setConfirm(true);
    else void save();
  }

  let body: React.ReactNode;
  if (loading && !data) {
    body = (
      <div role="status" className="space-y-3">
        <span className="sr-only">Loading preferences...</span>
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
      </div>
    );
  } else if (error && !data) {
    // an API that has no preferences endpoint yet is "not available", not a failure
    body =
      error.status === 404 || error.status === 405 || error.status === 501 ? (
        <EmptyState
          title="Preferences are not available yet"
          hint="You will receive every alert until this is switched on."
        />
      ) : (
        <ErrorState message={friendlyMessage(error)} requestId={error.requestId} onRetry={reload} />
      );
  } else {
    body = (
      <>
        {saveError && (
          <div className="mb-3">
            <Alert tone="danger">{saveError}</Alert>
          </div>
        )}
        <div className="divide-y">
          <Row
            id="pref-push"
            label="Push notifications"
            hint="Messages on devices where you turned notifications on."
            checked={draft.push}
            onChange={(v) => setDraft((d) => ({ ...d, push: v }))}
            disabled={saving}
          />
          <Row
            id="pref-inapp"
            label="In-app notifications"
            hint="The list on the Notifications page."
            checked={draft.inApp}
            onChange={(v) => setDraft((d) => ({ ...d, inApp: v }))}
            disabled={saving}
          />
        </div>

        <h3 className="mb-1 mt-5 text-sm font-semibold">Tell me about</h3>
        <div className="divide-y">
          {PREFERENCE_TYPES.map((t) => (
            <Row
              key={t.type}
              id={`pref-${t.type}`}
              label={t.label}
              hint={t.hint}
              checked={draft.types[t.type]}
              onChange={(v) => setDraft((d) => ({ ...d, types: { ...d.types, [t.type]: v } }))}
              disabled={saving}
              warn={t.safety}
            />
          ))}
        </div>

        {muted.length > 0 && !silent && (
          <div className="mt-4">
            <Alert tone="warning">
              You will not be told if your camera or AI monitoring stops working. Your shutter may be
              unwatched without you knowing.
            </Alert>
          </div>
        )}
        {silent && (
          <div className="mt-4">
            <Alert tone="warning">
              With these settings you will not be told about anything. You can still see alerts on the
              Alerts page.
            </Alert>
          </div>
        )}

        <div className="mt-5 flex justify-end gap-2">
          <Button variant="outline" disabled={!dirty || saving} onClick={() => setDraft(saved)}>
            Discard
          </Button>
          <Button loading={saving} disabled={!dirty} onClick={onSave}>
            Save preferences
          </Button>
        </div>
      </>
    );
  }

  return (
    <Card className="p-5">
      {leaveDialog}
      <h2 className="font-semibold">Notification preferences</h2>
      <p className="mb-3 mt-1 text-sm text-muted-foreground">Choose what we tell you about and where.</p>
      {body}

      <Modal
        open={confirm}
        title="Turn off all notifications?"
        description="You will not be told when something is detected or when monitoring stops."
        onClose={() => !saving && setConfirm(false)}
        footer={
          <>
            <Button variant="outline" disabled={saving} onClick={() => setConfirm(false)}>
              Go back
            </Button>
            <Button variant="danger" loading={saving} onClick={() => void save()}>
              Save anyway
            </Button>
          </>
        }
      >
        Alerts will still be listed on the Alerts page, but nothing will reach you.
      </Modal>
    </Card>
  );
}
