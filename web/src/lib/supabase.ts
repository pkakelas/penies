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
  /**
   * Where the playable part starts and ends, in seconds from the start of
   * the recording; null means the recording's own start or end. Set in /admin
   * to cut an intro or an outro. The player behaves as if the song began and
   * ended there.
   */
  start_seconds: number | null;
  end_seconds: number | null;
  /** Stem name -> path in the stems bucket. */
  stems: Record<string, string>;
  /** Place in the landing page's list, from 1. Null: not placed yet, shown first. */
  sort_order: number | null;
  created_at: string;
  published_at: string | null;
};

/** The order of the landing page's list: placed songs by their number, unplaced ones first, newest first. */
export function orderSongs<T extends Pick<Song, "sort_order" | "published_at">>(songs: T[]): T[] {
  return [...songs].sort((a, b) => {
    if (a.sort_order !== b.sort_order) {
      if (a.sort_order === null) return -1;
      if (b.sort_order === null) return 1;
      return a.sort_order - b.sort_order;
    }
    return (b.published_at ?? "").localeCompare(a.published_at ?? "");
  });
}

/**
 * The part of the recording that is played: [start, end] in seconds.
 * `end` is null while the recording's length is unknown and no end is set.
 */
export function playableRange(song: Pick<Song, "start_seconds" | "end_seconds" | "duration_seconds">) {
  const start = Math.max(0, song.start_seconds ?? 0);
  const end = song.end_seconds ?? song.duration_seconds;
  return { start, end: end !== null && end > start ? end : null };
}

/** How long the song plays for, in seconds, or null while unknown. */
export function playableLength(song: Pick<Song, "start_seconds" | "end_seconds" | "duration_seconds">): number | null {
  const { start, end } = playableRange(song);
  return end === null ? null : end - start;
}

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
