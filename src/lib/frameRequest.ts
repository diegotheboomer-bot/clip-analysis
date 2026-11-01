import "server-only";
import type { Box, Detection } from "./types";

const MAX_IMAGE_CHARS = 4_000_000; // ~3 MB of base64 — keeps under Vercel's body cap

export const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");

// "data:image/jpeg;base64,…" → { mime, data }
export function parseFrame(v: unknown): { mime: string; data: string } | null {
  const m = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(str(v, MAX_IMAGE_CHARS + 100));
  return m && m[2].length <= MAX_IMAGE_CHARS ? { mime: m[1], data: m[2] } : null;
}

const box = (b: unknown): Box | null =>
  Array.isArray(b) && b.length === 4 && b.every((n) => Number.isFinite(n)) ? (b.map((n) => Math.max(0, Math.min(1000, n))) as Box) : null;

// A detection echoed back by the browser — re-validate it.
const xy = (v: unknown): [number, number] | undefined =>
  Array.isArray(v) && v.length === 2 && v.every((n) => Number.isFinite(n) && Math.abs(n) < 200) ? [v[0], v[1]] : undefined;

export function parseDetection(v: unknown): Detection {
  const d = (v ?? {}) as {
    ball?: unknown;
    ballPitch?: unknown;
    people?: Array<{ box?: unknown; team?: unknown; pitch?: unknown }>;
    calibration?: { points?: unknown; error?: unknown };
  };
  const teams = ["us", "them", "keeper", "referee", "unknown"] as const;
  const cal = d.calibration;
  return {
    ball: box(d.ball),
    ballPitch: xy(d.ballPitch),
    people: (Array.isArray(d.people) ? d.people : [])
      .slice(0, 40)
      .flatMap((p): Detection["people"] => {
        const b = box(p?.box);
        return b ? [{ box: b, team: teams.find((t) => t === p?.team) ?? "unknown", pitch: xy(p?.pitch) }] : [];
      }),
    calibration:
      cal && Number.isFinite(cal.points) && Number.isFinite(cal.error) ? { points: Number(cal.points), error: Number(cal.error) } : undefined,
  };
}
