import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Server-only, service-role client. Used just for clip storage.
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

export const supabaseAdmin: SupabaseClient | null =
  url && key
    ? createClient(url, key, {
        auth: { persistSession: false, autoRefreshToken: false },
        global: { fetch: (input, init) => fetch(input, { ...init, cache: "no-store" }) },
      })
    : null;

export const CLIPS_BUCKET = "clips";
export const MAX_CLIP_BYTES = 50 * 1024 * 1024;
