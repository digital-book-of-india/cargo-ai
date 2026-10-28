import type { Camera, SaveZoneRequest, Zone } from "@/types";
import { getZoneSavedCameraIds } from "@/lib/utils/storage";
import { ApiError } from "./errors";
import { apiRequest, API_BASE_URL } from "./client";

export const camerasApi = {
  register: (
    siteId: string,
    input: {
      name: string;
      protocol: "RTSP" | "ONVIF";
      host: string;
      port?: number;
      username?: string;
      password?: string;
      path?: string;
    }
  ) =>
    apiRequest<{ camera: Camera }>(`/sites/${siteId}/cameras`, {
      method: "POST",
      body: input,
    }),

  // The API answers { items }; { cameras } is accepted too.
  list: async (siteId: string): Promise<{ cameras: Camera[] }> => {
    const res = await apiRequest<{ items?: Camera[]; cameras?: Camera[] }>(
      `/sites/${siteId}/cameras`
    );
    return { cameras: res.items ?? res.cameras ?? [] };
  },

  // May answer with the camera and a message, or with nothing at all: callers re-read the list.
  test: (cameraId: string) =>
    apiRequest<{ camera?: Camera; message?: string } | null>(
      `/cameras/${cameraId}/test`,
      { method: "POST" }
    ),

  update: (
    cameraId: string,
    input: Partial<{
      name: string;
      host: string;
      port: number;
      username: string;
      password: string;
      path: string;
    }>
  ) =>
    apiRequest<{ camera: Camera }>(`/cameras/${cameraId}`, {
      method: "PATCH",
      body: input,
    }),

  // Moves a camera to another site of the same company.
  assignSite: (cameraId: string, siteId: string) =>
    apiRequest<{ camera: Camera }>(`/cameras/${cameraId}/assign-site`, { method: "POST", body: { siteId } }),

  delete: (cameraId: string) =>
    apiRequest<{ id?: string; message?: string; success?: boolean }>(`/cameras/${cameraId}`, {
      method: "DELETE",
    }),

  saveZone: (cameraId: string, zone: SaveZoneRequest) =>
    apiRequest<unknown>(`/cameras/${cameraId}/zones`, {
      method: "PUT",
      body: zone,
    }),

  // The saved zone, or null when none was saved yet (the API answers 404 then).
  // Tells the server someone is watching, so the site PC uploads about a picture a second.
  requestLive: (cameraId: string) =>
    apiRequest<{ expiresAt: string }>(`/cameras/${cameraId}/live`, { method: "POST" }),

  // The latest uploaded picture, or null when none has arrived yet (204/404).
  fetchLiveFrame: async (cameraId: string): Promise<{ blob: Blob; at: number } | null> => {
    const res = await fetch(`${API_BASE_URL}/cameras/${cameraId}/live.jpg`, {
      credentials: "include",
      cache: "no-store",
    });
    if (res.status === 204 || res.status === 404) return null;
    if (!res.ok) throw new ApiError(res.status, "LIVE_FRAME_FAILED", "Could not read the live picture.");
    return { blob: await res.blob(), at: Number(res.headers.get("x-frame-at")) || Date.now() };
  },

  getZone: async (cameraId: string): Promise<Zone | null> => {
    try {
      const res = await apiRequest<{ zone?: Zone } | Zone>(
        `/cameras/${cameraId}/zones`
      );
      const zone = (res as { zone?: Zone }).zone ?? (res as Zone);
      return zone && Array.isArray(zone.polygon) ? zone : null;
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) return null;
      throw err;
    }
  },
};

/**
 * Camera ids that have a saved zone, read from the API. If a read fails for another reason than
 * "no zone", the marker this browser kept after saving is used for that camera.
 */
export async function loadZoneCameraIds(cameras: Camera[]): Promise<string[]> {
  const markers = getZoneSavedCameraIds();
  const found = await Promise.all(
    cameras.map(async (c) => {
      try {
        return (await camerasApi.getZone(c.id)) ? c.id : null;
      } catch {
        return markers.includes(c.id) ? c.id : null;
      }
    })
  );
  return found.filter((id): id is string => id !== null);
}