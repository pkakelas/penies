import { dictionaries, href, SITE_NAME, type Lang } from "@/lib/i18n";
import { SongRequest } from "./SongRequest";

/** Where visitors can write to. */
const CONTACT = "pkakelas@gmail.com";

/** A bouzouki pick. */
export function PickMark({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={className}>
      <path
        d="M12 22.2c-1.5 0-2.6-1-3.6-2.6C6.2 16.2 3 10.9 3 7.3 3 3.9 7 1.8 12 1.8s9 2.1 9 5.5c0 3.6-3.2 8.9-5.4 12.3-1 1.6-2.1 2.6-3.6 2.6Z"
        fill="currentColor"
      />
    </svg>
  );
}

/**
 * Top bar. `page` is the current page's path without the language prefix
 * ("/", "/songs/atakti", "/admin"); the language switch links to the same
 * page in the other language. Every page but /admin has the button for
 * asking for songs.
 */
export function Header({ lang, page }: { lang: Lang; page: string }) {
  const t = dictionaries[lang];
  const other: Lang = lang === "el" ? "en" : "el";
  return (
    <header className="absolute inset-x-0 top-0 z-20">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-6 sm:px-10">
        <a href={href(lang, "/")} className="group flex items-center gap-2.5">
          <PickMark className="h-5 w-5 text-brass transition-transform duration-300 group-hover:-rotate-12" />
          <span className="font-display text-2xl tracking-tight">{SITE_NAME[lang]}</span>
        </a>
        <nav className="flex items-center gap-6 text-sm text-sand sm:gap-8">
          {/* On a phone there is room for this link or for the request button, not both. */}
          <a href={`${href(lang, "/")}#songs`} className={`transition-colors hover:text-cream ${page === "/admin" ? "" : "max-sm:hidden"}`}>
            {t.nav.songs}
          </a>
          {page !== "/admin" && <SongRequest lang={lang} t={t.request} header />}
          <a
            href={href(other, page)}
            hrefLang={other}
            className="rounded-full border border-line px-3 py-1 text-xs font-medium tracking-widest text-cream uppercase transition-colors hover:border-brass hover:text-brass-bright"
          >
            {other === "en" ? "EN" : "ΕΛ"}
          </a>
        </nav>
      </div>
    </header>
  );
}

export function Footer({ lang }: { lang: Lang }) {
  const t = dictionaries[lang];
  return (
    <footer className="mt-auto border-t border-line">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-x-8 gap-y-3 px-6 py-10 sm:px-10">
        <div className="flex items-center gap-2">
          <PickMark className="h-4 w-4 text-brass" />
          <span className="font-display text-lg">{SITE_NAME[lang]}</span>
        </div>
        <div className="flex flex-col gap-1 text-sm text-sand sm:items-end">
          <p>
            {t.credit} <span className="text-wine">♥</span>
          </p>
          <p>
            {t.contact}{" "}
            <a href={`mailto:${CONTACT}`} className="text-cream underline decoration-line underline-offset-4 transition-colors hover:text-brass-bright hover:decoration-brass">
              {CONTACT}
            </a>
          </p>
        </div>
      </div>
    </footer>
  );
}
