// ──────────────────────────────────────────────────────────────────────────
// Roboflow hosted models — SERVER ONLY.
//
// - players: football-players-detection (ball, goalkeeper, player, referee)
// - pitch:   football-field-detection (32 pitch landmarks → calibration)
// Both are optional: without ROBOFLOW_API_KEY the app falls back to Gemini
// detection only and makes no distance measurements.
// ──────────────────────────────────────────────────────────────────────────

import "server-only";
import type { Box } from "./types";

const KEY = process.env.ROBOFLOW_API_KEY ?? "";
const PLAYERS_MODEL = process.env.ROBOFLOW_PLAYERS_MODEL ?? "football-players-detection-3zvbc/10";
const PITCH_MODEL = process.env.ROBOFLOW_PITCH_MODEL ?? "football-field-detection-f07vi/14";
const BASE = "https://serverless.roboflow.com";

export const roboflowEnabled = () => Boolean(KEY);

interface RfPrediction {
  x: number;
  y: number;
  width: number;
  height: number;
  confidence: number;
  class: string;
  keypoints?: Array<{ x: number; y: number; confidence: number; class_id?: number; class?: string }>;
}
interface RfResponse {
  image?: { width: number; height: number };
  predictions?: RfPrediction[];
}

async function infer(model: string, imageBase64: string, confidence: number): Promise<RfResponse> {
  const res = await fetch(`${BASE}/${model}?api_key=${encodeURIComponent(KEY)}&confidence=${confidence}`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: imageBase64,
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Roboflow ${model} failed (${res.status}): ${(await res.text()).slice(0, 200)}`);
  return (await res.json()) as RfResponse;
}

const toBox = (p: RfPrediction, w: number, h: number): Box => [
  Math.round(((p.y - p.height / 2) / h) * 1000),
  Math.round(((p.x - p.width / 2) / w) * 1000),
  Math.round(((p.y + p.height / 2) / h) * 1000),
  Math.round(((p.x + p.width / 2) / w) * 1000),
];

export interface RfPeople {
  ball: Box | null;
  people: Array<{ box: Box; kind: "player" | "goalkeeper" | "referee" }>;
}

export async function rfPeople(imageBase64: string): Promise<RfPeople> {
  const r = await infer(PLAYERS_MODEL, imageBase64, 0.3);
  const w = r.image?.width ?? 1;
  const h = r.image?.height ?? 1;
  const preds = r.predictions ?? [];
  const ball = preds.filter((p) => p.class === "ball").sort((a, b) => b.confidence - a.confidence)[0];
  return {
    ball: ball ? toBox(ball, w, h) : null,
    people: preds
      .filter((p) => p.class !== "ball")
      .map((p) => ({
        box: toBox(p, w, h),
        kind: p.class === "goalkeeper" ? ("goalkeeper" as const) : p.class === "referee" ? ("referee" as const) : ("player" as const),
      })),
  };
}

// The 32 landmarks in model order, 0-1000 image coords, or null when not
// confidently visible.
export async function rfPitchKeypoints(imageBase64: string): Promise<Array<[number, number] | null>> {
  const r = await infer(PITCH_MODEL, imageBase64, 0.3);
  const w = r.image?.width ?? 1;
  const h = r.image?.height ?? 1;
  const kps = r.predictions?.[0]?.keypoints ?? [];
  const out: Array<[number, number] | null> = new Array(32).fill(null);
  kps.forEach((k, i) => {
    const idx = typeof k.class_id === "number" ? k.class_id : i;
    if (idx >= 0 && idx < 32 && k.confidence > 0.5) out[idx] = [(k.x / w) * 1000, (k.y / h) * 1000];
  });
  return out;
}
