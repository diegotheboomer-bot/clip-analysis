"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { Box, Shape, Tone } from "@/lib/types";

// Draws Gemini's shapes over a frame or the paused video, in a modern
// broadcast-telestration style (glowing rings, tapered arrows, hatched zones). Everything is laid out in pixels (the overlay measures itself), so
// rings stay round and labels can be placed in clear space: each label tries a
// ring of positions around its target and takes the one that covers the fewest
// players / the ball / other labels, joined back by a thin leader line.

export const TONE: Record<Tone, string> = {
  error: "#ff4d5e",
  good: "#22e39a",
  info: "#ffd23f",
};
const HALO = "rgba(5,8,14,0.6)";

interface Props {
  shapes: Shape[];
  avoid?: Box[];
  compact?: boolean; // thumbnails: thinner, no labels
  labels?: boolean;
}

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

function useSize<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setSize({ w: e.contentRect.width, h: e.contentRect.height }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, size] as const;
}

export function Telestration({ shapes, avoid = [], compact = false, labels: showLabels = true }: Props) {
  const [ref, { w, h }] = useSize<HTMLDivElement>();
  const uid = useId().replace(/:/g, "");
  const X = (x: number) => (x / 1000) * w;
  const Y = (y: number) => (y / 1000) * h;
  const sw = Math.max(1.4, Math.min(3.4, h / (compact ? 120 : 240)));
  const font = Math.round(Math.max(10, Math.min(13, h / 56)));

  const labels = useMemo(
    () => (compact || !showLabels || !w ? [] : placeLabels(shapes, avoid, w, h, font)),
    [shapes, avoid, w, h, font, compact, showLabels],
  );
  const glow = `url(#glow-${uid})`;

  return (
    <div ref={ref} className="pointer-events-none absolute inset-0 overflow-hidden">
      {w > 0 && (
        <svg width={w} height={h} className="absolute inset-0">
          <defs>
            <filter id={`glow-${uid}`} x="-50%" y="-50%" width="200%" height="200%">
              <feGaussianBlur stdDeviation={sw * 1.6} />
            </filter>
            {(Object.keys(TONE) as Tone[]).map((t) => (
              <pattern key={t} id={`hatch-${t}-${uid}`} width={sw * 4} height={sw * 4} patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                <rect width={sw * 4} height={sw * 4} fill={TONE[t]} fillOpacity={0.08} />
                <line x1={0} y1={0} x2={0} y2={sw * 4} stroke={TONE[t]} strokeOpacity={0.45} strokeWidth={sw * 0.9} />
              </pattern>
            ))}
          </defs>

          {shapes.map((s, i) => {
            const c = TONE[s.tone];
            const delay = { animationDelay: `${i * 140}ms` };

            // ── Player: glowing ring at the feet + marker above the head
            if ((s.kind === "player" || s.kind === "ball") && s.box_2d) {
              const [y0, x0, y1, x1] = s.box_2d;
              const cx = X((x0 + x1) / 2);
              const bw = X(x1) - X(x0);
              if (s.kind === "ball") {
                const cy = Y((y0 + y1) / 2);
                const r = Math.max(bw * 0.95, 7);
                return (
                  <g key={i} className="tel-pop" style={delay}>
                    <circle cx={cx} cy={cy} r={r * 1.2} fill={c} fillOpacity={0.35} filter={glow} />
                    <circle cx={cx} cy={cy} r={r} fill="none" stroke={HALO} strokeWidth={sw + 2.5} />
                    <circle cx={cx} cy={cy} r={r} fill="none" stroke={c} strokeWidth={sw} />
                  </g>
                );
              }
              const rx = Math.max(bw * 0.75, 10);
              const ry = rx * 0.32;
              const cy = Y(y1);
              const m = Math.max(5, sw * 2.6); // head marker size
              const my = Y(y0) - m * 0.9;
              return (
                <g key={i} className="tel-pop" style={delay}>
                  <ellipse cx={cx} cy={cy} rx={rx * 1.15} ry={ry * 1.15} fill={c} fillOpacity={0.32} filter={glow} />
                  <ellipse cx={cx} cy={cy} rx={rx} ry={ry} fill="none" stroke={HALO} strokeWidth={sw + 2.5} />
                  <ellipse cx={cx} cy={cy} rx={rx} ry={ry} fill="none" stroke={c} strokeWidth={sw * 1.1} />
                  <ellipse cx={cx} cy={cy} rx={rx * 0.6} ry={ry * 0.6} fill="none" stroke="#ffffff" strokeOpacity={0.55} strokeWidth={Math.max(1, sw * 0.45)} />
                  <path d={`M${cx - m * 0.7},${my - m} L${cx + m * 0.7},${my - m} L${cx},${my} Z`} fill={c} stroke={HALO} strokeWidth={1.5} strokeLinejoin="round" />
                </g>
              );
            }

            const pts = (s.points ?? []).map((p) => ({ x: X(p.x), y: Y(p.y) }));
            if (pts.length < 2) return null;

            // ── Arrow: tapered, fading in along its path (dashed = should have)
            if (s.kind === "arrow") {
              const a = arrowGeometry(pts[0], pts[1], sw);
              const gid = `grad-${i}-${uid}`;
              const dashed = s.tone === "good";
              return (
                <g key={i} className="tel-fade" style={delay}>
                  <defs>
                    <linearGradient id={gid} gradientUnits="userSpaceOnUse" x1={pts[0].x} y1={pts[0].y} x2={a.base.x} y2={a.base.y}>
                      <stop offset="0" stopColor={c} stopOpacity={0.35} />
                      <stop offset="1" stopColor={c} stopOpacity={1} />
                    </linearGradient>
                  </defs>
                  {dashed ? (
                    <>
                      <path d={a.centre} fill="none" stroke={HALO} strokeWidth={sw * 1.5 + 2} strokeLinecap="round" strokeDasharray={`${sw * 3} ${sw * 2.2}`} className="tel-march" style={delay} />
                      <path d={a.centre} fill="none" stroke={`url(#${gid})`} strokeWidth={sw * 1.5} strokeLinecap="round" strokeDasharray={`${sw * 3} ${sw * 2.2}`} className="tel-march" style={delay} />
                    </>
                  ) : (
                    <>
                      <path d={a.body} fill={c} fillOpacity={0.4} filter={glow} />
                      <path d={a.body} fill={`url(#${gid})`} stroke={HALO} strokeWidth={0.8} />
                    </>
                  )}
                  <path d={a.head} fill={c} stroke={HALO} strokeWidth={1.5} strokeLinejoin="round" />
                </g>
              );
            }

            const poly = pts.map((p) => `${p.x},${p.y}`).join(" ");

            // ── Line: glowing line through the players' feet
            if (s.kind === "line") {
              return (
                <g key={i} className="tel-fade" style={delay}>
                  <polyline points={poly} fill="none" stroke={c} strokeOpacity={0.55} strokeWidth={sw * 3} strokeLinecap="round" strokeLinejoin="round" filter={glow} />
                  <polyline points={poly} fill="none" stroke={c} strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" pathLength={1} className="tel-draw" style={delay} />
                  {pts.map((p, j) => (
                    <circle key={j} cx={p.x} cy={p.y} r={sw * 1.9} fill="#0a0e16" stroke={c} strokeWidth={sw * 0.9} />
                  ))}
                </g>
              );
            }

            // ── Gap: white dashed span with end ticks
            if (s.kind === "gap") {
              const [a, b] = pts;
              const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
              const nx = (-(b.y - a.y) / len) * sw * 3;
              const ny = ((b.x - a.x) / len) * sw * 3;
              return (
                <g key={i} className="tel-fade" style={delay}>
                  <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={HALO} strokeWidth={sw + 2.5} strokeLinecap="round" />
                  <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="#ffffff" strokeWidth={sw * 0.9} strokeDasharray={`${sw * 2.5} ${sw * 1.8}`} strokeLinecap="round" />
                  {[a, b].map((p, j) => (
                    <line key={j} x1={p.x - nx} y1={p.y - ny} x2={p.x + nx} y2={p.y + ny} stroke="#ffffff" strokeWidth={sw} strokeLinecap="round" />
                  ))}
                </g>
              );
            }

            // ── Zone: hatched danger area
            return (
              <g key={i} className="tel-fade" style={delay}>
                <polygon points={poly} fill={`url(#hatch-${s.tone}-${uid})`} />
                <polygon points={poly} fill="none" stroke={c} strokeOpacity={0.9} strokeWidth={sw * 0.8} strokeDasharray={`${sw * 3} ${sw * 2}`} strokeLinejoin="round" />
              </g>
            );
          })}

          {/* Leader lines from labels to their targets */}
          {labels.map((l, i) =>
            l && l.leader ? (
              <g key={`ld${i}`} className="tel-fade" style={{ animationDelay: `${i * 140 + 250}ms` }}>
                <line x1={l.leader.x1} y1={l.leader.y1} x2={l.leader.x2} y2={l.leader.y2} stroke={HALO} strokeWidth={2.6} />
                <line x1={l.leader.x1} y1={l.leader.y1} x2={l.leader.x2} y2={l.leader.y2} stroke={TONE[shapes[i].tone]} strokeOpacity={0.9} strokeWidth={1.2} />
                <circle cx={l.leader.x2} cy={l.leader.y2} r={2.2} fill={TONE[shapes[i].tone]} />
              </g>
            ) : null,
          )}
        </svg>
      )}

      {labels.map((l, i) => {
        if (!l) return null;
        const s = shapes[i];
        const gap = s.kind === "gap";
        return (
          <span
            key={i}
            className="tel-fade absolute flex items-center whitespace-nowrap rounded-md font-bold uppercase leading-none tracking-[0.06em] shadow-lg shadow-black/40 backdrop-blur-sm"
            style={{
              left: l.rect.x,
              top: l.rect.y,
              height: l.rect.h,
              fontSize: font,
              padding: gap ? "0 6px" : "0 8px 0 7px",
              background: gap ? "rgba(255,255,255,0.92)" : "rgba(10,14,22,0.82)",
              color: gap ? "#0a0e16" : "#f4f6fa",
              borderLeft: gap ? undefined : `3px solid ${TONE[s.tone]}`,
              animationDelay: `${i * 140 + 250}ms`,
            }}
          >
            {s.label}
          </span>
        );
      })}
    </div>
  );
}

