# Redesign phase 1: Papel quente (warm paper)

**Status:** Approved
**Owner:** user (decision) · agent (draft)
**Date:** 2026-11-24

## Problem

SystemForge looks like a generic dark dashboard: a cool zinc/cyan palette, one rectangular card for
all 42 component kinds (only a small lucide icon tells them apart), and a three-column layout
(sidebar palette 280 px, canvas, right panel 300 px) that leaves the canvas squeezed between fixed
chrome. Adding a component gives almost no feedback: a drop just makes a card appear, and a
click-to-add shows a toast. Interview candidates cannot read the architecture at a glance, and the
app has no visual identity. The user picked the **Papel quente** direction from the mockups
(`Screen3D`, `Node3D`, `Interacoes`, `Animacoes`, `Aprendizado` in the design scratchpad) and
approved isometric components drawn in SVG (no real 3D, no three.js, no new runtime dependency).

## Outcome

The app wears the Papel quente identity, light by default and dark as a first-class alternative:
warm paper surfaces, ink strokes, a terracotta accent, Bricolage Grotesque headings, Inter body
text and IBM Plex Mono numbers. Every component on the canvas is a small isometric model whose
shape says what it is (a cylinder for a database, RAM sticks for a cache, a conveyor for a
queue...), tinted by its family, with its name, one live number and its status halo; the details
show on hover or selection. With a canvas step open, the canvas fills the screen and the tools
float over it: a top bar, a left rail with the problem and the steps, the right panel as a card,
and a component dock at the bottom with the most-used kinds and a door to the full palette. Adding
a component, by drag, click or keyboard, gives physical feedback: the model lifts, lands with a
bounce and a ripple, and the cost counter flashes. A new connection draws itself. The existing
motion (packets, status pulse, blast pulse) stays. All of it is purely visual: the graph, the
engine, the undo history and the persisted data behave exactly as today, and reduced motion turns
the new motion off.

## Decisions

The user answered the draft's open questions on 2026-11-24:

1. Light is the default theme for a fresh visitor; dark stays first-class and is tested too. The
   dark-only lines of `docs/architecture.md` are corrected in slice 1.
2. The dock holds eight fixed tiles (client, cdn, load-balancer, app-server, cache, sql-db,
   read-replica, message-queue) and an "All components" button that opens the existing palette,
   with its search, in a floating panel.
3. The status and accent palettes are remapped per theme: rose to err, amber to slow, emerald to
   ok, violet to resp, orange to accent, blue to req (steps 300–600).
4. Zoom controls sit bottom-left; the minimap is hidden by default behind a toggle; the chaos
   timeline floats just above the dock; the mockup's trace card is not part of phase 1.
5. A node shows its name pill, one live metric, the ×N button and the status halo. The capacity
   line, the technology tag and the full metrics badge show on hover or when selected.
6. No auto-connect in phase 1.
7. The worker draws the 7 extra archetypes in the `Node3D` style; the user approves them from
   screenshots in the slice-2 PR. Kinds sharing an archetype are told apart by tint and name.
8. The infrastructure family gets a seventh pastel, a soft olive-grey.
9. From 768 to 1279 px the rail starts collapsed to icons, the panel is 300 px wide and the dock
   scrolls horizontally.
10. The 16 px snap grid stays; the isometric pattern is decorative only.
11. Nodes are about 160 × 120 px on the canvas; the reference layouts are re-spaced only if the
    no-overlap test fails.

## Acceptance criteria

Criteria are grouped by slice. "Light" means `<html>` without `.dark`; "dark" means `<html
class="dark">`. Token values are exact hex (compare case-insensitively after `getComputedStyle`
on `document.documentElement`, trimmed).

**Slice 1: tokens, fonts, canvas colors (tracer)**

