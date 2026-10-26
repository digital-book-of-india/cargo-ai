// Browser push registration. Nothing here runs until the owner clicks "Turn on".
// The permission prompt is only shown when push can actually work in this deployment.

export type PermissionState = "unsupported" | "default" | "granted" | "denied";

export type PushFailure = "UNSUPPORTED" | "NOT_CONFIGURED" | "DENIED" | "DISMISSED" | "SUBSCRIBE_FAILED";

export class PushError extends Error {
  constructor(
    public readonly reason: PushFailure,
    message: string
  ) {
    super(message);
    this.name = "PushError";
  }
}

export const PUSH_FAILURE_MESSAGE: Record<PushFailure, string> = {
  UNSUPPORTED: "This browser does not support notifications.",
  NOT_CONFIGURED: "Push notifications are not set up for this service yet. You will still see alerts in the app.",
  DENIED: "Notifications are blocked for this site. Allow them in your browser settings, then try again.",
  DISMISSED: "You did not allow notifications. You can try again any time.",
  SUBSCRIBE_FAILED: "We could not turn on notifications on this device. Please try again.",
};

/** What the code needs from the browser: injectable so the rules can be tested. */
export interface PushEnv {
  Notification?: {
    permission: NotificationPermission;
    requestPermission: () => Promise<NotificationPermission>;
  };
  serviceWorker?: {
    register: (url: string) => Promise<{
      pushManager: {
        subscribe: (o: { userVisibleOnly: boolean; applicationServerKey: Uint8Array }) => Promise<{ toJSON: () => unknown }>;
      };
    }>;
  };
  /** public VAPID key (base64url). Not a secret. */
  vapidKey?: string;
  /** the demo (mock) layer is active: a clearly fake token is allowed */
  demo?: boolean;
}

export function browserEnv(): PushEnv {
  if (typeof window === "undefined") return {};
  return {
    Notification: "Notification" in window ? window.Notification : undefined,
    serviceWorker: "serviceWorker" in navigator && "PushManager" in window ? navigator.serviceWorker : undefined,
    vapidKey: process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || undefined,
    demo: process.env.NEXT_PUBLIC_USE_MOCKS === "true",
  };
}

export function permissionState(env: PushEnv = browserEnv()): PermissionState {
  if (!env.Notification) return "unsupported";
  const p = env.Notification.permission;
  return p === "granted" || p === "denied" ? p : "default";
}

/** Can a real or demo token be produced in this deployment? */
export function pushConfigured(env: PushEnv = browserEnv()): boolean {
  return !!env.demo || (!!env.vapidKey && !!env.serviceWorker);
}

export function base64UrlToBytes(value: string): Uint8Array {
  const padded = value + "=".repeat((4 - (value.length % 4)) % 4);
  const raw = atob(padded.replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

// Asks for permission (only if push can work) and returns the token to send to the API.
export async function enablePush(env: PushEnv = browserEnv()): Promise<{ token: string; demo: boolean }> {
  if (!env.Notification) throw new PushError("UNSUPPORTED", PUSH_FAILURE_MESSAGE.UNSUPPORTED);
  if (env.Notification.permission === "denied") throw new PushError("DENIED", PUSH_FAILURE_MESSAGE.DENIED);
  if (!pushConfigured(env)) throw new PushError("NOT_CONFIGURED", PUSH_FAILURE_MESSAGE.NOT_CONFIGURED);

  let permission: NotificationPermission = env.Notification.permission;
  if (permission !== "granted") permission = await env.Notification.requestPermission();
  if (permission === "denied") throw new PushError("DENIED", PUSH_FAILURE_MESSAGE.DENIED);
  if (permission !== "granted") throw new PushError("DISMISSED", PUSH_FAILURE_MESSAGE.DISMISSED);

  // real subscription when configured, otherwise the labelled demo token
  if (env.vapidKey && env.serviceWorker) {
    try {
      const registration = await env.serviceWorker.register("/sw.js");
      const sub = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: base64UrlToBytes(env.vapidKey),
      });
      return { token: JSON.stringify(sub.toJSON()), demo: false };
    } catch {
      throw new PushError("SUBSCRIBE_FAILED", PUSH_FAILURE_MESSAGE.SUBSCRIBE_FAILED);
    }
  }

  const random = Math.random().toString(36).slice(2, 10);
  return { token: `demo-token-${random}`, demo: true };
}
