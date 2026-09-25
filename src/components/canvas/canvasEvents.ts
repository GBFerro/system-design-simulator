/** Window events the canvas uses to talk to the shell and the panel (same pattern as `textnode:edit`). */
export const OPEN_PROPERTIES_EVENT = "panel:open-properties";

export interface OpenPropertiesDetail {
  /** Field to focus once the Props tab is visible. */
  focus?: "label";
}

/** Show the Props tab (opening the right panel / mobile sheet if needed). */
export function openPropertiesPanel(focus?: OpenPropertiesDetail["focus"]): void {
  pendingFocus = focus;
  window.dispatchEvent(
    new CustomEvent<OpenPropertiesDetail>(OPEN_PROPERTIES_EVENT, { detail: { focus } }),
  );
}

export const MOD_KEY =
  typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform) ? "⌘" : "Ctrl+";

/** Keyboard shortcuts must no-op while the user is typing. */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.tagName === "INPUT" ||
    target.tagName === "TEXTAREA" ||
    target.tagName === "SELECT" ||
    target.isContentEditable
  );
}

let pendingFocus: OpenPropertiesDetail["focus"];

/** Read (and clear) the field the last openPropertiesPanel() asked to focus. */
export function consumePendingFocus(): OpenPropertiesDetail["focus"] {
  const focus = pendingFocus;
  pendingFocus = undefined;
  return focus;
}
