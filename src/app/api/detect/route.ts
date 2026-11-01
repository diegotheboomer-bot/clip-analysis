import { NextResponse } from "next/server";
import { detectAll } from "@/lib/detect";
import { parseFrame, str } from "@/lib/frameRequest";

// One still frame → ball + every person on it (boxes, team) and, when the
// pitch lines allow, their real positions in metres.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const frame = parseFrame(body.image);
  const myTeamColour = str(body.myTeamColour, 40);
  if (!frame || !myTeamColour) return NextResponse.json({ error: "Invalid frame" }, { status: 400 });
  try {
    const detection = await detectAll(frame.data, frame.mime, { myTeamColour, opponentColour: str(body.opponentColour, 40) || undefined });
    return NextResponse.json({ detection });
  } catch (e) {
    console.error("detect error", e);
    return NextResponse.json({ error: "Couldn't read this frame" }, { status: 502 });
  }
}
