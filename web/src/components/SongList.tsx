import Link from "next/link";
import { dictionaries, formatTime, href, type Lang } from "@/lib/i18n";
import { getPublishedSongs } from "@/lib/songs";

/** The published songs, laid out like a setlist. */
export async function SongList({ lang }: { lang: Lang }) {
  const t = dictionaries[lang];
  const songs = await getPublishedSongs();
  if (songs.length === 0) return <p className="mt-14 text-sand">{t.songs.empty}</p>;
  return (
    <ol className="mt-14 border-t border-line">
      {songs.map((song, i) => (
        <li key={song.id} className="border-b border-line">
          <Link
            href={href(lang, `/songs/${song.slug}`)}
            className="group flex items-baseline gap-5 py-6 transition-colors sm:gap-8 sm:py-7"
          >
            <span className="w-7 shrink-0 text-sm text-sand tabular-nums">{String(i + 1).padStart(2, "0")}</span>
            <span className="min-w-0 flex-1">
              <span className="block font-display text-2xl leading-snug transition-colors group-hover:text-brass-bright sm:text-4xl">
                {song.title || t.admin.untitled}
              </span>
              <span className="mt-1 block text-sm text-sand sm:text-base">{song.artist || t.songs.unknownArtist}</span>
            </span>
            {song.duration_seconds ? (
              <span className="text-sm text-sand tabular-nums">{formatTime(song.duration_seconds)}</span>
            ) : null}
            <span
              aria-hidden="true"
              className="text-xl text-sand transition-all group-hover:translate-x-1.5 group-hover:text-brass-bright"
            >
              →
            </span>
            <span className="sr-only">{t.songs.open}</span>
          </Link>
        </li>
      ))}
    </ol>
  );
}

export function SongListSkeleton() {
  return (
    <div aria-hidden="true" className="mt-14 border-t border-line">
      {[0, 1, 2].map((i) => (
        <div key={i} className="flex items-center gap-8 border-b border-line py-8">
          <span className="h-3 w-6 rounded bg-cream/10" />
          <span className="h-7 w-1/2 rounded bg-cream/10" />
        </div>
      ))}
    </div>
  );
}
