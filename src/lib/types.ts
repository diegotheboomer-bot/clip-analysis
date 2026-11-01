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
  caption: string;
  shapes: Shape[];
  avoid: Box[]; // every visible player/ball — labels stay clear of these
}

// ── 2D board ─────────────────────────────────────────────────────────────
// 0-100 pitch coords from the analysed team's view: y=0 own goal line,
// y=100 opponent's goal line, x=0 left touchline.

export interface BoardPt {
  x: number;
  y: number;
}
export type BoardTone = Tone | "none";

export interface Board {
  players: Array<BoardPt & { team: "us" | "them"; role: string; tone: BoardTone }>;
  ball?: BoardPt;
  lines: Array<{ label: string; tone: BoardTone; points: BoardPt[] }>;
  arrows: Array<{ label: string; tone: BoardTone; from: BoardPt; to: BoardPt }>;
  zones: Array<{ label: string; tone: BoardTone; points: BoardPt[] }>;
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
