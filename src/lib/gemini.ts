// ──────────────────────────────────────────────────────────────────────────
// Gemini — SERVER ONLY.
//
// 1. analyseClip: watches the whole clip (Files API) and returns a structured
//    coaching breakdown with timestamps.
// 2. annotateFrame: takes a still frame at one of those timestamps and returns
//    telestration shapes (player rings, arrows, lines, open zones) in Gemini's
//    native 0-1000 coordinates, which the UI draws over the video.
// ──────────────────────────────────────────────────────────────────────────

import "server-only";
import type { Annotation, Board, BoardPt, BoardTone, ClipAnalysis, ClipContext, Moment, Shape } from "./types";

const GEMINI_KEY = process.env.GEMINI_API_KEY ?? "";
export const MODEL = process.env.GEMINI_ANALYSIS_MODEL ?? "gemini-3.8-flash";
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
async function generateJson<T>(parts: unknown[], system: string, schema: unknown): Promise<T> {
  const res = await gemini(`/v1beta/models/${MODEL}:generateContent`, {
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
const WHO = S("Player or unit, by kit colour + position (+ number only if clearly readable).");

const ANALYSIS_SCHEMA = {
  type: "OBJECT",
  properties: {
    outcome: S("One line: what happens in the clip, e.g. 'Goal conceded from a cut-back after a turnover'."),
    verdict: S("One sentence: THE main reason the goal was conceded (or the sequence went wrong)."),
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
          what_should_have_happened: S("The correct decision or positioning."),
          severity: { type: "STRING", enum: ["major", "minor"] },
        },
        required: ["time", "headline", "who", "what_went_wrong", "what_should_have_happened", "severity"],
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
        },
        required: ["time", "headline", "who", "what", "why"],
      },
    },
    prevention: {
      type: "ARRAY",
      description: "How the goal could have been prevented: the chain of interventions, earliest first.",
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

Analyse the clip from the point of view of the team the user names (the "analysed team"). Look closely at:
- Defensive line: height, flatness/stagger, stepping up vs dropping, offside trap, distances between centre-backs and between full-back and centre-back.
- Shape & compactness: distances between lines (defence-midfield-attack), horizontal compactness, ball-side overload, cover and balance.
- Individual defending: pressure on the ball, body shape, showing inside/outside, tracking runners, ball-watching, when a centre-back should step out or hold.
- Transitions: rest-defence before losing the ball, counter-press or recovery runs after it.
- Goalkeeper: starting position, angle, set position at the shot, decision to come or stay, handling, communication/organisation.
- The attack: how the opponent created and finished the chance.

Rules:
- Every point MUST have a precise timestamp (MM:SS.s) of the frame that best shows it — these frames get drawn on.
- Only describe what is actually visible. Never invent shirt numbers or names; refer to players by kit colour and position (e.g. "blue left centre-back"). Use a number only if clearly readable.
- If something can't be judged (out of frame, camera angle, blur), put it in "unclear" instead of guessing.
- Be honest and specific, like a coach in a video session. Credit good actions even in a goal conceded — a complete review lists what went well as well as what went wrong.
- "prevention" walks back through the move: every point where one of the analysed team's players could have stopped it (press, cover, track, step up, block, save).
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

  return generateJson<ClipAnalysis>(
    [{ fileData: { fileUri: file.uri, mimeType: file.mimeType }, videoMetadata: { fps } }, { text: lines.join("\n") }],
    ANALYSIS_SYSTEM,
    ANALYSIS_SCHEMA,
  );
}

// ── 2. Frame telestration ────────────────────────────────────────────────

const PT = { type: "OBJECT", properties: { y: { type: "INTEGER" }, x: { type: "INTEGER" } }, required: ["y", "x"] };

const ANNOTATION_SCHEMA = {
  type: "OBJECT",
  properties: {
    caption: S("One sentence explaining what the drawing shows."),
    shapes: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          kind: { type: "STRING", enum: ["player", "ball", "arrow", "line", "gap", "zone"] },
          tone: { type: "STRING", enum: ["error", "good", "info"] },
          label: S("Max 4 words. For gap: the estimated distance, e.g. '~12m'."),
          box_2d: { type: "ARRAY", items: { type: "INTEGER" }, description: "[ymin, xmin, ymax, xmax] 0-1000, for player/ball." },
          points: { type: "ARRAY", items: PT, description: "For arrow (from, to), line (2+), gap (2: the two players' feet), zone (3-6 polygon)." },
        },
        required: ["kind", "tone", "label"],
      },
    },
    avoid: {
      type: "ARRAY",
      description: "box_2d [ymin, xmin, ymax, xmax] of EVERY visible player, goalkeeper, referee and the ball — labels are kept clear of these.",
      items: { type: "ARRAY", items: { type: "INTEGER" } },
    },
  },
  required: ["caption", "shapes", "avoid"],
};

