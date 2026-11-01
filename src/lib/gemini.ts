// ──────────────────────────────────────────────────────────────────────────
// AI clip analysis — SERVER ONLY.
//
// Takes a short match clip (e.g. a conceded goal from Veo), sends it to Gemini
// via the Files API and gets back a structured coaching breakdown: what was
// done well, why the goal went in, and what should have happened — every point
// tied to a MM:SS timestamp so it can be checked against the video.
//
// Phase 1 is Gemini-only. Phase 2 will add measured tracking data (player/ball
// positions from a CV model) to the prompt so the tactical calls are grounded
// in numbers rather than the model's eye.
// ──────────────────────────────────────────────────────────────────────────

import "server-only";

const GEMINI_KEY = process.env.GEMINI_API_KEY ?? "";
export const ANALYSIS_MODEL = process.env.GEMINI_ANALYSIS_MODEL ?? "gemini-3.8-flash";
const BASE = "https://generativelanguage.googleapis.com";

export const MAX_CLIP_SECONDS = 120;

export interface ClipContext {
  myTeamColour: string;
  opponentColour?: string;
  format?: string; // "11v11", "7v7", …
  notes?: string;
  durationSec?: number;
}

export interface TimedPoint {
  time: string;
  who: string;
  what: string;
  why: string;
}

export interface ClipCause {
  time: string;
  who: string;
  what_went_wrong: string;
  what_should_have_happened: string;
  severity: "major" | "minor";
}

export interface ClipAnalysis {
  outcome: string;
  summary: string;
  key_moment: { time: string; description: string };
  done_well: TimedPoint[];
  goal_causes: ClipCause[];
  coaching_points: string[];
  unclear: string[];
}

const S = (description: string) => ({ type: "STRING", description });

// Gemini structured-output schema (OpenAPI subset) mirroring ClipAnalysis.
const RESPONSE_SCHEMA = {
  type: "OBJECT",
  properties: {
    outcome: S("One line: what happens in the clip, e.g. 'Goal conceded from a cut-back after a turnover'."),
    summary: S("3-5 sentence tactical summary of the sequence from the analysed team's point of view."),
    key_moment: {
      type: "OBJECT",
      properties: { time: S("MM:SS"), description: S("The single moment the goal was decided.") },
      required: ["time", "description"],
    },
    done_well: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          time: S("MM:SS"),
          who: S("Player or unit, by colour + position (+ number only if readable)."),
          what: S("What was done well."),
          why: S("Why it matters tactically."),
        },
        required: ["time", "who", "what", "why"],
      },
    },
    goal_causes: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          time: S("MM:SS"),
          who: S("Player or unit, by colour + position (+ number only if readable)."),
          what_went_wrong: S("The specific error or tactical problem."),
          what_should_have_happened: S("The correct decision/positioning."),
          severity: { type: "STRING", enum: ["major", "minor"] },
        },
        required: ["time", "who", "what_went_wrong", "what_should_have_happened", "severity"],
      },
    },
    coaching_points: { type: "ARRAY", items: S("A short, actionable training/coaching point.") },
    unclear: { type: "ARRAY", items: S("Anything that could not be judged from the footage, and why.") },
  },
  required: ["outcome", "summary", "key_moment", "done_well", "goal_causes", "coaching_points", "unclear"],
};

const SYSTEM = `You are an elite football (soccer) video analyst and UEFA Pro Licence coach reviewing amateur match footage, usually from a Veo camera (wide, elevated, auto-panning).

Analyse the clip from the point of view of the team the user names (the "analysed team"). Look closely at:
- Defensive line: height, flatness/stagger, stepping up vs dropping, offside trap, distances between centre-backs and between full-back and centre-back.
- Shape & compactness: distances between lines (defence-midfield-attack), horizontal compactness, ball-side overload, cover and balance.
- Individual defending: pressure on the ball, body shape, showing inside/outside, tracking runners, ball-watching, when a centre-back should step out or hold.
- Transitions: rest-defence before losing the ball, counter-press or recovery runs after it.
- Goalkeeper: starting position, angle, set position at the shot, decision to come or stay, handling, communication/organisation.
- The attack: how the opponent created and finished the chance.

Rules:
- Every point MUST have a MM:SS timestamp from the clip.
- Only describe what is actually visible. Never invent shirt numbers or names; refer to players by kit colour and position (e.g. "blue left centre-back"). Use a number only if clearly readable.
- If something can't be judged (out of frame, camera angle, blur), put it in "unclear" instead of guessing.
- Be honest and specific, like a coach in a video session. Credit good actions even in a goal conceded.
- If the clip does not show a goal conceded, still analyse the sequence; "goal_causes" then lists what went wrong defensively (or is empty).`;

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

interface GeminiFile {
  name: string;
  uri: string;
  mimeType: string;
  state?: string;
}

// Files API resumable upload: start a session, then send the bytes + finalize.
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

export async function analyseClip(file: GeminiFile, ctx: ClipContext): Promise<ClipAnalysis> {
  // Football is fast: sample well above the 1 fps default. Short clips can
  // afford more frames (each frame is a few hundred tokens).
  const fps = (ctx.durationSec ?? 30) <= 60 ? 5 : 2;

  const lines = [
    `Analysed team kit colour: ${ctx.myTeamColour}.`,
    ctx.opponentColour ? `Opponent kit colour: ${ctx.opponentColour}.` : "",
    ctx.format ? `Format: ${ctx.format}.` : "",
    ctx.notes ? `Context from the coach: ${ctx.notes}` : "",
    "Break down this clip.",
  ].filter(Boolean);

  const res = await gemini(`/v1beta/models/${ANALYSIS_MODEL}:generateContent`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: SYSTEM }] },
      contents: [
        {
          role: "user",
          parts: [
            { fileData: { fileUri: file.uri, mimeType: file.mimeType }, videoMetadata: { fps } },
            { text: lines.join("\n") },
          ],
        },
      ],
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema: RESPONSE_SCHEMA,
      },
    }),
  });
  if (!res.ok) await fail(res, "analysis");

  const json = (await res.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string; thought?: boolean }> } }>;
  };
  const text = (json.candidates?.[0]?.content?.parts ?? [])
    .filter((p) => !p.thought && p.text)
    .map((p) => p.text)
    .join("");
  if (!text) throw new Error("Gemini returned an empty analysis");
  return JSON.parse(text) as ClipAnalysis;
}
