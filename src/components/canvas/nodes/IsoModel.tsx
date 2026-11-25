import type { ReactNode } from "react";
import {
  ISO_ORIGIN,
  boxFaces,
  diamond,
  lq,
  pt,
  quad,
  rq,
  tq,
  type IsoArchetype,
  type IsoTint,
  type Point,
} from "@/lib/iso";

/**
 * One isometric model (specs/2026-11-24-redesign-papel-quente.md, slice 2): a 160x160 SVG with a
 * slab, the hard ground shadow, the status halo, the selected ring and the archetype's body. Every
 * color is a CSS variable (`--iso-<tint>-*`, `--iso-stroke`, `--sf-*`), so a theme switch repaints
 * through CSS. Pure: no state, no effects. The first eight archetypes are the mockup's geometry
 * (`Node3D.dc.html`); dns, gateway, worker, bucket, search, monitor and control are drawn in the
 * same style (same slab, same light: top lightest, right darkest; same stroke weight).
 */

export type IsoStatus = "ok" | "slow" | "err";

export type IsoModelProps = {
  archetype: IsoArchetype;
  tint: IsoTint;
  /** Draws the halo ring in the status token; undefined draws none. */
  status?: IsoStatus;
  selected?: boolean;
  className?: string;
};

const C = ISO_ORIGIN;

/** The colors an archetype draws with, as CSS values. */
type Paint = { top: string; left: string; right: string; tint: IsoTint };

const DETAIL = "var(--sf-accent)";
const OK = "var(--sf-ok)";
const STROKE = "var(--iso-stroke)";
const SCREEN = "color-mix(in srgb, var(--sf-accent) 28%, var(--sf-panel))";
const GOLD = "var(--iso-gold)";

const paintOf = (tint: IsoTint): Paint => ({
  top: `var(--iso-${tint}-top)`,
  left: `var(--iso-${tint}-left)`,
  right: `var(--iso-${tint}-right)`,
  tint,
});

/** The dark chip color of the cache modules: the stroke mixed 15% toward the right face. */
const chipOf = (p: Paint) => `color-mix(in srgb, ${STROKE} 85%, ${p.right})`;

const f1 = (n: number) => n.toFixed(1);

/** A path through (u, v, z) points around `o`: `M x y L x y ...`. */
function seg(o: Point, pts: readonly (readonly [number, number, number])[]): string {
  return (
    "M" +
    pts
      .map(([u, v, z]) => {
        const q = pt(o, u, v, z);
        return `${f1(q[0])} ${f1(q[1])}`;
      })
      .join(" L")
  );
}

/** A dot at (u, v, z) around `o`. */
function Dot({
  o,
  at,
  r,
  fill,
}: {
  o: Point;
  at: readonly [number, number, number];
  r: number;
  fill: string;
}) {
  const q = pt(o, at[0], at[1], at[2]);
  return <circle cx={f1(q[0])} cy={f1(q[1])} r={r} fill={fill} stroke="none" />;
}

type BoxProps = {
  o: Point;
  a: number;
  b: number;
  h: number;
  z: number;
  paint: Paint;
  /** Face colors overriding the paint's (left, right, top). */
  fills?: { left?: string; right?: string; top?: string };
  sw?: number;
};

/** A box: left, right, then top face. */
function Box({ o, a, b, h, z, paint, fills, sw }: BoxProps) {
  const g = boxFaces(o, a, b, h, z);
  return (
    <>
      <polygon points={g.left} fill={fills?.left ?? paint.left} strokeWidth={sw} />
      <polygon points={g.right} fill={fills?.right ?? paint.right} strokeWidth={sw} />
      <polygon points={g.top} fill={fills?.top ?? paint.top} strokeWidth={sw} />
    </>
  );
}