1. In light, the root defines `--sf-bg #EEE8DF`, `--sf-panel #FAF6F0`, `--sf-panel-2 #F3EDE4`,
   `--sf-ink #26211C`, `--sf-soft #4F463D`, `--sf-muted #6B6155`, `--sf-line #DDD3C5`,
   `--sf-accent #B4502A`, `--sf-accent-ink #FFFFFF`, `--sf-accent-soft #F5DCCD`,
   `--sf-req #B4502A`, `--sf-resp #1F6F68`, `--sf-ok #2F7A4C`, `--sf-slow #9C5F0C`,
   `--sf-err #B3313E`. In dark the same names are `--sf-bg #1A1714`, `--sf-panel #231F1B`,
   `--sf-panel-2 #2A2520`, `--sf-ink #F1E9DD`, `--sf-soft #D3C7B7`, `--sf-muted #AB9D8B`,
   `--sf-line #3A332C`, `--sf-accent #E27D52`, `--sf-accent-ink #1A1714`,
   `--sf-accent-soft #4A2E22`, `--sf-req #E27D52`, `--sf-resp #52B8AC`, `--sf-ok #5CC98A`,
   `--sf-slow #E8A84A`, `--sf-err #EE7A84`. The category pastels are, in light,
   `--sf-cat-client #E9E2D6`, `--sf-cat-network #DCE6F1`, `--sf-cat-compute #E4DEF3`,
   `--sf-cat-cache #F5DAD2`, `--sf-cat-data #F3E2C6`, `--sf-cat-messaging #D6ECE6`,
   `--sf-cat-infra #E1E2D2`, and in dark, `--sf-cat-client #4A4238`, `--sf-cat-network #34465A`,
   `--sf-cat-compute #443D5E`, `--sf-cat-cache #5E3B3B`, `--sf-cat-data #5A4A2C`,
   `--sf-cat-messaging #2C5049`, `--sf-cat-infra #47483A`. `--sf-radius` is `14px`,
   `--sf-radius-sm` `8px`, `--sf-border-w` `1.5px`, and `--sf-btn-shadow` is `2px 3px 0 #26211C`
   in light and `2px 3px 0 #000000` in dark.
2. The existing ramps resolve to the tokens: `--z-100` = ink, `--z-400` = soft, `--z-500` = muted,
   `--z-800` = line, `--z-900` = panel, `--z-950` = bg, `--ac-500` = accent; and the shadcn
   tokens `--background` = bg, `--foreground` = ink, `--card` = panel, `--popover` = panel,
   `--border` = line, `--primary` = accent, `--primary-foreground` = accent-ink, `--destructive` =
   err, `--ring` = accent, in both themes. The steps not named here are hex values between their
   neighbours.
3. In both themes, every text pair on the passing side of the contrast list (Approach,
   "Contrast") is at least 4.5:1 by the WCAG 2.x formula: `--z-50`..`--z-500`, req, resp, ok,
   slow and err on panel and panel-2; accent-ink on accent; ink on accent-soft and on each of the
   seven category pastels. The pairs the list marks as failing are not on it.
4. Elements with `text-rose-400`, `text-amber-400`, `text-emerald-400`, `text-violet-400`,
   `text-orange-400` and `text-blue-400` compute their color to err, slow, ok, resp, accent and
   req of the active theme, and `bg-rose-500`, `bg-amber-500`, `bg-emerald-500`, `bg-violet-500`,
   `bg-orange-500` and `bg-blue-500` compute their background to the same tokens, in both themes.
5. Body text computes a `font-family` whose first family name contains `Inter`; elements using
   `font-heading`/`font-display` contain `Bricolage Grotesque`; `.font-mono` contains
   `IBM Plex Mono`; no computed `font-family` on the page contains `Hanken` or `Geist`.
6. The canvas colors come from tokens: the idle edge path's computed `stroke` equals
   `--edge-idle`, the minimap mask equals `--minimap-mask`, and the background pattern equals
   `--grid-dot`/`--grid-line` in each theme, and switching theme changes them without a reload. An
   SVG export's background is the active theme's `--sf-bg`. `DesignCanvas.tsx`,
   `AnimatedEdge.tsx`, `FlowParticles.tsx`, `lib/particles.ts` and `lib/exportCanvas.ts` contain
   no hex, `rgb()` or `rgba()` color literal.
7. A fresh browser context (no storage) opens in light: `<html>` has no `dark` class at
   `DOMContentLoaded`, so there is no flash of dark, and the viewport `theme-color` meta is
   `#EEE8DF`. The theme toggle switches to dark and back, flipping every token above, and the
   choice survives a reload.
8. `package.json` gains no runtime dependency, and the bundle-size check in `verify.sh` passes
   without editing its baseline.

**Slice 2: isometric models**

