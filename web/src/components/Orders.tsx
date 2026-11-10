"use client";

import { useEffect, useState } from "react";
import { dictionaries, type Lang } from "@/lib/i18n";
import { lookUp, REQUESTS_CHANGED, SongRequest, type Visitor } from "./SongRequest";

/**
 * The orders page: the songs the signed-in visitor asked for and is waiting
 * for (a song leaves the list when an admin presses Done on it), numbered
 * like a setlist, and the button for asking for more. Signing in is done in
 * that button's dialog; the page looks again whenever the dialog signs in or
 * out or sends a song.
 */
export function Orders({ lang }: { lang: Lang }) {
  const t = dictionaries[lang];
  // Undefined until it has been looked up.
  const [found, setFound] = useState<{ visitor: Visitor | null; credits: number; asked: string[] }>();

  useEffect(() => {
    let current = true;
    const look = () =>
      void lookUp().then((now) => {
        if (current) setFound(now);
      });
    look();
    window.addEventListener(REQUESTS_CHANGED, look);
    return () => {
      current = false;
      window.removeEventListener(REQUESTS_CHANGED, look);
    };
  }, []);

  const credits = found?.credits ?? 0;
  return (
    <main className="mx-auto w-full max-w-lg px-6 pt-32 pb-24 sm:pt-40">
      <h1 className="font-display text-4xl tracking-tight sm:text-5xl">{t.orders.title}</h1>
      {found?.visitor && credits > 0 && (
        <p className="mt-2 text-sm text-brass-bright">
          {credits === 1 ? t.request.leftOne : t.request.leftMany.replace("{n}", String(credits))}
        </p>
      )}
      {found === undefined ? (
        <div aria-hidden="true" className="h-28" />
      ) : !found.visitor ? (
        <p className="mt-6 leading-relaxed text-cream">{t.orders.signedOut}</p>
      ) : found.asked.length === 0 ? (
        <p className="mt-6 leading-relaxed text-cream">{t.orders.empty}</p>
      ) : (
        <ol className="mt-8 overflow-hidden rounded-2xl border border-line bg-coal">
          {found.asked.map((title, i) => (
            <li key={i} className="flex items-baseline gap-3.5 border-t border-line pr-4 pl-5 first:border-t-0">
              <span aria-hidden="true" className="w-4 shrink-0 font-display text-xl text-brass-bright">
                {i + 1}
              </span>
              <span className="min-w-0 flex-1 py-3.5 font-display text-lg break-words text-cream sm:text-xl">{title}</span>
            </li>
          ))}
        </ol>
      )}
      {found !== undefined && (
        <div className="mt-8">
          <SongRequest lang={lang} t={t.request} />
        </div>
      )}
    </main>
  );
}
