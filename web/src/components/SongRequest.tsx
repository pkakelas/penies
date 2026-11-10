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
import { ADMIN_EMAIL_DOMAIN, supabaseBrowser } from "@/lib/supabase";

/**
 * The payment pages (Stripe Payment Links), one per pack, by how many songs the pack has.
 * Each sends the visitor back to the Greek landing page with `?paid`. A pack without a link is not offered.
 */
const PAYMENT_LINKS: Record<number, string | undefined> = {
  1: process.env.NEXT_PUBLIC_PAYMENT_LINK_1,
  3: process.env.NEXT_PUBLIC_PAYMENT_LINK_3,
  5: process.env.NEXT_PUBLIC_PAYMENT_LINK_5,
};
/** The pack chosen until the visitor picks another, and the only one shown when no link is set up at all. */
const USUAL_PACK = 3;
/** Kept for the tab while the visitor is away paying: the language of the page they left. */
const PAYING = "penia-paying";

/** Who is signed in to ask for songs. `name` is the one they gave with their last song. */
export type Visitor = { id: string; email: string; name: string };
/** Sent on the window when the visitor signs in or out or asks for a song, for the orders page to look again. */
export const REQUESTS_CHANGED = "penia-requests-changed";
const changed = () => window.dispatchEvent(new Event(REQUESTS_CHANGED));

