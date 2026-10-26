import type { OwnerEvent } from "@/lib/events";
import type { Paginated, ReviewStatus } from "@/types";
import { apiRequest } from "./client";

export const eventsApi = {
  list: (shopId: string, query?: { cursor?: string; limit?: number }) =>
    apiRequest<Paginated<OwnerEvent>>(`/shops/${shopId}/events`, { query }),
  get: (eventId: string) => apiRequest<{ event: OwnerEvent }>(`/events/${eventId}`),
  review: (eventId: string, reviewStatus: Exclude<ReviewStatus, "NEW">) =>
    apiRequest<{ event: OwnerEvent }>(`/events/${eventId}/review`, {
      method: "POST",
      body: { reviewStatus },
    }),
};
