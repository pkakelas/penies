import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;

/**
 * Name of the Supabase Storage bucket that holds the stems of songs whose
 * `storage` is "supabase": the ones not copied to R2 yet.
 */
export const STEMS_BUCKET = "stems";

// /admin logins are usernames; Supabase wants an email, so "maria" signs in as
// maria@<this domain>. Keep in sync with ADMIN_EMAIL_DOMAIN in worker.py.
export const ADMIN_EMAIL_DOMAIN = "admin.penia.app";

export type SongStatus = "queued" | "processing" | "draft" | "published" | "archived" | "failed";

export type Song = {
  id: string;
  /** The page address. The database makes it from the title whenever the title changes. */
  slug: string;
  /** Addresses the song had before its title changed; the song page redirects them. */
  old_slugs: string[];
  youtube_id: string;
  youtube_url: string;
  title: string;
  /** Who sings in this recording. */
  artist: string;
  /** When the song was first performed: free text, often only a year. */
  first_performed: string;
  first_singer: string;
  /** No singer: the song has no vocals stem, and artist/first_singer say who plays. */
  instrumental: boolean;
  /** Who wrote the music. */
  composer: string;
  /** The visitor who asked for the song, as named in the request form. Empty: nobody asked. */
  requested_by: string;
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
  /**
   * Where the stems are: Cloudflare R2, or Supabase Storage for a song that
   * was not copied over yet (`uv run worker.py to-r2`). The paths are the same.
   */
  storage: "supabase" | "r2";
  /** Place in the landing page's list, from 1. Null: not placed yet, shown first. */
  sort_order: number | null;
  created_at: string;
  published_at: string | null;
};

/** A song a visitor asked for with the form on the landing page. */
export type SongRequest = {
  id: string;
  song: string;
  /** Who is asking, as typed. Null in requests from before the form asked for a name. */
  name: string | null;
  email: string;
  /** The language of the page it was sent from. */
  lang: "el" | "en";
  /** The same for the songs of one form; Stripe gives it back with the payment. Null in requests from before payments were tracked. */
  form: string | null;
  /** When Stripe said the form was paid for. Null: no payment seen (yet). */
  paid_at: string | null;
  created_at: string;
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

/**
 * Downloads a song's stems, stem name -> the file's bytes; `only` picks the
 * stems to fetch.
 *
 * From R2 the browser needs links that the database signs for whoever may
 * read the song (`stem_links`), so a draft's audio stays admin-only. The
 * links stay the same for days, which lets the browser reuse a stem it has.
 * No links means the song is still in Supabase Storage. The database is asked
 * rather than `song.storage`, because a page may hold the song's row from
 * before it moved.
 */
export async function downloadStems<Name extends string>(
  song: Pick<Song, "id" | "stems">,
  only: readonly Name[],
  onStem?: () => void,
): Promise<Partial<Record<Name, ArrayBuffer>>> {
  const client = supabaseBrowser();
  let fetchStem: (name: Name) => Promise<ArrayBuffer>;
  const { data, error } = await client.rpc("stem_links", { song_id: song.id });
  if (error) throw error;
  const links = data as Record<string, string> | null;
  if (links) {
    fetchStem = async (name) => {
      if (!links[name]) throw new Error(`no link for ${name}`);
      // The link itself is not part of the message: it would let anyone download the stem.
      const response = await fetch(links[name]).catch(() => null);
      if (!response?.ok) throw new Error(`${name}: download failed (${response?.status ?? "network"})`);
      return response.arrayBuffer();
    };
  } else {
    const storage = client.storage.from(STEMS_BUCKET);
    fetchStem = async (name) => {
      const { data, error } = await storage.download(song.stems[name]);
      if (error) throw error;
      return data.arrayBuffer();
    };
  }
  const files: Partial<Record<Name, ArrayBuffer>> = {};
  await Promise.all(
    only.map(async (name) => {
      files[name] = await fetchStem(name);
      onStem?.();
    }),
  );
  return files;
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
