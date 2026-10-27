export interface WorkerInfo {
  status: string;
  lastHeartbeatAt: string | null;
  isStale: boolean;
}

export interface WorkerView {
  label: string;
  dot: string;
  badge: string;
  age: string;
}

function ageText(iso: string | null): string {
  if (!iso) return "never";
  const seconds = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (seconds < 60) return `${seconds} s ago`;
  if (seconds < 3600) return `${Math.round(seconds / 60)} min ago`;
  if (seconds < 86400) return `${Math.round(seconds / 3600)} h ago`;
  return `${Math.round(seconds / 86400)} d ago`;
}

// The AI worker is only shown as online while it is really reporting. The API marks a worker "stale" when its last
// heartbeat is too old; a stale worker is never shown as online, whatever its stored status says.
export function workerView(w: WorkerInfo): WorkerView {
  const age = ageText(w.lastHeartbeatAt);
  if (w.status === "ONLINE" && w.isStale) {
    return { label: "STALE", dot: "bg-amber-500", badge: "bg-amber-100 text-amber-800", age };
  }
  if (w.status === "ONLINE") return { label: "ONLINE", dot: "bg-green-500 animate-pulse", badge: "bg-green-100 text-green-800", age };
  if (w.status === "UNKNOWN") return { label: "UNKNOWN", dot: "bg-gray-400", badge: "bg-gray-100 text-gray-700", age };
  return { label: w.status, dot: "bg-red-500", badge: "bg-red-100 text-red-800", age };
}
