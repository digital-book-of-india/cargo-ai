import { Badge } from "@/components/ui/Badge";
import type { BadgeTone } from "@/components/ui/Badge";
import type {
  CameraStatus,
  EventType,
  ReviewStatus,
  ShopStatus,
} from "@/types";

const camera: Record<CameraStatus, { label: string; tone: BadgeTone }> = {
  PENDING_TEST: { label: "Not tested yet", tone: "neutral" },
  ONLINE: { label: "Online", tone: "success" },
  OFFLINE: { label: "Offline", tone: "danger" },
  ERROR: { label: "Error", tone: "danger" },
};

export function CameraStatusBadge({ status }: { status: CameraStatus }) {
  const c = camera[status];
  return (
    <Badge tone={c.tone} dot>
      {c.label}
    </Badge>
  );
}

const review: Record<ReviewStatus, { label: string; tone: BadgeTone }> = {
  NEW: { label: "New", tone: "primary" },
  REVIEWED: { label: "Reviewed", tone: "neutral" },
  FALSE_ALARM: { label: "False alarm", tone: "neutral" },
  CONFIRMED: { label: "Confirmed", tone: "warning" },
};

export function ReviewStatusBadge({ status }: { status: ReviewStatus }) {
  const r = review[status];
  return <Badge tone={r.tone}>{r.label}</Badge>;
}

const shop: Record<ShopStatus, { label: string; tone: BadgeTone }> = {
  PENDING_SETUP: { label: "Setup pending", tone: "warning" },
  ACTIVE: { label: "Active", tone: "success" },
  SUSPENDED: { label: "Suspended", tone: "danger" },
};

export function ShopStatusBadge({ status }: { status: ShopStatus }) {
  const s = shop[status];
  return (
    <Badge tone={s.tone} dot>
      {s.label}
    </Badge>
  );
}

// Conservative wording: a camera cannot guarantee detection of every touch.
export const EVENT_TYPE_LABEL: Record<EventType, string> = {
  PERSON_IN_ZONE: "Person in monitored zone",
  POSSIBLE_SHUTTER_INTERACTION: "Possible shutter interaction",
  POSSIBLE_TAMPERING: "Suspicious activity near shutter",
  CAMERA_OFFLINE: "Camera went offline",
  AI_OFFLINE: "AI monitoring went offline",
};
