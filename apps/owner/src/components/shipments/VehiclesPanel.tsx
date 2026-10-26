"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Alert, ApiErrorState, EmptyState, LoadingState } from "@/components/common/States";
import { Badge, Button, Card, TextField } from "@/components/ui";
import { useAsync } from "@/hooks/useAsync";
import { friendlyMessage } from "@/lib/api/messages";
import { vehiclesApi } from "@/lib/api/shipments";
import { useAuth } from "@/lib/auth/AuthProvider";

export function VehiclesPanel() {
  const { can } = useAuth();
  const canWrite = can("manifests:write");
  const vehicles = useAsync(() => vehiclesApi.list(), []);
  const [plate, setPlate] = useState("");
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function add() {
    setBusy(true);
    setError(null);
    try {
      await vehiclesApi.create({ registrationNumber: plate.trim(), label: label.trim() || undefined });
      setPlate("");
      setLabel("");
      toast.success("Vehicle added");
      vehicles.reload();
    } catch (err) {
      setError(friendlyMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function toggle(id: string, active: boolean) {
    try {
      await vehiclesApi.update(id, { active });
      vehicles.reload();
    } catch (err) {
      toast.error(friendlyMessage(err));
    }
  }

  if (vehicles.loading && !vehicles.data) return <LoadingState label="Loading vehicles..." />;
  if (vehicles.error && !vehicles.data) return <ApiErrorState error={vehicles.error} onRetry={vehicles.reload} />;
  const items = vehicles.data ?? [];

  return (
    <div className="space-y-4">
      {canWrite && (
        <Card className="p-4 sm:p-5">
          <form
            className="flex flex-col gap-3 sm:flex-row sm:items-end"
            onSubmit={(e) => {
              e.preventDefault();
              if (plate.trim()) add();
            }}
          >
            <TextField label="Registration number" value={plate} onChange={(e) => setPlate(e.target.value)} maxLength={32} />
            <TextField label="Label (optional)" value={label} onChange={(e) => setLabel(e.target.value)} maxLength={120} />
            <Button type="submit" disabled={busy || !plate.trim()}>
              {busy ? "Adding..." : "Add vehicle"}
            </Button>
          </form>
          {error && (
            <div className="mt-3">
              <Alert tone="danger">{error}</Alert>
            </div>
          )}
        </Card>
      )}
      {items.length === 0 ? (
        <EmptyState title="No vehicles" hint="Register the vehicles you load so sessions can say which one they were for." />
      ) : (
        <Card>
          <ul className="divide-y" aria-label="Vehicles">
            {items.map((v) => (
              <li key={v.id} className="flex items-center justify-between gap-3 p-4 sm:p-5">
                <div>
                  <span className="font-medium">{v.registrationNumber}</span>
                  {v.label && <span className="ml-2 text-sm text-muted-foreground">{v.label}</span>}
                  {!v.active && <Badge className="ml-2">Not in use</Badge>}
                </div>
                {canWrite && (
                  <Button variant="ghost" onClick={() => toggle(v.id, !v.active)}>
                    {v.active ? "Stop using" : "Use again"}
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
