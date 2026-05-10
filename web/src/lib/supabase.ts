import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

if (!url || !anonKey) {
  // Don't throw — let the UI render an empty-state message instead of a white screen.
  // eslint-disable-next-line no-console
  console.warn("VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY missing — Supabase reads will fail.");
}

export const supabase = createClient(url ?? "http://invalid", anonKey ?? "invalid", {
  auth: { persistSession: false },
});
