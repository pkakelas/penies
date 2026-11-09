"use client";

import { useState, type ReactNode } from "react";
import type { Dict, Lang } from "@/lib/i18n";
import { search } from "@/lib/search";
import { SongRequest } from "./SongRequest";

/**
 * One song of the list: its row as drawn by SongList, searchKey() of the text
 * it is found by, and searchKey() of each of its composers and singers.
 */
export type SongRow = { id: string; key: string; composers: string[]; singers: string[]; row: ReactNode };

/** A row of buttons that narrow the list: one per composer, or one per singer, with how many songs each has. */
export type Filter = {
  by: "composers" | "singers";
  label: string;
  people: { id: string; name: string; count: number }[];
};

const chip = "shrink-0 rounded-full border px-4 py-2 text-sm whitespace-nowrap transition-colors";
const chipOff = "border-line text-sand hover:border-cream/40 hover:text-cream";
const chipOn = "border-brass bg-brass font-medium text-ink";

/**
 * The song list under a search box and rows of buttons, one row for the
 * composers and one for the singers. Typing or choosing a person hides the
 * songs that do not match; when a search leaves none, the visitor can ask for
 * what they typed. The list always ends with the row that opens the request
 * form.
 *
 * One thing narrows the list at a time: typing lets go of the person chosen,
 * and choosing a person empties the box and lets go of the one before. Two at
 * once could hide a song that is on the site, and the visitor would be invited
 * to ask for it.
 */
export function SongSearch(props: {
  lang: Lang;
  t: Dict["songs"];
  request: Dict["request"];
  songs: SongRow[];
  /** The last row, as drawn by SongList: it opens the request form. */
  blank: ReactNode;
  filters: Filter[];
}) {
  const { lang, t, request, songs, blank, filters } = props;
  const [query, setQuery] = useState("");
  const [chosen, setChosen] = useState<{ by: Filter["by"]; id: string } | null>(null);
  const shown =
    chosen === null
      ? search(
          songs.map((song) => song.key),
          query,
        )
      : songs.map((song) => song[chosen.by].includes(chosen.id));
  const none = !shown.includes(true);
  const type = (text: string) => {
    setQuery(text);
    setChosen(null);
  };
  const choose = (person: typeof chosen) => {
    setChosen(person);
    setQuery("");
  };

  return (
    <>
      <div className="mt-10 flex flex-col gap-4">
        <label className="relative block">
          <span className="sr-only">{t.search}</span>
          <svg
            viewBox="0 0 24 24"
            aria-hidden="true"
            className="pointer-events-none absolute top-1/2 left-4.5 h-4.5 w-4.5 -translate-y-1/2 text-sand"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.75"
            strokeLinecap="round"
          >
            <circle cx="10.5" cy="10.5" r="6.5" />
            <path d="m15.5 15.5 5 5" />
          </svg>
          <input
            type="search"
            value={query}
            onChange={(event) => type(event.target.value)}
            placeholder={t.searchPlaceholder}
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            enterKeyHint="search"
            className="w-full rounded-full border border-line bg-ink py-3 pr-5 pl-12 text-base text-cream placeholder:text-sand/60 transition-colors focus:border-brass focus:outline-none"
          />
        </label>
        {filters.map(({ by, label, people }) => {
          if (people.length === 0) return null;
          const on = chosen?.by === by ? chosen.id : null;
          return (
            <div key={by} role="group" aria-label={label} className="flex flex-col gap-2 sm:flex-row sm:gap-4">
              <span
                aria-hidden="true"
                className="text-[10.5px] tracking-[0.14em] text-brass/75 uppercase sm:w-20 sm:shrink-0 sm:pt-3"
              >
                {label}
              </span>
              {/* One row that scrolls sideways on a phone, to the edges of the screen; wider screens wrap it. */}
              <div className="-mx-6 -my-1.5 flex gap-2 overflow-x-auto px-6 py-1.5 [scrollbar-width:none] sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0">
                <button
                  type="button"
                  aria-pressed={on === null}
                  onClick={() => choose(null)}
                  className={`${chip} ${on === null ? chipOn : chipOff}`}
                >
                  {t.all}
                </button>
                {people.map(({ id, name, count }) => (
                  <button
                    key={id}
                    type="button"
                    aria-pressed={on === id}
                    onClick={() => choose(on === id ? null : { by, id })}
                    className={`${chip} ${on === id ? chipOn : chipOff}`}
                  >
                    {name} <span className={`ml-1 tabular-nums ${on === id ? "text-ink/60" : "text-sand/60"}`}>{count}</span>
                  </button>
                ))}
              </div>
            </div>
          );
        })}
      </div>
      <ol hidden={none} className="mt-10 border-t border-line">
        {songs.map((song, i) => (
          <li key={song.id} hidden={!shown[i]} className="border-b border-line">
            {song.row}
          </li>
        ))}
        <li className="border-b border-line">
          <SongRequest lang={lang} t={request}>
            {blank}
          </SongRequest>
        </li>
      </ol>
      {none && (
        <div className="mt-10 flex flex-wrap items-center gap-x-6 gap-y-4 border-t border-line pt-10">
          <p role="status" className="text-sand">
            {t.noMatch}
          </p>
          {/* A new form for each search, so it opens with what was typed. */}
          <SongRequest key={query} lang={lang} t={request} song={query.trim()} />
        </div>
      )}
    </>
  );
}
