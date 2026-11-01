import type { ClipAnalysis, Moment } from "./types";

// "01:23.4" → 83.4 (also tolerates "1:23" and "0:01:23").
export function toSeconds(t: string): number | null {
  const parts = t.trim().split(":").map(Number);
  if (parts.length === 0 || parts.some((n) => Number.isNaN(n))) return null;
  return parts.reduce((acc, n) => acc * 60 + n, 0);
}

export function formatTime(s: number): string {
  const m = Math.floor(s / 60);
  const sec = s - m * 60;
  return `${String(m).padStart(2, "0")}:${sec.toFixed(1).padStart(4, "0")}`;
}

// Flatten the analysis into one timeline of moments, sorted by time.
export function buildMoments(a: ClipAnalysis, duration: number | null): Moment[] {
  const clampT = (t: string) => {
    const s = toSeconds(t) ?? 0;
    return duration ? Math.min(Math.max(0, s), Math.max(0, duration - 0.05)) : Math.max(0, s);
  };
  const out: Moment[] = [
    {
      id: "key",
      time: a.key_moment.time,
      seconds: clampT(a.key_moment.time),
      kind: "key",
      headline: a.key_moment.headline || "Key moment",
      who: "",
      detail: a.key_moment.description,
    },
    ...a.goal_causes.map((c, i) => ({
      id: `c${i}`,
      time: c.time,
      seconds: clampT(c.time),
      kind: "error" as const,
      headline: c.headline,
      who: c.who,
      detail: c.what_went_wrong,
      fix: c.what_should_have_happened,
      severity: c.severity,
    })),
    ...a.done_well.map((d, i) => ({
      id: `g${i}`,
      time: d.time,
      seconds: clampT(d.time),
      kind: "good" as const,
      headline: d.headline,
      who: d.who,
      detail: d.what,
      fix: d.why,
    })),
  ];
  return out.sort((x, y) => x.seconds - y.seconds);
}

// Which moments to draw first: key moment, major errors, minor errors, good.
export function drawOrder(moments: Moment[], max = 8): Moment[] {
  const rank = (m: Moment) => (m.kind === "key" ? 0 : m.kind === "error" ? (m.severity === "major" ? 1 : 2) : 3);
  return [...moments].sort((a, b) => rank(a) - rank(b)).slice(0, max);
}