// A gently curved, tapered arrow from a to b: the body is a filled outline
// (thin at the start, thick near the head), plus a chevron arrowhead.
function arrowGeometry(a: { x: number; y: number }, b: { x: number; y: number }, sw: number) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  const bend = Math.min(len * 0.12, 36);
  const c = { x: (a.x + b.x) / 2 - (dy / len) * bend, y: (a.y + b.y) / 2 + (dx / len) * bend };
  const size = Math.max(12, sw * 5);
  const tl = Math.hypot(b.x - c.x, b.y - c.y) || 1;
  const ux = (b.x - c.x) / tl;
  const uy = (b.y - c.y) / tl;
  const base = { x: b.x - ux * size * 0.85, y: b.y - uy * size * 0.85 };

  // Sample the curve a → c → base and offset each side by a growing width.
  const q = (t: number) => ({
    x: (1 - t) ** 2 * a.x + 2 * (1 - t) * t * c.x + t * t * base.x,
    y: (1 - t) ** 2 * a.y + 2 * (1 - t) * t * c.y + t * t * base.y,
  });
  const N = 24;
  const left: string[] = [];
  const right: string[] = [];
  for (let k = 0; k <= N; k++) {
    const t = k / N;
    const p = q(t);
    const p2 = q(Math.min(1, t + 0.01));
    const p1 = q(Math.max(0, t - 0.01));
    const tx = p2.x - p1.x;
    const ty = p2.y - p1.y;
    const tn = Math.hypot(tx, ty) || 1;
    const half = sw * 0.4 + sw * 1.0 * t;
    left.push(`${p.x - (ty / tn) * half},${p.y + (tx / tn) * half}`);
    right.unshift(`${p.x + (ty / tn) * half},${p.y - (tx / tn) * half}`);
  }
  const wing = size * 0.62;
  const back = { x: b.x - ux * size, y: b.y - uy * size };
  const notch = { x: b.x - ux * size * 0.7, y: b.y - uy * size * 0.7 };
  return {
    base,
    centre: `M${a.x},${a.y} Q${c.x},${c.y} ${base.x},${base.y}`,
    body: `M${left.join(" L")} L${right.join(" L")} Z`,
    head: `M${b.x},${b.y} L${back.x - uy * wing},${back.y + ux * wing} L${notch.x},${notch.y} L${back.x + uy * wing},${back.y - ux * wing} Z`,
  };
}

