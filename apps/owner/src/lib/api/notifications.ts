import type { AppNotification } from "@/types";
import { apiRequest } from "./client";

export const notificationsApi = {
  list: (opts: { unread?: boolean; limit?: number } = {}) =>
    apiRequest<{ items: AppNotification[]; unreadCount: number }>("/notifications", {
      query: { unread: opts.unread ? "true" : undefined, limit: opts.limit },
    }),
  unreadCount: async () => (await apiRequest<{ unreadCount: number }>("/notifications/unread-count")).unreadCount,
  markRead: (id: string) => apiRequest<{ id: string; readAt: string }>(`/notifications/${id}/read`, { method: "POST" }),
  readAll: () => apiRequest<{ marked: number }>("/notifications/read-all", { method: "POST" }),
};
