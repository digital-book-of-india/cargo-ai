import type { Schedule } from "@/types";
import { ApiError } from "./errors";
import { apiRequest } from "./client";

// Handoff section 9: the PUT response carries only these fields, not the weekly days.
// Callers must re-read the schedule (GET) to show what was stored.
export interface ScheduleSaveResult {
  shopId: string;
  timezone?: string;
  version: number;
  nextTransitionAt?: string;
}

export const scheduleApi = {
  get: (shopId: string) => apiRequest<Schedule>(`/shops/${shopId}/schedule`),
  // null when the shop has no schedule yet (the API answers 404)
  getOrNull: async (shopId: string): Promise<Schedule | null> => {
    try {
      return await apiRequest<Schedule>(`/shops/${shopId}/schedule`);
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) return null;
      throw err;
    }
  },
  // `exceptions` is passed through untouched so saving the weekly hours never wipes holidays.
  update: (
    shopId: string,
    input: Pick<Schedule, "weeklySchedule" | "gracePeriodMinutes"> & { exceptions?: unknown }
  ) =>
    apiRequest<ScheduleSaveResult>(`/shops/${shopId}/schedule`, { method: "PUT", body: input }),
};
