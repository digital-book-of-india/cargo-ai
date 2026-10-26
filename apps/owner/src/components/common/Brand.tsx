import { ShieldCheck } from "lucide-react";
import { cn } from "@/lib/utils/cn";

export function BrandMark({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "flex size-9 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow-pop",
        className
      )}
    >
      <ShieldCheck className="size-5" aria-hidden />
    </span>
  );
}

export function Brand({ className }: { className?: string }) {
  return (
    <span className={cn("flex items-center gap-2.5", className)}>
      <BrandMark />
      <span className="text-lg font-bold tracking-tight">DBI Intelligence</span>
    </span>
  );
}
