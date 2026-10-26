"use client";

import { useEffect } from "react";
import { ErrorState } from "@/components/common/States";

// Last-resort screen for an unexpected crash inside a page. It never shows technical details.
export default function RouteError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    document.title = "Something went wrong | DBI Intelligence";
  }, []);

  return (
    <div className="mx-auto max-w-lg p-6">
      <ErrorState
        message="Something went wrong on this page. Please try again."
        requestId={error.digest}
        onRetry={reset}
      />
    </div>
  );
}
