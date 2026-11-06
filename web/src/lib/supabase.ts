import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;

/** Name of the storage bucket that holds every song's stems. */
export const STEMS_BUCKET = "stems";

// /admin logins are usernames; Supabase wants an email, so "maria" signs in as
// maria@<this domain>. Keep in sync with ADMIN_EMAIL_DOMAIN in worker.py.
export const ADMIN_EMAIL_DOMAIN = "admin.penia.app";

export type SongStatus = "queued" | "processing" | "draft" | "published" | "failed";

export type Song = {
  id: string;
  slug: string;
  youtube_id: string;
  youtube_url: string;
  title: string;
  /** Who sings in this recording. */
  artist: string;
  /** When the song was first performed: free text, often only a year. */
  first_performed: string;
  first_singer: string;
  status: SongStatus;
  step: string;
  step_detail: string;
  error: string;
  duration_seconds: number | null;
  /** Stem name -> path in the stems bucket. */
  stems: Record<string, string>;
  created_at: string;
  published_at: string | null;
};

let browserClient: SupabaseClient | undefined;

/** The client for the browser. It remembers an admin's sign-in. */
export function supabaseBrowser(): SupabaseClient {
  browserClient ??= createClient(URL, KEY);
  return browserClient;
}

/** A client with a visitor's rights only, for rendering pages on the server. */
export function supabasePublic(): SupabaseClient {
  return createClient(URL, KEY, { auth: { persistSession: false, autoRefreshToken: false } });
}
