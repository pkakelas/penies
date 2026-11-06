"use client";

import { useEffect, useState } from "react";
import { dictionaries, type Lang } from "@/lib/i18n";
import { supabaseBrowser, type Song } from "@/lib/supabase";
import { SongView } from "./SongView";

/**
 * Shown when no published song has this address. Asks again with the
 * browser's own sign-in: an admin gets their draft to test, anyone else is
 * told the song does not exist.
 */
export function DraftPreview({ lang, slug }: { lang: Lang; slug: string }) {
  const t = dictionaries[lang];
  // undefined while asking, null when there is no such song
  const [song, setSong] = useState<Song | null | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    supabaseBrowser()
      .from("songs")
      .select("*")
      .eq("slug", slug)
      .maybeSingle()
      .then(({ data }) => {
        const found = data as Song | null;
        // A song that is still being split has nothing to play yet.
        if (!cancelled) setSong(found && found.stems["instruments"] ? found : null);
      });
    return () => {
      cancelled = true;
    };
  }, [slug]);

  if (song) return <SongView lang={lang} song={song} draft={song.status !== "published"} />;
  return (
    <main className="mx-auto w-full max-w-3xl px-6 pt-40 pb-24 sm:px-10">
      <p className="font-display text-3xl text-sand">{song === null ? t.player.notFound : t.player.checking}</p>
    </main>
  );
}
