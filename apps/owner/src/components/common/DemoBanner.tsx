import { FlaskConical } from "lucide-react";
import { USE_MOCKS } from "@/lib/api/client";

// Shown whenever the app runs on mock data, so nothing is mistaken for live data.
export function DemoBanner() {
  if (!USE_MOCKS) return null;
  return (
    <div className="flex items-center justify-center gap-2 border-b border-warning/30 bg-warning/10 px-4 py-1.5 text-xs font-medium text-warning">
      <FlaskConical className="size-3.5 shrink-0" aria-hidden />
      <span>DEMO DATA: mock responses are on. Nothing here is live monitoring.</span>
    </div>
  );
}