9. `isoArchetypeOf(componentId)` maps each of the 42 catalog ids to the archetype in the mapping
   list (Approach) and any other id (a user's custom component, an unknown id) to `api`;
   `isoTintOf(componentId, category)` maps every id to one of the seven tints in the same list.
10. Every component node on the canvas contains exactly one `svg[data-iso-kind]` whose value is
    `isoArchetypeOf(componentId)`, with `data-iso-tint` = its tint and `viewBox="0 0 160 160"`.
    The 15 archetypes each draw a different shape (no two archetypes share their SVG markup).
11. The face colors are CSS variables `--iso-<tint>-top/-left/-right` per theme whose values follow
    the mockup rule (light: top = mix(pastel, #FFFFFF, 0.5), left = pastel, right = mix(pastel,
    ink, 0.14); dark: top = mix(pastel, ink, 0.14), left = pastel, right = mix(pastel, #000000,
    0.35)), each channel within ±1; strokes are ink in light and `#0B0A09` in dark; the hard ground
    shadow is offset (3, 5) with fill ink (light) or `#000000` (dark) at opacity 0.9.
12. With a runtime snapshot pushed through `window.__runtimeStore`, a node with status `ok`,
    `warn`, `critical` or `down` shows a halo ring with `data-iso-status` = `ok`, `slow`, `err`,
    `err` and a stroke of that status token; with no snapshot there is no halo. The status icon in
    `[data-testid=node-metrics]` still exists, so status stays color AND icon.
13. A selected node shows a dashed ring (`[data-iso-selected]`) in the accent color; an unselected
    node has none; `.react-flow__node` still carries React Flow's `selected` class.
14. Every component node has the same measured size, 160 × 120 px, equal to `DEFAULT_NODE_SIZE`,
    whatever its label, technology tag, instance count, status, metrics, hover or selection; ten
    tap-adds never overlap (the existing editor B5 test passes).
15. For every one of the 35 reference solutions, the node boxes built by the reference loader at
    `DEFAULT_NODE_SIZE` do not overlap.
16. At rest a node shows its name pill, one headline metric (`[data-node-headline]` whose value is
    the field named in the headline list of the Approach: `rpsIn`, `p99` or `utilization`; the
    row is empty without a snapshot), the ×N button when it has more than one instance, and the
    halo. The capacity line, `[data-technology]` and `[data-testid=node-metrics]` stay in the DOM
    with computed opacity 0 at rest and 1 while the node is hovered, holds focus or is selected;
    on a coarse pointer only selection reveals them.
17. What the card offers today still works on the model: source/target handles and the return
    handles (the `connect` helper connects two nodes), the ×N button, the technology tag text, the
    metrics badge (its status icon, its sparkline on hover), the actions toolbar, `[data-blast]`,
    `[data-finding]`, `[data-preview-change]` and custom-node rename. The existing editor, metrics,
    chaos, advisor, technologies and return-edge e2e specs pass without adding a hover step.

**Slice 3: stage layout (desktop and tablet)**

18. At 1440×900 and 1280×800 on a canvas step, the `.react-flow` box spans the full viewport width
    and the height below the interview bar (when one is shown), and `[data-testid=stage-topbar]`,
    `[data-testid=stage-rail]` (210 px wide), `[data-testid=stage-panel]` (340 px wide) and
    (Design only) `[data-testid=stage-dock]` are boxes inside it, with border radius 14 px and a
    1.5 px border, none intersecting another.
19. At 1024×768 on the Design step the rail starts collapsed to icons (at most 56 px wide) and can
    be expanded, the panel is 300 px wide, the dock's computed `overflow-x` is `auto` and every
    tile can be scrolled into view, and no two floating cards intersect.
20. The rail holds the problem and the steps: `[data-testid=step-bar]` and the Back/Next buttons
    keep their roles and names, and navigation keeps "only the order" (the wizard spec passes).
21. Changing step only changes what is visible: across a step change the undo count, the node and
    edge counts and a live run's clock are unchanged; the dock shows only where `paletteVisible`
    (free mode) or `interviewPaletteVisible` (interview) is true.
22. Collapsing or opening the rail or the panel (the existing toggles) shows or hides its card and
    leaves the `.react-flow` box size unchanged.
23. After loading a reference at 1440×900, no component node box intersects the top bar, the rail,
    the panel or the dock.
24. The Problem step and interview phases 1–4 stay full screen with no canvas.
25. The top bar keeps its groups apart and the problem selector at least 80 px wide from 768 to
    1920 px with a live run (the smoke spec passes unchanged).
26. Below 768 px the layout works as today: the palette and the panel open as drawers and the
    bottom sheet, no dock is rendered, and the mobile flows in the e2e suite pass.
27. The zoom controls sit at the canvas's bottom-left and no floating card covers them. The minimap
    is not rendered on a fresh load; a "Show minimap" toggle renders it, uncovered, and a "Hide
    minimap" toggle removes it. The chaos timeline is uncovered and, when the dock is shown, its
    box bottom is at or above the dock's top.

**Slice 4: dock and add/connect motion**

28. On the Design step (and interview phase 5) the dock is a `role="toolbar"` named "Components"
    with eight tiles, in order client, cdn, load-balancer, app-server, cache, sql-db, read-replica
    and message-queue; each shows the kind's isometric model and label, is a button named
    `Add {label} to canvas` and keeps `data-palette-item`. After them, an "All components" button with
    `aria-expanded` opens a floating panel holding the existing palette with its search; Escape or
    the button closes it, and so does the start of a drag from it.
29. A click, Enter or Space on a tile adds exactly one node through `placeNode` at the visible
    center of the canvas not covered by floating cards; one Undo removes it; a `role="status"`
    `aria-live="polite"` region announces `Added {label}`.
30. Dragging a tile (or a palette item from the panel) onto the canvas adds exactly one node
    through `addNode`, centered under the pointer, announced the same way; one Undo removes it. A
    drop on a floating card or outside the canvas adds nothing.
31. While dragging, the overlay shows the model lifted (`[data-drag-lift]`, scale 1.06, a ground
    shadow), and the canvas carries `data-drop-active="true"` only while the pointer is over a
    place that accepts the drop.
32. A node just added by drag, click or keyboard has `[data-landing]` on its model wrapper (600 ms,
    `cubic-bezier(.34,1.56,.64,1)`) and a ground ripple element; both are gone within 1 s, and the
    node's measured size does not change while they run.
33. A clicked tile plays a press (scale 0.92 and back, 300 ms) and shows an `aria-hidden` "+1"
    badge, both gone within 1 s; `[data-testid=cost-mini]` gets `data-flash` when its value changes
    after an add, removed within 1 s.
34. An edge the user just connected has `data-drawing` on its path for 450 ms; edges created by
    loading a design, a reference or a quick fix, and every edge already on the canvas, never get
    it.
35. The "just added" and "just connected" marks live in an unpersisted store: after an add, the
    persisted canvas in `localStorage` and `node.data` hold no animation field, and the undo
    history gains exactly the one entry of the add.
36. On a read-only (reference) tab the dock tiles are `aria-disabled="true"`, a click shows
    "Reference tabs are read-only" and adds nothing, and a drag adds nothing.
37. With `prefers-reduced-motion: reduce`, an add still places the node and announces it, but no
    `[data-landing]`, ripple, press, "+1" badge, `data-flash` or `data-drawing` appears; packets
    stay off as today.
38. The existing motion stays: the status pulse, the blast pulse and the packets run as today (the
    traffic and chaos e2e specs pass).

**Every slice**

39. `bash scripts/verify.sh` passes on the slice's head and the whole e2e suite passes (the slices
    change layout, navigation and handles); the `engine-golden` fixture and every file under
    `src/engine/` are unchanged.
