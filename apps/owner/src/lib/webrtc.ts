import { camerasApi } from "@/lib/api/cameras";
import { ApiError } from "@/lib/api/errors";

const ICE_GATHER_TIMEOUT_MS = 3000;
const CONNECT_TIMEOUT_MS = 12000;
const FIRST_FRAME_TIMEOUT_MS = 8000;

// Resolves once the browser has collected its network candidates (or after a short wait: the
// offer is sent in one piece, so candidates found later would be lost anyway).
function waitForIceGathering(pc: RTCPeerConnection): Promise<void> {
  return new Promise((resolve) => {
    if (pc.iceGatheringState === "complete") return resolve();
    const done = () => {
      pc.removeEventListener("icegatheringstatechange", onChange);
      clearTimeout(timer);
      resolve();
    };
    const onChange = () => {
      if (pc.iceGatheringState === "complete") done();
    };
    const timer = setTimeout(done, ICE_GATHER_TIMEOUT_MS);
    pc.addEventListener("icegatheringstatechange", onChange);
  });
}

function waitForConnected(pc: RTCPeerConnection): Promise<void> {
  return new Promise((resolve, reject) => {
    if (pc.connectionState === "connected") return resolve();
    const cleanup = () => {
      pc.removeEventListener("connectionstatechange", onChange);
      clearTimeout(timer);
    };
    const onChange = () => {
      if (pc.connectionState === "connected") {
        cleanup();
        resolve();
      } else if (pc.connectionState === "failed" || pc.connectionState === "closed") {
        cleanup();
        reject(new Error("WebRTC connection failed"));
      }
    };
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error("WebRTC connection timed out"));
    }, CONNECT_TIMEOUT_MS);
    pc.addEventListener("connectionstatechange", onChange);
  });
}

// The connection can be up while no picture ever arrives (a codec the browser cannot decode, a
// stream that is slow to start). Only call it live once a frame has really been decoded.
function waitForFirstFrame(video: HTMLVideoElement): Promise<void> {
  return new Promise((resolve, reject) => {
    const hasFrame = () => video.videoWidth > 0 && video.readyState >= 2;
    if (hasFrame()) return resolve();
    const cleanup = () => {
      video.removeEventListener("loadeddata", onData);
      video.removeEventListener("playing", onData);
      clearTimeout(timer);
    };
    const onData = () => {
      if (hasFrame()) {
        cleanup();
        resolve();
      }
    };
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error("No video frames arrived"));
    }, FIRST_FRAME_TIMEOUT_MS);
    video.addEventListener("loadeddata", onData);
    video.addEventListener("playing", onData);
  });
}

/**
 * Plays a camera's live video in `video` over WebRTC. The offer goes through the backend to the
 * Connector PC next to the camera (go2rtc), and the video flows from there to this browser, via
 * Cloudflare TURN when the networks need it. Resolves with a function that stops the stream;
 * `onLost` fires if the connection drops later. Rejects if video cannot be started (callers fall
 * back to still pictures).
 */
export async function connectWebRtc(
  cameraId: string,
  video: HTMLVideoElement,
  onLost: () => void
): Promise<() => void> {
  const { iceServers } = await camerasApi.iceServers();
  const pc = new RTCPeerConnection({ iceServers });
  pc.addTransceiver("video", { direction: "recvonly" });
  pc.ontrack = (event) => {
    video.srcObject = event.streams[0] ?? new MediaStream([event.track]);
    void video.play().catch(() => undefined);
  };

  const close = () => {
    pc.onconnectionstatechange = null;
    pc.close();
    video.srcObject = null;
  };

  try {
    await pc.setLocalDescription(await pc.createOffer());
    await waitForIceGathering(pc);
    const { answer } = await camerasApi.webrtcOffer(cameraId, pc.localDescription!.sdp);
    await pc.setRemoteDescription({ type: "answer", sdp: answer });
    await waitForConnected(pc);
    await waitForFirstFrame(video);
  } catch (err) {
    close();
    throw err;
  }

  pc.onconnectionstatechange = () => {
    if (pc.connectionState === "failed" || pc.connectionState === "disconnected" || pc.connectionState === "closed") onLost();
  };
  return close;
}

/** A short, plain reason why live video could not start, shown under the picture. */
export function describeWebRtcError(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.code === "CONNECTOR_OFFLINE") return "The shop PC (Theaft Connector) is offline.";
    if (err.code === "CONNECTOR_TIMEOUT")
      return "The shop PC did not answer. Update Theaft Connector to the latest version and make sure it is running.";
    if (err.code === "WEBRTC_FAILED")
      return "The shop PC could not start the video (go2rtc). Check that Windows Firewall allowed Theaft Connector.";
    if (err.status === 0) return "Could not reach the server.";
    return err.message || "The server could not start live video.";
  }
  const message = err instanceof Error ? err.message : "";
  if (message.includes("No video frames")) {
    return "Connected, but no picture arrived. The camera's video format may not play in a browser; use the sub-stream (path ending in 02).";
  }
  if (message.includes("WebRTC connection")) {
    return "The video connection to the shop PC could not be set up (network or firewall). Cloudflare TURN may be needed.";
  }
  return "Live video could not start.";
};
