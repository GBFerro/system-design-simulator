import type { CSSProperties, ReactNode } from "react";

interface StageCardProps {
  /** `data-testid` of the card (`stage-topbar`, `stage-rail`, `stage-panel`, `stage-palette`). */
  testId: string;
  /** Shown or not: a closed card is `display: none` and inert; it never changes any other box. */
  open?: boolean;
  className?: string;
  /** Position and size, from `lib/stageLayout`. */
  style?: CSSProperties;
  children: ReactNode;
  /** Not a card: only a layout-free wrapper (`display: contents`), so the children keep their place. */
  flat?: boolean;
  /** The card's own landmark role and name (the dock is a toolbar named "Components"). */
  role?: string;
  ariaLabel?: string;
}

/**
 * A floating card of the stage layout: the theme's radius (14 px), border width (1.5 px) and line
 * color, on the panel color. Position and size are the caller's.
 */
export function StageCard({
  testId,
  open = true,
  className = "",
  style,
  children,
  flat = false,
  role,
  ariaLabel,
}: StageCardProps) {
  // The same element either way, so a bar that is a card on the stage and a plain row elsewhere
  // is not remounted when the layout changes.
  if (flat) return <div className="contents">{children}</div>;
  return (
    <div
      data-testid={testId}
      data-stage-card=""
      role={role}
      aria-label={ariaLabel}
      className={`bg-zinc-900 shadow-lg ${className}`.trim()}
      style={{
        borderRadius: "var(--sf-radius)",
        borderWidth: "var(--sf-border-w)",
        borderStyle: "solid",
        borderColor: "var(--sf-line)",
        ...style,
        // inline, so no display utility of the caller's can win over it
        ...(open ? null : { display: "none" }),
      }}
      aria-hidden={open ? undefined : true}
      inert={open ? undefined : true}
    >
      {children}
    </div>
  );
}