40. `docs/architecture.md` describes the new files (the architecture-map unit test passes), and
    its map line on `app/` (`:17`) and its Conventions line (`:210`) say light is the default,
    dark is supported and the top bar has a theme toggle.

## Out of scope

- Any engine, scoring, cost, SLO, advisor or persistence-schema change. No `STORE_VERSION` bump.
- Isometric projection of node positions or edges: React Flow's coordinate system, the 16 px snap
  grid, bezier edges and the particle layer stay as they are. The isometric look is per node plus
  a decorative background pattern.
- Auto-wiring a dropped node (the mockup connects it "to the API") and the guide line previewing
  that connection.
- The "first packet runs through the new edge" beat of the mockup: packets come from a run's
  snapshots, and a new edge has none until the next frame.
- The mockup's bottom-left trace card and its lesson card (the `Aprendizado` content).
- Isometric versions of the ghost (advisor preview), instance and text nodes: they take the new
  tokens only.
- Rewriting the ~1,830 raw palette classes in the components one by one; the reskin goes through
  the token remaps.
- New UI copy beyond the dock, the minimap toggle and the announcement; the copy stays English
  (the mockups are pt-BR).

## Approach

**Tokens (slice 1).** `globals.css` gains the `--sf-*` tokens for `:root` (light) and `.dark`
(dark), exactly the values of criterion 1, from the mockup table `P.quente`; the infrastructure
pastel is new (olive-grey `#E1E2D2` / `#47483A`, at the lightness of the other six). The existing
indirections stay the single switch: `--z-*`, `--ac-*` and the shadcn tokens are redefined from
the `--sf-*` values (criterion 2), so the ~1,830 `zinc-*`/`cyan-*` classes reskin with no component
churn. A second `@theme inline` block points steps 300–600 of `rose`, `amber`, `emerald`,
`violet`, `orange` and `blue` at err, slow, ok, resp, accent and req; steps 50–200 and 700–950 of
those palettes keep Tailwind's values. In Papel quente req and accent are the same color, so
`orange` and `blue` classes render alike. `--canvas-atmos`, `--grid-dot`, `--grid-line`,
`--edge-idle` and `--minimap-mask` are re-derived from ink and bg. The canvas files that hold color
literals today (`DesignCanvas.tsx:131-134` and the minimap node colors at `:248-254`,
`AnimatedEdge.tsx:117/:222/:289/:323`, `FlowParticles.tsx:62`, `lib/particles.ts:15-29`,
`lib/exportCanvas.ts:66`) read the tokens instead: SVG and DOM through `var(--…)`, the 2D particle
canvas and the export through a small `readThemeColors()` that reads `getComputedStyle` once per
theme change. Theme: `appStore`'s default becomes `"light"`, `layout.tsx` drops the hardcoded
`dark` class and its pre-paint script adds `dark` only when the persisted theme is dark, and
`themeColor` is `#EEE8DF`. Fonts: `layout.tsx` swaps `Hanken_Grotesk`/`Geist_Mono` for
`Bricolage_Grotesque`, `Inter` and `IBM_Plex_Mono` from `next/font/google` (IBM Plex Mono is
static, so its weights are listed explicitly, per
`node_modules/next/dist/docs/01-app/03-api-reference/02-components/font.md`), and
`--font-sans/-heading/-display/-mono` point at them. Inter supports `cv11` and `ss01`, so the body
`font-feature-settings` can stay.

