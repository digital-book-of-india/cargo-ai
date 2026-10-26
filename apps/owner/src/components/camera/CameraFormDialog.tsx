"use client";

import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { ShieldAlert } from "lucide-react";
import { Alert } from "@/components/common/States";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  SelectField,
  TextField,
} from "@/components/ui";
import { connectorsApi } from "@/lib/api/connectors";
import { friendlyMessage } from "@/lib/api/messages";
import { checkHost, checkPort } from "@/lib/camera";
import { CONSENT_LABEL, PRIVACY_POINTS } from "@/lib/privacy";
import type { Camera, Connector } from "@/types";

export interface CameraFormValues {
  name: string;
  connectorId?: string | null;
  protocol: "RTSP" | "ONVIF";
  /** empty string when editing and the connection is left unchanged */
  host: string;
  port?: number;
  username?: string;
  password?: string;
  path?: string;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  shopId: string;
  /** set when editing an existing camera */
  camera?: Camera;
  onSubmit: (values: CameraFormValues) => Promise<void>;
}

// Add or edit a camera. The address is never shown back: when editing, leaving it blank keeps
// the stored one. Form state is cleared whenever the dialog closes.
export function CameraFormDialog({ open, onOpenChange, shopId, camera, onSubmit }: Props) {
  const editing = !!camera;
  const [name, setName] = useState("");
  const [connectorId, setConnectorId] = useState<string>("");
  const [connectors, setConnectors] = useState<Connector[]>([]);
  const [protocol, setProtocol] = useState<"RTSP" | "ONVIF">("RTSP");
  const [host, setHost] = useState("");
  const [port, setPort] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [path, setPath] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [consent, setConsent] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName(camera?.name ?? "");
    setConnectorId(camera?.connectorId ?? "");
    setProtocol(camera?.protocol ?? "RTSP");
    setHost("");
    setPort("");
    setUsername("");
    setPassword("");
    setPath("");
    setErrors({});
    setFormError(null);
    setSubmitting(false);
    setConsent(false);
    connectorsApi
      .list(shopId)
      .then((res) => setConnectors(res.connectors))
      .catch(() => setConnectors([]));
  }, [open, camera, shopId]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (submitting) return;
    setFormError(null);

    const fieldErrors: Record<string, string> = {};
    if (!name.trim()) fieldErrors.name = "Give the camera a name";
    if (!editing && !consent) fieldErrors.consent = "Please confirm before adding the camera";

    let hostValue = "";
    let portValue: number | undefined;
    if (!editing || host.trim()) {
      const hostCheck = checkHost(host);
      if (!hostCheck.ok) fieldErrors.host = hostCheck.message;
      else hostValue = hostCheck.value;

      const portCheck = checkPort(port);
      if (!portCheck.ok) fieldErrors.port = portCheck.message;
      else portValue = portCheck.value;
    }

    if (Object.keys(fieldErrors).length > 0) {
      setErrors(fieldErrors);
      return;
    }
    setErrors({});

    // nothing to change: just close
    if (editing && camera && name.trim() === camera.name && !hostValue) {
      onOpenChange(false);
      return;
    }

    setSubmitting(true);
    try {
      await onSubmit({
        name: name.trim(),
        connectorId: connectorId || null,
        protocol,
        host: hostValue,
        port: portValue,
        username: username.trim() || undefined,
        password: password || undefined,
        path: path.trim() || undefined,
      });
      // do not keep credentials around in form state
      setHost("");
      setPort("");
      setUsername("");
      setPassword("");
      setPath("");
      onOpenChange(false);
    } catch (err) {
      setFormError(friendlyMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !submitting && onOpenChange(o)}>
      <DialogContent className="max-w-lg max-h-[calc(100dvh-2rem)] overflow-y-auto">
        <form onSubmit={handleSubmit} noValidate className="space-y-5">
          <DialogHeader>
            <DialogTitle>{editing ? "Edit camera" : "Add a camera"}</DialogTitle>
            <DialogDescription>
              {editing
                ? "Change the name or give a new address. A new address must be tested again."
                : "Use the camera that watches your shutter or gate."}
            </DialogDescription>
          </DialogHeader>

          {formError && <Alert tone="danger">{formError}</Alert>}

          <div className="space-y-4">
            <TextField
              label="Camera name"
              placeholder="Front shutter camera"
              value={name}
              onChange={(e) => setName(e.target.value)}
              error={errors.name}
              disabled={submitting}
            />

            <SelectField
              label="Connector (site PC)"
              value={connectorId || "__none"}
              onValueChange={(v) => setConnectorId(v === "__none" ? "" : v)}
              options={[
                { value: "__none", label: "Not assigned yet" },
                ...connectors.map((c) => ({
                  value: c.id,
                  label: `${c.name}${c.online ? " (online)" : ""}`,
                })),
              ]}
              hint={
                connectors.length === 0
                  ? "No connectors yet - create one from the Connectors page first."
                  : "The on-site PC that will pull this camera's stream."
              }
              disabled={submitting}
            />

            <SelectField
              label="Connection type"
              value={protocol}
              onValueChange={(v) => setProtocol(v as "RTSP" | "ONVIF")}
              options={[
                { value: "RTSP", label: "RTSP (most cameras and DVR/NVR)" },
                { value: "ONVIF", label: "ONVIF" },
              ]}
              hint={
                editing
                  ? "The connection type cannot be changed. Add a new camera to use another type."
                  : undefined
              }
              disabled={submitting || editing}
            />

            <div className="grid grid-cols-3 gap-3">
              <div className="col-span-2">
                <TextField
                  label={editing ? "New camera IP/host (optional)" : "Camera IP or hostname"}
                  autoComplete="off"
                  spellCheck={false}
                  placeholder="192.168.1.20"
                  hint={editing ? "Leave blank to keep the current connection." : undefined}
                  value={host}
                  onChange={(e) => setHost(e.target.value)}
                  error={errors.host}
                  disabled={submitting}
                />
              </div>
              <TextField
                label="Port"
                autoComplete="off"
                placeholder="554"
                value={port}
                onChange={(e) => setPort(e.target.value)}
                error={errors.port}
                disabled={submitting}
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <TextField
                label="Username (optional)"
                autoComplete="off"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                disabled={submitting}
              />
              <TextField
                label="Password (optional)"
                type="password"
                autoComplete="off"
                hint="Never shown again after saving."
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={submitting}
              />
            </div>

            <TextField
              label="Stream path (optional)"
              autoComplete="off"
              placeholder="/stream1"
              hint="Defaults to /stream1 if left blank."
              value={path}
              onChange={(e) => setPath(e.target.value)}
              disabled={submitting}
            />
          </div>

          <div className="rounded-lg border border-warning/30 bg-warning/5 p-3 text-xs text-muted-foreground">
            <p className="flex items-center gap-2 font-medium text-foreground">
              <ShieldAlert className="size-4 shrink-0 text-warning" aria-hidden /> Privacy notice
            </p>
            <ul className="mt-2 list-disc space-y-1 pl-5">
              {PRIVACY_POINTS.slice(0, 4).map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
            <p className="mt-2">We never show your camera password.</p>
          </div>

          {!editing && (
            <div>
              <label className="flex cursor-pointer items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={consent}
                  onChange={(e) => setConsent(e.target.checked)}
                  disabled={submitting}
                  className="mt-0.5 size-4 shrink-0 accent-primary"
                />
                <span>{CONSENT_LABEL}</span>
              </label>
              {errors.consent && (
                <p role="alert" className="mt-1 text-xs font-medium text-destructive">
                  {errors.consent}
                </p>
              )}
            </div>
          )}

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={submitting}
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" loading={submitting}>
              {editing ? "Save camera" : "Add camera"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}