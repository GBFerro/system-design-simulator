"use client";

import { motion, AnimatePresence } from "framer-motion";
import { CheckCircle2, AlertCircle, Info } from "lucide-react";
import { useAppStore } from "@/store/appStore";

const ICONS = {
  success: CheckCircle2,
  error: AlertCircle,
  info: Info,
};

const COLORS = {
  success: "border-emerald-500/30 bg-zinc-900 text-emerald-300",
  error: "border-rose-500/30 bg-zinc-900 text-rose-300",
  info: "border-zinc-700 bg-zinc-900 text-zinc-300",
};

const ICON_COLORS = {
  success: "text-emerald-400",
  error: "text-rose-400",
  info: "text-cyan-400",
};

export function Toast() {
  // Auto-dismiss is owned by the store's 4s timer (showToast/clearToast) —
  // do not schedule a competing timeout here.
  const toast = useAppStore((s) => s.toast);

  return (
    <AnimatePresence>
      {toast && (
        <motion.div
          // Horizontal centering lives in the motion values: framer-motion
          // writes `transform` inline, which would overwrite -translate-x-1/2.
          initial={{ opacity: 0, y: 20, scale: 0.95, x: "-50%" }}
          animate={{ opacity: 1, y: 0, scale: 1, x: "-50%" }}
          exit={{ opacity: 0, y: 10, scale: 0.95, x: "-50%" }}
          transition={{ duration: 0.2 }}
          // (the stage lifts it above the dock with `--toast-bottom`)
          className="pointer-events-none fixed bottom-[var(--toast-bottom,1.5rem)] left-1/2 z-50"
        >
          <div
            className={`pointer-events-auto flex items-center gap-2 rounded-md border px-4 py-2.5 shadow-sm ${COLORS[toast.type]}`}
          >
            {(() => {
              const Icon = ICONS[toast.type];
              return <Icon className={`h-4 w-4 shrink-0 ${ICON_COLORS[toast.type]}`} />;
            })()}
            <span className="text-sm font-medium">{toast.message}</span>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