**Contrast** (computed from the hex values; the slice-1 unit test recomputes them exactly):

- Pass in both themes: muted on panel (light 5.6, dark 6.2), on panel-2 (5.2, 5.7) and on bg (5.0,
  6.7); accent-ink on accent (white 5.1 in light, `#1A1714` 6.2 in dark); accent text on panel in
  light (4.7); ok, slow, err and resp on panel (light 4.9, 4.8, 5.7, 5.5; dark 6 or more); ink on
  accent-soft; ink on every pastel (infra: 12.2 light, 7.7 dark).
- Fail, so not allowed for normal-size text: accent text on bg in light (4.2, large text and UI
  only); accent text on accent-soft (3.9 light, 4.3 dark; use ink there); white text on the dark
  accent (2.9, which is why dark uses `#1A1714`).
- Decorative only: `line` against panel is about 1.4:1, so inputs and buttons carry the ink border
  (`--sf-border-w`), never `line` alone.

**Isometric models (slice 2).** A new `components/canvas/nodes/IsoModel.tsx` draws one 160×160 SVG
per archetype with the mockup geometry: `pt(o,u,v,z) = [x + 0.866(u − v), y + 0.5(u + v) − z]`
around the origin (80, 104), a slab, the hard ground shadow, the status halo ring and the selected
dashed ring. The pure parts live in `lib/iso.ts`: `isoArchetypeOf`, `isoTintOf`,
`headlineMetricOf` and the geometry helpers (box faces, quads, diamonds), unit-tested. Face colors
are precomputed CSS variables (criterion 11), so a theme switch repaints through CSS and
`ComponentNode`'s memo comparator does not change. The node box is 160 × 120 px
(`DEFAULT_NODE_SIZE`): the model rendered at about 96 px, the name pill and the headline row. The
halo, rings, ripple, ×N button and the hover details are absolutely positioned and may overflow the
box, so the box never resizes. `ComponentNode` keeps its handles (left/right, at the slab's
mid-height), `ReturnHandles`, `NodeMetricsBadge`, `NodeActionsToolbar`, ×N button, tech tag,
blast/finding/preview markers and data attributes, and replaces the bordered card and icon chip
with the model. The capacity line, the tech tag and the badge are always rendered and fade in with
opacity on `:hover`, `:focus-within` and selection; Playwright treats opacity 0 as visible and
still dispatches hover to it, so `metrics.spec.ts:63/:67/:105/:176` and
`technologies.spec.ts:345-366` need no hover step. On a coarse pointer the reveal follows
selection only (`useIsCoarsePointer()`), since `hover:` never fires there. `CATEGORY_COLORS`, today
duplicated in `ComponentNode.tsx:25-31` and `sidebar/ComponentPalette.tsx:34-50`, becomes the tint
table in `lib/iso.ts`. The background pattern becomes the mockup's isometric lines (30° and 150°,
26 px, `--grid-line`), decorative only; the snap grid stays 16 px. The worker draws the 7 extra
archetypes and the slice-2 PR carries a screenshot of all 15 in both themes for the user.

Mapping (archetype: kinds, tint). The first 8 are drawn in `Node3D`; the extras are marked:

