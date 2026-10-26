"use client";

import { useCallback, useEffect, useState } from "react";
import { NoAccess } from "@/components/common/NoAccess";
import { PageHeader } from "@/components/common/PageHeader";
import { Alert, ApiErrorState, EmptyState, LoadingState } from "@/components/common/States";
import { Button, Card, SelectField } from "@/components/ui";
import { ApiError } from "@/lib/api/client";
import { auditApi } from "@/lib/api/reports";
import type { AuditEntry } from "@/lib/api/reports";
import { useAuth } from "@/lib/auth/AuthProvider";
import { auditLabel } from "@/lib/audit";

const ALL = "ALL";
const FILTERS = [
  { value: ALL, label: "Everything" },
  { value: "EVENTS_EXPORTED", label: "Exports" },
  { value: "EVIDENCE_ACCESSED", label: "Evidence viewed" },
  { value: "SUPPORT_EVIDENCE_ACCESS_GRANTED", label: "Support access" },
  { value: "COMPANY_SETTINGS_UPDATED", label: "Settings changes" },
  { value: "SITE_CREATED", label: "Sites created" },
  { value: "LOADING_SESSION_CLOSED", label: "Sessions closed" },
];

// A short, safe summary of what an entry carried. Never shows raw objects or ids.
function detail(entry: AuditEntry): string | null {
  const m = entry.metadata;
  if (!m) return null;
  const parts: string[] = [];
  if (typeof m.rows === "number") parts.push(`${m.rows} rows`);
  if (typeof m.reference === "string") parts.push(`reference ${m.reference}`);
  if (typeof m.status === "string") parts.push(`result ${m.status.replace("_", " ")}`);
  if (typeof m.kind === "string") parts.push(`${m.kind}`);
  if (typeof m.created === "number") parts.push(`${m.created} created`);
  return parts.length ? parts.join(" · ") : null;
}

export default function AuditPage() {
  const { can } = useAuth();
  const [filter, setFilter] = useState(ALL);
  const [items, setItems] = useState<AuditEntry[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ApiError | null>(null);

  const load = useCallback(
    async (after?: string) => {
      setLoading(true);
      setError(null);
      try {
        const res = await auditApi.list({ action: filter === ALL ? undefined : filter, cursor: after, limit: 25 });
        setItems((prev) => (after ? [...prev, ...res.items] : res.items));
        setCursor(res.nextCursor);
      } catch (err) {
        setError(err instanceof ApiError ? err : new ApiError(0, "UNKNOWN_ERROR", "Something went wrong."));
      } finally {
        setLoading(false);
      }
    },
    [filter]
  );

  useEffect(() => {
    if (can("audit:read")) load();
  }, [load, can]);

  if (!can("audit:read")) return <NoAccess what="the audit trail" />;

  return (
    <div className="animate-fade-up space-y-5">
      <PageHeader title="Audit trail" description="Who changed what in your company, newest first. Entries cannot be edited or removed." />
      <div className="max-w-xs">
        <SelectField label="Show" value={filter} onValueChange={setFilter} options={FILTERS} />
      </div>

      {error && items.length === 0 ? (
        <ApiErrorState error={error} onRetry={() => load()} />
      ) : loading && items.length === 0 ? (
        <LoadingState label="Loading the audit trail..." />
      ) : items.length === 0 ? (
        <EmptyState title="Nothing recorded yet" hint="Changes to sites, settings, manifests and exports will appear here." />
      ) : (
        <Card>
          <ul className="divide-y" aria-label="Audit entries">
            {items.map((e) => {
              const extra = detail(e);
              return (
                <li key={e.id} className="space-y-0.5 p-4 text-sm sm:p-5">
                  <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                    <span className="font-medium">{auditLabel(e.action)}</span>
                    <time className="text-muted-foreground" dateTime={e.createdAt}>
                      {new Date(e.createdAt).toLocaleString()}
                    </time>
                  </div>
                  <p className="text-muted-foreground">
                    By {e.actor.name}
                    {extra ? ` · ${extra}` : ""}
                  </p>
                  {e.reason && <p>Reason: {e.reason}</p>}
                </li>
              );
            })}
          </ul>
        </Card>
      )}
      {error && items.length > 0 && <Alert tone="warning">Could not load more. Try again.</Alert>}
      {cursor && (
        <div className="flex justify-center">
          <Button variant="outline" onClick={() => load(cursor)} disabled={loading}>
            {loading ? "Loading..." : "Load more"}
          </Button>
        </div>
      )}
    </div>
  );
}