/** A cylinder standing on the ground point (x, y): the elliptical projection of a circle. */
function Cylinder({
  x,
  y,
  rx,
  ry,
  h,
  paint,
}: {
  x: number;
  y: number;
  rx: number;
  ry: number;
  h: number;
  paint: Paint;
}) {
  const [xl, xr, yt] = [f1(x - rx), f1(x + rx), f1(y - h)];
  return (
    <>
      <path
        d={`M${xl} ${f1(y)} A${rx} ${ry} 0 0 0 ${xr} ${f1(y)} L${xr} ${yt} L${xl} ${yt} Z`}
        fill={paint.left}
      />
      <path
        d={`M${f1(x)} ${f1(y + ry)} A${rx} ${ry} 0 0 0 ${xr} ${f1(y)} L${xr} ${yt} L${f1(x)} ${yt} Z`}
        fill={paint.right}
        stroke="none"
      />
      <path d={`M${xl} ${f1(y)} A${rx} ${ry} 0 0 0 ${xr} ${f1(y)}`} />
      <ellipse cx={f1(x)} cy={yt} rx={rx} ry={ry} fill={paint.top} />
    </>
  );
}

/** A convex or star-shaped outline in (u, v), counter-clockwise. */
type Outline = readonly (readonly [number, number])[];

/** An extruded outline between heights z0 and z1: the viewer-facing sides back to front, then the top. */
function Prism({
  o,
  outline,
  z0,
  z1,
  paint,
}: {
  o: Point;
  outline: Outline;
  z0: number;
  z1: number;
  paint: Paint;
}) {
  const sides = outline
    .map((p, i) => {
      const q = outline[(i + 1) % outline.length];
      const [du, dv] = [q[0] - p[0], q[1] - p[1]];
      // The outward normal of a counter-clockwise outline is (dv, -du); the viewer looks along -(1, 1).
      return { p, q, nu: dv, nv: -du, depth: p[0] + q[0] + p[1] + q[1] };
    })
    .filter((s) => s.nu + s.nv > 0)
    .sort((a, b) => a.depth - b.depth);
  return (
    <>
      {sides.map((s, i) => (
        <polygon
          key={i}
          points={quad([
            pt(o, s.p[0], s.p[1], z0),
            pt(o, s.q[0], s.q[1], z0),
            pt(o, s.q[0], s.q[1], z1),
            pt(o, s.p[0], s.p[1], z1),
          ])}
          fill={s.nu > s.nv ? paint.right : paint.left}
        />
      ))}
      <polygon points={quad(outline.map((p) => pt(o, p[0], p[1], z1)))} fill={paint.top} />
    </>
  );
}

/** A gear outline: `teeth` teeth between the root and the outer radius. */
function gear(teeth: number, outer: number, root: number): Outline {
  const step = (2 * Math.PI) / teeth;
  const out: [number, number][] = [];
  for (let i = 0; i < teeth; i++) {
    for (const [d, r] of [
      [-0.24, root],
      [-0.13, outer],
      [0.13, outer],
      [0.24, root],
    ] as const) {
      const t = (i + d) * step;
      out.push([r * Math.cos(t), r * Math.sin(t)]);
    }
  }
  return out;
}

function circle(r: number, n = 14): Outline {
  return Array.from({ length: n }, (_, i) => {
    const t = (2 * Math.PI * i) / n;
    return [r * Math.cos(t), r * Math.sin(t)] as const;
  });
}

/* ---------- the eight models of the mockup ---------- */

function Client({ p }: { p: Paint }) {
  const c2 = pt(C, 0, -15, 0);
  const pc = pt(C, 31, 14, 0);
  const scr = boxFaces(c2, 24, 1.5, 30, 4);
  const ph = boxFaces(pc, 5, 9, 2.5, 0);
  return (
    <>
      <Box o={C} a={24} b={16} h={4} z={0} paint={p} />
      <polygon points={tq(C, -20, 20, -10, 7, 4)} fill={p.left} strokeWidth={0.9} />
      <polygon points={tq(C, -6, 6, 9, 14, 4)} fill={p.right} strokeWidth={0.9} />
      <polygon points={scr.right} fill={p.right} />
      <polygon points={scr.top} fill={p.top} />
      <polygon points={scr.left} fill={p.left} />
      <polygon points={lq(c2, 1.5, -20, 20, 8, 30)} fill={SCREEN} strokeWidth={0.9} />
      <polygon points={lq(c2, 1.5, -16, 8, 24, 27)} fill={DETAIL} stroke="none" />
      <polygon
        points={lq(c2, 1.5, -16, 14, 18, 21)}
        fill={STROKE}
        fillOpacity={0.25}
        stroke="none"
      />
      <polygon
        points={lq(c2, 1.5, -16, 0, 12, 15)}
        fill={STROKE}
        fillOpacity={0.25}
        stroke="none"
      />
      <polygon points={ph.left} fill={p.left} />
      <polygon points={ph.right} fill={p.right} />
      <polygon points={ph.top} fill={p.top} />
      <polygon points={tq(pc, -3.5, 3.5, -7, 7, 2.5)} fill={SCREEN} strokeWidth={0.9} />
    </>
  );
}