- `client` (laptop + phone): client; client.
- `dns` (extra): dns; network.
- `cdn` (globe + PoP towers): cdn, origin-shield; network.
- `lb` (box, arrow fan): load-balancer, reverse-proxy; network.
- `gateway` (extra): api-gateway, waf, rate-limiter; network.
- `api` (stacked blades): app-server, auth-service, websocket-server, notification-service,
  custom, any unknown id; compute.
- `worker` (extra): worker-pool, task-scheduler, stream-processor; compute.
- `cache` (RAM sticks): cache; cache.
- `db` (cylinder): sql-db, nosql-db, graph-db, timeseries-db, data-warehouse; data.
- `replica` (short cylinder, dashed top): read-replica; data.
- `bucket` (extra): object-storage, file-store; data.
- `search` (extra): search, vector-db, geospatial-index; data.
- `queue` (conveyor, moving cubes): message-queue, dlq, pub-sub; messaging.
- `monitor` (extra): monitoring; infra.
- `control` (extra): service-mesh, autoscaler, service-discovery, distributed-lock,
  circuit-breaker, coordination-service, id-generator, sharded-counter, config-service; infra.

Headline metric (`headlineMetricOf(archetype)`, only from fields `runtimeStore` already has,
formatted with the existing `lib/runtimeMetrics` formatters):

- `p99`: api, worker, gateway (request latency is what a service tier is judged on).
- `utilization`: cache, db, replica, search, queue (how close the stateful tier is to its limit).
- `rpsIn`: client, dns, cdn, lb, bucket, monitor, control (how much passes through).

**Stage layout (slice 3).** `AppShell` renders the canvas as a full-bleed layer and the top bar,
rail (problem + vertical `StepBar`), right panel and dock as absolutely positioned cards over it,
with the mockup's geometry at 1440×900: top bar 16 px from the edges; rail 210 px at left 16, top
84; panel 340 px at right 16, top 84, bottom 16; dock bottom-centered. From 768 to 1279 px the rail
starts collapsed to an icon column (at most 56 px, expandable), the panel is 300 px and the dock
scrolls horizontally. Toggling a card never resizes the React Flow host, so no re-measure and no
store write. `fitView` and `placeNode`'s visible center take a padding for the open cards, the way
`paddingAboveSheet` does for the mobile sheet. The zoom controls move to the canvas's bottom-left;
the minimap is off by default and a "Show minimap" / "Hide minimap" button next to the zoom
controls toggles it (an unpersisted `appStore` field, left out of `partialize`, so the persisted
shape does not change); the `ChaosTimeline` floats just above the dock's slot (at the bottom when
no dock is shown). Below 768 px nothing structural changes. The right panel keeps its base-ui Tabs
and `TOOLS_BY_STEP`; step changes keep AD-004. Dialogs stay in `ModalShell`.

**Dock and motion (slice 4).** `components/canvas/ComponentDock.tsx` renders the eight tiles and
the "All components" button. The tiles reuse the palette's drag source (`PaletteDndProvider`, one
path for mouse and touch, drop by pointer geometry against `data-canvas-drop` minus the floating
cards) and the palette's quick-add (`placeNode(createComponentNode(...))` with the read-only
guard). The "All components" panel holds the existing `ComponentPalette` unchanged and closes on
drag start, as the mobile drawer does today. The panel stays mounted while closed, but its items
are hidden then, so the e2e helpers change: `quickAdd` clicks the dock tile when one is visible and
otherwise opens "All components" first, and a new `openPalette(page)` helper is called before the
direct `[data-palette-item]` uses in `chaos.spec.ts`, `cost.spec.ts`, `drill.spec.ts`,
`editor.spec.ts` (`dragFromPalette`), `score.spec.ts` and `technologies.spec.ts`. A new unpersisted
`store/motionStore.ts` (like `flowHighlightStore`) holds the ids of the node just added and the edge
just connected, with their start times; `ComponentNode` and `AnimatedEdge` read their own id with a
per-id selector and clear it on `animationend`. Nothing goes into `node.data`, `canvasStore` or a
persisted store, and no undo entry is pushed. Motion tokens: enter 320 ms
`cubic-bezier(.16,1,.3,1)`, move 460 ms `(.4,0,.2,1)`, confirm 240 ms `(.34,1.56,.64,1)`; drop
600 ms with the confirm curve; pick 120 ms; edge draw 450 ms. All keyframes carry a
`prefers-reduced-motion` guard, and the components skip setting the marks when
`usePrefersReducedMotion()` is true. The announcement goes through a `role="status"` live region:
today's `Toast` has no `aria-live`, so the add announcement does not rely on it.

