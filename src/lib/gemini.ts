// ──────────────────────────────────────────────────────────────────────────
// Gemini — SERVER ONLY.
//
// 1. analyseClip: watches the whole clip (Files API) and returns a structured,
//    timestamped coaching review. Low-confidence claims are moved to
//    "unclear" instead of being presented as fact.
// 2. detectFrame: a spatial model finds the ball and every person on a frame.
// 3. annotateFrame: the reasoning model sees the frame with every detected
//    person NUMBERED on it, checks the claim against the frame, and picks
//    players by number. Coordinates come from the detector, never guessed.
// ──────────────────────────────────────────────────────────────────────────

import "server-only";
import type { Annotation, Box, ClipAnalysis, ClipContext, Detection, Moment, Pt, Shape, Tone } from "./types";

const GEMINI_KEY = process.env.GEMINI_API_KEY ?? "";
export const MODEL = process.env.GEMINI_ANALYSIS_MODEL ?? "gemini-4-argon";
export const DETECT_MODEL = process.env.GEMINI_DETECT_MODEL ?? "gemini-robotics-er-2-preview";
const BASE = "https://generativelanguage.googleapis.com";

export const MAX_CLIP_SECONDS = 120;

async function gemini(path: string, init: RequestInit): Promise<Response> {
  if (!GEMINI_KEY) throw new Error("GEMINI_API_KEY is not set");
  return fetch(`${BASE}${path}`, {
    ...init,
    cache: "no-store",
    headers: { "x-goog-api-key": GEMINI_KEY, ...(init.headers ?? {}) },
  });
}

async function fail(res: Response, step: string): Promise<never> {
  const body = await res.text().catch(() => "");
  throw new Error(`Gemini ${step} failed (${res.status}): ${body.slice(0, 300)}`);
}

// generateContent with JSON output; returns the parsed JSON.
async function generateJson<T>(parts: unknown[], system: string, schema: unknown, model = MODEL): Promise<T> {
  const res = await gemini(`/v1beta/models/${model}:generateContent`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: "user", parts }],
      generationConfig: { responseMimeType: "application/json", responseSchema: schema },
    }),
  });
  if (!res.ok) await fail(res, "generate");
  const json = (await res.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string; thought?: boolean }> } }>;
  };
  const text = (json.candidates?.[0]?.content?.parts ?? [])
    .filter((p) => !p.thought && p.text)
    .map((p) => p.text)
    .join("");
  if (!text) throw new Error("Gemini returned an empty response");
  return JSON.parse(text) as T;
}

// ── Files API ────────────────────────────────────────────────────────────

interface GeminiFile {
  name: string;
  uri: string;
  mimeType: string;
  state?: string;
}

// Resumable upload: start a session, then send the bytes + finalize.
export async function uploadToGemini(bytes: ArrayBuffer, mimeType: string, displayName: string): Promise<GeminiFile> {
  const start = await gemini("/upload/v1beta/files", {
    method: "POST",
    headers: {
      "X-Goog-Upload-Protocol": "resumable",
      "X-Goog-Upload-Command": "start",
      "X-Goog-Upload-Header-Content-Length": String(bytes.byteLength),
      "X-Goog-Upload-Header-Content-Type": mimeType,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ file: { display_name: displayName } }),
  });
  if (!start.ok) await fail(start, "upload start");
  const uploadUrl = start.headers.get("x-goog-upload-url");
  if (!uploadUrl) throw new Error("Gemini upload start returned no upload URL");

  const up = await fetch(uploadUrl, {
    method: "POST",
    cache: "no-store",
    headers: {
      "Content-Length": String(bytes.byteLength),
      "X-Goog-Upload-Offset": "0",
      "X-Goog-Upload-Command": "upload, finalize",
    },
    body: bytes,
  });
  if (!up.ok) await fail(up, "upload");
  const json = (await up.json()) as { file?: GeminiFile };
  if (!json.file?.name) throw new Error("Gemini upload returned no file");
  return json.file;
}

// Videos are processed after upload; wait until the file is ACTIVE.
export async function waitUntilActive(name: string, timeoutMs = 120_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const res = await gemini(`/v1beta/${name}`, { method: "GET" });
    if (!res.ok) await fail(res, "file status");
    const f = (await res.json()) as GeminiFile;
    if (f.state === "ACTIVE") return;
    if (f.state === "FAILED") throw new Error("Gemini could not process this video");
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error("Timed out waiting for Gemini to process the video");
}

