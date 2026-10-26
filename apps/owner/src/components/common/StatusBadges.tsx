import { Badge } from "@/components/ui/Badge";
import type { BadgeTone } from "@/components/ui/Badge";
import type {
  CameraStatus,
  CargoEventSeverity,
  CargoEventStatus,
  CargoEventType,
  SiteStatus,
} from "@/types";

const camera: Record<CameraStatus | "DEGRADED", { label: string; tone: BadgeTone }> = {
  PENDING_TEST: { label: "Not tested yet", tone: "neutral" },
  ONLINE: { label: "Online", tone: "success" },
  DEGRADED: { label: "Not reporting", tone: "warning" },
  OFFLINE: { label: "Offline", tone: "danger" },
  ERROR: { label: "Error", tone: "danger" },
};

export function CameraStatusBadge({ status }: { status: CameraStatus | "DEGRADED" }) {
  const c = camera[status];
  return (
    <Badge tone={c.tone} dot>
      {c.label}
    </Badge>
  );
}

const eventStatus: Record<CargoEventStatus, { label: string; tone: BadgeTone }> = {
  open: { label: "Open", tone: "primary" },
  acknowledged: { label: "Acknowledged", tone: "neutral" },
  in_review: { label: "In review", tone: "neutral" },
  resolved: { label: "Resolved", tone: "success" },
  false_positive: { label: "False alarm", tone: "neutral" },
  escalated: { label: "Escalated", tone: "warning" },
};

export function EventStatusBadge({ status }: { status: CargoEventStatus }) {
  const r = eventStatus[status];
  return <Badge tone={r.tone}>{r.label}</Badge>;
}

const severity: Record<CargoEventSeverity, { label: string; tone: BadgeTone }> = {
  low: { label: "Low", tone: "neutral" },
  medium: { label: "Medium", tone: "warning" },
  high: { label: "High", tone: "danger" },
  critical: { label: "Critical", tone: "danger" },
};

export function SeverityBadge({ severity: level }: { severity: CargoEventSeverity }) {
  const s = severity[level];
  return <Badge tone={s.tone}>{s.label} severity</Badge>;
}

const site: Record<SiteStatus, { label: string; tone: BadgeTone }> = {
  ACTIVE: { label: "Active", tone: "success" },
  INACTIVE: { label: "Inactive", tone: "warning" },
  ARCHIVED: { label: "Archived", tone: "neutral" },
};

export function SiteStatusBadge({ status }: { status: SiteStatus }) {
  const s = site[status];
  return (
    <Badge tone={s.tone} dot>
      {s.label}
    </Badge>
  );
}

// Conservative wording: these describe what the system saw, never what someone did.
export const EVENT_TYPE_LABEL: Record<CargoEventType, string> = {
  package_detected: "Package detected",
  package_line_crossing: "Package crossed the counting line",
  zone_entry: "Package movement entered a zone",
  zone_exit: "Package movement left a zone",
  restricted_zone_movement: "Movement in a restricted zone",
  unusual_after_hours_movement: "Movement outside configured hours",
  count_mismatch: "Count differs from the expected count",
  possible_package_damage: "Possible visible package damage",
  possible_seal_appearance_change: "Possible change in seal appearance",
  camera_offline: "Camera went offline",
  ai_service_unavailable: "AI detection is unavailable",
};
