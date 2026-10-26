import type { Camera, Schedule, Shop } from "@/types";

export type StepStatus = "done" | "todo" | "attention" | "blocked";

export interface OnboardingStep {
  id: "shop" | "schedule" | "camera" | "camera-test" | "zone";
  title: string;
  description: string;
  status: StepStatus;
  /** short explanation when status is attention or blocked */
  note?: string;
  cta?: { label: string; href: string };
}

export interface OnboardingState {
  steps: OnboardingStep[];
  done: number;
  total: number;
  percent: number;
  complete: boolean;
}

export interface OnboardingInput {
  shop: Shop | null;
  schedule: Schedule | null;
  cameras: Camera[];
  /** camera ids that had a zone saved from this browser */
  zoneSavedCameraIds: string[];
}

// Pure function: turns what the API told us into a checklist.
export function computeOnboarding({
  shop,
  schedule,
  cameras,
  zoneSavedCameraIds,
}: OnboardingInput): OnboardingState {
  const shopId = shop?.id;
  // The API creates a default schedule (version 1) together with the shop. Only a save by the
  // owner raises the version, so "done" means the owner saved their hours at least once.
  const hasSchedule = !!schedule && schedule.version > 1 && schedule.weeklySchedule.length > 0;
  const hasCamera = cameras.length > 0;
  const anyOnline = cameras.some((c) => c.status === "ONLINE");
  const testedBad = cameras.find((c) => c.status === "OFFLINE" || c.status === "ERROR");
  const untested = cameras.find((c) => c.status === "PENDING_TEST");
  const zoneCamera =
    cameras.find((c) => c.status === "ONLINE") ?? cameras[0];
  const zoneDone = cameras.some((c) => zoneSavedCameraIds.includes(c.id));

  const needShop = "Create your shop first.";

  const steps: OnboardingStep[] = [
    {
      id: "shop",
      title: "Create your shop",
      description: "Add your shop name, timezone and address.",
      status: shop ? "done" : "todo",
      cta: shop ? undefined : { label: "Create shop", href: "/shops/new" },
    },
    {
      id: "schedule",
      title: "Set your opening hours",
      description: "Monitoring arms after closing time and switches off when you open.",
      status: !shop ? "blocked" : hasSchedule ? "done" : "todo",
      note: !shop ? needShop : undefined,
      cta: shop && !hasSchedule ? { label: "Set hours", href: `/shops/${shopId}/schedule` } : undefined,
    },
    {
      id: "camera",
      title: "Connect your camera",
      description: "Add the CCTV camera that watches your shutter or gate.",
      status: !shop ? "blocked" : hasCamera ? "done" : "todo",
      note: !shop ? needShop : undefined,
      cta: shop && !hasCamera ? { label: "Add camera", href: `/shops/${shopId}/cameras` } : undefined,
    },
    {
      id: "camera-test",
      title: "Test the camera connection",
      description: "We check that we can receive video from your camera.",
      status: !hasCamera
        ? "blocked"
        : anyOnline
          ? "done"
          : testedBad
            ? "attention"
            : "todo",
      note: !hasCamera
        ? "Add a camera first."
        : testedBad && !anyOnline
          ? "The last test failed. Check the camera address and try again."
          : undefined,
      cta:
        hasCamera && !anyOnline
          ? {
              label: untested ? "Test camera" : "Fix and retest",
              href: `/shops/${shopId}/cameras`,
            }
          : undefined,
    },
    {
      id: "zone",
      title: "Mark the shutter zone",
      description: "Draw the area of the picture that should be watched.",
      status: !hasCamera ? "blocked" : zoneDone ? "done" : "todo",
      note: !hasCamera ? "Add a camera first." : undefined,
      cta:
        hasCamera && !zoneDone && zoneCamera
          ? {
              label: "Draw zone",
              href: `/shops/${shopId}/cameras/${zoneCamera.id}/zone`,
            }
          : undefined,
    },
  ];

  const done = steps.filter((s) => s.status === "done").length;
  const total = steps.length;
  return {
    steps,
    done,
    total,
    percent: Math.round((done / total) * 100),
    complete: done === total,
  };
}
