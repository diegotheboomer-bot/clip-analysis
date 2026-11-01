import { NextResponse } from "next/server";
import { annotateFrame } from "@/lib/gemini";
import { parseDetection, parseFrame, str } from "@/lib/frameRequest";
import type { Moment } from "@/lib/types";

// A frame with every detected person numbered on it + the detection itself →
// a check of the claim against the frame, and telestration shapes.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const frame = parseFrame(body.image);
  if (!frame) return NextResponse.json({ error: "Invalid frame" }, { status: 400 });

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
    const annotation = await annotateFrame(frame.data, frame.mime, parseDetection(body.detection), moment, {
      myTeamColour,
      opponentColour: str(body.opponentColour, 40) || undefined,
    });
    return NextResponse.json({ annotation });
  } catch (e) {
    console.error("annotate error", e);
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg.includes("(429)") ? "Rate limited — try again in a minute" : "Couldn't draw this frame" }, { status: 502 });
  }
}
