"use client";

import { useState } from "react";
import { FileUp, Plus } from "lucide-react";
import { toast } from "sonner";
import { Alert, ApiErrorState, EmptyState, LoadingState } from "@/components/common/States";
import { Badge, Button, Card, Checkbox, Modal, SelectField, TextField } from "@/components/ui";
import { useAsync } from "@/hooks/useAsync";
import { friendlyMessage } from "@/lib/api/messages";
import { manifestsApi } from "@/lib/api/shipments";
import { useAuth } from "@/lib/auth/AuthProvider";
import { IMPORT_STATUS_LABEL, MANIFEST_STATUS_LABEL, MANIFEST_STATUS_TONE } from "@/lib/shipments";
import { useSite } from "@/lib/site/SiteProvider";
import type { ManifestImportJob } from "@/types";

const MAX_BYTES = 1024 * 1024;

export function ManifestsPanel() {
  const { can } = useAuth();
  const canWrite = can("manifests:write");
  const [search, setSearch] = useState("");
  const manifests = useAsync(() => manifestsApi.list({ q: search.trim() || undefined, limit: 100 }), [search]);
  const [createOpen, setCreateOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);

  const items = manifests.data?.items ?? [];

  async function cancel(id: string) {
    try {
      await manifestsApi.update(id, { status: "cancelled" });
      toast.success("Manifest cancelled");
      manifests.reload();
    } catch (err) {
      toast.error(friendlyMessage(err));
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <TextField label="Search by reference" value={search} onChange={(e) => setSearch(e.target.value)} className="sm:w-72" />
        {canWrite && (
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => setImportOpen(true)}>
              <FileUp aria-hidden /> Import CSV
            </Button>
            <Button onClick={() => setCreateOpen(true)}>
              <Plus aria-hidden /> New manifest
            </Button>
          </div>
        )}
      </div>

      {manifests.loading && !manifests.data ? (
        <LoadingState label="Loading manifests..." />
      ) : manifests.error && !manifests.data ? (
        <ApiErrorState error={manifests.error} onRetry={manifests.reload} />
      ) : items.length === 0 ? (
        <EmptyState title="No manifests" hint="A manifest says how many packages a shipment should contain. Add one, or import a CSV." />
      ) : (
        <Card>
          <ul className="divide-y" aria-label="Manifests">
            {items.map((m) => (
              <li key={m.id} className="flex flex-col gap-2 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{m.reference}</span>
                    <Badge tone={MANIFEST_STATUS_TONE[m.status]}>{MANIFEST_STATUS_LABEL[m.status]}</Badge>
                    {m.source === "csv_import" && <Badge>Imported</Badge>}
                  </div>
                  <p className="text-sm text-muted-foreground">
                    {m.site.name} · {m.expectedPackageCount} packages expected
                  </p>
                  {m.notes && <p className="text-sm text-muted-foreground">{m.notes}</p>}
                </div>
                {canWrite && m.status === "active" && (
                  <Button variant="ghost" onClick={() => cancel(m.id)}>
                    Cancel manifest
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </Card>
      )}

      {createOpen && (
        <CreateDialog
          onClose={() => setCreateOpen(false)}
          onDone={() => {
            setCreateOpen(false);
            manifests.reload();
          }}
        />
      )}
      {importOpen && <ImportDialog onClose={() => setImportOpen(false)} onImported={() => manifests.reload()} />}
    </div>
  );
}

function CreateDialog({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const { sites, current } = useSite();
  const [reference, setReference] = useState("");
  const [count, setCount] = useState("");
  const [siteId, setSiteId] = useState(current?.id ?? sites[0]?.id ?? "");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await manifestsApi.create({
        reference: reference.trim(),
        siteId,
        expectedPackageCount: Number(count),
        notes: notes.trim() || undefined,
      });
      toast.success("Manifest added");
      onDone();
    } catch (err) {
      setError(friendlyMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const valid = reference.trim() !== "" && /^\d+$/.test(count) && siteId !== "";
  return (
    <Modal
      open
      title="New manifest"
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={busy || !valid}>
            {busy ? "Saving..." : "Add manifest"}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {error && <Alert tone="danger">{error}</Alert>}
        <TextField label="Reference" value={reference} onChange={(e) => setReference(e.target.value)} maxLength={100} />
        <SelectField
          label="Site"
          value={siteId}
          onValueChange={setSiteId}
          options={sites.filter((s) => s.status === "ACTIVE").map((s) => ({ value: s.id, label: s.name }))}
        />
        <TextField label="Expected package count" inputMode="numeric" value={count} onChange={(e) => setCount(e.target.value)} />
        <TextField label="Notes (optional)" value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={1000} />
      </div>
    </Modal>
  );
}

function ImportDialog({ onClose, onImported }: { onClose: () => void; onImported: () => void }) {
  const [file, setFile] = useState<{ name: string; text: string } | null>(null);
  const [partial, setPartial] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [job, setJob] = useState<ManifestImportJob | null>(null);

  async function pick(f: File | undefined) {
    setError(null);
    setJob(null);
    if (!f) return setFile(null);
    if (f.size > MAX_BYTES) {
      setFile(null);
      return setError("This file is larger than 1 MB.");
    }
    setFile({ name: f.name, text: await f.text() });
  }

  async function submit() {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const res = await manifestsApi.importCsv(file.name, file.text, partial);
      setJob(res);
      if (res.createdCount > 0) onImported();
    } catch (err) {
      setError(friendlyMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open
      title="Import manifests from CSV"
      description="Columns: reference, siteCode, expectedPackageCount, and optionally notes. The first line is the header."
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            {job ? "Done" : "Cancel"}
          </Button>
          {!job && (
            <Button onClick={submit} disabled={busy || !file}>
              {busy ? "Importing..." : "Import"}
            </Button>
          )}
        </>
      }
    >
      <div className="space-y-4">
        {error && <Alert tone="danger">{error}</Alert>}
        {!job && (
          <>
            <div className="space-y-1.5">
              <label htmlFor="manifest-csv" className="text-sm font-medium">
                CSV file
              </label>
              <input
                id="manifest-csv"
                type="file"
                accept=".csv,text/csv"
                onChange={(e) => pick(e.target.files?.[0])}
                className="block w-full text-sm file:mr-3 file:rounded-md file:border file:bg-background file:px-3 file:py-2"
              />
            </div>
            <div className="flex items-start gap-2">
              <Checkbox id="allow-partial" checked={partial} onCheckedChange={(v) => setPartial(v === true)} />
              <label htmlFor="allow-partial" className="text-sm">
                Import the good rows even if some rows have problems.
                <span className="block text-xs text-muted-foreground">By default nothing is imported unless every row is correct.</span>
              </label>
            </div>
          </>
        )}
        {job && (
          <div className="space-y-3">
            <Alert tone={job.status === "COMPLETED" ? "success" : job.status === "PARTIAL" ? "warning" : "danger"}>
              {job.duplicate ? "This exact file was already imported before. Nothing was added again. " : ""}
              {IMPORT_STATUS_LABEL[job.status]}: {job.createdCount} of {job.totalRows} rows added.
            </Alert>
            {job.errors.length > 0 && (
              <div>
                <p className="mb-1 font-medium">Problems to fix</p>
                <ul className="max-h-48 space-y-1 overflow-auto rounded-md border p-2 text-xs">
                  {job.errors.map((e, i) => (
                    <li key={i}>
                      Line {e.row}
                      {e.field ? ` (${e.field})` : ""}: {e.message}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}
