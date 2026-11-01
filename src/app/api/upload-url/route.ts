import { NextResponse } from "next/server";
import { CLIPS_BUCKET, MAX_CLIP_BYTES, supabaseAdmin } from "@/lib/supabaseAdmin";

// Issues a one-off signed upload URL so the browser can send the clip straight
// to Supabase Storage (Vercel caps request bodies at ~4.5 MB, too small for video).
export const dynamic = "force-dynamic";

const EXT: Record<string, string> = { "video/mp4": "mp4", "video/quicktime": "mov", "video/webm": "webm" };

export async function POST(request: Request) {
  if (!supabaseAdmin) return NextResponse.json({ error: "Server not configured" }, { status: 500 });

  const body = (await request.json().catch(() => ({}))) as { type?: string; size?: number };
  const ext = EXT[body.type ?? ""];
  if (!ext) return NextResponse.json({ error: "Upload an MP4, MOV or WebM video" }, { status: 400 });
  if (!body.size || body.size > MAX_CLIP_BYTES) {
    return NextResponse.json({ error: "Clip must be under 50 MB" }, { status: 400 });
  }

  const path = `${Date.now()}-${crypto.randomUUID()}.${ext}`;
  const { data, error } = await supabaseAdmin.storage.from(CLIPS_BUCKET).createSignedUploadUrl(path);
  if (error || !data) {
    console.error("upload-url error", error);
    return NextResponse.json({ error: `Could not start upload: ${error?.message ?? "unknown error"}` }, { status: 500 });
  }
  return NextResponse.json({ path: data.path, token: data.token });
}
