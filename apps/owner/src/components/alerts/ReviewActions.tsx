"use client";

import { useState } from "react";
import { Alert } from "@/components/common/States";
import { EventStatusBadge } from "@/components/common/StatusBadges";
import { Button, Card } from "@/components/ui";
import { friendlyMessage } from "@/lib/api/messages";
import { availableActions } from "@/lib/events";
import type { ReviewAction } from "@/lib/events";
import type { CargoEventStatus } from "@/types";

interface Props {
  status: CargoEventStatus;
  /** must throw when the server rejects the action */
  onAction: (action: ReviewAction, note: string) => Promise<void>;
}

// Review buttons. The shown status only changes after the server accepted the action.
export function ReviewActions({ status, onAction }: Props) {
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const actions = availableActions(status);

  async function run(action: ReviewAction) {
    if (pending) return;
    if (action.needsNote && note.trim().length < 3) {
      setError("Please add a short reason first.");
      return;
    }
    setPending(action.id);
    setError(null);
    try {
      await onAction(action, note);
      setNote("");
    } catch (err) {
      setError(friendlyMessage(err));
    } finally {
      setPending(null);
    }
  }

  return (
    <Card className="p-5">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h2 className="font-semibold">Your review</h2>
        <EventStatusBadge status={status} />
      </div>
      {actions.length === 0 ? (
        <p className="text-sm text-muted-foreground">This alert is closed.</p>
      ) : (
        <>
          <label className="mb-1 block text-sm font-medium" htmlFor="review-note">
            Note <span className="font-normal text-muted-foreground">(optional, required for a false alarm)</span>
          </label>
          <textarea
            id="review-note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={2000}
            rows={2}
            className="mb-3 w-full rounded-lg border bg-background px-3 py-2 text-sm"
            disabled={!!pending}
          />
          {error && (
            <div className="mb-3">
              <Alert tone="danger">{error}</Alert>
            </div>
          )}
          <div className="grid gap-2 sm:grid-cols-2">
            {actions.map((a) => (
              <Button
                key={a.id}
                variant="outline"
                className="h-auto flex-col items-start gap-0.5 whitespace-normal py-3 text-left"
                loading={pending === a.id}
                disabled={!!pending}
                onClick={() => void run(a)}
              >
                <span className="font-medium">{a.label}</span>
                <span className="text-xs font-normal text-muted-foreground">{a.hint}</span>
              </Button>
            ))}
          </div>
        </>
      )}
    </Card>
  );
}
