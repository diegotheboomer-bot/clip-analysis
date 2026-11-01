# Clip Analysis

Upload a short football clip (e.g. a goal conceded, exported from Veo) and get an
AI coaching breakdown: what was done well, why the goal went in, what should have
happened — each point with a clickable timestamp.

Next.js 14 · Gemini API (video understanding) · Supabase Storage.

## How it works

1. browser → Supabase Storage (signed upload, since Vercel caps request bodies at ~4.5 MB)
   → `/api/analyse` → Gemini watches the clip → timestamped breakdown. The clip is
   deleted from Supabase and Gemini straight after.
2. The browser grabs a still frame at each moment and sends it to `/api/annotate`;
   Gemini returns telestration shapes (player rings, arrows, lines, open zones) on its
   0-1000 coordinate grid, which are drawn over the paused video and the moment cards.

There is no login: anyone who can reach the app can use your Gemini credits, so
add protection before hosting it publicly.

## Setup

1. Supabase: run `supabase/clips-storage.sql` in the SQL Editor (creates the private `clips` bucket).
2. Env vars (see `.env.example`):
   - `GEMINI_API_KEY`
   - `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` (Project Settings → API)
   - optional `GEMINI_ANALYSIS_MODEL` (default `gemini-4-argon` — paid-only; set `gemini-3.8-flash` for the free tier)
   - optional `GEMINI_DETECT_MODEL` (default `gemini-robotics-er-2-preview`, finds the ball + players on each frame)
   - optional `ROBOFLOW_API_KEY` — adds Roboflow player detection and pitch-line calibration, so the frame check gets measured distances (positions assume a standard-size pitch; with too few pitch lines visible, nothing is measured)
3. `npm install && npm run dev`, or import the repo into Vercel (preset: Next.js).
