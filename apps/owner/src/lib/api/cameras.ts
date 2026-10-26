import type { Camera, SaveZoneRequest, Zone } from "@/types";
import { getZoneSavedCameraIds } from "@/lib/utils/storage";
import { ApiError } from "./errors";
import { apiRequest } from "./client";

export const camerasApi = {
  register: (
    shopId: string,
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
    apiRequest<{ camera: Camera }>(`/shops/${shopId}/cameras`, {
      method: "POST",
      body: input,
    }),

  // The API answers { items }; { cameras } is accepted too.
  list: async (shopId: string): Promise<{ cameras: Camera[] }> => {
    const res = await apiRequest<{ items?: Camera[]; cameras?: Camera[] }>(
      `/shops/${shopId}/cameras`
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