function Cdn({ p }: { p: Paint }) {
  const tR = pt(C, 26, -26, 0);
  const tL = pt(C, -26, 26, 0);
  const tF = pt(C, 26, 26, 0);
  return (
    <>
      <Box o={tR} a={4} b={4} h={14} z={0} paint={p} />
      <Dot o={tR} at={[0, 0, 19]} r={2.6} fill={DETAIL} />
      <Box o={tL} a={4} b={4} h={14} z={0} paint={p} />
      <Dot o={tL} at={[0, 0, 19]} r={2.6} fill={DETAIL} />
      <Box o={C} a={16} b={16} h={10} z={0} paint={p} />
      <circle cx={80} cy={72} r={22} fill={p.top} />
      <path d="M80 50 A22 22 0 0 1 80 94 Z" fill={p.right} fillOpacity={0.45} stroke="none" />
      <ellipse cx={80} cy={72} rx={9} ry={22} strokeWidth={1} />
      <ellipse cx={80} cy={72} rx={22} ry={6.5} strokeWidth={1} />
      <path d="M62 60 Q80 54 98 60 M62 84 Q80 90 98 84" strokeWidth={1} />
      <circle cx={80} cy={72} r={22} />
      <Box o={tF} a={4} b={4} h={14} z={0} paint={p} />
      <Dot o={tF} at={[0, 0, 19]} r={2.6} fill={DETAIL} />
    </>
  );
}

function Lb({ p }: { p: Paint }) {
  const vents = [-20, -12, -4, 4, 12]
    .map((u) =>
      seg(C, [
        [u, 22, 3],
        [u, 22, 9],
      ]),
    )
    .join(" ");
  const arrows = [
    seg(C, [
      [-24, 0, 12],
      [-6, 0, 12],
    ]),
    seg(C, [
      [-6, 0, 12],
      [20, -14, 12],
    ]),
    seg(C, [
      [-6, 0, 12],
      [20, 0, 12],
    ]),
    seg(C, [
      [-6, 0, 12],
      [20, 14, 12],
    ]),
  ].join(" ");
  return (
    <>
      <Box o={C} a={30} b={22} h={12} z={0} paint={p} />
      <path d={vents} strokeWidth={1} />
      <polygon points={rq(C, 30, 17, 11, 3, 8)} fill={STROKE} stroke="none" />
      <polygon points={rq(C, 30, 3, -3, 3, 8)} fill={STROKE} stroke="none" />
      <polygon points={rq(C, 30, -11, -17, 3, 8)} fill={STROKE} stroke="none" />
      <path d={arrows} stroke={DETAIL} strokeWidth={2.4} strokeLinecap="round" />
      <Dot o={C} at={[-24, 0, 12]} r={3.2} fill={DETAIL} />
      <Dot o={C} at={[20, -14, 12]} r={2.6} fill={DETAIL} />
      <Dot o={C} at={[20, 0, 12]} r={2.6} fill={DETAIL} />
      <Dot o={C} at={[20, 14, 12]} r={2.6} fill={DETAIL} />
    </>
  );
}

