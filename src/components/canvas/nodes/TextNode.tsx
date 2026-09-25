"use client";

import { memo, useState, useCallback, useRef, useEffect } from "react";
import { type NodeProps, type Node, NodeResizer } from "@xyflow/react";
import { useIsCoarsePointer } from "@/hooks/useBreakpoint";
import { NodeActionsToolbar } from "./NodeActionsToolbar";

export interface TextNodeData {
  text: string;
  fontSize?: "sm" | "base" | "lg";
  [key: string]: unknown;
}

type TextNodeType = Node<TextNodeData, "text">;

const FONT_SIZE_CLASS: Record<string, string> = {
  sm: "text-sm",
  base: "text-base",
  lg: "text-lg",
};

const PLACEHOLDER = "Double-click (or tap) to edit";

function TextNodeInner({ data, selected, id }: NodeProps<TextNodeType>) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(data.text || "");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const isCoarse = useIsCoarsePointer();

  const fontClass = FONT_SIZE_CLASS[data.fontSize ?? "sm"] ?? "text-sm";

  useEffect(() => {
    if (editing && textareaRef.current) {
      textareaRef.current.focus();
      textareaRef.current.select();
    }
  }, [editing]);

  // Placeholder is purely presentational — never committed into data.text
  const displayText = editing ? text : data.text || PLACEHOLDER;
  const isPlaceholder = !editing && !data.text;

  // Set when Escape reverts an edit so a trailing blur doesn't commit anyway
  const cancelledRef = useRef(false);

  const commitEdit = useCallback(() => {
    if (cancelledRef.current) {
      cancelledRef.current = false;
      return;
    }
    setEditing(false);
    const next = text.trim() === "" ? "" : text;
    const event = new CustomEvent("textnode:update", {
      detail: { id, text: next },
    });
    window.dispatchEvent(event);
  }, [text, id]);

  const startEditing = useCallback(() => {
    setText(data.text || "");
    setEditing(true);
  }, [data.text]);

  const handleDoubleClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      startEditing();
    },
    [startEditing],
  );

  // Touch devices have no double-click: tapping an already-selected note
  // enters edit mode.
  const handleClick = useCallback(() => {
    if (!isCoarse || !selected || editing) return;
    startEditing();
  }, [isCoarse, selected, editing, startEditing]);

  // Allow external "Edit text" buttons (e.g. the properties panel) to open
  // the editor for this node.
  useEffect(() => {
    function onEditRequest(e: Event) {
      if ((e as CustomEvent).detail?.id === id) startEditing();
    }
    window.addEventListener("textnode:edit", onEditRequest);
    return () => window.removeEventListener("textnode:edit", onEditRequest);
  }, [id, startEditing]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Escape") {
        // Revert — discard the in-progress edit without committing
        e.stopPropagation();
        cancelledRef.current = true;
        setText(data.text || "");
        setEditing(false);
      }
    },
    [data.text],
  );

  return (
    <>
      <NodeActionsToolbar nodeId={id} />
      <NodeResizer
        isVisible={selected}
        minWidth={140}
        minHeight={48}
        lineClassName="!border-cyan-500/40"
        handleClassName={`${isCoarse ? "!h-5 !w-5" : "!h-2 !w-2"} !rounded-sm !border !border-cyan-500 !bg-cyan-500/80`}
      />
      <div
        className={`
          flex h-full w-full min-h-[48px] min-w-[140px] flex-col overflow-hidden rounded-md transition-colors duration-150
          ${selected ? "border border-dashed border-zinc-600 bg-zinc-900/60" : "border border-transparent"}
          ${!selected && !editing ? "hover:bg-zinc-900/50" : ""}
          ${editing ? "border border-dashed border-zinc-500 bg-zinc-900/70" : ""}
        `}
        onDoubleClick={handleDoubleClick}
        onClick={handleClick}
      >
        {editing ? (
          <textarea
            ref={textareaRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onBlur={commitEdit}
            onKeyDown={handleKeyDown}
            spellCheck={false}
            wrap="soft"
            className={`nodrag nowheel h-full w-full flex-1 resize-none whitespace-pre-wrap break-words bg-transparent px-3 py-2 font-mono text-zinc-300 outline-none placeholder:text-zinc-500 ${fontClass}`}
            style={{ overflowWrap: "anywhere", wordBreak: "break-word" }}
          />
        ) : (
          <div className="nowheel h-full w-full flex-1 overflow-auto px-3 py-2">
            <pre
              className={`m-0 whitespace-pre-wrap break-words font-mono text-zinc-300 ${fontClass} ${
                isPlaceholder ? "italic text-zinc-500" : ""
              }`}
              style={{ overflowWrap: "anywhere", wordBreak: "break-word" }}
            >
              {displayText}
            </pre>
          </div>
        )}
      </div>
    </>
  );
}

function areTextNodePropsEqual(
  prev: NodeProps<TextNodeType>,
  next: NodeProps<TextNodeType>,
): boolean {
  return (
    prev.selected === next.selected &&
    prev.data.text === next.data.text &&
    prev.data.fontSize === next.data.fontSize
  );
}

export const TextNode = memo(TextNodeInner, areTextNodePropsEqual);
