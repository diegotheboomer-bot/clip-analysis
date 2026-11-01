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
export function parseDetection(v: unknown): Detection {
  const d = (v ?? {}) as { ball?: unknown; people?: Array<{ box?: unknown; team?: unknown }> };
  const teams = ["us", "them", "keeper", "referee", "unknown"] as const;
  return {
    ball: box(d.ball),
    people: (Array.isArray(d.people) ? d.people : [])
      .slice(0, 40)
      .map((p) => ({ box: box(p?.box), team: teams.find((t) => t === p?.team) ?? "unknown" }))
      .filter((p): p is Detection["people"][number] => !!p.box),
  };
}