export async function deleteGeminiFile(name: string): Promise<void> {
  await gemini(`/v1beta/${name}`, { method: "DELETE" }).catch(() => undefined);
}

// ── 1. Clip analysis ─────────────────────────────────────────────────────

const S = (description: string) => ({ type: "STRING", description });
const TIME = S("Timestamp in the clip as MM:SS.s (tenths), e.g. 00:07.4 — the exact frame that best shows it.");
const HEADLINE = S("Punchy 3-6 word title, e.g. 'CB fails to step out'.");
const WHO = S("Player or unit, by kit colour + position on the pitch (+ number only if clearly readable).");
const CONFIDENCE = {
  type: "STRING",
  enum: ["high", "medium", "low"],
  description: "high = clearly visible and unambiguous; medium = visible but partly obscured or a judgement call; low = guess.",
};

const ANALYSIS_SCHEMA = {
  type: "OBJECT",
  properties: {
    outcome: S("One line: what happens in the clip, e.g. 'Goal conceded from a cut-back after a turnover'."),
    verdict: S("One sentence: THE main reason the goal was conceded (or the sequence went wrong). Only what the footage clearly shows."),
    summary: S("3-5 sentence tactical summary of the sequence from the analysed team's point of view."),
    key_moment: {
      type: "OBJECT",
      properties: { time: TIME, headline: HEADLINE, description: S("The single moment the goal was decided.") },
      required: ["time", "headline", "description"],
    },
    goal_causes: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          time: TIME,
          headline: HEADLINE,
          who: WHO,
          what_went_wrong: S("The specific error or tactical problem."),
          what_should_have_happened: S("The correct decision or positioning — only something this player could realistically have done from where they were."),
          severity: { type: "STRING", enum: ["major", "minor"] },
          confidence: CONFIDENCE,
        },
        required: ["time", "headline", "who", "what_went_wrong", "what_should_have_happened", "severity", "confidence"],
      },
    },
    done_well: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          time: TIME,
          headline: HEADLINE,
          who: WHO,
          what: S("What was done well."),
          why: S("Why it matters tactically."),
          confidence: CONFIDENCE,
        },
        required: ["time", "headline", "who", "what", "why", "confidence"],
      },
    },
    prevention: {
      type: "ARRAY",
      description: "How the goal could have been prevented: the chain of realistic interventions, earliest first.",
      items: {
        type: "OBJECT",
        properties: {
          time: TIME,
          who: WHO,
          action: S("The specific action that would have stopped or reduced the danger."),
          impact: S("What it would have changed."),
        },
        required: ["time", "who", "action", "impact"],
      },
    },
    coaching_points: { type: "ARRAY", items: S("A short, actionable training/coaching point.") },
    unclear: { type: "ARRAY", items: S("Anything that could not be judged from the footage, and why.") },
  },
  required: ["outcome", "verdict", "summary", "key_moment", "goal_causes", "done_well", "prevention", "coaching_points", "unclear"],
};

const ANALYSIS_SYSTEM = `You are an elite football (soccer) video analyst and UEFA Pro Licence coach reviewing amateur match footage, usually from a Veo camera (wide, elevated, auto-panning).

Analyse the clip from the point of view of the team the user names (the "analysed team"). Look at:
- Defensive line: height, flatness/stagger, stepping up vs dropping, offside trap, distances between centre-backs and between full-back and centre-back.
- Shape & compactness: distances between lines, horizontal compactness, ball-side overload, cover and balance.
- Individual defending: pressure on the ball, body shape, tracking runners, ball-watching, when a centre-back should step out or hold.
- Transitions: rest-defence before losing the ball, counter-press or recovery runs after it.
- Goalkeeper: starting position, angle, set position at the shot, decision to come or stay, handling, communication.
- The attack: how the opponent created and finished the chance.

ACCURACY RULES — these matter more than anything else:
- Only state what you can actually see. A wrong claim is far worse than a missing one.
- Before blaming a player, check they were close enough to affect the play AT THAT MOMENT. Footage is a 2D view from an elevated camera: players who look close can be far apart in depth, and vice versa. Use pitch markings to judge depth. Never blame a player who was far away or could not realistically have reached the ball/runner in time — say whose zone it was instead, or put it in "unclear".
- Do not assume positions, distances or roles you cannot confirm. Never state distances in metres.
- Never invent shirt numbers or names; refer to players by kit colour and position (e.g. "blue left centre-back"). Use a number only if clearly readable.
- Set "confidence" honestly. If a point is a guess, mark it low.
- Every point MUST have a precise timestamp (MM:SS.s) of the frame that best shows it.
- Be specific, like a coach in a video session. Credit good actions too.
- "prevention" walks back through the move: realistic points where one of the analysed team's players could have stopped it.
- If the clip does not show a goal conceded, still analyse the sequence; "goal_causes" then lists what went wrong defensively (or is empty).`;

