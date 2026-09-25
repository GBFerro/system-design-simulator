"use client";

import { X, AlertTriangle } from "lucide-react";
import { ModalShell } from "./ModalShell";

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  danger?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}

export function ConfirmDialog({
  open,
  title,
  message,
  confirmText = "Confirm",
  cancelText = "Cancel",
  danger = false,
  onConfirm,
  onClose,
}: ConfirmDialogProps) {
  const confirmClass = danger ? "bg-rose-600 hover:bg-rose-500" : "bg-cyan-600 hover:bg-cyan-500";

  return (
    <ModalShell open={open} onClose={onClose} panelClassName="max-w-sm p-6" ariaLabel={title}>
      <div className="mb-4 flex items-start justify-between">
        <div className="flex items-center gap-2">
          {danger && <AlertTriangle className="h-4 w-4 text-rose-400" />}
          <h2 className="text-sm font-semibold text-zinc-100">{title}</h2>
        </div>
        <button
          onClick={onClose}
          className="flex h-6 w-6 items-center justify-center rounded-md text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300"
          aria-label="Close"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <p className="mb-5 text-xs leading-relaxed text-zinc-400">{message}</p>

      <div className="flex justify-end gap-2">
        <button
          onClick={onClose}
          className="rounded-md px-3 py-1.5 text-xs text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
        >
          {cancelText}
        </button>
        <button
          onClick={() => {
            onConfirm();
            onClose();
          }}
          data-autofocus
          className={`rounded-md px-4 py-1.5 text-xs font-medium text-white ${confirmClass}`}
        >
          {confirmText}
        </button>
      </div>
    </ModalShell>
  );
}
