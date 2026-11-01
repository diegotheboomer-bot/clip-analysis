// ──────────────────────────────────────────────────────────────────────────
// Frame detection — SERVER ONLY. Combines:
//  - Roboflow players model: tight boxes for players / keepers / referees
//  - Gemini Robotics-ER: the ball, and which team each player is on
//  - Roboflow pitch landmarks → calibration → each player's position in metres
// Falls back to Gemini alone if Roboflow isn't configured or fails.
// ──────────────────────────────────────────────────────────────────────────

import "server-only";
import { detectFrame } from "./gemini";
import { calibrate, onPitch, toPitch } from "./pitch";
import { rfPeople, rfPitchKeypoints, roboflowEnabled } from "./roboflow";
import type { Box, ClipContext, Detection } from "./types";

const iou = (a: Box, b: Box) => {
  const ih = Math.max(0, Math.min(a[2], b[2]) - Math.max(a[0], b[0]));
  const iw = Math.max(0, Math.min(a[3], b[3]) - Math.max(a[1], b[1]));
  const inter = ih * iw;
  const area = (x: Box) => (x[2] - x[0]) * (x[3] - x[1]);
  return inter / (area(a) + area(b) - inter || 1);
};

export async function detectAll(
  imageBase64: string,
  mimeType: string,
  ctx: Pick<ClipContext, "myTeamColour" | "opponentColour">,
): Promise<Detection> {
  const rf = roboflowEnabled();
  const [gem, people, keypoints] = await Promise.all([
    detectFrame(imageBase64, mimeType, ctx).catch((e) => (console.error("gemini detect failed", e), null)),
    rf ? rfPeople(imageBase64).catch((e) => (console.error("roboflow players failed", e), null)) : null,
    rf ? rfPitchKeypoints(imageBase64).catch((e) => (console.error("roboflow pitch failed", e), null)) : null,
  ]);

  // People: Roboflow boxes when we have them, team from Gemini's matching box.
  let list: Detection["people"];
  if (people && people.people.length > 0) {
    list = people.people.map((p) => {
      if (p.kind === "goalkeeper") return { box: p.box, team: "keeper" as const };
      if (p.kind === "referee") return { box: p.box, team: "referee" as const };
      const match = (gem?.people ?? [])
        .map((g) => ({ g, s: iou(g.box, p.box) }))
        .sort((a, b) => b.s - a.s)[0];
      return { box: p.box, team: match && match.s > 0.25 ? match.g.team : ("unknown" as const) };
    });
  } else {
    list = gem?.people ?? [];
  }
  const ball = gem?.ball ?? people?.ball ?? null;
  if (!gem && !people) throw new Error("No detector available");

  // Real pitch positions, when the pitch lines pin the view down.
  const cal = keypoints ? calibrate(keypoints) : null;
  const project = ([, x0, y1, x1]: Box): [number, number] | undefined => {
    if (!cal) return undefined;
    const p = toPitch(cal, (x0 + x1) / 2, y1);
    return onPitch(p) ? [Math.round(p[0] * 10) / 10, Math.round(p[1] * 10) / 10] : undefined;
  };

  return {
    ball,
    ballPitch: ball ? project(ball) : undefined,
    people: list.slice(0, 40).map((p) => ({ ...p, pitch: project(p.box) })),
    calibration: cal ? { points: cal.points, error: Math.round(cal.error * 10) / 10 } : undefined,
  };
}
