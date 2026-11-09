import { Suspense } from "react";
import { dictionaries, type Lang } from "@/lib/i18n";
import { Footer, Header } from "./Header";
import { SongList, SongListSkeleton } from "./SongList";
import { SongRequest } from "./SongRequest";
import { Strings } from "./Strings";

/** The home page: one line saying what Penia is, then the songs. */
export function Landing({ lang }: { lang: Lang }) {
  const t = dictionaries[lang];
  return (
    <>
      <Header lang={lang} page="/" />
      <main>
        <section className="relative isolate overflow-hidden">
          {/* Two soft lamps on a dark stage. */}
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(55%_45%_at_72%_4%,rgb(217_164_65/0.17),transparent_70%),radial-gradient(40%_40%_at_6%_62%,rgb(194_84_63/0.09),transparent_70%)]"
          />
          <div className="mx-auto max-w-6xl px-6 pt-36 sm:px-10 sm:pt-48">
            <h1 className="rise font-display text-[clamp(2.7rem,8.2vw,6.75rem)] leading-[1.03] tracking-tight">
              {t.hero.title} <em className="text-brass-bright">{t.hero.titleEm}</em>
            </h1>
          </div>
          <div className="mt-6 sm:mt-2">
            <Strings />
          </div>
        </section>

        {/* At least a screen tall, so the search box stays where it is when a search shortens the list. */}
        <section id="songs" className="min-h-dvh scroll-mt-10 border-t border-line bg-coal">
          <div className="mx-auto max-w-6xl px-6 py-24 sm:px-10 sm:py-32">
            <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-6">
              <h2 className="font-display text-5xl tracking-tight sm:text-6xl">{t.songs.title}</h2>
              <SongRequest lang={lang} t={t.request} />
            </div>
            <Suspense fallback={<SongListSkeleton />}>
              <SongList lang={lang} />
            </Suspense>
          </div>
        </section>
      </main>
      <Footer lang={lang} />
    </>
  );
}
