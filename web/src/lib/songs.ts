import { cacheLife, cacheTag } from "next/cache";
import { supabasePublic, type Song } from "./supabase";

// Published songs change rarely: pages keep them for a few minutes, and
// /admin calls refreshSongs() (app/actions.ts) after it changes one.

export async function getPublishedSongs(): Promise<Song[]> {
  "use cache";
  cacheLife("minutes");
  cacheTag("songs");
  const { data, error } = await supabasePublic()
    .from("songs")
    .select("*")
    .eq("status", "published")
    // The same order as orderSongs() in supabase.ts, which /admin uses.
    .order("sort_order", { ascending: true, nullsFirst: true })
    .order("published_at", { ascending: false });
  if (error) throw new Error(error.message);
  return data as Song[];
}

export async function getPublishedSong(slug: string): Promise<Song | null> {
  "use cache";
  cacheLife("minutes");
  cacheTag("songs");
  const { data, error } = await supabasePublic()
    .from("songs")
    .select("*")
    .eq("status", "published")
    .eq("slug", slug)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data as Song | null;
}

/** The current address of the published song that used to be at `slug`, or null. */
export async function getMovedSongSlug(slug: string): Promise<string | null> {
  "use cache";
  cacheLife("minutes");
  cacheTag("songs");
  const { data, error } = await supabasePublic()
    .from("songs")
    .select("slug")
    .eq("status", "published")
    .contains("old_slugs", [slug])
    .limit(1)
    .maybeSingle();
  // A failed lookup only means no redirect: the page goes on to the draft preview or 404.
  if (error) {
    console.error("moved song lookup failed:", error.message);
    return null;
  }
  return data?.slug ?? null;
}