function Api({ p }: { p: Paint }) {
  return (
    <>
      {[0, 1, 2].map((k) => {
        const z = k * 12;
        const lines =
          seg(C, [
            [-18, 16, z + 4],
            [6, 16, z + 4],
          ]) +
          " " +
          seg(C, [
            [-18, 16, z + 7.5],
            [6, 16, z + 7.5],
          ]);
        return (
          <g key={k}>
            <Box o={C} a={22} b={16} h={11} z={z} paint={p} />
            <path d={lines} strokeWidth={1} />
            <Dot o={C} at={[12, 16, z + 5.5]} r={1.9} fill={OK} />
            <Dot o={C} at={[17.5, 16, z + 5.5]} r={1.9} fill={DETAIL} />
          </g>
        );
      })}
      <path
        d={
          seg(C, [
            [-12, -4, 35],
            [12, -4, 35],
          ]) +
          " " +
          seg(C, [
            [-12, 4, 35],
            [6, 4, 35],
          ])
        }
        stroke={DETAIL}
        strokeWidth={1.6}
        strokeLinecap="round"
      />
    </>
  );
}

function Cache({ p }: { p: Paint }) {
  const k1 = pt(C, 0, -5, 0);
  const k2 = pt(C, 0, 7, 0);
  const chip = chipOf(p);
  const stick = (k: Point) => {
    const s = boxFaces(k, 30, 2, 20, 3);
    return (
      <>
        <polygon points={s.right} fill={p.right} />
        <polygon points={s.top} fill={p.top} />
        <polygon points={s.left} fill={p.top} />
        <polygon points={lq(k, 2, -28, 28, 4, 7)} fill={GOLD} stroke="none" />
        {[
          [-27, -16],
          [-12, -1],
          [3, 14],
          [18, 28],
        ].map(([u0, u1]) => (
          <polygon key={u0} points={lq(k, 2, u0, u1, 10, 19)} fill={chip} stroke="none" />
        ))}
      </>
    );
  };
  return (
    <>
      <Box o={C} a={34} b={14} h={3} z={0} paint={p} fills={{ left: p.right, top: p.left }} />
      {stick(k1)}
      {stick(k2)}
      <path d="M86 30 L73 48 H81 L77 62 L91 42 H83 Z" fill={DETAIL} />
    </>
  );
}

function Db({ p, replica }: { p: Paint; replica: boolean }) {
  const h = replica ? 30 : 46;
  const ty = 104 - h;
  const band = (k: number) =>
    `M50 ${f1(104 - (h * k) / 3)} A30 17 0 0 0 110 ${f1(104 - (h * k) / 3)}`;
  return (
    <>
      <path d={`M50 104 A30 17 0 0 0 110 104 L110 ${ty} L50 ${ty} Z`} fill={p.left} />
      <path
        d={`M80 121 A30 17 0 0 0 110 104 L110 ${ty} L80 ${ty} Z`}
        fill={p.right}
        stroke="none"
      />
      <path d="M50 104 A30 17 0 0 0 110 104" />
      <path d={`${band(1)} ${band(2)}`} strokeWidth={1} />
      <ellipse cx={80} cy={ty} rx={30} ry={17} fill={p.top} />
      <ellipse
        cx={80}
        cy={ty}
        rx={17}
        ry={9.6}
        strokeWidth={1}
        strokeDasharray={replica ? "3 3" : undefined}
      />
      <circle cx={61} cy={f1(104 - h / 6 + 10)} r={2} fill={OK} stroke="none" />
      <circle cx={61} cy={f1(104 - h / 2 + 10)} r={2} fill={DETAIL} stroke="none" />
    </>
  );
}

function Queue({ p }: { p: Paint }) {
  const rollers = [-24, -12, 0, 12, 24]
    .map((u) =>
      seg(C, [
        [u, 10, 1.5],
        [u, 10, 4.5],
      ]),
    )
    .join(" ");
  return (
    <>
      <Box o={pt(C, -35, 0, 0)} a={2.5} b={12} h={16} z={0} paint={p} />
      <Box o={C} a={33} b={10} h={6} z={0} paint={p} />
      <path d={rollers} strokeWidth={1} />
      <g className="iso-motion iso-conv">
        {[-26, -10, 6, 22].map((u) => (
          <Box
            key={u}
            o={pt(C, u, 0, 6)}
            a={4.5}
            b={4.5}
            h={8}
            z={0}
            paint={p}
            fills={{ left: DETAIL, top: SCREEN }}
          />
        ))}
      </g>
      <Box o={pt(C, 35, 0, 0)} a={2.5} b={12} h={16} z={0} paint={p} />
    </>
  );
}

/* ---------- the seven extras, drawn in the same style ---------- */

