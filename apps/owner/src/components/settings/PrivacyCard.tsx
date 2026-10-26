import { ShieldCheck } from "lucide-react";
import { Card } from "@/components/ui";
import { PRIVACY_POINTS } from "@/lib/privacy";

// Owner guidance on cameras, consent and what the service does and does not do.
export function PrivacyCard() {
  return (
    <Card className="p-5">
      <h2 className="flex items-center gap-2 font-semibold">
        <ShieldCheck className="size-4 text-primary" aria-hidden /> Privacy and monitoring notice
      </h2>
      <ul className="mt-3 list-disc space-y-1.5 pl-5 text-sm text-muted-foreground">
        {PRIVACY_POINTS.map((p) => (
          <li key={p}>{p}</li>
        ))}
      </ul>
      <p className="mt-3 text-xs text-muted-foreground">
        This is guidance, not legal advice. You are responsible for following the rules that apply to your shop.
      </p>
    </Card>
  );
}