export async function analyseClip(file: GeminiFile, ctx: ClipContext): Promise<ClipAnalysis> {
  // Football is fast: sample well above the 1 fps default.
  const fps = (ctx.durationSec ?? 30) <= 60 ? 5 : 2;
  const lines = [
    `Analysed team kit colour: ${ctx.myTeamColour}.`,
    ctx.opponentColour ? `Opponent kit colour: ${ctx.opponentColour}.` : "",
    ctx.format ? `Format: ${ctx.format}.` : "",
    ctx.notes ? `Context from the coach: ${ctx.notes}` : "",
    "Break down this clip.",
  ].filter(Boolean);

  const a = await generateJson<ClipAnalysis>(
    [{ fileData: { fileUri: file.uri, mimeType: file.mimeType }, videoMetadata: { fps } }, { text: lines.join("\n") }],
    ANALYSIS_SYSTEM,
    ANALYSIS_SCHEMA,
  );

  // Don't present guesses as findings: low-confidence points go to "unclear".
  const unsure = [
    ...a.goal_causes.filter((c) => c.confidence === "low").map((c) => `Possible but uncertain (${c.time}): ${c.who} — ${c.what_went_wrong}`),
    ...a.done_well.filter((d) => d.confidence === "low").map((d) => `Possible but uncertain (${d.time}): ${d.who} — ${d.what}`),
  ];
  return {
    ...a,
    goal_causes: a.goal_causes.filter((c) => c.confidence !== "low"),
    done_well: a.done_well.filter((d) => d.confidence !== "low"),
    unclear: [...a.unclear, ...unsure],
  };
}

// ── 2. Detection ─────────────────────────────────────────────────────────

const clamp = (n: unknown) => Math.max(0, Math.min(1000, Math.round(Number(n) || 0)));

function cleanBox(b: unknown): Box | null {
  if (!Array.isArray(b) || b.length !== 4) return null;
  const [y0, x0, y1, x1] = b.map(clamp);
  return y1 > y0 && x1 > x0 ? [y0, x0, y1, x1] : null;
}

const DETECT_SCHEMA = {
  type: "OBJECT",
  properties: {
    ball_visible: { type: "BOOLEAN" },
    ball: { type: "ARRAY", items: { type: "INTEGER" }, description: "[ymin, xmin, ymax, xmax] 0-1000" },
    people: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          box_2d: { type: "ARRAY", items: { type: "INTEGER" } },
          team: { type: "STRING", enum: ["us", "them", "keeper", "referee", "unknown"] },
        },
        required: ["box_2d", "team"],
      },
    },
  },
  required: ["ball_visible", "people"],
};

export async function detectFrame(
  imageBase64: string,
  mimeType: string,
  ctx: Pick<ClipContext, "myTeamColour" | "opponentColour">,
): Promise<Detection> {
  const r = await generateJson<{ ball_visible?: boolean; ball?: unknown; people?: Array<{ box_2d?: unknown; team?: string }> }>(
    [
      { inlineData: { mimeType, data: imageBase64 } },
      {
        text: [
          "Football match frame from a wide camera.",
          "1) Find the ball. It is small and may be far away, partly hidden or blurred — only report it if you can actually see it.",
          "2) Box every person on the pitch (players, goalkeepers, referees), head to feet, tightly.",
          `team: "us" = ${ctx.myTeamColour} kit, "them" = ${ctx.opponentColour || "the other outfield kit"}, "keeper" = a goalkeeper, "referee" = officials, "unknown" if you can't tell.`,
          "Boxes are [ymin, xmin, ymax, xmax] normalized 0-1000.",
        ].join("\n"),
      },
    ],
    "You are a precise object detector for football video.",
    DETECT_SCHEMA,
    DETECT_MODEL,
  );
  const teams = ["us", "them", "keeper", "referee", "unknown"] as const;
  return {
    ball: r.ball_visible ? cleanBox(r.ball) : null,
    people: (r.people ?? [])
      .map((p) => ({ box: cleanBox(p.box_2d), team: teams.find((t) => t === p.team) ?? "unknown" }))
      .filter((p): p is { box: Box; team: (typeof teams)[number] } => !!p.box)
      .slice(0, 40),
  };
}