/** dns: a signpost with two boards, each pointing the way to a record. */
function Dns({ p }: { p: Paint }) {
  const oA = pt(C, 8, 4, 0);
  const oB = pt(C, -8, 4, 0);
  return (
    <>
      <Box o={C} a={16} b={14} h={4} z={0} paint={p} />
      <Box o={C} a={3} b={3} h={42} z={4} paint={p} />
      <Box o={oB} a={20} b={2} h={10} z={16} paint={p} />
      <polygon
        points={quad([pt(oB, -20, 2, 16), pt(oB, -20, 2, 26), pt(oB, -28, 2, 21)])}
        fill={p.left}
      />
      <path
        d={seg(oB, [
          [-14, 2, 21],
          [8, 2, 21],
        ])}
        strokeWidth={1}
      />
      <Dot o={oB} at={[15, 2, 21]} r={2} fill={OK} />
      <Box o={oA} a={22} b={2} h={10} z={30} paint={p} />
      <polygon
        points={quad([pt(oA, 22, 2, 30), pt(oA, 22, 2, 40), pt(oA, 30, 2, 35)])}
        fill={p.left}
      />
      <path
        d={
          seg(oA, [
            [-12, 2, 32.5],
            [12, 2, 32.5],
          ]) +
          " " +
          seg(oA, [
            [-12, 2, 37],
            [4, 2, 37],
          ])
        }
        strokeWidth={1}
      />
      <Dot o={oA} at={[-17, 2, 35]} r={2} fill={DETAIL} />
    </>
  );
}

/** gateway: a portal of two pillars and a lintel, a portcullis between them. */
function Gateway({ p }: { p: Paint }) {
  const bars = [-12, -4, 4, 12]
    .map((u) =>
      seg(C, [
        [u, 0, 1],
        [u, 0, 36],
      ]),
    )
    .join(" ");
  return (
    <>
      <Box o={pt(C, -24, 0, 0)} a={7} b={10} h={36} z={0} paint={p} />
      <path d={bars} strokeWidth={1} />
      <Box o={pt(C, 24, 0, 0)} a={7} b={10} h={36} z={0} paint={p} />
      <Box o={C} a={34} b={10} h={9} z={36} paint={p} />
      <polygon points={lq(C, 10, -7, 7, 38, 43)} fill={DETAIL} stroke="none" />
      <Dot o={C} at={[24, 10, 26]} r={2} fill={OK} />
    </>
  );
}

/** worker: two server blades with a gear turning on top. */
function Worker({ p }: { p: Paint }) {
  const blade = (z: number) => (
    <>
      <Box o={C} a={28} b={22} h={8} z={z} paint={p} />
      <path
        d={seg(C, [
          [-22, 22, z + 4],
          [8, 22, z + 4],
        ])}
        strokeWidth={1}
      />
      <Dot o={C} at={[17, 22, z + 4]} r={1.9} fill={OK} />
      <Dot o={C} at={[22.5, 22, z + 4]} r={1.9} fill={DETAIL} />
    </>
  );
  return (
    <>
      {blade(0)}
      {blade(8)}
      <Prism o={C} outline={gear(10, 18, 14.5)} z0={16} z1={23} paint={p} />
      <polygon
        points={quad(circle(5.5).map((q) => pt(C, q[0], q[1], 23)))}
        fill={p.right}
        strokeWidth={1}
      />
      <Dot o={C} at={[0, 0, 23]} r={2} fill={DETAIL} />
    </>
  );
}