## Files likely touched

- `src/app/globals.css`: `--sf-*` tokens, ramp and palette remaps, iso face variables, keyframes, iso grid.
- `src/app/layout.tsx`: fonts, `themeColor`, no hardcoded `dark`, the pre-paint script.
- `src/store/appStore.ts`: light default, unpersisted minimap toggle.
- `src/components/canvas/DesignCanvas.tsx`: token colors, iso background, drop-active mark, fitView padding, controls and minimap.
- `src/components/canvas/edges/AnimatedEdge.tsx`: token colors, `data-drawing`.
- `src/components/canvas/FlowParticles.tsx`, `src/lib/particles.ts`: token colors.
- `src/lib/exportCanvas.ts`: theme background.
- `src/lib/iso.ts` (new): archetype, tint and headline mapping, geometry helpers.
- `src/components/canvas/nodes/IsoModel.tsx` (new): the per-archetype SVG.
- `src/components/canvas/nodes/ComponentNode.tsx`, `NodeMetricsBadge.tsx`: model, headline, hover details, landing mark.
- `src/lib/placement.ts`: `DEFAULT_NODE_SIZE` = 160 × 120, visible center minus the floating cards.
- `src/data/problems.ts` or `src/lib/loadReference.ts`: only if criterion 15 fails at the new size.
- `src/components/layout/app-shell.tsx`, `top-bar.tsx`, `StepBar.tsx`: stage layout.
- `src/components/panel/RightPanel.tsx`, `src/components/sidebar/Sidebar.tsx`, `ComponentPalette.tsx`: floating cards, shared tint table.
- `src/components/canvas/ChaosTimeline.tsx`: position above the dock.
- `src/components/canvas/ComponentDock.tsx` (new), `src/components/canvas/PaletteDnd.tsx`: dock, palette panel, lift overlay, drop geometry.
- `src/store/motionStore.ts` (new): unpersisted animation marks.
- `src/components/cost/CostMini.tsx`: `data-flash`.
- `docs/architecture.md`: map entries, the theme lines `:17` and `:210`.
- `tests/unit/theme-tokens.test.ts`, `tests/unit/iso.test.ts`, `tests/unit/reference-layout.test.ts` (new); `tests/e2e/redesign.spec.ts` (new).
- `tests/e2e/helpers.ts` (`quickAdd`, new `openPalette`) and the six specs that use `[data-palette-item]` directly.

## Test plan

| Criterion | Test that proves it                                                 | Kind (unit, integration, e2e) |
| --------- | ------------------------------------------------------------------- | ----------------------------- |
| 1, 2      | `redesign.spec.ts` tokens                                           | e2e                           |
| 3         | `theme-tokens.test.ts` contrast                                     | unit                          |
| 4         | `redesign.spec.ts` status palettes                                  | e2e                           |
| 5         | `redesign.spec.ts` fonts                                            | e2e                           |
| 6         | `theme-tokens.test.ts` literals + `redesign.spec.ts` canvas colors  | unit + e2e                    |
| 7         | `redesign.spec.ts` default theme                                    | e2e                           |
| 8         | `verify.sh` bundle-size check                                       | check                         |
| 9         | `iso.test.ts` mapping                                               | unit                          |
| 10        | `redesign.spec.ts` archetypes + `iso.test.ts` markup                | e2e + unit                    |
| 11        | `theme-tokens.test.ts` iso faces                                    | unit                          |
| 12        | `redesign.spec.ts` status halo                                      | e2e                           |
| 13        | `redesign.spec.ts` selected ring                                    | e2e                           |
| 14        | `redesign.spec.ts` fixed size + `editor.spec.ts` B5                 | e2e                           |
| 15        | `reference-layout.test.ts` no overlap                               | unit                          |
| 16        | `redesign.spec.ts` node at rest and on hover                        | e2e                           |
| 17        | existing editor, metrics, chaos, advisor, technologies, return-edge | e2e                           |
| 18        | `redesign.spec.ts` stage 1440 and 1280                              | e2e                           |
| 19        | `redesign.spec.ts` stage 1024                                       | e2e                           |
| 20        | `wizard.spec.ts`                                                    | e2e                           |
| 21        | `redesign.spec.ts` step change + `wizard.spec.ts`                   | e2e                           |
| 22        | `redesign.spec.ts` toggles keep canvas size                         | e2e                           |
| 23        | `redesign.spec.ts` fitView clears cards                             | e2e                           |
| 24        | `wizard.spec.ts`, `interview.spec.ts`                               | e2e                           |
| 25        | `smoke.spec.ts`                                                     | e2e                           |
| 26        | existing mobile tests + `redesign.spec.ts` no dock below 768        | e2e                           |
| 27        | `redesign.spec.ts` canvas chrome                                    | e2e                           |
| 28        | `redesign.spec.ts` dock                                             | e2e                           |
| 29        | `redesign.spec.ts` click and keyboard add                           | e2e                           |
| 30        | `redesign.spec.ts` drag add                                         | e2e                           |
| 31        | `redesign.spec.ts` drag lift                                        | e2e                           |
| 32        | `redesign.spec.ts` landing                                          | e2e                           |
| 33        | `redesign.spec.ts` press, +1, flash                                 | e2e                           |
| 34        | `redesign.spec.ts` edge draw                                        | e2e                           |
| 35        | `redesign.spec.ts` marks not persisted                              | e2e                           |
| 36        | `redesign.spec.ts` read-only dock                                   | e2e                           |
| 37        | `redesign.spec.ts` reduced motion                                   | e2e                           |
| 38        | `traffic.spec.ts`, `chaos.spec.ts`                                  | e2e                           |
| 39        | `verify.sh` receipt, full e2e, engine diff empty                    | check                         |
| 40        | `architecture-map.test.ts` + review                                 | unit + review                 |

