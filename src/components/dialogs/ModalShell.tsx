"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { motion } from "framer-motion";

interface ModalShellProps {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  /** Extra classes for the dialog panel (e.g. max-w-md, p-6, bg overrides). */
  panelClassName?: string;
  /** Extra classes for the fixed wrapper (e.g. z-[60]). */
  wrapperClassName?: string;
  /** Extra classes for the backdrop. */
  backdropClassName?: string;
  /** Accessible name for the dialog. */
  ariaLabel?: string;
  /**
   * When false, the panel renders without the default chrome
   * (rounded-lg border bg-zinc-900 shadow) so callers can fully restyle it.
   */
  chrome?: boolean;
}

/**
 * Stack of currently-open ModalShell instances. Escape should only close the
 * topmost dialog (e.g. a ConfirmDialog layered over LoadDialog), so each
 * instance registers itself here while open.
 */
const openModalStack: symbol[] = [];

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Shared modal wrapper: backdrop, centered scrollable panel, Escape-to-close,
 * simple focus trap (focus panel on open, trap Tab, restore focus on close).
 *
 * Mark an element inside with `data-autofocus` to receive initial focus.
 */
export function ModalShell({
  open,
  onClose,
  children,
  panelClassName = "",
  wrapperClassName = "",
  backdropClassName = "",
  ariaLabel,
  chrome = true,
}: ModalShellProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  const instanceIdRef = useRef<symbol | null>(null);
  if (instanceIdRef.current === null) {
    instanceIdRef.current = Symbol("modal-shell");
  }

  useEffect(() => {
    if (!open) return;

    const instanceId = instanceIdRef.current as symbol;
    openModalStack.push(instanceId);

    restoreFocusRef.current = document.activeElement as HTMLElement | null;

    const panel = panelRef.current;
    const autoTarget = panel?.querySelector<HTMLElement>("[data-autofocus]");
    (autoTarget ?? panel)?.focus();

    function onKeyDown(e: KeyboardEvent) {
      // Only the topmost open dialog reacts to keyboard events.
      if (openModalStack[openModalStack.length - 1] !== instanceId) return;
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key === "Tab" && panel) {
        const focusables = Array.from(
          panel.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
        ).filter((el) => el.offsetParent !== null || el === document.activeElement);
        if (focusables.length === 0) {
          e.preventDefault();
          panel.focus();
          return;
        }
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        const active = document.activeElement;
        if (e.shiftKey && (active === first || active === panel || !panel.contains(active))) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && (active === last || !panel.contains(active))) {
          e.preventDefault();
          first.focus();
        }
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      const idx = openModalStack.indexOf(instanceId);
      if (idx !== -1) openModalStack.splice(idx, 1);
      restoreFocusRef.current?.focus?.();
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className={`fixed inset-0 z-50 flex items-center justify-center p-4 ${wrapperClassName}`}>
      {/* Backdrop */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.15 }}
        className={`absolute inset-0 bg-black/60 ${backdropClassName}`}
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Panel */}
      <motion.div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={ariaLabel}
        tabIndex={-1}
        initial={{ opacity: 0, scale: 0.96, y: 12 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
        className={`relative z-10 max-h-[85dvh] w-full overflow-y-auto outline-none ${
          chrome ? "rounded-lg border border-zinc-800 bg-zinc-900 shadow-lg" : ""
        } ${panelClassName}`}
      >
        {children}
      </motion.div>
    </div>
  );
}