/** bucket: an open-top, tapered bucket with a handle, a label and objects inside. */
function Bucket({ p }: { p: Paint }) {
  const objA = pt(C, -6, 2, 0);
  const objB = pt(C, 6, -3, 0);
  const objFills = { left: DETAIL, top: SCREEN };
  return (
    <>
      <path d="M54 66 C50 20 110 20 106 66" fill="none" stroke={DETAIL} strokeWidth={2.4} />
      <path d="M53 64 L60 104 A20 11.5 0 0 0 100 104 L107 64 Z" fill={p.left} />
      <path d="M80 115.5 A20 11.5 0 0 0 100 104 L107 64 L80 64 Z" fill={p.right} stroke="none" />
      <path d="M53 64 L60 104 A20 11.5 0 0 0 100 104 L107 64" />
      <path
        d="M55.8 80 A24.2 13.9 0 0 0 104.2 80 M57.9 92 A22.1 12.7 0 0 0 102.1 92"
        strokeWidth={1}
      />
      <polygon points="70,83 90,83 90,95 70,95" fill={SCREEN} strokeWidth={0.9} />
      <path d="M73 87 H87 M73 91 H83" stroke={DETAIL} strokeWidth={1.2} strokeLinecap="round" />
      <ellipse cx={80} cy={64} rx={27} ry={15.5} fill={p.top} />
      <ellipse cx={80} cy={65} rx={23} ry={12.6} fill={p.right} strokeWidth={1} />
      <Box o={objA} a={5} b={5} h={7} z={39} paint={p} fills={objFills} />
      <Box o={objB} a={5} b={5} h={7} z={40} paint={p} fills={objFills} />
      <path d="M53 64 A27 15.5 0 0 0 107 64" />
    </>
  );
}

/** search: a magnifier standing on a low slab, result lines in the glass. */
function Search({ p }: { p: Paint }) {
  return (
    <>
      <Box o={C} a={26} b={16} h={5} z={0} paint={p} />
      <polygon points="79.5,76.5 95.5,92.5 100.5,87.5 84.5,71.5" fill={p.right} />
      <circle cx={68} cy={56} r={23} fill={p.left} />
      <circle cx={68} cy={56} r={17} fill={SCREEN} strokeWidth={1} />
      <path
        d="M57 50 A12 12 0 0 1 66 44"
        fill="none"
        stroke={p.top}
        strokeWidth={2}
        strokeLinecap="round"
      />
      <path d="M60 58 H78 M60 64 H72" stroke={DETAIL} strokeWidth={1.6} strokeLinecap="round" />
      <circle cx={78} cy={51} r={2.2} fill={DETAIL} stroke="none" />
    </>
  );
}

/** monitor: a wide screen on a stand, a chart line across it. */
function Monitor({ p }: { p: Paint }) {
  const chart = seg(C, [
    [-24, 2.5, 26],
    [-14, 2.5, 35],
    [-5, 2.5, 29],
    [5, 2.5, 41],
    [15, 2.5, 33],
    [24, 2.5, 40],
  ]);
  const grid = [28, 36]
    .map((z) =>
      seg(C, [
        [-28, 2.5, z],
        [28, 2.5, z],
      ]),
    )
    .join(" ");
  return (
    <>
      <Box o={C} a={13} b={10} h={3} z={0} paint={p} />
      <Box o={C} a={3} b={3} h={13} z={3} paint={p} />
      <Box o={C} a={32} b={2.5} h={34} z={16} paint={p} />
      <polygon points={lq(C, 2.5, -28, 28, 20, 46)} fill={SCREEN} strokeWidth={0.9} />
      <path d={grid} strokeWidth={0.8} strokeOpacity={0.25} />
      <path d={chart} fill="none" stroke={DETAIL} strokeWidth={1.8} strokeLinecap="round" />
      <Dot o={C} at={[24, 2.5, 40]} r={2.2} fill={DETAIL} />
      <Dot o={C} at={[26, 2.5, 18]} r={1.4} fill={OK} />
    </>
  );
}

/** control: a console with two dials on top and a row of faders on its face. */
function Control({ p }: { p: Paint }) {
  const d1 = pt(C, -14, -2, 14);
  const d2 = pt(C, 14, -2, 14);
  const pointer = (d: Point, u: number, v: number) => {
    const top = pt(d, 0, 0, 7);
    return seg(top, [
      [0, 0, 0],
      [u, v, 0],
    ]);
  };
  const handles = [4, 8, 5, 9, 3];
  return (
    <>
      <Box o={C} a={32} b={22} h={14} z={0} paint={p} />
      {[-24, -12, 0, 12, 24].map((u, i) => (
        <g key={u}>
          <path
            d={seg(C, [
              [u, 22, 2.5],
              [u, 22, 11.5],
            ])}
            strokeWidth={1}
          />
          <polygon
            points={lq(C, 22, u - 2.5, u + 2.5, handles[i], handles[i] + 3)}
            fill={DETAIL}
            strokeWidth={0.9}
          />
        </g>
      ))}
      <Cylinder x={d1[0]} y={d1[1]} rx={11} ry={6.4} h={7} paint={p} />
      <path d={pointer(d1, 6.5, -3)} stroke={DETAIL} strokeWidth={2.2} strokeLinecap="round" />
      <Cylinder x={d2[0]} y={d2[1]} rx={11} ry={6.4} h={7} paint={p} />
      <path d={pointer(d2, -3, -6.5)} stroke={DETAIL} strokeWidth={2.2} strokeLinecap="round" />
      <Dot o={C} at={[22, -12, 14]} r={1.8} fill={OK} />
    </>
  );
}

