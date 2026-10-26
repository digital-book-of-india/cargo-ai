"use client";

import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Button, Modal } from "@/components/ui";

// Warns before unsaved edits are lost.
//  - closing or reloading the tab: the browser's own "leave site?" prompt
//  - clicking a link inside the app: a dialog with Stay / Leave
// Not covered: the browser Back button and programmatic navigation (for example the site switcher).
// Render the returned element somewhere in the page.
export function useUnsavedChangesGuard(dirty: boolean): ReactNode {
  const router = useRouter();
  const [pending, setPending] = useState<string | null>(null);

  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);

  useEffect(() => {
    if (!dirty) return;
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0) return;
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const anchor = (e.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!anchor || anchor.target === "_blank" || anchor.hasAttribute("download")) return;
      const url = new URL(anchor.href, window.location.href);
      if (url.origin !== window.location.origin) return;
      if (url.pathname === window.location.pathname && url.search === window.location.search) return;
      e.preventDefault();
      e.stopPropagation(); // keep the router from handling the same click
      setPending(url.pathname + url.search + url.hash);
    };
    // capture phase so we run before the router's own click handler
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, [dirty]);

  return (
    <Modal
      open={pending !== null}
      title="Leave without saving?"
      description="You have changes that are not saved. If you leave now they will be lost."
      onClose={() => setPending(null)}
      footer={
        <>
          <Button variant="outline" onClick={() => setPending(null)}>
            Stay on this page
          </Button>
          <Button
            variant="danger"
            onClick={() => {
              const target = pending;
              setPending(null);
              if (target) router.push(target);
            }}
          >
            Leave and discard
          </Button>
        </>
      }
    />
  );
}
