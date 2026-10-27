"use client";

import React, { useEffect, useState } from "react";
import { ApiError, API_BASE_URL } from "@/lib/api/client";
import { requestSupportEvidenceLink, SupportEvidenceLink } from "@/lib/api/admin";

const MIN_REASON = 10;
// The link the API returns is a path on the API host ("/api/v1/evidence/..."), not on this panel.
const API_ORIGIN = API_BASE_URL.replace(/\/api\/v1\/?$/, "");

export default function SupportAccessPage() {
  const [eventId, setEventId] = useState("");
  const [kind, setKind] = useState<"snapshot" | "clip">("snapshot");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ message: string; requestId?: string } | null>(null);
  const [grant, setGrant] = useState<(SupportEvidenceLink & { kind: "snapshot" | "clip" }) | null>(null);
  const [secondsLeft, setSecondsLeft] = useState(0);

  useEffect(() => {
    if (!grant) return;
    const tick = () => setSecondsLeft(Math.max(0, Math.round((Date.parse(grant.expiresAt) - Date.now()) / 1000)));
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [grant]);

  const reasonOk = reason.trim().length >= MIN_REASON;
  const canSubmit = !busy && /^[a-fA-F0-9]{24}$/.test(eventId.trim()) && reasonOk;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    setGrant(null);
    try {
      const link = await requestSupportEvidenceLink({ eventId: eventId.trim(), kind, reason: reason.trim() });
      setGrant({ ...link, kind });
    } catch (err) {
      if (err instanceof ApiError) setError({ message: err.message, requestId: err.requestId });
      else setError({ message: "Something went wrong. Please try again." });
    } finally {
      setBusy(false);
    }
  };

  const expired = grant !== null && secondsLeft === 0;
  const src = grant ? API_ORIGIN + grant.url : "";

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h2 className="text-2xl font-bold text-[#0F172A]">Support access to evidence</h2>
        <p className="text-sm text-gray-500 mt-1">
          Open one snapshot or clip of a company&apos;s event for troubleshooting. Every grant needs a written reason, is
          written to that company&apos;s own audit trail, and the link works for 2 minutes only.
        </p>
      </div>

      <form onSubmit={submit} className="bg-white p-5 rounded-xl border border-[#DBEAFE] shadow-sm space-y-4">
        <div>
          <label htmlFor="eventId" className="block text-xs font-semibold text-gray-700 mb-1">
            Event ID
          </label>
          <input
            id="eventId"
            type="text"
            value={eventId}
            onChange={(e) => setEventId(e.target.value)}
            placeholder="24-character event id (see Overview, recent events)"
            autoComplete="off"
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm font-mono focus:ring-2 focus:ring-[#2563EB]"
          />
        </div>

        <fieldset>
          <legend className="block text-xs font-semibold text-gray-700 mb-1">File</legend>
          <div className="flex gap-4 text-sm">
            {(["snapshot", "clip"] as const).map((k) => (
              <label key={k} className="inline-flex items-center gap-2">
                <input type="radio" name="kind" checked={kind === k} onChange={() => setKind(k)} />
                {k === "snapshot" ? "Snapshot (image)" : "Clip (video)"}
              </label>
            ))}
          </div>
        </fieldset>

        <div>
          <label htmlFor="reason" className="block text-xs font-semibold text-gray-700 mb-1">
            Reason (shown to the company in its audit trail)
          </label>
          <textarea
            id="reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={3}
            maxLength={500}
            placeholder="For example: customer ticket 1234, snapshot not loading in their panel"
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-[#2563EB]"
          />
          <p className={`mt-1 text-xs ${reasonOk || reason.length === 0 ? "text-gray-400" : "text-red-600"}`}>
            At least {MIN_REASON} characters ({reason.trim().length}/{MIN_REASON}).
          </p>
        </div>

        <button
          type="submit"
          disabled={!canSubmit}
          className="px-4 py-2 bg-[#2563EB] text-white text-sm font-semibold rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {busy ? "Requesting..." : "Request access link"}
        </button>
      </form>

      {error && (
        <div role="alert" className="p-4 bg-red-50 border border-red-200 text-red-800 rounded-xl text-sm">
          <p>{error.message}</p>
          {error.requestId && <p className="mt-1 text-xs text-red-600">Reference: {error.requestId}</p>}
        </div>
      )}

      {grant && (
        <div className="bg-white p-5 rounded-xl border border-[#DBEAFE] shadow-sm space-y-3" aria-live="polite">
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold text-gray-900">Access granted and recorded in the audit trail</p>
            <span
              className={`text-xs font-semibold px-2.5 py-0.5 rounded-full border ${
                expired ? "bg-gray-100 text-gray-500 border-gray-200" : "bg-[#EFF6FF] text-[#2563EB] border-[#DBEAFE]"
              }`}
            >
              {expired ? "Link expired" : `Expires in ${secondsLeft}s`}
            </span>
          </div>

          {expired ? (
            <p className="text-sm text-gray-500">The link has expired. Request a new one with a reason if you still need it.</p>
          ) : grant.kind === "snapshot" ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={src} alt="Evidence snapshot" className="max-h-96 rounded-lg border border-gray-200" />
          ) : (
            <video src={src} controls className="max-h-96 w-full rounded-lg border border-gray-200" />
          )}
        </div>
      )}
    </div>
  );
}