function Body({ archetype, p }: { archetype: IsoArchetype; p: Paint }): ReactNode {
  switch (archetype) {
    case "client":
      return <Client p={p} />;
    case "dns":
      return <Dns p={p} />;
    case "cdn":
      return <Cdn p={p} />;
    case "lb":
      return <Lb p={p} />;
    case "gateway":
      return <Gateway p={p} />;
    case "api":
      return <Api p={p} />;
    case "worker":
      return <Worker p={p} />;
    case "cache":
      return <Cache p={p} />;
    case "db":
      return <Db p={p} replica={false} />;
    case "replica":
      return <Db p={p} replica />;
    case "bucket":
      return <Bucket p={p} />;
    case "search":
      return <Search p={p} />;
    case "queue":
      return <Queue p={p} />;
    case "monitor":
      return <Monitor p={p} />;
    case "control":
      return <Control p={p} />;
  }
}

/** The slab every model stands on: z from -8 to 0, half-size 37. */
const SLAB = { a: 37, h: 8, z: -8 };

const SLAB_PAINT = {
  top: "var(--iso-slab-top)",
  left: "var(--iso-slab-left)",
  right: "var(--iso-slab-right)",
};

/** The ground shadow: the slab's base offset (3, 5), hard-edged. */
const SHADOW = quad(
  [
    pt(C, -SLAB.a, SLAB.a, SLAB.z),
    pt(C, SLAB.a, SLAB.a, SLAB.z),
    pt(C, SLAB.a, -SLAB.a, SLAB.z),
    pt(C, -SLAB.a, -SLAB.a, SLAB.z),
  ].map((q): [number, number] => [q[0] + 3, q[1] + 5]),
);

export function IsoModel({ archetype, tint, status, selected, className }: IsoModelProps) {
  const slab = boxFaces(C, SLAB.a, SLAB.a, SLAB.h, SLAB.z);
  const ring = diamond(46, 0);
  // Wider than the halo (the mockup draws both at 46), so a selected node with a status shows both.
  const selRing = diamond(51, 0);
  return (
    <svg
      className={className}
      viewBox="0 0 160 160"
      fill="none"
      aria-hidden="true"
      data-iso-kind={archetype}
      data-iso-tint={tint}
      style={{ overflow: "visible" }}
    >
      <polygon points={SHADOW} fill="var(--iso-shadow)" fillOpacity={0.9} />
      <g stroke={STROKE} strokeWidth={1.2} strokeLinejoin="round">
        <polygon points={slab.left} fill={SLAB_PAINT.left} />
        <polygon points={slab.right} fill={SLAB_PAINT.right} />
        <polygon points={slab.top} fill={SLAB_PAINT.top} />
      </g>
      {status && (
        <g data-iso-status={status} stroke={`var(--sf-${status})`}>
          <polygon className="iso-motion iso-halo" points={ring} strokeWidth={2.2} />
          <polygon points={diamond(41, 0)} strokeWidth={1.6} />
        </g>
      )}
      {selected && (
        <polygon
          className="iso-motion iso-dash"
          data-iso-selected=""
          points={selRing}
          stroke="var(--sf-accent)"
          strokeWidth={1.8}
          strokeDasharray="6 6"
        />
      )}
      <g stroke={STROKE} strokeWidth={1.3} strokeLinejoin="round">
        <Body archetype={archetype} p={paintOf(tint)} />
      </g>
    </svg>
  );
}