// ── Label placement ────────────────────────────────────────────────────────

let measureCtx: CanvasRenderingContext2D | null = null;
function textWidth(text: string, font: number): number {
  if (typeof document === "undefined") return text.length * font * 0.6;
  measureCtx ??= document.createElement("canvas").getContext("2d");
  if (!measureCtx) return text.length * font * 0.6;
  measureCtx.font = `700 ${font}px ui-sans-serif, system-ui, sans-serif`;
  // labels are uppercase with letter-spacing
  return measureCtx.measureText(text.toUpperCase()).width + text.length * font * 0.06;
}

const overlap = (a: Rect, b: Rect) =>
  Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));

interface Placed {
  rect: Rect;
  leader: { x1: number; y1: number; x2: number; y2: number } | null;
}

function placeLabels(shapes: Shape[], avoid: Box[], w: number, h: number, font: number): Array<Placed | null> {
  const X = (x: number) => (x / 1000) * w;
  const Y = (y: number) => (y / 1000) * h;
  const boxRect = ([y0, x0, y1, x1]: Box, pad: number): Rect => ({
    x: X(x0) - pad,
    y: Y(y0) - pad,
    w: X(x1) - X(x0) + pad * 2,
    h: Y(y1) - Y(y0) + pad * 2 + 4,
  });

  // Everything a label must not cover: every visible player + the ball, plus
  // the drawn rings.
  const obstacles: Rect[] = [
    ...avoid.map((b) => boxRect(b, 3)),
    ...shapes.filter((s) => s.box_2d).map((s) => {
      const r = boxRect(s.box_2d as Box, 6);
      const m = Math.max(14, h / 45); // keep the head marker clear too
      return { ...r, y: r.y - m, h: r.h + m };
    }),
  ];
  const placed: Rect[] = [];
  const lh = Math.round(font * 1.65);

  return shapes.map((s) => {
    if (!s.label) return null;
    const lw = textWidth(s.label, font) + (s.kind === "gap" ? 12 : 18);

    // Anchor point the label refers to.
    let ax: number;
    let ay: number;
    if (s.box_2d) {
      const [y0, x0, , x1] = s.box_2d;
      ax = X((x0 + x1) / 2);
      ay = Y(y0) - (s.kind === "player" ? Math.max(14, h / 45) : 0); // above the head marker
    } else {
      const p = (s.points ?? []).map((q) => ({ x: X(q.x), y: Y(q.y) }));
      if (p.length === 0) return null;
      if (s.kind === "arrow" && p.length >= 2) {
        ax = p[0].x + (p[1].x - p[0].x) * 0.55;
        ay = p[0].y + (p[1].y - p[0].y) * 0.55;
      } else if (s.kind === "gap" && p.length >= 2) {
        ax = (p[0].x + p[1].x) / 2;
        ay = (p[0].y + p[1].y) / 2;
      } else if (s.kind === "zone") {
        ax = p.reduce((a, q) => a + q.x, 0) / p.length;
        ay = p.reduce((a, q) => a + q.y, 0) / p.length;
      } else {
        ax = p[0].x;
        ay = p[0].y;
      }
    }

    // Candidate centres: on the anchor (gaps/zones only), then rings outward.
    const dists = s.kind === "gap" || s.kind === "zone" ? [0, 26, 48, 76] : [30, 52, 80, 115];
    const dirs = [
      [0, -1], [0.7, -0.7], [-0.7, -0.7], [1, 0], [-1, 0], [0.7, 0.7], [-0.7, 0.7], [0, 1],
    ];
    let best: { rect: Rect; score: number; d: number } | null = null;
    for (const d of dists) {
      for (const [dx, dy] of d === 0 ? [[0, 0]] : dirs) {
        const cx = ax + dx * (d + lw / 2 * Math.abs(dx));
        const cy = ay + dy * (d + lh / 2 * Math.abs(dy));
        const rect = { x: cx - lw / 2, y: cy - lh / 2, w: lw, h: lh };
        const out =
          Math.max(0, 6 - rect.x) + Math.max(0, rect.x + rect.w - (w - 6)) + Math.max(0, 6 - rect.y) + Math.max(0, rect.y + rect.h - (h - 6));
        const hitObs = obstacles.reduce((a, o) => a + overlap(rect, o), 0);
        const hitLab = placed.reduce((a, o) => a + overlap(rect, { x: o.x - 4, y: o.y - 4, w: o.w + 8, h: o.h + 8 }), 0);
        const score = hitObs * 4 + hitLab * 12 + out * 60 + d * 1.2 + (dy > 0 ? 18 : 0);
        if (!best || score < best.score) best = { rect, score, d };
      }
    }
    if (!best) return null;
    placed.push(best.rect);

    // Leader line from the label's nearest edge to the anchor.
    const r = best.rect;
    const nx = Math.max(r.x, Math.min(ax, r.x + r.w));
    const ny = Math.max(r.y, Math.min(ay, r.y + r.h));
    const leader = Math.hypot(nx - ax, ny - ay) > 8 ? { x1: nx, y1: ny, x2: ax, y2: ay } : null;
    return { rect: r, leader };
  });
}
