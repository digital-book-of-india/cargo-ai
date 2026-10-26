import type { NotificationPreferences } from "@/lib/notifications";
import type { AppNotification } from "@/types";
import { apiRequest } from "./client";

export const notificationsApi = {
  // The API answers { items }; { notifications } is accepted too.
  list: async (): Promise<{ notifications: AppNotification[] }> => {
    const res = await apiRequest<{ items?: AppNotification[]; notifications?: AppNotification[] }>("/notifications");
    return { notifications: res.items ?? res.notifications ?? [] };
  },
  registerPushToken: (token: string) =>
    apiRequest<unknown>("/notifications/push-token", { method: "POST", body: { token } }),
  // Not in the handoff catalogue yet (see docs/gaps/dev1-owner.md).
  getPreferences: () => apiRequest<unknown>("/notifications/preferences"),
  updatePreferences: (prefs: NotificationPreferences) =>
    apiRequest<unknown>("/notifications/preferences", { method: "PUT", body: prefs }),
};