const ANNOTATION_SYSTEM = `You are a football video analyst drawing telestration on a single match frame, like a TV pundit on a touchscreen.

Coordinates are normalized 0-1000 relative to this image. box_2d is [ymin, xmin, ymax, xmax] drawn tightly around one player (head to feet) or the ball. points are {y, x}.

Shapes:
- player: box_2d around a key player. tone "error" = at fault, "good" = did well, "info" = context (e.g. the attacker, ball carrier).
- ball: box_2d around the ball, only if clearly visible.
- arrow: points [from, to]. Use for a run, a pass, or where a player SHOULD have moved (tone "good" for the correct movement).
- line: 2+ points along a defensive or midfield line, through the players' feet, left to right.
- gap: exactly 2 points at two players' feet to show the distance between them; label = estimated distance in metres using the pitch markings for scale (penalty box 16.5m deep, 40.3m wide; centre circle radius 9.15m), e.g. "~14m".
- zone: 3-6 polygon points around open space that was exploited (tone "error").

Also return "avoid": a box for every visible player, referee and the ball.

Rules: 2-7 shapes, the fewest that make the point clear. Points for players are at their FEET (bottom of their box). Only mark what is actually visible in this frame — if the described moment isn't visible, mark what is relevant and say so in the caption. Labels max 4 words.`;

const KINDS = ["player", "ball", "arrow", "line", "gap", "zone"] as const;
const clamp = (n: unknown) => Math.max(0, Math.min(1000, Math.round(Number(n) || 0)));

// Drop anything malformed so the UI can trust what it draws.
function cleanBoxes(boxes: unknown): Array<[number, number, number, number]> {
  if (!Array.isArray(boxes)) return [];
  return boxes
    .filter((b): b is number[] => Array.isArray(b) && b.length === 4)
    .map((b) => b.map(clamp) as [number, number, number, number])
    .filter(([y0, x0, y1, x1]) => y1 > y0 && x1 > x0)
    .slice(0, 40);
}

function cleanShapes(shapes: unknown): Shape[] {
  if (!Array.isArray(shapes)) return [];
  const out: Shape[] = [];
  for (const raw of shapes.slice(0, 8)) {
    const s = raw as Partial<Shape>;
    const kind = KINDS.find((k) => k === s?.kind);
    if (!s || !kind) continue;
    const tone = (["error", "good", "info"] as const).find((t) => t === s.tone) ?? "info";
    const label = typeof s.label === "string" ? s.label.slice(0, 40) : "";
    if (kind === "player" || kind === "ball") {
      if (!Array.isArray(s.box_2d) || s.box_2d.length !== 4) continue;
      const [y0, x0, y1, x1] = s.box_2d.map(clamp);
      if (y1 <= y0 || x1 <= x0) continue;
      out.push({ kind, tone, label, box_2d: [y0, x0, y1, x1] });
    } else {
      const pts = (Array.isArray(s.points) ? s.points : []).map((p) => ({ y: clamp(p?.y), x: clamp(p?.x) }));
      if (pts.length < (kind === "zone" ? 3 : 2)) continue;
      out.push({ kind, tone, label, points: kind === "arrow" || kind === "gap" ? pts.slice(0, 2) : pts.slice(0, 8) });
    }
  }
  return out;
}

export async function annotateFrame(
  imageBase64: string,
  mimeType: string,
  moment: Pick<Moment, "kind" | "headline" | "who" | "detail" | "fix">,
  ctx: Pick<ClipContext, "myTeamColour" | "opponentColour">,
): Promise<Annotation> {
  const brief = [
    `Analysed team kit colour: ${ctx.myTeamColour}.`,
    ctx.opponentColour ? `Opponent kit colour: ${ctx.opponentColour}.` : "",
    `Moment (${moment.kind === "good" ? "done well" : moment.kind === "key" ? "key moment" : "mistake"}): ${moment.headline}.`,
    moment.who ? `Who: ${moment.who}.` : "",
    `Detail: ${moment.detail}`,
    moment.fix ? `What should have happened: ${moment.fix}` : "",
    "Draw this on the frame.",
  ].filter(Boolean);

  const res = await generateJson<{ caption?: string; shapes?: unknown; avoid?: unknown }>(
    [{ inlineData: { mimeType, data: imageBase64 } }, { text: brief.join("\n") }],
    ANNOTATION_SYSTEM,
    ANNOTATION_SCHEMA,
  );
  return {
    caption: typeof res.caption === "string" ? res.caption : "",
    shapes: cleanShapes(res.shapes),
    avoid: cleanBoxes(res.avoid),
  };
}

// ── 3. 2D tactical board ─────────────────────────────────────────────────
// A top-down reconstruction of one frame. Approximate: it's inferred from a
// single angled camera view using the pitch markings.

