"use client";

import { useState, type ReactNode } from "react";
import type { Dict, Lang } from "@/lib/i18n";
import { search } from "@/lib/search";
import { SongRequest } from "./SongRequest";

/** One song of the list: its row as drawn by SongList, and searchKey() of the text it is found by. */
export type SongRow = { id: string; key: string; row: ReactNode };

/**
 * The song list under a search box. Typing hides the songs that do not match;
 * when none is left, the visitor can ask for what they typed.
 */
export function SongSearch(props: { lang: Lang; t: Dict["songs"]; request: Dict["request"]; songs: SongRow[] }) {
  const { lang, t, request, songs } = props;
  const [query, setQuery] = useState("");
  const shown = search(
    songs.map((song) => song.key),
    query,
  );
  const none = !shown.includes(true);

  return (
    <>
      <label className="relative mt-10 block sm:max-w-sm">
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
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t.searchPlaceholder}
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          enterKeyHint="search"
          className="w-full rounded-full border border-line bg-ink py-3 pr-5 pl-12 text-base text-cream placeholder:text-sand/60 transition-colors focus:border-brass focus:outline-none"
        />
      </label>
      <ol hidden={none} className="mt-10 border-t border-line">
        {songs.map((song, i) => (
          <li key={song.id} hidden={!shown[i]} className="border-b border-line">
            {song.row}
          </li>
        ))}
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
