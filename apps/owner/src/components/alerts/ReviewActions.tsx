"use client";

import { useState } from "react";
import { Check } from "lucide-react";
import { Alert } from "@/components/common/States";
import { ReviewStatusBadge } from "@/components/common/StatusBadges";
import { Button, Card } from "@/components/ui";
import { friendlyMessage } from "@/lib/api/messages";
import { REVIEW_CHOICES } from "@/lib/events";
import type { ReviewChoice } from "@/lib/events";
import type { ReviewStatus } from "@/types";

interface Props {
  status: ReviewStatus;
  /** must throw when the server rejects the change */
  onReview: (choice: ReviewChoice) => Promise<void>;
}

// Review buttons. The shown status only changes after the server accepted the choice.
export function ReviewActions({ status, onReview }: Props) {
  const [pending, setPending] = useState<ReviewChoice | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function choose(choice: ReviewChoice) {
    if (pending || choice === status) return;
    setPending(choice);
    setError(null);
    try {
      await onReview(choice);
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
        <ReviewStatusBadge status={status} />
      </div>
      {status === "NEW" && (
        <p className="mb-3 text-sm text-muted-foreground">
          Look at the evidence, then tell us what you think. This helps you keep track.
        </p>
      )}
      {error && (
        <div className="mb-3">
          <Alert tone="danger">{error}</Alert>
        </div>
      )}
      <div className="grid gap-2 sm:grid-cols-3">
        {REVIEW_CHOICES.map((c) => {
          const current = c.value === status;
          return (
            <Button
              key={c.value}
              variant={current ? "secondary" : "outline"}
              className="h-auto flex-col items-start gap-0.5 whitespace-normal py-3 text-left"
              loading={pending === c.value}
              disabled={!!pending || current}
              aria-pressed={current}
              onClick={() => void choose(c.value)}
            >
              <span className="flex items-center gap-1.5 font-medium">
                {current && <Check aria-hidden />} {c.label}
              </span>
              <span className="text-xs font-normal text-muted-foreground">{c.hint}</span>
            </Button>
          );
        })}
      </div>
    </Card>
  );
}
