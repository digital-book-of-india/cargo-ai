import type { AppNotification } from "@/types";

// Pure helpers for the notification screens.

export function sortNotifications<T extends AppNotification>(list: T[]): T[] {
  return [...list].sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id));
}

// A notification that is not SENT may never have reached the person: say so plainly.
export function deliveryNote(status: AppNotification["status"]): string | null {
  if (status === "PENDING") return "Delivery is still being retried.";
  if (status === "FAILED") return "This could not be delivered. Check your alerts to see what happened.";
  return null;
}
