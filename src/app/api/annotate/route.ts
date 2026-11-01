import { NextResponse } from "next/server";
import { annotateFrame, boardFrame } from "@/lib/gemini";
import type { Moment } from "@/lib/types";

// One still frame (captured in the browser at a moment's timestamp) →
// telestration shapes (mode "draw", default) or a 2D tactics board (mode "board").
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MAX_IMAGE_CHARS = 4_000_000; // ~3 MB of base64 — keeps under Vercel's body cap

const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const image = str(body.image, MAX_IMAGE_CHARS + 100);
  const m = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(image);
  if (!m || m[2].length > MAX_IMAGE_CHARS) return NextResponse.json({ error: "Invalid frame" }, { status: 400 });

  const raw = (body.moment ?? {}) as Partial<Moment>;
  const moment = {
    kind: raw.kind === "good" || raw.kind === "key" ? raw.kind : ("error" as const),
    headline: str(raw.headline, 120),
    who: str(raw.who, 120),
    detail: str(raw.detail, 600),
    fix: str(raw.fix, 600) || undefined,
  };
  const myTeamColour = str(body.myTeamColour, 40);
  if (!moment.detail || !myTeamColour) return NextResponse.json({ error: "Missing moment" }, { status: 400 });

  try {
    const ctx = { myTeamColour, opponentColour: str(body.opponentColour, 40) || undefined };
    if (body.mode === "board") return NextResponse.json({ board: await boardFrame(m[2], m[1], moment, ctx) });
    return NextResponse.json({ annotation: await annotateFrame(m[2], m[1], moment, ctx) });
  } catch (e) {
    console.error("annotate error", e);
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json(
      { error: msg.includes("(429)") ? "Rate limited — try again in a minute" : "Couldn't draw this frame" },
      { status: 502 },
    );
  }
}
