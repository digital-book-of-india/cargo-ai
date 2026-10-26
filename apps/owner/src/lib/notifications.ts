import type { AppNotification } from "@/types";

// Pure logic for the notification screens.

export const CHANNEL_LABEL: Record<AppNotification["channel"], string> = {
  PUSH: "Push",
  IN_APP: "In app",
};

// "FAILED" means the owner may NOT have been told: say so plainly.
export const DELIVERY_META: Record<
  AppNotification["status"],
  { label: string; tone: "neutral" | "success" | "danger"; hint: string }
> = {
  PENDING: { label: "Waiting to send", tone: "neutral", hint: "This has not been delivered yet." },
  SENT: { label: "Sent", tone: "success", hint: "" },
  FAILED: {
    label: "Not delivered",
    tone: "danger",
    hint: "This message could not be delivered. Check your alerts to see what happened.",
  },
};

export function sortNotifications<T extends AppNotification>(list: T[]): T[] {
  return [...list].sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id));
}

export function countFailed(list: AppNotification[]): number {
  return list.filter((n) => n.status === "FAILED").length;
}

/** Notifications may carry a shop id (not in @dbi/api-types yet). */
export type OwnerNotification = AppNotification & { shopId?: string };

/** Which shop an alert link should use: the notification's own shop when known, else the current one. */
export function notificationShopId(n: OwnerNotification, currentShopId: string | null): string | null {
  return n.shopId || currentShopId;
}

/** Merges a fresh list into what is shown: updated rows replace old ones, unseen ones are counted. */
export function applyLatestNotifications<T extends AppNotification>(
  existing: T[],
  latest: T[]
): { items: T[]; newCount: number } {
  const known = new Set(existing.map((n) => n.id));
  const newCount = latest.filter((n) => !known.has(n.id)).length;
  return { items: sortNotifications(latest), newCount };
}
