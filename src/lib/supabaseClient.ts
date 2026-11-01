"use client";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Browser client — only used to upload clips with a signed upload URL.
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

export const supabase: SupabaseClient | null =
  url && anonKey ? createClient(url, anonKey, { auth: { persistSession: false } }) : null;