How the tests work: token and font tests read `getComputedStyle` in light and in dark (toggle);
`theme-tokens.test.ts` parses `globals.css`, recomputes the WCAG ratios and the iso face mixes, and
scans the five canvas files for color literals; halo, headline and hover tests push synthetic
snapshots through `window.__runtimeStore`; the reduced-motion test uses
`page.emulateMedia({ reducedMotion: "reduce" })`; criterion 39's engine check is
`git diff --stat src/engine tests/unit/fixtures` being empty.

Gaps, named: the visual likeness to the mockups (shapes, proportions, the feel of the bounce) and
the 7 extra archetypes have no automated test: the user approves them from the screenshots in each
slice's PR. Criterion 3 checks token pairs, not that no component puts accent text on accent-soft
(review). There is no test that a live tick re-renders only the nodes whose status changed (the
memo stays as is; review). Unit tests run in node only, so component markup is checked through e2e.

E2E assertions coupled to style, and what happens to them: `editor.spec.ts:57` (`/selected/`, React
Flow's class: stays), `metrics.spec.ts:136` (edge `strokeWidth`: widths unchanged, stays),
`metrics.spec.ts:496` (`text-rose-400`: the class stays and now resolves to err, stays),
`return-edge.spec.ts:44` and `traffic.spec.ts:165` (`strokeDasharray`: dashes unchanged, stay),
`return-edge.spec.ts:126` (return handle opacity 0: stays), `editor.spec.ts:133` (viewport scale ≤ 1
after the first drop: at risk from the new fitView padding and node size, must keep passing).
Palette-coupled: the 45 `quickAdd` calls in 9 specs keep working through the updated helper, and
the 21 direct `[data-palette-item]`/sidebar uses in 6 specs call `openPalette` first (Approach,
slice 4).

## Slices

1. **Tracer: Papel quente tokens, fonts and canvas colors** (criteria 1–8, 39, 40). The thinnest
   end-to-end path that proves the reskin approach: hex tokens → the existing `--z-*`/`--ac-*` and
   shadcn indirections and the six remapped palettes → every Tailwind class, the canvas SVG, the 2D
   particle layer and the export, in both themes, with the contrast proven by a test and light as
   the default. Every later slice builds on its variables. One PR.
2. **Isometric models** (9–17, 39, 40): `lib/iso.ts`, `IsoModel` with all 15 archetypes,
   `ComponentNode` on the model with the headline and the hover details, 160 × 120 node size, iso
   background, reference layout check (re-spacing only if it fails). One PR, with screenshots.
3. **Stage layout** (18–27, 39, 40): floating top bar, rail, panel and dock slot at desktop and
   tablet widths; fitView padding; controls, minimap toggle, chaos timeline. Separate from slice 4
   because it touches navigation and the whole e2e suite.
4. **Dock and add/connect motion** (28–38, 39, 40): the dock and its "All components" panel with
   the helper changes, the lift/landing/press/flash/edge-draw marks in the unpersisted
   `motionStore`, the live region, the read-only and reduced-motion paths.

## Open questions

None. The last one was decided while folding in the answers: the remap makes req and accent one
color, and orange (the blast target's dashed outline) would resolve to accent, the same color as the
selected node's dashed ring. The blast outline uses `err` instead, so a fault target never looks
selected; every other `orange-*` use still resolves to accent.
