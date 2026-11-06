import Link from "next/link";
import { dictionaries, href, type Lang } from "@/lib/i18n";
import type { Song } from "@/lib/supabase";
import { Player } from "./Player";

/** A song's title and its player. Used for published songs and for an admin's draft preview. */
export function SongView({ lang, song, draft = false }: { lang: Lang; song: Song; draft?: boolean }) {
  const t = dictionaries[lang];
  const details = [
    { label: t.song.firstPerformed, value: song.first_performed },
    { label: t.song.firstSinger, value: song.first_singer },
    { label: t.song.singer, value: song.artist },
  ].filter((detail) => detail.value);
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
      <h1 className="rise mt-10 font-display text-5xl leading-[1.08] tracking-tight [animation-delay:80ms] sm:text-7xl">
        {song.title || t.admin.untitled}
      </h1>
      {details.length > 0 && (
        <dl className="rise mt-8 grid gap-x-10 gap-y-4 [animation-delay:160ms] sm:flex sm:flex-wrap">
          {details.map((detail) => (
            <div key={detail.label}>
              <dt className="text-xs text-sand">{detail.label}</dt>
              <dd className="mt-1 text-cream">{detail.value}</dd>
            </div>
          ))}
        </dl>
      )}
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
