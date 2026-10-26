import type { ReactNode } from "react";
import { AlertTriangle, CheckCircle2, Info, Inbox, ShieldAlert, XCircle } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Skeleton } from "@/components/ui/Skeleton";
import { friendlyMessage } from "@/lib/api/messages";
import type { ApiError } from "@/lib/api/errors";
import { cn } from "@/lib/utils/cn";

export function LoadingState({ label = "Loading..." }: { label?: string }) {
  return (
    <div role="status" aria-live="polite" className="space-y-3 p-2">
      <span className="sr-only">{label}</span>
      <Skeleton className="h-5 w-1/3" />
      <Skeleton className="h-24 w-full" />
      <Skeleton className="h-24 w-full" />
    </div>
  );
}

export function EmptyState({
  title,
  hint,
  action,
  icon,
}: {
  title: string;
  hint?: string;
  action?: ReactNode;
  icon?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center rounded-xl border border-dashed border-primary/25 bg-accent/50 px-6 py-10 text-center">
      <div className="mb-3 flex size-12 items-center justify-center rounded-full bg-primary/10 text-primary">
        {icon ?? <Inbox className="size-6" aria-hidden />}
      </div>
      <p className="font-semibold">{title}</p>
      {hint && <p className="mt-1 max-w-sm text-sm text-muted-foreground">{hint}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function ErrorState({
  message,
  requestId,
  onRetry,
}: {
  message: string;
  requestId?: string;
  onRetry?: () => void;
}) {
  return (
    <div
      role="alert"
      className="flex items-start gap-3 rounded-xl border border-destructive/30 bg-destructive/5 p-4"
    >
      <XCircle className="mt-0.5 size-5 shrink-0 text-destructive" aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-destructive">{message}</p>
        {requestId && <p className="mt-1 text-xs text-muted-foreground">Reference: {requestId}</p>}
        {onRetry && (
          <Button variant="outline" size="sm" className="mt-3" onClick={onRetry}>
            Try again
          </Button>
        )}
      </div>
    </div>
  );
}

type AlertTone = "success" | "info" | "warning" | "danger";

const alertStyles: Record<AlertTone, { box: string; icon: ReactNode }> = {
  success: {
    box: "border-success/30 bg-success/10 text-success",
    icon: <CheckCircle2 className="size-4" aria-hidden />,
  },
  info: {
    box: "border-primary/25 bg-primary/5 text-primary",
    icon: <Info className="size-4" aria-hidden />,
  },
  warning: {
    box: "border-warning/35 bg-warning/10 text-warning",
    icon: <AlertTriangle className="size-4" aria-hidden />,
  },
  danger: {
    box: "border-destructive/30 bg-destructive/10 text-destructive",
    icon: <ShieldAlert className="size-4" aria-hidden />,
  },
};

// Inline success / info / warning / error message.
export function Alert({ tone = "info", children }: { tone?: AlertTone; children: ReactNode }) {
  const s = alertStyles[tone];
  return (
    <div
      role={tone === "danger" ? "alert" : "status"}
      className={cn("flex items-start gap-2 rounded-lg border px-3 py-2.5 text-sm font-medium", s.box)}
    >
      <span className="mt-0.5 shrink-0">{s.icon}</span>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

// Error state for a failed API call. 403 and 404 get their own wording and no retry.
export function ApiErrorState({ error, onRetry }: { error: ApiError; onRetry?: () => void }) {
  if (error.status === 403) {
    return (
      <EmptyState
        icon={<ShieldAlert className="size-6" aria-hidden />}
        title="You do not have access to this"
        hint="If you think this is a mistake, sign in with the right account."
      />
    );
  }
  if (error.status === 404) {
    return <EmptyState title="Not found" hint="This item may have been removed." />;
  }
  return (
    <ErrorState
      message={friendlyMessage(error)}
      requestId={error.requestId}
      onRetry={error.status === 0 || error.status >= 500 ? onRetry : undefined}
    />
  );
}