const BPT = { type: "OBJECT", properties: { x: { type: "NUMBER" }, y: { type: "NUMBER" } }, required: ["x", "y"] };
const TONE_ENUM = { type: "STRING", enum: ["error", "good", "info", "none"] };

const BOARD_SCHEMA = {
  type: "OBJECT",
  properties: {
    players: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          team: { type: "STRING", enum: ["us", "them"] },
          x: { type: "NUMBER" },
          y: { type: "NUMBER" },
          role: S("Short position tag if clear, e.g. GK, LB, CB, DM, ST — else empty."),
          tone: TONE_ENUM,
        },
        required: ["team", "x", "y", "role", "tone"],
      },
    },
    ball: BPT,
    lines: {
      type: "ARRAY",
      description: "Our team's lines (defence, midfield) connecting those players left to right.",
      items: {
        type: "OBJECT",
        properties: { label: S("e.g. 'Back line'"), tone: TONE_ENUM, points: { type: "ARRAY", items: BPT } },
        required: ["label", "tone", "points"],
      },
    },
    arrows: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: { label: S("Max 4 words."), tone: TONE_ENUM, from: BPT, to: BPT },
        required: ["label", "tone", "from", "to"],
      },
    },
    zones: {
      type: "ARRAY",
      description: "Open space that was exploited.",
      items: {
        type: "OBJECT",
        properties: { label: S("Max 4 words."), tone: TONE_ENUM, points: { type: "ARRAY", items: BPT } },
        required: ["label", "tone", "points"],
      },
    },
  },
  required: ["players", "lines", "arrows", "zones"],
};

const BOARD_SYSTEM = `You are a football analyst turning one camera frame into a top-down 2D tactics board.

Pitch coordinates are 0-100 on both axes, from the ANALYSED team's point of view as they attack:
- y = 0 is the analysed team's OWN goal line, y = 100 the opponent's goal line.
- x = 0 is the analysed team's left touchline, x = 100 their right touchline.
Work out which goal the analysed team defends from the context, then use the pitch markings (penalty box, centre circle, halfway line, touchlines) to place every VISIBLE player as accurately as you can. Do not add players who are out of frame.

tone: "error" for players at fault in this moment, "good" for players who did well, "info" for key context (ball carrier, runner), "none" otherwise.
Lines: the analysed team's defensive line and midfield line, through those players left to right.
Arrows: key runs/passes, and where a player should have moved (tone "good").
Zones: open space that was exploited (tone "error").`;

const pct = (n: unknown) => Math.max(0, Math.min(100, Number(n) || 0));
const bpt = (p: unknown): BoardPt => ({ x: pct((p as BoardPt)?.x), y: pct((p as BoardPt)?.y) });
const btone = (t: unknown): BoardTone => (["error", "good", "info"] as const).find((x) => x === t) ?? "none";

export async function boardFrame(
  imageBase64: string,
  mimeType: string,
  moment: Pick<Moment, "kind" | "headline" | "who" | "detail" | "fix">,
  ctx: Pick<ClipContext, "myTeamColour" | "opponentColour">,
): Promise<Board> {
  const brief = [
    `Analysed team ("us") kit: ${ctx.myTeamColour}.`,
    ctx.opponentColour ? `Opponent ("them") kit: ${ctx.opponentColour}.` : "",
    `Moment: ${moment.headline}. ${moment.who ? `Who: ${moment.who}. ` : ""}${moment.detail}`,
    moment.fix ? `What should have happened: ${moment.fix}` : "",
    "Build the 2D board for this frame.",
  ].filter(Boolean);

  const r = await generateJson<Record<string, unknown>>(
    [{ inlineData: { mimeType, data: imageBase64 } }, { text: brief.join("\n") }],
    BOARD_SYSTEM,
    BOARD_SCHEMA,
  );
  const arr = (v: unknown) => (Array.isArray(v) ? v : []) as Array<Record<string, unknown>>;
  const label = (v: unknown) => (typeof v === "string" ? v.slice(0, 40) : "");
  return {
    players: arr(r.players)
      .slice(0, 30)
      .map((p) => ({ team: p.team === "them" ? "them" : "us", ...bpt(p), role: label(p.role).slice(0, 4), tone: btone(p.tone) })),
    ball: r.ball ? bpt(r.ball) : undefined,
    lines: arr(r.lines)
      .map((l) => ({ label: label(l.label), tone: btone(l.tone), points: arr(l.points).map(bpt) }))
      .filter((l) => l.points.length >= 2),
    arrows: arr(r.arrows).map((a) => ({ label: label(a.label), tone: btone(a.tone), from: bpt(a.from), to: bpt(a.to) })),
    zones: arr(r.zones)
      .map((z) => ({ label: label(z.label), tone: btone(z.tone), points: arr(z.points).map(bpt) }))
      .filter((z) => z.points.length >= 3),
  };
}
