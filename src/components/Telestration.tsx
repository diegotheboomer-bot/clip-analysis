"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Box, Shape, Tone } from "@/lib/types";

// Draws Gemini's shapes over a frame or the paused video, broadcast-telestration
// style. Everything is laid out in pixels (the overlay measures itself), so
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
  compact?: boolean; // thumbnails: no labels
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

export function Telestration({ shapes, avoid = [], compact = false }: Props) {
  const [ref, { w, h }] = useSize<HTMLDivElement>();
  const X = (x: number) => (x / 1000) * w;
  const Y = (y: number) => (y / 1000) * h;
  const sw = Math.max(1.6, Math.min(4.5, h / (compact ? 120 : 210)));
  const font = Math.round(Math.max(11, Math.min(16, h / 38)));

  const labels = useMemo(
    () => (compact || !w ? [] : placeLabels(shapes, avoid, w, h, font)),
    [shapes, avoid, w, h, font, compact],
  );

  return (
    <div ref={ref} className="pointer-events-none absolute inset-0 overflow-hidden">
      {w > 0 && (
        <svg width={w} height={h} className="absolute inset-0">
          {shapes.map((s, i) => {
            const c = TONE[s.tone];
            const delay = { animationDelay: `${i * 130}ms` };

            if ((s.kind === "player" || s.kind === "ball") && s.box_2d) {
              const [y0, x0, y1, x1] = s.box_2d;
              const cx = X((x0 + x1) / 2);
              const bw = X(x1) - X(x0);
              if (s.kind === "ball") {
                const r = Math.max(bw * 0.9, 7);
                return (
                  <g key={i} className="tel-pop" style={delay}>
                    <circle cx={cx} cy={Y((y0 + y1) / 2)} r={r} fill="none" stroke={HALO} strokeWidth={sw + 3} />
                    <circle cx={cx} cy={Y((y0 + y1) / 2)} r={r} fill="none" stroke={c} strokeWidth={sw} />
                  </g>
                );
              }
              const rx = Math.max(bw * 0.95, 11);
              const ry = rx * 0.34;
              const cy = Y(y1);
              return (
                <g key={i} className="tel-pop" style={delay}>
                  <ellipse cx={cx} cy={cy} rx={rx} ry={ry} fill={c} fillOpacity={0.16} stroke={HALO} strokeWidth={sw + 3.5} />
                  <ellipse cx={cx} cy={cy} rx={rx} ry={ry} fill="none" stroke={c} strokeWidth={sw * 1.15} />
                  <ellipse cx={cx} cy={cy} rx={rx} ry={ry} fill="none" stroke={c} strokeWidth={sw * 0.6} className="tel-pulse" />
                </g>
              );
            }

            const pts = (s.points ?? []).map((p) => ({ x: X(p.x), y: Y(p.y) }));
            if (pts.length < 2) return null;

            if (s.kind === "arrow") {
              const { d, head } = curvedArrow(pts[0], pts[1], sw);
              const dashed = s.tone === "good";
              return (
                <g key={i} style={delay} className={dashed ? "tel-fade" : undefined}>
                  <path d={d} fill="none" stroke={HALO} strokeWidth={sw * 1.2 + 3} strokeLinecap="round" />
                  <path
                    d={d}
                    fill="none"
                    stroke={c}
                    strokeWidth={sw * 1.2}
                    strokeLinecap="round"
                    pathLength={dashed ? undefined : 1}
                    strokeDasharray={dashed ? `${sw * 3.2} ${sw * 2.4}` : undefined}
                    className={dashed ? "tel-march" : "tel-draw"}
                    style={delay}
                  />
                  <polygon points={head} fill={c} stroke={HALO} strokeWidth={1.5} className="tel-fade" style={{ animationDelay: `${i * 130 + 450}ms` }} />
                </g>
              );
            }

            const poly = pts.map((p) => `${p.x},${p.y}`).join(" ");
            if (s.kind === "line" || s.kind === "gap") {
              const gap = s.kind === "gap";
              return (
                <g key={i} className="tel-fade" style={delay}>
                  <polyline points={poly} fill="none" stroke={HALO} strokeWidth={sw + 3} strokeLinecap="round" strokeLinejoin="round" />
                  <polyline
                    points={poly}
                    fill="none"
                    stroke={gap ? "#ffffff" : c}
                    strokeWidth={gap ? sw * 0.8 : sw}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    pathLength={1}
                    className="tel-draw"
                    style={delay}
                  />
                  {pts.map((p, j) => (
                    <circle key={j} cx={p.x} cy={p.y} r={sw * 1.5} fill={gap ? "#ffffff" : c} stroke={HALO} strokeWidth={1.5} />
                  ))}
                </g>
              );
            }

            // zone
            return (
              <g key={i} className="tel-fade" style={delay}>
                <polygon points={poly} fill={c} fillOpacity={0.18} stroke={HALO} strokeWidth={sw + 2} strokeLinejoin="round" />
                <polygon points={poly} fill="none" stroke={c} strokeWidth={sw * 0.8} strokeDasharray={`${sw * 3} ${sw * 2}`} strokeLinejoin="round" />
              </g>
            );
          })}

          {/* Leader lines from labels to their targets */}
          {labels.map((l, i) =>
            l && l.leader ? (
              <g key={`ld${i}`} className="tel-fade" style={{ animationDelay: `${i * 130 + 250}ms` }}>
                <line x1={l.leader.x1} y1={l.leader.y1} x2={l.leader.x2} y2={l.leader.y2} stroke={HALO} strokeWidth={3} />
                <line x1={l.leader.x1} y1={l.leader.y1} x2={l.leader.x2} y2={l.leader.y2} stroke={TONE[shapes[i].tone]} strokeWidth={1.4} />
                <circle cx={l.leader.x2} cy={l.leader.y2} r={2.4} fill={TONE[shapes[i].tone]} />
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
            className="tel-fade absolute flex items-center gap-1.5 whitespace-nowrap rounded-md border border-white/10 px-2 font-bold leading-none shadow-lg shadow-black/40 backdrop-blur-sm"
            style={{
              left: l.rect.x,
              top: l.rect.y,
              height: l.rect.h,
              fontSize: font,
              background: "rgba(8,12,20,0.86)",
              color: gap ? "#fff" : "#f4f6fa",
              animationDelay: `${i * 130 + 250}ms`,
            }}
          >
            {!gap && <span className="h-2 w-2 shrink-0 rounded-sm" style={{ background: TONE[s.tone] }} />}
            {s.label}
          </span>
        );
      })}
    </div>
  );
}

// Gentle curve from a to b, with a solid arrowhead at b.
function curvedArrow(a: { x: number; y: number }, b: { x: number; y: number }, sw: number) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  const bend = Math.min(len * 0.14, 40);
  const cx = (a.x + b.x) / 2 - (dy / len) * bend;
  const cy = (a.y + b.y) / 2 + (dx / len) * bend;
  const tx = b.x - cx;
  const ty = b.y - cy;
  const tl = Math.hypot(tx, ty) || 1;
  const ux = tx / tl;
  const uy = ty / tl;
  const size = Math.max(9, sw * 4);
  const bx = b.x - ux * size;
  const by = b.y - uy * size;
  const head = `${b.x},${b.y} ${bx - uy * size * 0.55},${by + ux * size * 0.55} ${bx + uy * size * 0.55},${by - ux * size * 0.55}`;
  // stop the shaft at the arrowhead's base
  return { d: `M${a.x},${a.y} Q${cx},${cy} ${bx},${by}`, head };
}

// ── Label placement ────────────────────────────────────────────────────────

let measureCtx: CanvasRenderingContext2D | null = null;
function textWidth(text: string, font: number): number {
  if (typeof document === "undefined") return text.length * font * 0.6;
  measureCtx ??= document.createElement("canvas").getContext("2d");
  if (!measureCtx) return text.length * font * 0.6;
  measureCtx.font = `700 ${font}px ui-sans-serif, system-ui, sans-serif`;
  return measureCtx.measureText(text).width;
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
    ...shapes.filter((s) => s.box_2d).map((s) => boxRect(s.box_2d as Box, 6)),
  ];
  const placed: Rect[] = [];
  const lh = Math.round(font * 1.75);

  return shapes.map((s) => {
    if (!s.label) return null;
    const lw = textWidth(s.label, font) + (s.kind === "gap" ? 16 : 26);

    // Anchor point the label refers to.
    let ax: number;
    let ay: number;
    if (s.box_2d) {
      const [y0, x0, , x1] = s.box_2d;
      ax = X((x0 + x1) / 2);
      ay = Y(y0);
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
