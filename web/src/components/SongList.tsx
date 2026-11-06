import Link from "next/link";
import { dictionaries, formatTime, href, type Lang } from "@/lib/i18n";
import { getPublishedSongs } from "@/lib/songs";

// Wide screens: one row per song, the details in columns under a heading.
const columns = "lg:grid-cols-[2rem_minmax(0,1fr)_7rem_minmax(0,12rem)_minmax(0,12rem)_3.5rem_1.25rem]";

/** The published songs, laid out like a setlist. */
export async function SongList({ lang }: { lang: Lang }) {
  const t = dictionaries[lang];
  const songs = await getPublishedSongs();
  if (songs.length === 0) return <p className="mt-14 text-sand">{t.songs.empty}</p>;
  return (
    <>
      <div aria-hidden="true" className={`mt-14 hidden gap-x-6 pb-3 text-xs text-sand lg:grid ${columns}`}>
        <span className="col-start-3">{t.song.firstPerformed}</span>
        <span>{t.song.firstSinger}</span>
        <span>{t.song.singer}</span>
      </div>
      <ol className="mt-14 border-t border-line lg:mt-0">
        {songs.map((song, i) => (
          <li key={song.id} className="border-b border-line">
            <Link
              href={href(lang, `/songs/${song.slug}`)}
              className={`group grid grid-cols-[2rem_minmax(0,1fr)_auto_auto] items-baseline gap-x-4 py-6 transition-colors sm:gap-x-6 sm:py-7 ${columns}`}
            >
              <span className="text-sm text-sand tabular-nums">{String(i + 1).padStart(2, "0")}</span>
              <span className="font-display text-2xl leading-snug transition-colors group-hover:text-brass-bright sm:text-4xl lg:text-3xl">
                {song.title || t.admin.untitled}
              </span>
              <dl className="col-span-3 col-start-2 row-start-2 mt-3 grid gap-x-4 gap-y-2 text-sm sm:grid-cols-[auto_minmax(0,1fr)] sm:gap-y-1 lg:contents">
                <Detail label={t.song.firstPerformed} value={song.first_performed} />
                <Detail label={t.song.firstSinger} value={song.first_singer} />
                <Detail label={t.song.singer} value={song.artist} />
              </dl>
              <span className="text-sm text-sand tabular-nums">
                {song.duration_seconds ? formatTime(song.duration_seconds) : null}
              </span>
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
    </>
  );
}

/** One detail of a song: label and value on phones and tablets, a column on wide screens. */
function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className={value ? "sm:contents" : "hidden lg:contents"}>
      <dt className="text-xs text-sand sm:text-sm lg:sr-only">{label}</dt>
      <dd className="text-cream lg:text-sm">{value || "—"}</dd>
    </div>
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
