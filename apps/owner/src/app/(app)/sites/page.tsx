"use client";

import { useState } from "react";
import Link from "next/link";
import { Archive, Plus, Power, Store } from "lucide-react";
import { toast } from "sonner";
import { DemoBadge } from "@/components/common/DemoBadge";
import { PageHeader } from "@/components/common/PageHeader";
import { Alert, ApiErrorState, EmptyState, LoadingState } from "@/components/common/States";
import { SiteStatusBadge } from "@/components/common/StatusBadges";
import { Button, Card, Checkbox, Modal } from "@/components/ui";
import { useAsync } from "@/hooks/useAsync";
import { friendlyMessage } from "@/lib/api/messages";
import { sitesApi } from "@/lib/api/sites";
import { useAuth } from "@/lib/auth/AuthProvider";
import { useSite } from "@/lib/site/SiteProvider";
import type { Site } from "@/types";

type Action = { site: Site; kind: "deactivate" | "reactivate" | "archive" };

export default function SitesPage() {
  const { can, canAtSite } = useAuth();
  const { reload: reloadShell, select } = useSite();
  const [showArchived, setShowArchived] = useState(false);
  const list = useAsync(() => sitesApi.list({ includeArchived: showArchived }), [showArchived]);
  const [action, setAction] = useState<Action | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (list.loading && !list.data) return <LoadingState label="Loading sites..." />;
  if (list.error && !list.data) return <ApiErrorState error={list.error} onRetry={list.reload} />;

  const sites = list.data?.sites ?? [];
  const canCreate = can("sites:write");

  async function confirm() {
    if (!action) return;
    setBusy(true);
    setError(null);
    try {
      if (action.kind === "archive") await sitesApi.archive(action.site.id);
      else await sitesApi.update(action.site.id, { status: action.kind === "deactivate" ? "INACTIVE" : "ACTIVE" });
      toast.success(
        action.kind === "archive" ? "Site archived" : action.kind === "deactivate" ? "Site deactivated" : "Site reactivated"
      );
      setAction(null);
      list.reload();
      void reloadShell();
    } catch (err) {
      setError(friendlyMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const copy: Record<Action["kind"], { title: string; text: string; button: string }> = {
    deactivate: {
      title: "Deactivate this site?",
      text: "A deactivated site stops taking new cameras. Its history stays. You can turn it back on.",
      button: "Deactivate",
    },
    reactivate: { title: "Reactivate this site?", text: "The site can take cameras again.", button: "Reactivate" },
    archive: {
      title: "Archive this site?",
      text: "Archived sites are hidden and cannot be changed. Move or remove its cameras and zones first; the system refuses otherwise.",
      button: "Archive",
    },
  };

  return (
    <div className="animate-fade-up space-y-5">
      <PageHeader
        title="Sites"
        description="Your warehouses and other places with cameras."
        actions={
          canCreate ? (
            <Button asChild>
              <Link href="/sites/new">
                <Plus aria-hidden /> Add site
              </Link>
            </Button>
          ) : undefined
        }
      />

      {list.error && <Alert tone="warning">Could not refresh. This list may be out of date.</Alert>}

      <div className="flex items-center gap-2">
        <Checkbox id="show-archived" checked={showArchived} onCheckedChange={(v) => setShowArchived(v === true)} />
        <label htmlFor="show-archived" className="text-sm">
          Show archived sites
        </label>
      </div>

      {sites.length === 0 ? (
        <EmptyState
          icon={<Store className="size-6" aria-hidden />}
          title="No sites yet"
          hint={canCreate ? "Add your first warehouse to connect cameras." : "Ask a company owner or admin to add a site."}
        />
      ) : (
        <Card>
          <ul className="divide-y" aria-label="Sites">
            {sites.map((s) => {
              const manage = canAtSite("sites:write", s.id) && s.status !== "ARCHIVED";
              return (
                <li key={s.id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <Link
                        href={`/sites/${s.id}`}
                        onClick={() => select(s.id)}
                        className="font-semibold hover:text-primary"
                      >
                        {s.name}
                      </Link>
                      <span className="text-xs text-muted-foreground">{s.code}</span>
                      <SiteStatusBadge status={s.status} />
                      {s.demo && <DemoBadge />}
                    </div>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {[s.address?.city, s.address?.state].filter(Boolean).join(", ") || "No address"} · {s.timezone}
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-wrap gap-2">
                    <Button asChild variant="outline" size="sm">
                      <Link href={`/sites/${s.id}`} onClick={() => select(s.id)}>
                        Open
                      </Link>
                    </Button>
                    {manage && s.status === "ACTIVE" && (
                      <Button variant="outline" size="sm" onClick={() => { setError(null); setAction({ site: s, kind: "deactivate" }); }}>
                        <Power aria-hidden /> Deactivate
                      </Button>
                    )}
                    {manage && s.status === "INACTIVE" && (
                      <Button variant="outline" size="sm" onClick={() => { setError(null); setAction({ site: s, kind: "reactivate" }); }}>
                        <Power aria-hidden /> Reactivate
                      </Button>
                    )}
                    {manage && (
                      <Button variant="outline" size="sm" onClick={() => { setError(null); setAction({ site: s, kind: "archive" }); }}>
                        <Archive aria-hidden /> Archive
                      </Button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </Card>
      )}

      <Modal
        open={!!action}
        title={action ? copy[action.kind].title : ""}
        description={action ? `${action.site.name}: ${copy[action.kind].text}` : undefined}
        onClose={() => setAction(null)}
        footer={
          <>
            <Button variant="outline" onClick={() => setAction(null)} disabled={busy}>
              Cancel
            </Button>
            <Button onClick={() => void confirm()} loading={busy}>
              {action ? copy[action.kind].button : ""}
            </Button>
          </>
        }
      >
        {error && <Alert tone="danger">{error}</Alert>}
      </Modal>
    </div>
  );
}
