import { NextResponse } from "next/server";
import { CLIPS_BUCKET, supabaseAdmin } from "@/lib/supabaseAdmin";
import {
  MAX_CLIP_SECONDS,
  analyseClip,
  deleteGeminiFile,
  uploadToGemini,
  waitUntilActive,
} from "@/lib/gemini";
import type { ClipContext } from "@/lib/types";

// Storage → Gemini Files API → wait for processing → structured analysis.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");

export async function POST(request: Request) {
  if (!supabaseAdmin) return NextResponse.json({ error: "Server not configured" }, { status: 500 });

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const path = str(body.path, 200);
  if (!/^[\w-]+\.(mp4|mov|webm)$/.test(path)) return NextResponse.json({ error: "Invalid clip" }, { status: 400 });

  const ctx: ClipContext = {
    myTeamColour: str(body.myTeamColour, 40),
    opponentColour: str(body.opponentColour, 40) || undefined,
    format: str(body.format, 10) || undefined,
    notes: str(body.notes, 500) || undefined,
    durationSec: typeof body.durationSec === "number" ? body.durationSec : undefined,
  };
  if (!ctx.myTeamColour) return NextResponse.json({ error: "Tell us your team's kit colour" }, { status: 400 });
  if (ctx.durationSec && ctx.durationSec > MAX_CLIP_SECONDS) {
    return NextResponse.json({ error: `Clip must be ${MAX_CLIP_SECONDS} seconds or less` }, { status: 400 });
  }

  const bucket = supabaseAdmin.storage.from(CLIPS_BUCKET);
  let geminiName: string | null = null;
  try {
    const { data: blob, error } = await bucket.download(path);
    if (error || !blob) return NextResponse.json({ error: "Clip not found — upload it again" }, { status: 404 });

    const file = await uploadToGemini(await blob.arrayBuffer(), blob.type || "video/mp4", path);
    geminiName = file.name;
    await waitUntilActive(file.name);
    const analysis = await analyseClip(file, ctx);
    return NextResponse.json({ analysis });
  } catch (e) {
    console.error("analysis error", e);
    const msg = e instanceof Error ? e.message : String(e);
    const friendly = msg.includes("(429)")
      ? "The analyser is busy right now — try again in a minute."
      : "Analysis failed. Try again, or try a shorter clip.";
    return NextResponse.json({ error: friendly }, { status: 502 });
  } finally {
    // Don't keep footage around once it's been analysed.
    if (geminiName) await deleteGeminiFile(geminiName);
    await bucket.remove([path]).catch(() => undefined);
  }
}
