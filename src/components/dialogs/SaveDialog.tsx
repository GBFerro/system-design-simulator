"use client";

import { useState, useRef, useEffect } from "react";
import { X } from "lucide-react";
import { useAppStore } from "@/store/appStore";
import { useSavedDesignsStore } from "@/store/savedDesignsStore";
import { useCustomProblemsStore } from "@/store/customProblemsStore";
import { PROBLEMS } from "@/data/problems";
import { ModalShell } from "./ModalShell";

interface SaveDialogProps {
  open: boolean;
  onClose: () => void;
}

export function SaveDialog({ open, onClose }: SaveDialogProps) {
  const selectedProblemId = useAppStore((s) => s.selectedProblemId);
  const saveDesign = useSavedDesignsStore((s) => s.saveDesign);
  const customProblems = useCustomProblemsStore((s) => s.problems);
  const inputRef = useRef<HTMLInputElement>(null);

  const problemTitle =
    PROBLEMS.find((p) => p.id === selectedProblemId)?.title ??
    customProblems.find((p) => p.id === selectedProblemId)?.title ??
    "Design";
  const defaultName = `${problemTitle} - ${new Date().toLocaleString()}`;

  const [name, setName] = useState(defaultName);
  const [prevOpen, setPrevOpen] = useState(false);

  // Reset name when dialog opens
  if (open && !prevOpen) {
    setName(`${problemTitle} - ${new Date().toLocaleString()}`);
    setPrevOpen(true);
  } else if (!open && prevOpen) {
    setPrevOpen(false);
  }

  // Focus input after dialog opens
  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.select(), 50);
    }
  }, [open]);

  const handleSave = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    saveDesign(trimmed);
    onClose();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleSave();
    }
  };

  return (
    <ModalShell open={open} onClose={onClose} panelClassName="max-w-md p-6" ariaLabel="Save design">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-zinc-100">Save Design</h2>
        <button
          onClick={onClose}
          className="flex h-6 w-6 items-center justify-center rounded-md text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300"
          aria-label="Close"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <label className="mb-1.5 block text-xs text-zinc-400">Design name</label>
      <input
        ref={inputRef}
        type="text"
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={handleKeyDown}
        data-autofocus
        className="mb-4 w-full rounded-md border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-500 outline-none focus:border-cyan-500"
        placeholder="My awesome design..."
      />

      <div className="flex justify-end gap-2">
        <button
          onClick={onClose}
          className="rounded-md px-3 py-1.5 text-xs text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
        >
          Cancel
        </button>
        <button
          onClick={handleSave}
          disabled={!name.trim()}
          className="rounded-md bg-cyan-600 px-4 py-1.5 text-xs font-medium text-white hover:bg-cyan-500 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          Save
        </button>
      </div>
    </ModalShell>
  );
}
