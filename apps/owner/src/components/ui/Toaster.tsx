"use client";

import { Toaster as Sonner } from "sonner";

// Success / error toasts. Use `toast.success("Saved")` from "sonner".
export function Toaster() {
  return (
    <Sonner
      position="top-right"
      closeButton
      toastOptions={{
        classNames: {
          toast: "rounded-lg border border-border bg-background text-foreground shadow-md",
          description: "text-muted-foreground",
        },
      }}
    />
  );
}
