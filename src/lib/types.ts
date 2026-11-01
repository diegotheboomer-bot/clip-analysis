// Types shared by the server (Gemini) and the browser (UI).

export interface ClipContext {
  myTeamColour: string;
  opponentColour?: string;
  format?: string; // "11v11", "7v7", …
  notes?: string;
  durationSec?: number;
}

export interface GoodPoint {
  time: string;
  headline: string;
  who: string;
  what: string;
  why: string;
}

export interface Cause {
  time: string;
  headline: string;
  who: string;
  what_went_wrong: string;
  what_should_have_happened: string;
  severity: "major" | "minor";
}

export interface ClipAnalysis {
  outcome: string;
  summary: string;
  key_moment: { time: string; headline: string; description: string };
  done_well: GoodPoint[];
  goal_causes: Cause[];
  coaching_points: string[];
  unclear: string[];
}

// ── Telestration ─────────────────────────────────────────────────────────
// Coordinates are Gemini's native 0-1000 scale relative to the frame.

export type Tone = "error" | "good" | "info";

export interface Pt {
  y: number;
  x: number;
}

export interface Shape {
  kind: "player" | "ball" | "arrow" | "line" | "zone";
  tone: Tone;
  label: string;
  box_2d?: [number, number, number, number]; // [ymin, xmin, ymax, xmax]
  points?: Pt[];
}

export interface Annotation {
  caption: string;
  shapes: Shape[];
}

// A moment on the timeline, built from the analysis on the client.
export interface Moment {
  id: string;
  time: string;
  seconds: number;
  kind: "key" | "error" | "good";
  headline: string;
  who: string;
  detail: string;
  fix?: string;
  severity?: "major" | "minor";
}
