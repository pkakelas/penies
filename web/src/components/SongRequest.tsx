"use client";

import {
  useEffect,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
  type FormEvent,
  type MouseEvent,
  type ReactNode,
} from "react";
import { href, type Dict, type Lang } from "@/lib/i18n";
import { supabaseBrowser } from "@/lib/supabase";

/** How many songs one payment buys. The price is in the texts and on the payment page. */
const PACK = 3;
/** The payment page (a Stripe Payment Link). It sends the visitor back to the Greek landing page with `?paid`. */
const PAYMENT_LINK = process.env.NEXT_PUBLIC_PAYMENT_LINK;
/** Kept for the tab while the visitor is away paying: the language of the page they left. */
const PAYING = "penia-paying";

/**
 * A button that opens a form for asking for three songs, which are paid for
 * together. The requests are saved (they show up in /admin) and the visitor
 * goes to the payment page; back from it, the form says the payment was made.
 * `song` is what the first song field starts with. `header` is the smaller
 * button of the top bar, which is on every page: that one opens by itself
 * when the visitor comes back from paying, so a page shows it once. With
 * `children` there is no button to see: they are what opens the form (the
 * song list's last row).
 */
export function SongRequest({
  lang,
  t,
  song = "",
  header = false,
  children,
}: {
  lang: Lang;
  t: Dict["request"];
  song?: string;
  header?: boolean;
  children?: ReactNode;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const [state, setState] = useState<"idle" | "sending" | "failed">("idle");
  const paid = useSyncExternalStore(paidReturn.subscribe, paidReturn.read, () => false);
  // The requests already saved from this form, so pressing Pay again after coming back does not save them twice.
  const saved = useRef("");

  // Back from the payment page.
  useEffect(() => {
    if (!paid || !header) return;
    if (lang === "el" && recall() === "en") {
      window.location.replace(`${href("en", "/")}?paid`);
      return;
    }
    remember(null);
    if (!dialog.current?.open) dialog.current?.showModal();
  }, [paid, header, lang]);

  // Back with the browser's back button, without paying: the page is shown as it was left.
  useEffect(() => {
    const wake = (event: PageTransitionEvent) => {
      if (event.persisted) setState((now) => (now === "sending" ? "idle" : now));
    };
    window.addEventListener("pageshow", wake);
    return () => window.removeEventListener("pageshow", wake);
  }, []);

  const open = () => {
    dialog.current?.showModal();
    dialog.current?.querySelector<HTMLInputElement>("input[name=song]")?.focus();
  };
  const close = () => dialog.current?.close();
  // Once closed, a paid or failed request gives way to an empty form for the next one.
  const reset = () => {
    if (paid) paidReturn.forget();
    setState((now) => (now === "sending" ? now : "idle"));
  };
  // The dialog element itself is only hit by a click on the dimmed page around the form.
  const closeFromOutside = (event: MouseEvent<HTMLDialogElement>) => {
    if (event.target === event.currentTarget) close();
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const email = String(form.get("email"));
    const rows = form.getAll("song").map((song) => ({ song: String(song), email, lang }));
    if (!PAYMENT_LINK) {
      setState("failed");
      return;
    }
    setState("sending");
    const key = JSON.stringify(rows);
    if (saved.current !== key) {
      const { error } = await supabaseBrowser().from("song_requests").insert(rows);
      if (error) {
        setState("failed");
        return;
      }
      saved.current = key;
    }
    // The same email on the payment page, so the payment can be matched to the requests.
    const pay = new URL(PAYMENT_LINK, window.location.href);
    pay.searchParams.set("prefilled_email", email);
    pay.searchParams.set("locale", lang);
    remember(lang);
    window.location.assign(pay);
  };

  return (
    <>
      {children ? (
        <button type="button" onClick={open} className="song group block w-full text-left">
          {children}
        </button>
      ) : (
        <button
          type="button"
          onClick={open}
          className={`rounded-full border border-brass/60 font-medium text-brass-bright transition-colors hover:border-brass hover:bg-brass hover:text-ink ${
            header ? "px-3.5 py-1.5 text-xs whitespace-nowrap sm:text-sm" : "px-5 py-2.5 text-sm"
          }`}
        >
          {t.button}
        </button>
      )}
      <dialog
        ref={dialog}
        aria-labelledby={titleId}
        onClick={closeFromOutside}
        onClose={reset}
        className="m-auto w-[calc(100%-2rem)] max-w-md rounded-3xl border border-line bg-coal text-cream shadow-2xl shadow-black/70 backdrop:bg-ink/80 backdrop:backdrop-blur-sm"
      >
        <div className="relative p-7 sm:p-9">
          <button
            type="button"
            onClick={close}
            aria-label={t.close}
            title={t.close}
            className="absolute top-4 right-4 grid h-9 w-9 place-items-center rounded-full text-xl text-sand transition-colors hover:text-cream"
          >
            ×
          </button>
          <h2 id={titleId} className="pr-8 font-display text-3xl tracking-tight sm:text-4xl">
            {paid ? t.paidTitle : t.title}
          </h2>
          {paid ? (
            <>
              <p role="status" className="mt-5 leading-relaxed text-cream">
                {t.paid}
              </p>
              <button
                type="button"
                onClick={close}
                className="mt-8 rounded-full border border-line px-5 py-2.5 text-sm text-cream transition-colors hover:border-cream/40"
              >
                {t.close}
              </button>
            </>
          ) : (
            <form onSubmit={submit}>
              <p className="mt-5 leading-relaxed text-cream">{t.promise}</p>
              <p className="mt-3 text-sm leading-relaxed text-sand">{t.note}</p>
              {/* The songs as one list, like a setlist: a number, then the line to write on. */}
              <ol className="mt-7 overflow-hidden rounded-2xl border border-line bg-ink">
                {Array.from({ length: PACK }, (_, i) => (
                  <li
                    key={i}
                    className="group/row border-t border-line transition-colors first:border-t-0 has-[:focus]:bg-ember has-[:focus]:shadow-[inset_2px_0_0_var(--color-brass)]"
                  >
                    <label className="flex cursor-text items-baseline gap-3.5 pr-4 pl-5">
                      <span
                        aria-hidden="true"
                        className="w-4 shrink-0 font-display text-xl text-brass/45 transition-colors group-has-[:focus]/row:text-brass group-has-[input:not(:placeholder-shown)]/row:text-brass-bright"
                      >
                        {i + 1}
                      </span>
                      <span className="sr-only">
                        {t.song} {i + 1}
                      </span>
                      <input
                        name="song"
                        defaultValue={i ? "" : song}
                        required
                        minLength={2}
                        maxLength={300}
                        placeholder={t.examples[i]}
                        className="min-w-0 flex-1 bg-transparent py-3.5 font-display text-lg text-cream placeholder:text-sand/45 focus:outline-none! sm:text-xl"
                      />
                    </label>
                  </li>
                ))}
              </ol>
              {/* The email stands apart, so it does not read as a fourth song. */}
              <label className="mt-4 flex cursor-text items-baseline gap-3.5 rounded-2xl border border-line bg-ink pr-4 pl-5 transition-colors has-[:focus]:border-brass">
                <span className="shrink-0 text-sm text-sand">{t.email}</span>
                <input
                  name="email"
                  type="email"
                  required
                  maxLength={254}
                  autoComplete="email"
                  className="min-w-0 flex-1 bg-transparent py-3.5 text-base text-cream focus:outline-none!"
                />
              </label>
              {state === "failed" && (
                <p role="alert" className="mt-5 text-sm text-wine">
                  {t.failed}
                </p>
              )}
              <button
                type="submit"
                disabled={state === "sending"}
                className="mt-8 w-full rounded-full bg-brass px-5 py-3 text-sm font-medium text-ink transition-colors hover:bg-brass-bright disabled:opacity-50"
              >
                {state === "sending" ? t.paying : t.pay}
              </button>
            </form>
          )}
        </div>
      </dialog>
    </>
  );
}

/** Whether the address says the visitor is back from the payment page. `forget` takes that out of the address. */
const watching = new Set<() => void>();
const paidReturn = {
  subscribe(watcher: () => void) {
    watching.add(watcher);
    return () => void watching.delete(watcher);
  },
  read: () => new URLSearchParams(window.location.search).has("paid"),
  forget() {
    window.history.replaceState(null, "", window.location.pathname + window.location.hash);
    watching.forEach((watcher) => watcher());
  },
};

/** Note, or with null forget, the language of the page the visitor left to pay. A browser that keeps nothing is fine. */
function remember(lang: Lang | null) {
  try {
    if (lang) sessionStorage.setItem(PAYING, lang);
    else sessionStorage.removeItem(PAYING);
  } catch {}
}

function recall(): string | null {
  try {
    return sessionStorage.getItem(PAYING);
  } catch {
    return null;
  }
}
