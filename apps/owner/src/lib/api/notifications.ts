import type { AppNotification } from "@/types";
import { apiRequest } from "./client";

export const notificationsApi = {
  // The API answers { items }; { notifications } is accepted too.
  list: async (): Promise<{ notifications: AppNotification[] }> => {
    const res = await apiRequest<{ items?: AppNotification[]; notifications?: AppNotification[] }>("/notifications");
    return { notifications: res.items ?? res.notifications ?? [] };
  },
};
