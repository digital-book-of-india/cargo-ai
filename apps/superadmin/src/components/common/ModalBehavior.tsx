"use client";

import { useEffect, useRef } from "react";

// Gives a hand-built dialog the behaviour people expect: Escape closes it, Tab stays inside it, focus moves into it when
// it opens and returns to where it was when it closes. Put it inside an element with role="dialog" aria-modal="true".
export function ModalBehavior({ onClose, disabled = false }: { onClose: () => void; disabled?: boolean }) {
  // the latest values, so the listeners are set up once and typing in the dialog never resets the focus
  const latest = useRef({ onClose, disabled });
  latest.current = { onClose, disabled };

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const dialog = document.querySelector<HTMLElement>('[role="dialog"][aria-modal="true"]');
    const focusable = () =>
      Array.from(
        dialog?.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
        ) ?? []
      );
    (focusable().find((el) => el.tagName === "TEXTAREA" || el.tagName === "INPUT") ?? focusable()[0] ?? dialog)?.focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !latest.current.disabled) {
        e.stopPropagation();
        latest.current.onClose();
        return;
      }
      if (e.key !== "Tab") return;
      const items = focusable();
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      previous?.focus?.();
    };
  }, []);

  return null;
}
