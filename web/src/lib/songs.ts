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
