"use client";

import { useState } from "react";
import { MessageSquarePlus, RotateCcw, UserCheck } from "lucide-react";
import { toast } from "sonner";
import { Alert } from "@/components/common/States";
import { Button, Card, SelectField } from "@/components/ui";
import { useAsync } from "@/hooks/useAsync";
import { eventsApi } from "@/lib/api/events";
import { friendlyMessage } from "@/lib/api/messages";
import { useAuth } from "@/lib/auth/AuthProvider";
import { ROLE_LABEL } from "@/lib/roles";
import type { CargoEventDetail } from "@/types";

interface Props {
  event: CargoEventDetail;
  onChange: (event: CargoEventDetail) => void;
}

const NONE = "__none";

// Notes, assignment and reopening for one alert. Each control appears only for people whose role
// allows it; the server checks again.
export function EventCollaboration({ event, onChange }: Props) {
  const { canAtSite, can } = useAuth();
  const canReview = canAtSite("events:review", event.siteId);
  const canReopen = canAtSite("events:reopen", event.siteId) && can("events:reopen");
  const closed = event.status === "resolved" || event.status === "false_positive";

  const assignees = useAsync(() => (canReview && !closed ? eventsApi.assignees(event.id) : Promise.resolve([])), [event.id, closed, canReview]);
  const [note, setNote] = useState("");
  const [assignee, setAssignee] = useState<string>(event.assignedTo?.id ?? NONE);
  const [reopenNote, setReopenNote] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run(label: string, call: () => Promise<{ event: CargoEventDetail }>, done: string, after?: () => void) {
    setBusy(label);
    setError(null);
    try {
      const res = await call();
      onChange(res.event);
      toast.success(done);
      after?.();
    } catch (err) {
      setError(friendlyMessage(err));
    } finally {
      setBusy(null);
    }
  }

  if (!canReview && !canReopen) return null;

  return (
    <Card className="p-5">
      <h2 className="mb-3 font-semibold">Notes and assignment</h2>
      {error && (
        <div className="mb-3">
          <Alert tone="danger">{error}</Alert>
        </div>
      )}

      {canReview && (
        <div className="space-y-2">
          <label htmlFor="event-note" className="block text-sm font-medium">
            Add a note
          </label>
          <textarea
            id="event-note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={5000}
            rows={2}
            className="w-full rounded-lg border bg-background px-3 py-2 text-sm"
            disabled={!!busy}
          />
          <Button
            variant="outline"
            size="sm"
            loading={busy === "note"}
            disabled={!!busy || note.trim().length === 0}
            onClick={() => void run("note", () => eventsApi.addNote(event.id, note.trim()), "Note added", () => setNote(""))}
          >
            <MessageSquarePlus aria-hidden /> Add note
          </Button>
        </div>
      )}

      {canReview && !closed && (
        <div className="mt-5 space-y-2">
          <SelectField
            label="Assigned to"
            value={assignee}
            onValueChange={setAssignee}
            options={[
              { value: NONE, label: "Nobody" },
              ...(assignees.data ?? []).map((p) => ({ value: p.id, label: `${p.name} (${ROLE_LABEL[p.role]})` })),
            ]}
            hint="An acknowledged alert moves into review when you give it to someone."
            disabled={!!busy || assignees.loading}
          />
          <Button
            variant="outline"
            size="sm"
            loading={busy === "assign"}
            disabled={!!busy || assignee === (event.assignedTo?.id ?? NONE)}
            onClick={() =>
              void run("assign", () => eventsApi.assign(event.id, assignee === NONE ? null : assignee), assignee === NONE ? "Assignment cleared" : "Alert assigned")
            }
          >
            <UserCheck aria-hidden /> Save assignment
          </Button>
        </div>
      )}

      {canReopen && event.status === "resolved" && (
        <div className="mt-5 space-y-2 border-t pt-4">
          <label htmlFor="reopen-note" className="block text-sm font-medium">
            Reopen this alert
          </label>
          <textarea
            id="reopen-note"
            value={reopenNote}
            onChange={(e) => setReopenNote(e.target.value)}
            maxLength={2000}
            rows={2}
            placeholder="Why does it need another look?"
            className="w-full rounded-lg border bg-background px-3 py-2 text-sm"
            disabled={!!busy}
          />
          <Button
            variant="outline"
            size="sm"
            loading={busy === "reopen"}
            disabled={!!busy || reopenNote.trim().length < 3}
            onClick={() => void run("reopen", () => eventsApi.reopen(event.id, reopenNote.trim()), "Alert reopened", () => setReopenNote(""))}
          >
            <RotateCcw aria-hidden /> Reopen
          </Button>
        </div>
      )}
    </Card>
  );
}