/**
 * A button that opens the dialog for asking for songs. A visitor first signs
 * in with their email (a code sent by mail). Signed in, the dialog shows how
 * many songs they can still ask for and a row for adding one, which takes
 * one credit and saves the request (it shows up in /admin); with none left
 * it sells a pack of them (one, three or five), on the payment page. Back
 * from paying, the dialog opens and waits for the new songs to arrive. The
 * songs they are waiting for are on the orders page, which the dialog links to.
 * `song` is what the song field starts with. `header` is the smaller button
 * of the top bar, which is on every page: that one opens by itself when the
 * visitor comes back from paying, so a page shows it once. With `children`
 * there is no button to see: they are what opens the dialog (the song list's
 * last row).
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
  // Who is signed in: undefined until it has been looked up, null for nobody.
  const [visitor, setVisitor] = useState<Visitor | null>();
  // How many songs they can still ask for, and the ones they are waiting for.
  const [credits, setCredits] = useState(0);
  const [asked, setAsked] = useState<string[]>([]);
  // Signing in: the address a code was sent to, or null while the email is still being asked for.
  const [codeFor, setCodeFor] = useState<string | null>(null);
  // How many songs were sent since the page loaded; each one gives way to an empty field.
  const [sent, setSent] = useState(0);
  // A song was just sent: the dialog thanks them, until they ask for another, go to the packs or close it.
  const [thanked, setThanked] = useState(false);
  // Which pack to pay for, as its number of songs.
  const [pack, setPack] = useState(USUAL_PACK);
  const linked = t.packs.filter((one) => PAYMENT_LINKS[one.songs]);
  const packs = linked.length > 0 ? linked : t.packs.filter((one) => one.songs === USUAL_PACK);
  const chosen = packs.find((one) => one.songs === pack) ?? packs.find((one) => one.songs === USUAL_PACK) ?? packs[0];

  const refresh = async () => {
    const found = await lookUp();
    setVisitor(found.visitor);
    setCredits(found.credits);
    setAsked(found.asked);
  };

  // Back from the payment page.
  useEffect(() => {
    if (!paid || !header) return;
    if (lang === "el" && recall() === "en") {
      window.location.replace(`${href("en", "/")}?paid`);
      return;
    }
    remember(null);
    if (!dialog.current?.open) dialog.current?.showModal();
    // Stripe tells the database a moment after the visitor is back: look until the songs are there.
    let stopped = false;
    void (async () => {
      for (let tries = 0; tries < 15 && !stopped; tries++) {
        const found = await lookUp();
        if (stopped) return;
        setVisitor(found.visitor);
        setCredits(found.credits);
        setAsked(found.asked);
        if (!found.visitor) return;
        if (found.credits > 0) return changed();
        await new Promise((done) => setTimeout(done, 2000));
      }
    })();
    return () => {
      stopped = true;
    };
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
    dialog.current?.querySelector<HTMLInputElement>("input[name=song], input[name=email], input[name=code]")?.focus();
    void refresh();
  };
  const close = () => dialog.current?.close();
  // Once closed, a failed try or a half-done sign-in gives way to a fresh start.
  const reset = () => {
    if (paid) paidReturn.forget();
    setState((now) => (now === "sending" ? now : "idle"));
    setCodeFor(null);
    setThanked(false);
  };
  // The dialog element itself is only hit by a click on the dimmed page around the form.
  const closeFromOutside = (event: MouseEvent<HTMLDialogElement>) => {
    if (event.target === event.currentTarget) close();
  };

  const sendCode = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const email = String(new FormData(event.currentTarget).get("email")).trim();
    setState("sending");
    const { error } = await supabaseBrowser().auth.signInWithOtp({ email, options: { shouldCreateUser: true } });
    if (error) {
      setState("failed");
      return;
    }
    setState("idle");
    setCodeFor(email);
  };

  const checkCode = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (codeFor === null) return;
    const token = String(new FormData(event.currentTarget).get("code")).replace(/\s/g, "");
    setState("sending");
    const { error } = await supabaseBrowser().auth.verifyOtp({ email: codeFor, token, type: "email" });
    if (error) {
      setState("failed");
      return;
    }
    await refresh();
    setState("idle");
    setCodeFor(null);
    changed();
  };

  const signOut = async () => {
    await supabaseBrowser().auth.signOut({ scope: "local" });
    setVisitor(null);
    setCredits(0);
    setAsked([]);
    setThanked(false);
    setState("idle");
    changed();
  };

  /** Ask for the song in the field: it takes one credit. */
  const ask = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!visitor) return;
    const form = new FormData(event.currentTarget);
    const wanted = String(form.get("song")).trim();
    const name = String(form.get("name")).trim();
    setState("sending");
    const client = supabaseBrowser();
    const { data: left, error } = await client.rpc("spend_song_credits", { songs: [wanted], name, lang });
    if (error) {
      setState("failed");
      return;
    }
    // Kept with the sign-in, so the next song does not ask for the name again. The song is saved either way.
    if (name !== visitor.name) void client.auth.updateUser({ data: { name } });
    setVisitor({ ...visitor, name });
    setCredits(left as number);
    setAsked((songs) => [...songs, wanted]);
    setSent((count) => count + 1);
    setThanked(true);
    setState("idle");
    changed();
  };

  /**
   * To the payment page of the chosen pack. Stripe hands the visitor's id back with the payment, which is how
   * the database knows whose the songs are; how many they are it reads from the link's `songs` metadata.
   */
  const pay = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const link = PAYMENT_LINKS[chosen.songs];
    if (!link || !visitor) {
      setState("failed");
      return;
    }
    setState("sending");
    const page = new URL(link, window.location.href);
    page.searchParams.set("client_reference_id", visitor.id);
    page.searchParams.set("prefilled_email", visitor.email);
    page.searchParams.set("locale", lang);
    remember(lang);
    window.location.assign(page);
  };

  // Paid, and the songs have not arrived yet.
  const waiting = paid && credits === 0;
  const thanking = thanked;

  // How many songs they are waiting for, as a link to the page that lists them.
  const ordersLink = asked.length > 0 && (
    <a
      href={href(lang, "/orders")}
      className="mt-2 inline-block text-sm text-sand underline decoration-line underline-offset-4 transition-colors hover:text-cream hover:decoration-brass"
    >
      {asked.length === 1 ? t.askedOne : t.askedMany.replace("{n}", String(asked.length))} →
    </a>
  );

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
        className="m-auto w-[calc(100%-2rem)] max-w-lg rounded-3xl border border-line bg-coal text-cream shadow-2xl shadow-black/70 backdrop:bg-ink/80 backdrop:backdrop-blur-sm"
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
            {thanking ? t.thanks : t.title}
          </h2>
          {!(thanking && credits === 0) && (
            <p className="mt-2 text-sm text-brass-bright">
              {visitor && credits > 0 ? (credits === 1 ? t.leftOne : t.leftMany.replace("{n}", String(credits))) : t.terms}
            </p>
          )}
          {visitor && !thanking && ordersLink}
          {paid && (
            <p role="status" className="mt-5 leading-relaxed text-cream">
              {t.paid}
              {visitor && waiting && ` ${t.paidSoon}`}
            </p>
          )}
          {visitor === undefined ? (
            <div aria-hidden="true" className="h-28" />
          ) : visitor === null && codeFor === null ? (
            <form onSubmit={sendCode}>
              <p className="mt-5 leading-relaxed text-cream">{t.signInNote}</p>
              <div className="mt-7 overflow-hidden rounded-2xl border border-line bg-ink">
                <label className={field}>
                  <span className="w-14 shrink-0 text-sm text-sand">{t.email}</span>
                  <input
                    name="email"
                    type="email"
                    required
                    maxLength={254}
                    autoComplete="email"
                    autoFocus
                    className="min-w-0 flex-1 bg-transparent py-3.5 text-base text-cream focus:outline-none!"
                  />
                </label>
              </div>
              {state === "failed" && (
                <p role="alert" className="mt-5 text-sm text-wine">
                  {t.failed}
                </p>
              )}
              <button type="submit" disabled={state === "sending"} className={primary}>
                {state === "sending" ? t.sendingCode : t.sendCode}
              </button>
            </form>
          ) : visitor === null ? (
            <form onSubmit={checkCode}>
              <p className="mt-5 leading-relaxed text-cream">{t.codeSent}</p>
              <div className="mt-7 overflow-hidden rounded-2xl border border-line bg-ink">
                <label className={field}>
                  <span className="w-14 shrink-0 text-sm text-sand">{t.code}</span>
                  <input
                    name="code"
                    required
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    pattern="\s*\d(\s*\d){5,9}\s*"
                    maxLength={20}
                    autoFocus
                    className="min-w-0 flex-1 bg-transparent py-3.5 font-display text-xl tracking-[0.3em] text-cream tabular-nums focus:outline-none!"
                  />
                </label>
              </div>
              {state === "failed" && (
                <p role="alert" className="mt-5 text-sm text-wine">
                  {t.badCode}
                </p>
              )}
              <button type="submit" disabled={state === "sending"} className={primary}>
                {state === "sending" ? t.checkingCode : t.signIn}
              </button>
              <button
                type="button"
                onClick={() => {
                  setState("idle");
                  setCodeFor(null);
                }}
                className="mt-3 w-full rounded-full px-5 py-2.5 text-sm text-sand transition-colors hover:text-cream"
              >
                {t.back}
              </button>
            </form>
          ) : thanking ? (
            <div>
              <p role="status" className="mt-5 leading-relaxed text-cream">
                {t.thanksNote}
              </p>
              {ordersLink}
              {/* Back to the dialog: to the next song while there are some left, otherwise to the packs. */}
              <button type="button" onClick={() => setThanked(false)} autoFocus className={primary}>
                {credits > 0 ? t.more : t.buyMore}
              </button>
              <button
                type="button"
                onClick={close}
                className="mt-3 w-full rounded-full px-5 py-2.5 text-sm text-sand transition-colors hover:text-cream"
              >
                {t.close}
              </button>
            </div>
          ) : (
            <form onSubmit={credits > 0 ? ask : pay}>
              {credits > 0 && (
                <>
                  <p className="mt-5 leading-relaxed text-cream">{t.promise}</p>
                  <p className="mt-3 text-sm leading-relaxed text-sand">{t.note}</p>
                </>
              )}
              {/* The line to write the next song on, like one more in a setlist. A new one after each song sent. */}
              {credits > 0 && (
                <div
                  key={`next-${sent}`}
                  className="mt-7 overflow-hidden rounded-2xl border border-line bg-ink transition-colors has-[:focus]:bg-ember has-[:focus]:shadow-[inset_2px_0_0_var(--color-brass)]"
                >
                  <label className="flex cursor-text items-baseline gap-3.5 pr-4 pl-5">
                    <span aria-hidden="true" className="w-4 shrink-0 font-display text-xl text-brass">
                      +
                    </span>
                    <span className="sr-only">{t.song}</span>
                    <input
                      name="song"
                      defaultValue={sent ? "" : song}
                      required
                      minLength={2}
                      maxLength={300}
                      autoFocus
                      placeholder={t.examples[asked.length % t.examples.length]}
                      className="min-w-0 flex-1 bg-transparent py-3.5 font-display text-lg text-cream placeholder:text-sand/45 focus:outline-none! sm:text-xl"
                    />
                  </label>
                </div>
              )}
              {/* Before paying: the packs to choose from, then what a pack is. */}
              {credits === 0 && !waiting && (
                <fieldset className="mt-7 overflow-hidden rounded-2xl border border-line bg-ink">
                  <legend className="sr-only">{t.packsLabel}</legend>
                  {packs.map((one, i) => (
                    <label
                      key={one.songs}
                      className={`flex cursor-pointer items-center gap-3.5 px-5 py-3.5 transition-colors hover:bg-ember/60 has-[:checked]:bg-ember ${
                        i > 0 ? "border-t border-line" : ""
                      }`}
                    >
                      <input
                        type="radio"
                        name="pack"
                        value={one.songs}
                        checked={one.songs === chosen.songs}
                        onChange={() => setPack(one.songs)}
                        className="peer sr-only"
                      />
                      <span
                        aria-hidden="true"
                        className="grid h-4 w-4 shrink-0 place-items-center rounded-full border border-sand/60 peer-checked:border-brass-bright peer-focus-visible:ring-2 peer-focus-visible:ring-brass peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-ink peer-checked:[&>span]:opacity-100"
                      >
                        <span className="h-2 w-2 rounded-full bg-brass-bright opacity-0" />
                      </span>
                      <span className="min-w-0 flex-1 font-display text-lg text-cream sm:text-xl">{one.label}</span>
                      {one.each && <span className="shrink-0 text-xs text-sand">{one.each}</span>}
                      <span className="w-12 shrink-0 text-right font-display text-lg text-brass-bright sm:text-xl">{one.price}</span>
                    </label>
                  ))}
                </fieldset>
              )}
              {credits === 0 && !waiting && (
                <ul className="mt-4 overflow-hidden rounded-2xl border border-line bg-ink">
                  {t.perks.map(([lead, text]) => (
                    <li key={lead} className="border-t border-line px-5 py-3.5 first:border-t-0">
                      <p className="font-display text-lg text-cream sm:text-xl">{lead}</p>
                      <p className="mt-0.5 text-sm leading-relaxed text-sand">{text}</p>
                    </li>
                  ))}
                </ul>
              )}
              {/* Who is asking stands apart, so it does not read as more songs. */}
              <div className="mt-4 overflow-hidden rounded-2xl border border-line bg-ink">
                {credits > 0 && (
                  <label className={`${field} border-b border-line`}>
                    <span className="w-14 shrink-0 text-sm text-sand">{t.name}</span>
                    <input
                      key={visitor.email}
                      name="name"
                      defaultValue={visitor.name}
                      required
                      maxLength={100}
                      autoComplete="name"
                      className="min-w-0 flex-1 bg-transparent py-3.5 text-base text-cream focus:outline-none!"
                    />
                  </label>
                )}
                {/* The songs go under the email that was proved, so it is not typed here. */}
                <div className="flex items-baseline gap-3.5 pr-4 pl-5">
                  <span className="w-14 shrink-0 text-sm text-sand">{t.email}</span>
                  <span className="min-w-0 flex-1 truncate py-3.5 text-base text-cream">{visitor.email}</span>
                  <button type="button" onClick={signOut} className="shrink-0 text-xs text-sand transition-colors hover:text-cream">
                    {t.signOut}
                  </button>
                </div>
              </div>
              {state === "failed" && (
                <p role="alert" className="mt-5 text-sm text-wine">
                  {t.failed}
                </p>
              )}
              {credits > 0 ? (
                <button type="submit" disabled={state === "sending"} className={primary}>
                  {state === "sending" ? t.asking : t.ask}
                </button>
              ) : (
                !waiting && (
                  <button type="submit" disabled={state === "sending"} className={primary}>
                    {state === "sending" ? t.paying : t.pay.replace("{price}", chosen.price)}
                  </button>
                )
              )}
            </form>
          )}
        </div>
      </dialog>
    </>
  );
}

