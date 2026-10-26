"use client";

import { useState } from "react";
import { useParams } from "next/navigation";
import { toast } from "sonner";
import { Router as ConnectorIcon, Plus, RefreshCw, Trash2 } from "lucide-react";
import { PageHeader } from "@/components/common/PageHeader";
import { ApiErrorState, EmptyState, LoadingState } from "@/components/common/States";
import { ConnectorStatusBadge } from "@/components/common/StatusBadges";
import {
  Button,
  Card,
  CardContent,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  TextField,
} from "@/components/ui";
import { useAsync } from "@/hooks/useAsync";
import { connectorsApi } from "@/lib/api/connectors";
import { friendlyMessage } from "@/lib/api/messages";
import { timeAgo } from "@/lib/camera";
import type { Connector, ConnectorWithPairingCode } from "@/types";

function minutesUntil(iso: string): number {
  return Math.max(0, Math.round((new Date(iso).getTime() - Date.now()) / 60_000));
}

export default function ConnectorsPage() {
  const { shopId } = useParams<{ shopId: string }>();
  const { data, error, loading, reload } = useAsync<Connector[]>(
    async () => (await connectorsApi.list(shopId)).connectors,
    [shopId]
  );

  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [pairing, setPairing] = useState<ConnectorWithPairingCode | null>(null);
  const [revoking, setRevoking] = useState<Connector | null>(null);
  const [busy, setBusy] = useState(false);

  async function createConnector() {
    if (!name.trim()) {
      setCreateError("Give this PC a name (e.g. Head Office).");
      return;
    }
    setBusy(true);
    setCreateError(null);
    try {
      const { connector } = await connectorsApi.create(shopId, name.trim());
      setCreateOpen(false);
      setName("");
      setPairing(connector);
      reload();
    } catch (err) {
      setCreateError(friendlyMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function regenerateCode(connector: Connector) {
    setBusy(true);
    try {
      const { connector: updated } = await connectorsApi.regeneratePairingCode(connector.id);
      setPairing(updated);
      reload();
    } catch (err) {
      toast.error(friendlyMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function confirmRevoke() {
    if (!revoking) return;
    setBusy(true);
    try {
      await connectorsApi.revoke(revoking.id);
      toast.success(`${revoking.name} disconnected`);
      setRevoking(null);
      reload();
    } catch (err) {
      toast.error(friendlyMessage(err));
    } finally {
      setBusy(false);
    }
  }

  if (loading && !data) return <LoadingState label="Loading connectors..." />;
  if (error) return <ApiErrorState error={error} onRetry={reload} />;
  if (!data) return null;

  return (
    <div className="animate-fade-up space-y-6">
      <PageHeader
        title="Connectors"
        description="Each site PC runs the StaffPie Connector and pairs here. Cameras are assigned to a connector so it knows which feeds to watch."
        actions={
          <Button
            onClick={() => {
              setName("");
              setCreateError(null);
              setCreateOpen(true);
            }}
          >
            <Plus aria-hidden /> New connector
          </Button>
        }
      />

      {data.length === 0 ? (
        <EmptyState
          icon={<ConnectorIcon className="size-6" aria-hidden />}
          title="No connector paired yet"
          hint="Create a connector, install the StaffPie Connector app on the site PC, and enter the pairing code there."
          action={
            <Button onClick={() => setCreateOpen(true)}>
              <Plus aria-hidden /> New connector
            </Button>
          }
        />
      ) : (
        <ul className="space-y-3">
          {data.map((c) => (
            <li key={c.id}>
              <Card>
                <CardContent className="flex flex-wrap items-center justify-between gap-3 py-4">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2 font-medium">
                      <ConnectorIcon className="size-4 text-muted-foreground" aria-hidden />
                      {c.name}
                      <ConnectorStatusBadge connector={c} />
                    </div>
                    <p className="text-sm text-muted-foreground">
                      {c.status === "PAIRED"
                        ? `${c.activeCameraCount} camera${c.activeCameraCount === 1 ? "" : "s"} · ${
                            c.lastHeartbeatAt ? `seen ${timeAgo(c.lastHeartbeatAt)}` : "never reported in"
                          }${c.lastSeenVersion ? ` · v${c.lastSeenVersion}` : ""}`
                        : c.status === "PENDING"
                        ? "Enter the pairing code in the Connector app on the site PC."
                        : "This connector was disconnected."}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    {c.status !== "REVOKED" && (
                      <Button variant="outline" size="sm" disabled={busy} onClick={() => regenerateCode(c)}>
                        <RefreshCw aria-hidden /> {c.status === "PENDING" ? "Show code" : "Re-pair"}
                      </Button>
                    )}
                    {c.status !== "REVOKED" && (
                      <Button variant="outline" size="sm" disabled={busy} onClick={() => setRevoking(c)}>
                        <Trash2 aria-hidden /> Disconnect
                      </Button>
                    )}
                  </div>
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      )}

      {/* New connector */}
      <Dialog open={createOpen} onOpenChange={(o) => !busy && setCreateOpen(o)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>New connector</DialogTitle>
            <DialogDescription>
              Name the site PC this will run on. You will install the StaffPie Connector app there and type in
              a pairing code.
            </DialogDescription>
          </DialogHeader>
          <TextField
            label="Connector name"
            placeholder="Head Office"
            value={name}
            onChange={(e) => setName(e.target.value)}
            error={createError ?? undefined}
            disabled={creating}
          />
          <DialogFooter>
            <Button variant="outline" disabled={busy} onClick={() => setCreateOpen(false)}>
              Cancel
            </Button>
            <Button loading={busy} onClick={createConnector}>
              Create & show pairing code
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Pairing code */}
      <Dialog open={!!pairing} onOpenChange={(o) => !o && setPairing(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Pairing code for {pairing?.name}</DialogTitle>
            <DialogDescription>
              Open the StaffPie Connector app on the site PC and type this code in. It expires in{" "}
              {pairing ? minutesUntil(pairing.pairingCodeExpiresAt) : 0} minutes.
            </DialogDescription>
          </DialogHeader>
          <div className="rounded-lg border bg-muted/40 py-6 text-center">
            <span className="text-3xl font-mono font-semibold tracking-widest">{pairing?.pairingCode}</span>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                if (pairing?.pairingCode) {
                  void navigator.clipboard?.writeText(pairing.pairingCode);
                  toast.success("Pairing code copied");
                }
              }}
            >
              Copy code
            </Button>
            <Button onClick={() => setPairing(null)}>Done</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Disconnect confirm */}
      <Dialog open={!!revoking} onOpenChange={(o) => !busy && !o && setRevoking(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="text-danger">Disconnect {revoking?.name}?</DialogTitle>
            <DialogDescription>
              This PC will stop being able to report in or fetch its camera list until it is paired again with a
              new code.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" disabled={busy} onClick={() => setRevoking(null)}>
              Cancel
            </Button>
            <Button variant="danger" loading={busy} onClick={confirmRevoke}>
              Disconnect
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
