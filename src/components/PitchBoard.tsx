"use client";

import type { Board, BoardPt, BoardTone } from "@/lib/types";
import { TONE } from "./Telestration";

// Top-down 2D tactics board. Board coords are 0-100 from the analysed team's
// view (y=0 own goal line); drawn on a 68×105 pitch with our goal at the bottom.
const W = 68;
const L = 105;
const px = (p: BoardPt) => ({ x: (p.x / 100) * W, y: L - (p.y / 100) * L });
const toneColor = (t: BoardTone) => (t === "none" ? "#ffffff" : TONE[t]);

interface Props {
  board: Board;
  usColor: string;
  themColor: string;
  showDistances: boolean; // only meaningful on a full-size 11v11 pitch
}

export function PitchBoard({ board, usColor, themColor, showDistances }: Props) {
  return (
    <svg viewBox={`-3 -3 ${W + 6} ${L + 6}`} className="h-full w-full" role="img" aria-label="2D tactics board">
      <defs>
        <pattern id="stripes" width={W} height={L / 10} patternUnits="userSpaceOnUse">
          <rect width={W} height={L / 20} fill="#2f7d32" />
          <rect y={L / 20} width={W} height={L / 20} fill="#2a722d" />
        </pattern>
      </defs>
      <rect x={-3} y={-3} width={W + 6} height={L + 6} rx={2} fill="#266a29" />
      <rect width={W} height={L} fill="url(#stripes)" />
      <PitchLines />

      {/* Zones */}
      {board.zones.map((z, i) => (
        <polygon
          key={`z${i}`}
          points={z.points.map((p) => `${px(p).x},${px(p).y}`).join(" ")}
          fill={toneColor(z.tone)}
          fillOpacity={0.28}
          stroke={toneColor(z.tone)}
          strokeWidth={0.35}
          strokeDasharray="1.2 0.8"
        />
      ))}

      {/* Our lines, with segment distances */}
      {board.lines.map((l, i) => {
        const pts = [...l.points].sort((a, b) => a.x - b.x).map(px);
        return (
          <g key={`l${i}`}>
            <polyline points={pts.map((p) => `${p.x},${p.y}`).join(" ")} fill="none" stroke="#0b0f17" strokeWidth={0.7} strokeLinejoin="round" />
            {showDistances &&
              pts.slice(1).map((p, j) => {
                const a = pts[j];
                const m = Math.hypot(p.x - a.x, p.y - a.y);
                if (m < 4) return null;
                return (
                  <g key={j} transform={`translate(${(a.x + p.x) / 2},${(a.y + p.y) / 2})`}>
                    <rect x={-3.2} y={-1.6} width={6.4} height={3.2} rx={1} fill="#0b0f17" />
                    <text textAnchor="middle" dy={1} fontSize={2.2} fontWeight={700} fill="#fff">
                      {Math.round(m)}m
                    </text>
                  </g>
                );
              })}
          </g>
        );
      })}

      {/* Arrows */}
      {board.arrows.map((a, i) => {
        const f = px(a.from);
        const t = px(a.to);
        const c = toneColor(a.tone);
        const dx = t.x - f.x;
        const dy = t.y - f.y;
        const len = Math.hypot(dx, dy) || 1;
        const ux = dx / len;
        const uy = dy / len;
        const s = 1.8;
        const bx = t.x - ux * s;
        const by = t.y - uy * s;
        return (
          <g key={`a${i}`}>
            <line x1={f.x} y1={f.y} x2={bx} y2={by} stroke={c} strokeWidth={0.55} strokeDasharray={a.tone === "good" ? "1.4 0.9" : undefined} />
            <polygon points={`${t.x},${t.y} ${bx - uy * s * 0.6},${by + ux * s * 0.6} ${bx + uy * s * 0.6},${by - ux * s * 0.6}`} fill={c} />
          </g>
        );
      })}

      {/* Players */}
      {board.players.map((p, i) => {
        const q = px(p);
        const fill = p.team === "us" ? usColor : themColor;
        return (
          <g key={`p${i}`}>
            {p.tone !== "none" && <circle cx={q.x} cy={q.y} r={2.6} fill="none" stroke={toneColor(p.tone)} strokeWidth={0.55} />}
            <circle cx={q.x} cy={q.y} r={1.6} fill={fill} stroke="#ffffff" strokeWidth={0.35} />
            {p.role && (p.tone !== "none" || p.role === "GK") && !crowded(board.players, i) && (
              <text x={q.x} y={q.y + 4.1} textAnchor="middle" fontSize={2.1} fontWeight={800} fill="#fff" stroke="#0b0f17" strokeWidth={0.5} paintOrder="stroke">
                {p.role}
              </text>
            )}
          </g>
        );
      })}

      {board.ball && (
        <circle cx={px(board.ball).x} cy={px(board.ball).y} r={0.9} fill="#fff" stroke="#0b0f17" strokeWidth={0.35} />
      )}
    </svg>
  );
}

// Skip a tag when an earlier tagged player sits right next to this one.
function crowded(players: Board["players"], i: number): boolean {
  const p = players[i];
  return players.slice(0, i).some((q) => q.role && Math.abs(q.x - p.x) < 6 && Math.abs(q.y - p.y) < 4);
}

function PitchLines() {
  const line = { fill: "none", stroke: "rgba(255,255,255,0.85)", strokeWidth: 0.3 };
  const box = (top: boolean) => {
    const y = top ? 0 : L;
    const s = top ? 1 : -1;
    return (
      <g>
        <rect x={(W - 40.32) / 2} y={top ? 0 : L - 16.5} width={40.32} height={16.5} {...line} />
        <rect x={(W - 18.32) / 2} y={top ? 0 : L - 5.5} width={18.32} height={5.5} {...line} />
        <circle cx={W / 2} cy={y + s * 11} r={0.35} fill="rgba(255,255,255,0.85)" />
        <path d={`M${W / 2 - 7.3},${y + s * 16.5} A9.15,9.15 0 0 ${top ? 0 : 1} ${W / 2 + 7.3},${y + s * 16.5}`} {...line} />
        <rect x={W / 2 - 3.66} y={top ? -1.6 : L} width={7.32} height={1.6} {...line} />
      </g>
    );
  };
  return (
    <g>
      <rect width={W} height={L} {...line} />
      <line x1={0} y1={L / 2} x2={W} y2={L / 2} {...line} />
      <circle cx={W / 2} cy={L / 2} r={9.15} {...line} />
      <circle cx={W / 2} cy={L / 2} r={0.35} fill="rgba(255,255,255,0.85)" />
      {box(true)}
      {box(false)}
    </g>
  );
}
