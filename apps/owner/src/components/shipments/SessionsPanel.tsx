"use client";

import { useState } from "react";
import { Play, Square } from "lucide-react";
import { toast } from "sonner";
import { Alert, ApiErrorState, EmptyState, LoadingState } from "@/components/common/States";
import { Badge, Button, Card, Modal, SelectField, TextField } from "@/components/ui";
import { useAsync } from "@/hooks/useAsync";
import { friendlyMessage } from "@/lib/api/messages";
import { manifestsApi, sessionsApi, vehiclesApi } from "@/lib/api/shipments";
import { useAuth } from "@/lib/auth/AuthProvider";
import { RECONCILIATION_LABEL, RECONCILIATION_TONE, describeDifference, directionLabel } from "@/lib/shipments";
import { useSite } from "@/lib/site/SiteProvider";
import { SESSION_DISCLAIMER } from "@/types";
import type { LoadingSession } from "@/types";

const NONE = "none";

export function SessionsPanel() {
  const { can } = useAuth();
  const { sites } = useSite();
  const canWrite = can("manifests:write");
  const sessions = useAsync(() => sessionsApi.list({ limit: 50 }), []);
  const [startOpen, setStartOpen] = useState(false);
  const [closing, setClosing] = useState<LoadingSession | null>(null);

  if (sessions.loading && !sessions.data) return <LoadingState label="Loading sessions..." />;
  if (sessions.error && !sessions.data) return <ApiErrorState error={sessions.error} onRetry={sessions.reload} />;
  const items = sessions.data?.items ?? [];

  return (
    <div className="space-y-4">
      <Alert tone="info">{SESSION_DISCLAIMER}</Alert>
      {canWrite && (
        <div className="flex justify-end">
          <Button onClick={() => setStartOpen(true)} disabled={sites.length === 0}>
            <Play aria-hidden /> Start loading session
          </Button>
        </div>
      )}
      {items.length === 0 ? (
        <EmptyState title="No loading sessions yet" hint="Start a session when a vehicle begins loading or unloading, and close it when it leaves." />
      ) : (
        <Card>
          <ul className="divide-y" aria-label="Loading sessions">
            {items.map((s) => (
              <li key={s.id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
                <div className="min-w-0 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{s.manifest?.reference ?? "No manifest"}</span>
                    <Badge tone={RECONCILIATION_TONE[s.reconciliationStatus]}>{RECONCILIATION_LABEL[s.reconciliationStatus]}</Badge>
                    {s.coverageGap && <Badge tone="warning">Camera gap: count may be incomplete</Badge>}
                  </div>
                  <p className="text-sm text-muted-foreground">
                    {s.site.name} · {directionLabel(s.direction)}
                    {s.vehicle ? ` · ${s.vehicle.registrationNumber}` : ""}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {new Date(s.startedAt).toLocaleString()}
                    {s.closedAt ? ` to ${new Date(s.closedAt).toLocaleString()}` : " (open)"}
                  </p>
                  {s.closedAt && <p className="text-sm">{describeDifference(s)}</p>}
                </div>
                {canWrite && !s.closedAt && (
                  <Button variant="outline" onClick={() => setClosing(s)}>
                    <Square aria-hidden /> Close session
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </Card>
      )}
      {startOpen && (
        <StartDialog
          onClose={() => setStartOpen(false)}
          onDone={() => {
            setStartOpen(false);
            sessions.reload();
          }}
        />
      )}
      {closing && (
        <CloseDialog
          session={closing}
          onClose={() => setClosing(null)}
          onDone={() => {
            setClosing(null);
            sessions.reload();
          }}
        />
      )}
    </div>
  );
}

function StartDialog({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const { sites, current } = useSite();
  const [siteId, setSiteId] = useState(current?.id ?? sites[0]?.id ?? "");
  const [manifestId, setManifestId] = useState(NONE);
  const [vehicleId, setVehicleId] = useState(NONE);
  const [direction, setDirection] = useState<"outbound" | "inbound">("outbound");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const manifests = useAsync(
    () => (siteId ? manifestsApi.list({ siteId, status: "active", limit: 100 }) : Promise.resolve({ items: [], nextCursor: null })),
    [siteId]
  );
  const vehicles = useAsync(() => vehiclesApi.list(), []);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await sessionsApi.start({
        siteId,
        direction,
        manifestId: manifestId === NONE ? null : manifestId,
        vehicleId: vehicleId === NONE ? null : vehicleId,
      });
      toast.success("Loading session started");
      onDone();
    } catch (err) {
      setError(friendlyMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open
      title="Start loading session"
      description="Counting for this session runs from now until you close it."
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={busy || !siteId}>
            {busy ? "Starting..." : "Start session"}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {error && <Alert tone="danger">{error}</Alert>}
        <SelectField
          label="Site"
          value={siteId}
          onValueChange={(v) => {
            setSiteId(v);
            setManifestId(NONE);
          }}
          options={sites.filter((s) => s.status === "ACTIVE").map((s) => ({ value: s.id, label: s.name }))}
        />
        <SelectField
          label="Direction"
          value={direction}
          onValueChange={(v) => setDirection(v as "outbound" | "inbound")}
          options={[
            { value: "outbound", label: "Loading out" },
            { value: "inbound", label: "Unloading in" },
          ]}
        />
        <SelectField
          label="Manifest"
          value={manifestId}
          onValueChange={setManifestId}
          hint="Without a manifest the count is recorded but cannot be checked."
          options={[
            { value: NONE, label: "No manifest" },
            ...(manifests.data?.items ?? []).map((m) => ({ value: m.id, label: `${m.reference} (${m.expectedPackageCount} expected)` })),
          ]}
        />
        <SelectField
          label="Vehicle"
          value={vehicleId}
          onValueChange={setVehicleId}
          options={[
            { value: NONE, label: "No vehicle" },
            ...(vehicles.data ?? []).filter((v) => v.active).map((v) => ({ value: v.id, label: v.registrationNumber })),
          ]}
        />
      </div>
    </Modal>
  );
}

function CloseDialog({ session, onClose, onDone }: { session: LoadingSession; onClose: () => void; onDone: () => void }) {
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const res = await sessionsApi.close(session.id, { closeNote: note.trim() || undefined });
      const r = res.session.reconciliationStatus;
      if (r === "matched") toast.success("Session closed: the count matches the manifest");
      else if (r === "review_required") toast.warning("Session closed: the count differs, an alert was created for review");
      else toast.message("Session closed: the count could not be verified");
      window.dispatchEvent(new Event("dbi:notifications-changed"));
      onDone();
    } catch (err) {
      setError(friendlyMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open
      title="Close loading session"
      description="The final count is taken now and compared with the manifest."
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={busy}>
            {busy ? "Closing..." : "Close session"}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {error && <Alert tone="danger">{error}</Alert>}
        <p>
          {session.manifest
            ? `Manifest ${session.manifest.reference}, expecting ${session.manifest.expectedPackageCount} packages.`
            : "This session has no manifest, so the count cannot be checked."}
        </p>
        <TextField label="Note (optional)" value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} />
      </div>
    </Modal>
  );
}
