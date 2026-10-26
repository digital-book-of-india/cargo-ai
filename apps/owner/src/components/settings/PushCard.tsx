"use client";

import { useEffect, useState } from "react";
import { BellRing } from "lucide-react";
import { toast } from "sonner";
import { DemoBadge } from "@/components/common/DemoBadge";
import { Alert } from "@/components/common/States";
import { Badge, Button, Card } from "@/components/ui";
import { notificationsApi } from "@/lib/api/notifications";
import { friendlyMessage } from "@/lib/api/messages";
import { PushError, browserEnv, enablePush, permissionState, pushConfigured } from "@/lib/push";
import type { PermissionState } from "@/lib/push";
import { readJson, writeJson } from "@/lib/utils/storage";

const REGISTERED_KEY = "dbi-push-registered";

// Turning on push on this browser. Permission is asked only after the owner clicks.
export function PushCard() {
  const [permission, setPermission] = useState<PermissionState | null>(null);
  const [configured, setConfigured] = useState(true);
  const [registered, setRegistered] = useState(false);
  const [demo, setDemo] = useState(false);
  const [providerPending, setProviderPending] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const env = browserEnv();
    setPermission(permissionState(env));
    setConfigured(pushConfigured(env));
    setDemo(!!env.demo);
    setRegistered(readJson<boolean>(REGISTERED_KEY, false));
  }, []);

  async function turnOn() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const { token } = await enablePush();
      const res = (await notificationsApi.registerPushToken(token)) as { message?: string } | null;
      writeJson(REGISTERED_KEY, true);
      setRegistered(true);
      setPermission(permissionState());
      // The API may only acknowledge the token while the push provider is not set up yet.
      const pending = /pending/i.test(res?.message ?? "");
      setProviderPending(pending);
      if (pending) {
        toast.info("This browser is registered. Push delivery is pending setup.");
      } else {
        toast.success("Notifications are on for this browser");
      }
    } catch (err) {
      setPermission(permissionState());
      setError(err instanceof PushError ? err.message : friendlyMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const on = registered && permission === "granted";

  let body: React.ReactNode;
  if (permission === null) {
    body = null;
  } else if (permission === "unsupported") {
    body = <Alert tone="info">This browser does not support notifications. You will still see alerts in the app.</Alert>;
  } else if (!configured && !on) {
    body = (
      <Alert tone="info">
        Push integration pending: push notifications are not set up for this service yet. You will
        still see alerts in the app.
      </Alert>
    );
  } else if (permission === "denied") {
    body = (
      <Alert tone="warning">
        Notifications are blocked for this site. Allow them in your browser settings, then come back here.
      </Alert>
    );
  } else if (on) {
    body = (
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={providerPending ? "warning" : "success"} dot>
          {providerPending ? "Registered: push integration pending" : "On for this browser"}
        </Badge>
        {demo && <DemoBadge />}
        <span className="text-sm text-muted-foreground">
          To stop them, block notifications for this site in your browser settings.
        </span>
      </div>
    );
  } else {
    body = (
      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={() => void turnOn()} loading={busy}>
          <BellRing aria-hidden /> Turn on notifications
        </Button>
        {demo && <DemoBadge />}
      </div>
    );
  }

  return (
    <Card className="p-5">
      <h2 className="font-semibold">Push notifications</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Get a message on this device when something is detected. Push can be late or missed, so the
        alerts page is always the source of truth.
      </p>
      {error && (
        <div className="mt-3">
          <Alert tone="danger">{error}</Alert>
        </div>
      )}
      <div className="mt-4">{body}</div>
    </Card>
  );
}
