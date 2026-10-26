import Link from "next/link";
import { AlertTriangle, ArrowRight, Check, Lock } from "lucide-react";
import { Badge, Button, Card, Progress } from "@/components/ui";
import { cn } from "@/lib/utils/cn";
import type { OnboardingState, OnboardingStep, StepStatus } from "@/lib/onboarding";

function StepMarker({ status, index }: { status: StepStatus; index: number }) {
  const base = "flex size-9 shrink-0 items-center justify-center rounded-full text-sm font-semibold";
  if (status === "done") {
    return (
      <span className={cn(base, "bg-success text-success-foreground")}>
        <Check className="size-4" strokeWidth={3} aria-hidden />
        <span className="sr-only">Done</span>
      </span>
    );
  }
  if (status === "attention") {
    return (
      <span className={cn(base, "bg-warning/15 text-warning")}>
        <AlertTriangle className="size-4" aria-hidden />
        <span className="sr-only">Needs attention</span>
      </span>
    );
  }
  if (status === "blocked") {
    return (
      <span className={cn(base, "bg-muted text-muted-foreground")}>
        <Lock className="size-4" aria-hidden />
        <span className="sr-only">Locked</span>
      </span>
    );
  }
  return <span className={cn(base, "bg-primary/10 text-primary")}>{index + 1}</span>;
}

function StepRow({ step, index }: { step: OnboardingStep; index: number }) {
  const muted = step.status === "blocked";
  return (
    <li className="flex gap-4 p-4 sm:p-5">
      <StepMarker status={step.status} index={index} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className={cn("font-medium", muted && "text-muted-foreground")}>{step.title}</h3>
          {step.status === "done" && <Badge tone="success">Done</Badge>}
          {step.status === "attention" && <Badge tone="warning">Needs attention</Badge>}
        </div>
        <p className="mt-0.5 text-sm text-muted-foreground">{step.description}</p>
        {step.note && (
          <p
            className={cn(
              "mt-1.5 text-sm",
              step.status === "attention" ? "font-medium text-warning" : "text-muted-foreground"
            )}
          >
            {step.note}
          </p>
        )}
      </div>
      {step.cta && (
        <div className="shrink-0 self-center">
          <Button asChild size="sm" variant={step.status === "attention" ? "outline" : "primary"}>
            <Link href={step.cta.href}>
              {step.cta.label} <ArrowRight aria-hidden />
            </Link>
          </Button>
        </div>
      )}
    </li>
  );
}

// Setup checklist. "Complete" means configured, not that monitoring is live;
// live status always comes from the security state on the dashboard.
export function OnboardingChecklist({ state }: { state: OnboardingState }) {
  return (
    <div className="space-y-4">
      <Card className="p-5">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="font-semibold">
              {state.complete ? "Setup complete" : `${state.done} of ${state.total} steps done`}
            </p>
            <p className="text-sm text-muted-foreground">
              {state.complete
                ? "Your shop is configured. Check the dashboard for live monitoring status."
                : "Finish the steps below to start monitoring after closing time."}
            </p>
          </div>
          <span className="text-2xl font-semibold tabular-nums text-primary">{state.percent}%</span>
        </div>
        <Progress
          value={state.percent}
          className="mt-4"
          aria-label="Setup progress"
        />
      </Card>

      <Card>
        <ol className="divide-y">
          {state.steps.map((step, i) => (
            <StepRow key={step.id} step={step} index={i} />
          ))}
        </ol>
      </Card>
    </div>
  );
}
