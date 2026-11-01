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
  confidence?: "high" | "medium" | "low";
}

export interface Cause {
  time: string;
  headline: string;
  who: string;
  what_went_wrong: string;
  what_should_have_happened: string;
  severity: "major" | "minor";
  confidence?: "high" | "medium" | "low";
}

export interface Prevention {
  time: string;
  who: string;
  action: string;
  impact: string;
}

export interface ClipAnalysis {
  outcome: string;
  verdict: string;
  summary: string;
  key_moment: { time: string; headline: string; description: string };
  done_well: GoodPoint[];
  goal_causes: Cause[];
  prevention: Prevention[];
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
  kind: "player" | "ball" | "arrow" | "line" | "gap" | "zone";
  tone: Tone;
  label: string;
  box_2d?: Box;
  points?: Pt[];
}

export type Box = [number, number, number, number]; // [ymin, xmin, ymax, xmax]

export interface Annotation {
  // Did the frame back up the claim? "contradicted" claims are hidden.
  check: { status: "supported" | "not_visible" | "contradicted"; note: string };
  caption: string;
  shapes: Shape[];
  avoid: Box[]; // every visible player/ball — labels stay clear of these
}

// What the detector found on a frame.
export interface Detection {
  ball: Box | null;
  people: Array<{ box: Box; team: "us" | "them" | "keeper" | "referee" | "unknown" }>;
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
