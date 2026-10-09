import { Handle, Position } from "@xyflow/react";
import { RETURN_SOURCE_HANDLE, RETURN_TARGET_HANDLE } from "@/domain/graph/returns";

/**
 * The handles of a call's response (RET-01): `ret-out` on the callee's left
 * side, `ret-in` on the caller's right side, below the request handles, so the
 * response runs back parallel to the request. Drag from the callee's `ret-out`
 * to the caller to answer a call. They never move or resize the node.
 */
export function ReturnHandles({
  connectable,
  coarse,
}: {
  /** False on a read-only tab (RET-14) and on instance cards, which only show edges. */
  connectable: boolean;
  coarse: boolean;
}) {
  const className = `${coarse ? "!h-5 !w-5" : "!h-2 !w-2"} !rounded-full !border !border-dashed !border-zinc-500 !bg-zinc-600`;
  // A read-only tab has no handle to drag from, but its responses still need an anchor.
  const style = {
    top: "76%",
    opacity: connectable ? 1 : 0,
    pointerEvents: connectable ? undefined : "none",
  } as const;
  return (
    <>
      <Handle
        id={RETURN_SOURCE_HANDLE}
        type="source"
        position={Position.Left}
        isConnectable={connectable}
        style={style}
        className={className}
        aria-label="Draw the response of a call"
        aria-hidden={!connectable || undefined}
        data-return-handle="out"
      />
      <Handle
        id={RETURN_TARGET_HANDLE}
        type="target"
        position={Position.Right}
        isConnectable={connectable}
        style={style}
        className={className}
        aria-label="Receive the response of a call"
        aria-hidden={!connectable || undefined}
        data-return-handle="in"
      />
    </>
  );
}