/** The dialog's main button. */
const primary =
  "mt-8 w-full rounded-full bg-brass px-5 py-3 text-sm font-medium text-ink transition-colors hover:bg-brass-bright disabled:opacity-50";

/** A labelled field in a card: lit like a song's row while it is typed in. */
const field =
  "flex cursor-text items-baseline gap-3.5 pr-4 pl-5 transition-colors has-[:focus]:bg-ember has-[:focus]:shadow-[inset_2px_0_0_var(--color-brass)]";

/** Who is signed in to ask for songs (an admin's sign-in does not count), their credits and the songs they are waiting for. */
export async function lookUp(): Promise<{ visitor: Visitor | null; credits: number; asked: string[] }> {
  const client = supabaseBrowser();
  const { data } = await client.auth.getSession();
  const user = data.session?.user;
  if (!user?.email || user.email.endsWith(`@${ADMIN_EMAIL_DOMAIN}`)) return { visitor: null, credits: 0, asked: [] };
  const [left, songs] = await Promise.all([client.rpc("my_song_credits"), client.rpc("my_song_requests")]);
  const name: unknown = user.user_metadata?.name;
  return {
    visitor: { id: user.id, email: user.email, name: typeof name === "string" ? name : "" },
    credits: left.error ? 0 : (left.data as number),
    asked: songs.error ? [] : (songs.data as string[]),
  };
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
