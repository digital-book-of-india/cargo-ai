import type {
  CargoEventDetail,
  CargoEventSeverity,
  CargoEventStatus,
  CargoEventSummary,
  CargoEventType,
  EventAssignee,
  EventSummaryCounts,
  Paginated,
} from "@/types";
import type { ReviewActionId } from "@/lib/events";
import { apiRequest } from "./client";

type DetailResponse = { event: CargoEventDetail };

export interface EventQuery {
  siteId?: string;
  status?: CargoEventStatus;
  severity?: CargoEventSeverity;
  eventType?: CargoEventType;
  assignedTo?: "me";
  from?: string;
  to?: string;
  cursor?: string;
  limit?: number;
}

export const eventsApi = {
  // company-wide (the sites this person may see), narrowed by the filters
  query: (q: EventQuery = {}) => apiRequest<Paginated<CargoEventSummary>>("/events", { query: q as Record<string, string | number | undefined> }),
  summary: (q: Pick<EventQuery, "siteId" | "assignedTo" | "from" | "to"> = {}) =>
    apiRequest<EventSummaryCounts>("/events/summary", { query: q as Record<string, string | undefined> }),
  list: (siteId: string, query?: { cursor?: string; limit?: number }) =>
    apiRequest<Paginated<CargoEventSummary>>(`/sites/${siteId}/events`, { query }),
  get: (eventId: string) => apiRequest<DetailResponse>(`/events/${eventId}`),
  assignees: async (eventId: string): Promise<EventAssignee[]> =>
    (await apiRequest<{ items: EventAssignee[] }>(`/events/${eventId}/assignees`)).items,

  // One call per review action. The server decides whether the move is allowed.
  act: (eventId: string, action: ReviewActionId, note?: string) => {
    const text = note?.trim() || undefined;
    if (action === "acknowledge") {
      return apiRequest<DetailResponse>(`/events/${eventId}/acknowledge`, { method: "POST", body: { note: text } });
    }
    if (action === "false_positive") {
      return apiRequest<DetailResponse>(`/events/${eventId}/false-positive`, { method: "POST", body: { reason: text } });
    }
    return apiRequest<DetailResponse>(`/events/${eventId}/resolve`, {
      method: "POST",
      body: { outcome: action, note: text },
    });
  },
  addNote: (eventId: string, note: string) =>
    apiRequest<DetailResponse>(`/events/${eventId}/notes`, { method: "POST", body: { note } }),
  assign: (eventId: string, userId: string | null) =>
    apiRequest<DetailResponse>(`/events/${eventId}/assign`, { method: "POST", body: { userId } }),
  reopen: (eventId: string, note: string) =>
    apiRequest<DetailResponse>(`/events/${eventId}/reopen`, { method: "POST", body: { note } }),
};
