import Link from "next/link";
import { dictionaries, formatTime, href, SITE_NAME, type Lang } from "@/lib/i18n";
import { getPublishedSongs } from "@/lib/songs";
import { searchKey } from "@/lib/search";
import { playableLength, type Song } from "@/lib/supabase";
import { SongSearch, type SongRow } from "./SongSearch";

// Old record labels came in a few colours; each song takes the next one.
const LABELS = [
  { paper: "var(--color-brass)", ink: "var(--color-ink)" },
  { paper: "var(--color-wine)", ink: "var(--color-cream)" },
  { paper: "var(--color-cream)", ink: "var(--color-ink)" },
];

const GROOVES = [76, 79, 82, 85, 88, 91, 94];

/** The published songs, each one a 78 rpm record, under a search box. */
export async function SongList({ lang }: { lang: Lang }) {
  const t = dictionaries[lang];
  const songs = await getPublishedSongs();
  if (songs.length === 0) return <p className="mt-14 text-sand">{t.songs.empty}</p>;
  const rows: SongRow[] = songs.map((song, i) => ({
    id: song.id,
    // What a song is found by: everything the list shows about it.
    key: searchKey(
      [
        song.title,
        song.composer,
        song.first_singer,
        song.artist,
        song.first_performed,
        song.instrumental ? t.song.instrumental : "",
      ].join(" "),
    ),
    row: (
      <Link
        href={href(lang, `/songs/${song.slug}`)}
        className="song group grid grid-cols-[7.5rem_minmax(0,1fr)_auto] items-center gap-x-5 gap-y-4 py-6 sm:grid-cols-[8rem_minmax(0,1fr)_auto] sm:gap-x-8 sm:gap-y-2 sm:py-6 lg:grid-cols-[9.5rem_minmax(0,1fr)_auto] lg:gap-x-10"
      >
        <span className="col-span-2 font-display text-2xl leading-tight transition-colors group-hover:text-brass-bright sm:col-span-1 sm:col-start-2 sm:row-start-1 sm:self-end sm:text-4xl lg:text-[2.75rem]">
          {song.title || t.admin.untitled}
        </span>
        <span
          aria-hidden="true"
          className="text-xl text-sand transition-all group-hover:translate-x-1.5 group-hover:text-brass-bright sm:col-start-3 sm:row-span-2 sm:row-start-1"
        >
          →
        </span>
        <Disc lang={lang} song={song} number={i + 1} />
        <Credits lang={lang} song={song} />
        <span className="sr-only">{t.songs.open}</span>
      </Link>
    ),
  }));
  return <SongSearch lang={lang} t={t.songs} request={t.request} songs={rows} />;
}

/** A record under a lamp. Its label carries the date of the first performance. */
function Disc({ lang, song, number }: { lang: Lang; song: Song; number: number }) {
  const t = dictionaries[lang];
  const label = LABELS[(number - 1) % LABELS.length];
  const date = song.first_performed || "—";
  const top = `label-top-${song.id}`;
  const bottom = `label-bottom-${song.id}`;
  return (
    <span aria-hidden="true" className="relative block aspect-square sm:row-span-2 sm:row-start-1">
      <span className="pointer-events-none absolute -inset-10 rounded-full bg-[radial-gradient(closest-side,rgb(217_164_65/0.2),transparent)] opacity-0 transition-opacity duration-700 group-hover:opacity-100" />
      <span className="disc-roll relative block rounded-full shadow-2xl shadow-black/70">
        <svg viewBox="0 0 200 200" className="disc-spin block w-full">
          <defs>
            <path id={top} d="M 44 100 A 56 56 0 0 1 156 100" />
            <path id={bottom} d="M 34 100 A 66 66 0 0 0 166 100" />
          </defs>
          <circle cx="100" cy="100" r="100" fill="#080605" />
          <circle cx="100" cy="100" r="99.25" fill="none" stroke="rgb(243 236 224 / 0.16)" strokeWidth="1.5" />
          {GROOVES.map((r) => (
            <circle key={r} cx="100" cy="100" r={r} fill="none" stroke="rgb(243 236 224 / 0.07)" strokeWidth="0.75" />
          ))}
          <circle cx="100" cy="100" r="72" fill={label.paper} />
          <circle cx="100" cy="100" r="69" fill="none" stroke={label.ink} strokeOpacity="0.35" strokeWidth="0.75" />
          <g fill={label.ink}>
            <text className="text-[13.5px] font-medium tracking-[0.1em] uppercase">
              <textPath href={`#${top}`} startOffset="50%" textAnchor="middle">
                {t.song.firstPerformed}
              </textPath>
            </text>
            <text
              x="100"
              y="90"
              textAnchor="middle"
              className="font-display text-[33px]"
              {...(date.length > 5 ? { textLength: 96, lengthAdjust: "spacingAndGlyphs" } : {})}
            >
              {date}
            </text>
            {playableLength(song) ? (
              <text x="100" y="125" textAnchor="middle" className="text-[12px] tabular-nums">
                {formatTime(playableLength(song)!)}
              </text>
            ) : null}
            <text className="text-[11px] tracking-[0.1em]">
              <textPath href={`#${bottom}`} startOffset="50%" textAnchor="middle">
                {SITE_NAME[lang]} · {String(number).padStart(2, "0")}
              </textPath>
            </text>
          </g>
          <circle cx="100" cy="100" r="4" fill="#080605" />
        </svg>
        <span className="disc-sheen absolute inset-0 rounded-full" />
      </span>
    </span>
  );
}

/** Liner notes: the composer and year on one line, then who sang it first and who sings here. */
function Credits({ lang, song }: { lang: Lang; song: Song }) {
  const t = dictionaries[lang];
  const head = [song.composer, song.first_performed].filter(Boolean).join(" · ");
  return (
    <div className="col-span-2 border-l border-brass/30 pl-4 sm:col-span-1 sm:col-start-2 sm:row-start-2 sm:self-start sm:border-0 sm:pl-0">
      {head && <p className="text-sm text-cream/85 sm:text-base">{head}</p>}
      <dl className="mt-2.5 flex flex-col gap-2.5 text-sm sm:flex-row sm:flex-wrap sm:gap-x-8 sm:gap-y-1">
        <Credit label={song.instrumental ? t.song.firstPlayer : t.song.firstSinger} value={song.first_singer} />
        <Credit label={t.song.singer} value={song.artist} />
      </dl>
    </div>
  );
}

function Credit({ label, value }: { label: string; value: string }) {
  if (!value) return null;
  return (
    <div className="flex min-w-0 flex-col gap-0.5 sm:flex-row sm:items-baseline sm:gap-2">
      <dt className="shrink-0 text-[10.5px] tracking-[0.14em] uppercase text-brass/75">{label}</dt>
      <dd className="text-cream">{value}</dd>
    </div>
  );
}

export function SongListSkeleton() {
  return (
    <div aria-hidden="true">
      <div className="mt-10 h-12.5 rounded-full border border-line bg-ink sm:max-w-sm" />
      <div className="mt-10 border-t border-line" />
      {[0, 1, 2].map((i) => (
        <div key={i} className="flex items-center gap-8 border-b border-line py-6 lg:gap-10">
          <span className="aspect-square w-30 shrink-0 rounded-full bg-cream/5 sm:w-32 lg:w-38" />
          <span className="h-9 w-1/2 rounded bg-cream/10" />
        </div>
      ))}
    </div>
  );
}
