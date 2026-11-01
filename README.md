# Clip Analysis

Upload a short football clip (e.g. a goal conceded, exported from Veo) and get an
AI coaching breakdown: what was done well, why the goal went in, what should have
happened — each point with a clickable timestamp.

Next.js 14 · Gemini API (video understanding) · Supabase Storage.

## How it works

browser → Supabase Storage (signed upload, since Vercel caps request bodies at ~4.5 MB)
→ `/api/analyse` → Gemini Files API → structured JSON. The clip is deleted from
Supabase and Gemini straight after.

There is no login: anyone who can reach the app can use your Gemini credits, so
add protection before hosting it publicly.

## Setup

1. Supabase: run `supabase/clips-storage.sql` in the SQL Editor (creates the private `clips` bucket).
2. Env vars (see `.env.example`):
   - `GEMINI_API_KEY`
   - `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` (Project Settings → API)
   - optional `GEMINI_ANALYSIS_MODEL` (default `gemini-3.8-flash`)
3. `npm install && npm run dev`, or import the repo into Vercel (preset: Next.js).
