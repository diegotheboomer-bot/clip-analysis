"use client";

import type { Shape, Tone } from "@/lib/types";

// Draws Gemini's shapes over a frame or the paused video, TV-pundit style.
// Coordinates arrive on a 0-1000 scale per axis; the SVG viewBox is stretched
// to the media's aspect ratio so rings and arrowheads stay undistorted.

export const TONE: Record<Tone, string> = {
  error: "#ff4d5e",
  good: "#22e39a",
  info: "#ffd23f",
};

interface Props {
  shapes: Shape[];
  aspect: number; // width / height of the media underneath
  compact?: boolean; // thumbnails: thinner lines, no labels
}

export function Telestration({ shapes, aspect, compact = false }: Props) {
  const VW = 1000 * aspect;
  const X = (x: number) => (x / 1000) * VW;
  const sw = compact ? 7 : 5;

  return (
    <div className="pointer-events-none absolute inset-0">
      <svg viewBox={`0 0 ${VW} 1000`} className="absolute inset-0 h-full w-full" preserveAspectRatio="none">
        <defs>
          {(Object.keys(TONE) as Tone[]).map((t) => (
            <marker
              key={t}
              id={`head-${t}`}
              viewBox="0 0 10 10"
              refX="7"
              refY="5"
              markerWidth="4"
              markerHeight="4"
              orient="auto-start-reverse"
            >
              <path d="M0 0 L10 5 L0 10 z" fill={TONE[t]} />
            </marker>
          ))}
          {(Object.keys(TONE) as Tone[]).map((t) => (
            <linearGradient key={t} id={`beam-${t}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor={TONE[t]} stopOpacity="0" />
              <stop offset="1" stopColor={TONE[t]} stopOpacity="0.35" />
            </linearGradient>
          ))}
        </defs>

        {shapes.map((s, i) => {
          const c = TONE[s.tone];
          const delay = { animationDelay: `${i * 140}ms` };

          if ((s.kind === "player" || s.kind === "ball") && s.box_2d) {
            const [y0, x0, y1, x1] = s.box_2d;
            const cx = X((x0 + x1) / 2);
            const w = X(x1) - X(x0);
            if (s.kind === "ball") {
              return (
                <circle key={i} cx={cx} cy={(y0 + y1) / 2} r={Math.max(w * 0.9, 10)} fill="none" stroke={c} strokeWidth={sw} className="tel-pop" style={delay} />
              );
            }
            const rx = Math.max(w * 0.85, 16);
            return (
              <g key={i} className="tel-pop" style={delay}>
                <rect x={cx - rx * 0.75} y={y0 - 6} width={rx * 1.5} height={y1 - y0 + 6} rx={rx * 0.4} fill={`url(#beam-${s.tone})`} />
                <ellipse cx={cx} cy={y1} rx={rx} ry={rx * 0.32} fill={c} fillOpacity={0.18} stroke={c} strokeWidth={sw} />
                <ellipse cx={cx} cy={y1} rx={rx} ry={rx * 0.32} fill="none" stroke={c} strokeWidth={sw * 0.6} className="tel-pulse" />
              </g>
            );
          }

          const pts = (s.points ?? []).map((p) => `${X(p.x)},${p.y}`).join(" ");
          if (s.kind === "arrow") {
            const dashed = s.tone === "good";
            return (
              <polyline
                key={i}
                points={pts}
                fill="none"
                stroke={c}
                strokeWidth={sw * 1.1}
                strokeLinecap="round"
                markerEnd={`url(#head-${s.tone})`}
                pathLength={dashed ? undefined : 1}
                strokeDasharray={dashed ? "16 12" : undefined}
                className={dashed ? "tel-march" : "tel-draw"}
                style={delay}
              />
            );
          }
          if (s.kind === "line") {
            return (
              <g key={i} className="tel-fade" style={delay}>
                <polyline points={pts} fill="none" stroke={c} strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" pathLength={1} className="tel-draw" style={delay} />
                {(s.points ?? []).map((p, j) => (
                  <circle key={j} cx={X(p.x)} cy={p.y} r={sw * 1.3} fill={c} />
                ))}
              </g>
            );
          }
          // zone
          return (
            <polygon key={i} points={pts} fill={c} fillOpacity={0.2} stroke={c} strokeWidth={sw * 0.8} strokeDasharray="12 9" strokeLinejoin="round" className="tel-fade" style={delay} />
          );
        })}
      </svg>

      {!compact &&
        placeLabels(shapes).map((at, i) => {
          const s = shapes[i];
          if (!at || !s.label) return null;
          return (
            <span
              key={i}
              className="tel-fade absolute -translate-x-1/2 -translate-y-full whitespace-nowrap rounded-md px-1.5 py-0.5 text-[11px] font-extrabold leading-tight text-black shadow-lg shadow-black/40"
              style={{ left: `${at.x / 10}%`, top: `${at.y / 10}%`, background: TONE[s.tone], animationDelay: `${i * 140 + 200}ms` }}
            >
              {s.label}
            </span>
          );
        })}
    </div>
  );
}

// Anchor every label, then nudge any that would collide upwards so labels on
// players standing close together don't sit on top of each other.
function placeLabels(shapes: Shape[]): Array<{ x: number; y: number } | null> {
  const placed: Array<{ x: number; y: number; w: number }> = [];
  return shapes.map((s) => {
    const at = labelAnchor(s);
    if (!at || !s.label) return null;
    const w = s.label.length * 11 + 24; // rough width in 0-1000 units
    let y = at.y;
    for (let tries = 0; tries < 6; tries++) {
      const hit = placed.find((p) => Math.abs(p.x - at.x) < (p.w + w) / 2 && Math.abs(p.y - y) < 34);
      if (!hit) break;
      y = hit.y - 36;
    }
    y = Math.max(y, 30);
    placed.push({ x: at.x, y, w });
    return { x: at.x, y };
  });
}

// Where to pin a shape's label (0-1000 coords).
function labelAnchor(s: Shape): { x: number; y: number } | null {
  if (s.box_2d) {
    const [y0, x0, , x1] = s.box_2d;
    return { x: (x0 + x1) / 2, y: Math.max(y0 - 8, 30) };
  }
  const p = s.points ?? [];
  if (p.length === 0) return null;
  if (s.kind === "arrow" && p.length >= 2) return { x: (p[0].x + p[1].x) / 2, y: (p[0].y + p[1].y) / 2 - 10 };
  const cx = p.reduce((a, q) => a + q.x, 0) / p.length;
  const cy = p.reduce((a, q) => a + q.y, 0) / p.length;
  return s.kind === "zone" ? { x: cx, y: cy } : { x: p[0].x, y: Math.max(p[0].y - 12, 30) };
}