// ── 3. Frame telestration (on a numbered frame) ──────────────────────────

const PT = { type: "OBJECT", properties: { y: { type: "INTEGER" }, x: { type: "INTEGER" } }, required: ["y", "x"] };

const ANNOTATION_SCHEMA = {
  type: "OBJECT",
  properties: {
    check: {
      type: "OBJECT",
      properties: {
        status: { type: "STRING", enum: ["supported", "not_visible", "contradicted"] },
        note: S("One sentence: what the frame shows about the claim."),
      },
      required: ["status", "note"],
    },
    caption: S("One sentence explaining what the drawing shows."),
    shapes: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          kind: { type: "STRING", enum: ["player", "ball", "arrow", "line", "gap", "zone"] },
          tone: { type: "STRING", enum: ["error", "good", "info"] },
          label: S("Max 3 words, or empty."),
          id: { type: "INTEGER", description: "player: the number of the person on the frame." },
          ids: { type: "ARRAY", items: { type: "INTEGER" }, description: "line: players left to right. gap: exactly two. zone: the 2-5 players around the open space." },
          from_id: { type: "INTEGER", description: "arrow: number of the player the arrow starts at." },
          from_ball: { type: "BOOLEAN", description: "arrow: true if it starts at the ball (a pass)." },
          to_id: { type: "INTEGER", description: "arrow: number of the player it ends at (pass receiver, runner being tracked, attacker to press). Prefer this over 'to'." },
          to: PT,
          points: { type: "ARRAY", items: PT, description: "zone: only if 'ids' can't describe it — 3-6 polygon points (0-1000)." },
        },
        required: ["kind", "tone", "label"],
      },
    },
  },
  required: ["check", "caption", "shapes"],
};

const ANNOTATION_SYSTEM = `You are a football video analyst drawing telestration on a single match frame.

Every detected person has a white NUMBER drawn above their head. Refer to players ONLY by those numbers — never guess coordinates for a player.

First, CHECK the claim against this frame:
- "supported": the frame clearly shows it.
- "not_visible": the moment or player isn't clearly visible here (out of frame, blocked, blurred).
- "contradicted": the frame shows something different — e.g. the blamed player is clearly too far away to have affected the play, or is not where the claim says.
Players that look close in a 2D camera view can be far apart in depth; judge depth from the pitch markings. Do not assume anything you cannot see.
If MEASURED distances are given in the brief (from pitch-line calibration), trust them over your visual impression. Use them to check whether the blamed player was realistically close enough to have done what the claim says (e.g. press the ball, block the pass, track the runner). If they clearly weren't, the claim is "contradicted".

Then draw (only if status is "supported"; otherwise return no shapes):
- player {id}: ring the key player. tone "error" = at fault, "good" = did well, "info" = context (ball carrier, attacker).
- ball: ring the ball — only if the brief says it was detected.
- arrow {from_id or from_ball, to_id or to}: a pass (from_ball → receiver's number), a run, or where a player SHOULD have moved (tone "good"). End it on a player number whenever it goes to a player; use "to" (a point, 0-1000) only for a run into empty space.
- line {ids}: a defensive or midfield line through those players, left to right.
- gap {ids: [a, b]}: highlight the space between two players. Never write a distance yourself — measured distances are added automatically.
- zone {ids}: open space that was exploited (tone "error"), given by the 2-5 players around it (e.g. the two centre-backs either side of the gap).

Keep it clean so the play stays visible: 2-4 shapes, the fewest that make the ONE point. Labels max 3 words, or empty when obvious.`;

