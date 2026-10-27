"use client";

import { useEffect } from "react";
import type { ReactNode } from "react";

// Consistent page title block used at the top of every owner screen.
export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  // each screen gets its own tab/window title
  useEffect(() => {
    document.title = `${title} | CargoSense AI`;
  }, [title]);

  return (
    <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap gap-2">{actions}</div>}
    </div>
  );
}
