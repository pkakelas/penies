import Link from "next/link";
import { dictionaries, href, type Lang } from "@/lib/i18n";
import type { Song } from "@/lib/supabase";
import { Player } from "./Player";

/** A song's title and its player. Used for published songs and for an admin's draft preview. */
export function SongView({ lang, song, draft = false }: { lang: Lang; song: Song; draft?: boolean }) {
  const t = dictionaries[lang];
  return (
    <main className="mx-auto w-full max-w-3xl px-6 pt-32 pb-24 sm:px-10 sm:pt-40">
      <Link
        href={`${href(lang, "/")}#songs`}
        className="group inline-flex items-center gap-2 text-sm text-sand transition-colors hover:text-cream"
      >
        <span aria-hidden="true" className="transition-transform group-hover:-translate-x-1">
          ←
        </span>
        {t.player.back}
      </Link>
      {draft && (
        <p className="mt-8 w-fit rounded-full border border-wine/60 px-3.5 py-1 text-xs tracking-wide text-wine">
          {t.player.draft}
        </p>
      )}
      <p className="rise mt-10 text-xs font-medium tracking-[0.28em] text-brass uppercase">
        {song.artist || t.songs.unknownArtist}
      </p>
      <h1 className="rise mt-4 font-display text-5xl leading-[1.08] tracking-tight [animation-delay:80ms] sm:text-7xl">
        {song.title || t.admin.untitled}
      </h1>
      <Player key={song.id} lang={lang} song={song} />
      <a
        href={song.youtube_url}
        target="_blank"
        rel="noreferrer"
        className="mt-8 inline-flex items-center gap-2 text-sm text-sand transition-colors hover:text-brass-bright"
      >
        {t.player.original}
        <span aria-hidden="true">↗</span>
      </a>
    </main>
  );
}