const TONES = ["error", "good", "info"] as const;
const feet = ([, x0, y1, x1]: Box): Pt => ({ x: Math.round((x0 + x1) / 2), y: y1 });
const centre = ([y0, x0, y1, x1]: Box): Pt => ({ x: Math.round((x0 + x1) / 2), y: Math.round((y0 + y1) / 2) });
const pt = (p: unknown): Pt | null => {
  const q = p as Pt | undefined;
  return q && Number.isFinite(q.x) && Number.isFinite(q.y) ? { x: clamp(q.x), y: clamp(q.y) } : null;
};

// The open space framed by some players' feet: a lens between two players,
// or the convex hull of three or more, pulled slightly inwards so the shaded
// area is the space itself rather than the players.
function zoneAround(feetPts: Pt[]): Pt[] {
  if (feetPts.length === 2) {
    const [a, b] = feetPts;
    const mx = (a.x + b.x) / 2;
    const my = (a.y + b.y) / 2;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy) || 1;
    const wdt = Math.min(len * 0.28, 60); // half-thickness of the lens
    const nx = (-dy / len) * wdt;
    const ny = (dx / len) * wdt * 0.6; // flatter in depth (camera perspective)
    const inset = (p: Pt) => ({ x: p.x + (mx - p.x) * 0.15, y: p.y + (my - p.y) * 0.15 });
    const A = inset(a);
    const B = inset(b);
    return [A, { x: mx + nx, y: my + ny }, B, { x: mx - nx, y: my - ny }].map((p) => ({ x: clamp(p.x), y: clamp(p.y) }));
  }
  // Convex hull (monotone chain), then shrink 12% towards the centre.
  const P = [...feetPts].sort((p, q) => p.x - q.x || p.y - q.y);
  const cross = (o: Pt, a: Pt, b: Pt) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower: Pt[] = [];
  for (const p of P) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper: Pt[] = [];
  for (const p of [...P].reverse()) {
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  const hull = [...lower.slice(0, -1), ...upper.slice(0, -1)];
  const cx = hull.reduce((s, p) => s + p.x, 0) / hull.length;
  const cy = hull.reduce((s, p) => s + p.y, 0) / hull.length;
  return hull.map((p) => ({ x: clamp(p.x + (cx - p.x) * 0.12), y: clamp(p.y + (cy - p.y) * 0.12) }));
}

interface RawShape {
  kind?: string;
  tone?: string;
  label?: string;
  id?: number;
  ids?: number[];
  from_id?: number;
  from_ball?: boolean;
  to_id?: number;
  to?: unknown;
  points?: unknown[];
}

// Turn the model's id-based shapes into coordinates from the detector.
function resolveShapes(raw: RawShape[], det: Detection): Shape[] {
  const box = (i: unknown) => (typeof i === "number" ? det.people[i]?.box : undefined);
  const out: Shape[] = [];
  for (const s of raw.slice(0, 5)) {
    const tone: Tone = TONES.find((t) => t === s.tone) ?? "info";
    const label = typeof s.label === "string" ? s.label.replace(/~?\d+(\.\d+)?\s*m\b/gi, "").trim().slice(0, 28) : "";
    switch (s.kind) {
      case "player": {
        const b = box(s.id);
        if (b) out.push({ kind: "player", tone, label, box_2d: b });
        break;
      }
      case "ball":
        if (det.ball) out.push({ kind: "ball", tone, label, box_2d: det.ball });
        break;
      case "arrow": {
        const from = s.from_ball && det.ball ? centre(det.ball) : box(s.from_id) ? feet(box(s.from_id) as Box) : null;
        const toBox = box(s.to_id);
        const to = toBox ? feet(toBox) : pt(s.to);
        if (from && to) out.push({ kind: "arrow", tone, label, points: [from, to] });
        break;
      }
      case "line":
      case "gap": {
        const pts = (s.ids ?? [])
          .map(box)
          .filter((b): b is Box => !!b)
          .map(feet)
          .sort((a, b) => a.x - b.x);
        const n = s.kind === "gap" ? 2 : 8;
        // A gap gets its MEASURED distance when both players are calibrated.
        let gapLabel = "";
        if (s.kind === "gap") {
          const [a, b] = (s.ids ?? []).map((i) => det.people[i]?.pitch);
          if (a && b) gapLabel = `${Math.round(Math.hypot(a[0] - b[0], a[1] - b[1]))}m`;
        }
        if (pts.length >= 2) out.push({ kind: s.kind, tone, label: s.kind === "gap" ? gapLabel : label, points: pts.slice(0, n) });
        break;
      }
      case "zone": {
        const around = (s.ids ?? []).map(box).filter((b): b is Box => !!b).map(feet);
        const pts = around.length >= 2 ? zoneAround(around) : (s.points ?? []).map(pt).filter((p): p is Pt => !!p);
        if (pts.length >= 3) out.push({ kind: "zone", tone, label, points: pts.slice(0, 12) });
        break;
      }
    }
  }
  return out;
}

// Distances measured from the pitch calibration, as plain facts for the model.
function measuredFacts(det: Detection): string {
  if (!det.calibration) return "No pitch calibration for this frame — there are no measured distances; be cautious about depth.";
  const d = (a: [number, number], b: [number, number]) => Math.round(Math.hypot(a[0] - b[0], a[1] - b[1]));
  const lines = det.people.flatMap((p, i) => {
    if (!p.pitch) return [];
    const parts = [];
    if (det.ballPitch) parts.push(`${d(p.pitch, det.ballPitch)}m from the ball`);
    const opp = det.people
      .map((q, j) => ({ q, j }))
      .filter(({ q }) => q.pitch && q !== p && ((p.team === "us" && q.team === "them") || (p.team === "them" && q.team === "us")))
      .map(({ q, j }) => ({ j, m: d(p.pitch as [number, number], q.pitch as [number, number]) }))
      .sort((a, b) => a.m - b.m)[0];
    if (opp) parts.push(`nearest opponent #${opp.j} at ${opp.m}m`);
    return parts.length ? [`#${i} (${p.team}): ${parts.join(", ")}`] : [];
  });
  return [
    `MEASURED from the pitch lines (${det.calibration.points} landmarks, ±${det.calibration.error}m; assumes a standard-size pitch):`,
    ...lines,
  ].join("\n");
}

export async function annotateFrame(
  markedBase64: string,
  mimeType: string,
  det: Detection,
  moment: Pick<Moment, "kind" | "headline" | "who" | "detail" | "fix">,
  ctx: Pick<ClipContext, "myTeamColour" | "opponentColour">,
): Promise<Annotation> {
  const roster = det.people.map((p, i) => `#${i}: ${p.team}`).join(", ");
  const measured = measuredFacts(det);
  const brief = [
    `Analysed team kit colour: ${ctx.myTeamColour}.`,
    ctx.opponentColour ? `Opponent kit colour: ${ctx.opponentColour}.` : "",
    `Numbered people (detector's team guess): ${roster || "none detected"}.`,
    measured,
    det.ball ? "The ball was detected — you may ring it with kind 'ball' or start a pass arrow at it." : "The ball was NOT detected in this frame — do not draw it or start anything at it.",
    `Claim (${moment.kind === "good" ? "done well" : moment.kind === "key" ? "key moment" : "mistake"}): ${moment.headline}.`,
    moment.who ? `Who: ${moment.who}.` : "",
    `Detail: ${moment.detail}`,
    moment.fix ? `What should have happened: ${moment.fix}` : "",
  ].filter(Boolean);

  const res = await generateJson<{ check?: { status?: string; note?: string }; caption?: string; shapes?: RawShape[] }>(
    [{ inlineData: { mimeType, data: markedBase64 } }, { text: brief.join("\n") }],
    ANNOTATION_SYSTEM,
    ANNOTATION_SCHEMA,
  );
  const status = (["supported", "not_visible", "contradicted"] as const).find((s) => s === res.check?.status) ?? "not_visible";
  return {
    measured: !!det.calibration,
    check: { status, note: typeof res.check?.note === "string" ? res.check.note : "" },
    caption: typeof res.caption === "string" ? res.caption : "",
    shapes: status === "supported" ? resolveShapes(Array.isArray(res.shapes) ? res.shapes : [], det) : [],
    avoid: det.ball ? [...det.people.map((p) => p.box), det.ball] : det.people.map((p) => p.box),
  };
}
