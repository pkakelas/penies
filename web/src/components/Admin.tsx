"use client";

import type { Session } from "@supabase/supabase-js";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { refreshSongs } from "@/app/actions";
import { dictionaries, formatTime, formatTimeExact, href, parseTime, type Dict, type Lang } from "@/lib/i18n";
import {
  ADMIN_EMAIL_DOMAIN,
  orderSongs,
  playableLength,
  STEMS_BUCKET,
  supabaseBrowser,
  type Song,
  type SongRequest,
} from "@/lib/supabase";

const POLL_MS = 4000;

const field =
  "w-full rounded-xl border border-line bg-ink px-4 py-3 text-cream placeholder:text-sand/60 transition-colors focus:border-brass focus:outline-none";
const primary =
  "rounded-full bg-brass px-5 py-2.5 text-sm font-medium text-ink transition-colors hover:bg-brass-bright disabled:opacity-50";
const quiet =
  "rounded-full border border-line px-5 py-2.5 text-sm text-cream transition-colors hover:border-cream/40 disabled:opacity-50";
const danger = "rounded-full px-3 py-2.5 text-sm text-sand transition-colors hover:text-wine disabled:opacity-50";
const checkbox = "size-4 rounded border-line bg-ink accent-brass";

/** The 11-character video id in a YouTube link, or null. */
function youtubeId(input: string): string | null {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    return null;
  }
  const host = url.hostname.replace(/^(www|m|music)\./, "");
  let id: string | null = null;
  if (host === "youtu.be") id = url.pathname.split("/")[1] ?? null;
  else if (host === "youtube.com" || host === "youtube-nocookie.com") {
    id = url.pathname === "/watch" ? url.searchParams.get("v") : (url.pathname.match(/^\/(?:shorts|embed|live|v)\/([^/]+)/)?.[1] ?? null);
  }
  return id && /^[\w-]{11}$/.test(id) ? id : null;
}

/** /admin: sign in, add a YouTube video, test the draft, publish. With `archive`, /admin/archive: the drafts put away. */
export function Admin({ lang, archive = false }: { lang: Lang; archive?: boolean }) {
  const t = dictionaries[lang].admin;
  // undefined until the browser's saved sign-in has been read
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  // Whether the signed-in user is an admin, remembered with the user it was asked for.
  const [checked, setChecked] = useState<{ user: string; admin: boolean } | null>(null);
  const user = session?.user.id;

  useEffect(() => {
    const { data } = supabaseBrowser().auth.onAuthStateChange((_event, next) => setSession(next));
    return () => data.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    supabaseBrowser()
      .rpc("is_admin")
      .then(({ data }) => {
        if (!cancelled) setChecked({ user, admin: data === true });
      });
    return () => {
      cancelled = true;
    };
  }, [user]);

  const isAdmin = user && checked?.user === user ? checked.admin : undefined;
  const signOut = () => void supabaseBrowser().auth.signOut();

  return (
    <main className="mx-auto w-full max-w-3xl px-6 pt-32 pb-24 sm:px-10 sm:pt-40">
      {session === undefined || (user && isAdmin === undefined) ? (
        <p className="text-sand">…</p>
      ) : !user ? (
        <SignIn t={t} />
      ) : !isAdmin ? (
        <div className="mx-auto max-w-sm text-center">
          <p className="text-wine">{t.notAdmin}</p>
          <button type="button" onClick={signOut} className={`${quiet} mt-6`}>
            {t.signOut}
          </button>
        </div>
      ) : (
        <Dashboard lang={lang} archive={archive} onSignOut={signOut} />
      )}
    </main>
  );
}

function SignIn({ t }: { t: Dict["admin"] }) {
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const name = String(form.get("username")).trim().toLowerCase();
    setBusy(true);
    setFailed(false);
    const { error } = await supabaseBrowser().auth.signInWithPassword({
      email: name.includes("@") ? name : `${name}@${ADMIN_EMAIL_DOMAIN}`,
      password: String(form.get("password")),
    });
    setBusy(false);
    setFailed(Boolean(error));
  };

  return (
    <form onSubmit={submit} className="mx-auto max-w-sm rounded-3xl border border-line bg-coal p-8">
      <h1 className="font-display text-4xl">{t.title}</h1>
      <label className="mt-8 block text-sm text-sand">
        {t.username}
        <input name="username" required autoComplete="username" autoCapitalize="none" className={`${field} mt-2`} />
      </label>
      <label className="mt-5 block text-sm text-sand">
        {t.password}
        <input name="password" type="password" required autoComplete="current-password" className={`${field} mt-2`} />
      </label>
      {failed && (
        <p role="alert" className="mt-5 text-sm text-wine">
          {t.badLogin}
        </p>
      )}
      <button type="submit" disabled={busy} className={`${primary} mt-8 w-full py-3`}>
        {busy ? t.signingIn : t.signIn}
      </button>
    </form>
  );
}

function Dashboard({ lang, archive, onSignOut }: { lang: Lang; archive: boolean; onSignOut: () => void }) {
  const t = dictionaries[lang].admin;
  const [songs, setSongs] = useState<Song[] | null>(null);
  // What visitors asked for on the landing page, the one waiting longest first.
  const [requests, setRequests] = useState<SongRequest[]>([]);
  const [problem, setProblem] = useState("");

  const load = useCallback(async () => {
    const [songRows, requestRows] = await Promise.all([
      supabaseBrowser().from("songs").select("*").order("created_at", { ascending: false }),
      supabaseBrowser().from("song_requests").select("*").order("created_at", { ascending: true }).order("seq", { ascending: true }),
    ]);
    if (!songRows.error) setSongs(songRows.data as Song[]);
    if (!requestRows.error) setRequests(requestRows.data as SongRequest[]);
  }, []);

  // Read the list now, and keep reading it while the worker has something to do.
  const waiting = songs?.some((song) => song.status === "queued" || song.status === "processing") ?? false;
  useEffect(() => {
    const first = window.setTimeout(load, 0);
    if (!waiting) return () => window.clearTimeout(first);
    const timer = window.setInterval(load, POLL_MS);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(timer);
    };
  }, [load, waiting]);

  /** Run a change, then re-read the list and let the public pages know. */
  const change = async (action: () => PromiseLike<{ error: { message: string } | null }>): Promise<boolean> => {
    setProblem("");
    const { error } = await action();
    if (error) setProblem(`${t.failedGeneric} (${error.message})`);
    await Promise.all([load(), refreshSongs()]);
    return !error;
  };

  const db = () => supabaseBrowser().from("songs");
  const update = (song: Song, fields: Partial<Song>) => change(() => db().update(fields).eq("id", song.id));
  const remove = (song: Song) => {
    if (!window.confirm(t.confirmRemove)) return;
    void change(async () => {
      // The stems are in R2, out of this page's reach: the worker deletes them
      // once the song's row is gone. An old copy in Supabase Storage goes now.
      const paths = Object.values(song.stems);
      if (paths.length) {
        const { error } = await supabaseBrowser().storage.from(STEMS_BUCKET).remove(paths);
        if (error) return { error };
      }
      return db().delete().eq("id", song.id);
    });
  };

  const finishRequest = (request: SongRequest) => {
    if (!window.confirm(t.confirmRequestDone)) return;
    void change(() => supabaseBrowser().from("song_requests").delete().eq("id", request.id));
  };

  const inProgress = songs?.filter((song) => ["queued", "processing", "failed"].includes(song.status)) ?? [];
  const drafts = songs?.filter((song) => song.status === "draft") ?? [];
  // In the landing page's order, so moving a song here moves it there.
  const published = orderSongs(songs?.filter((song) => song.status === "published") ?? []);
  const archived = songs?.filter((song) => song.status === "archived") ?? [];

  /** Swap a published song with its neighbour, then number the whole list from 1. */
  const move = (song: Song, by: -1 | 1) => {
    const from = published.findIndex((s) => s.id === song.id);
    const to = from + by;
    if (from < 0 || to < 0 || to >= published.length) return Promise.resolve(false);
    const ids = published.map((s) => s.id);
    [ids[from], ids[to]] = [ids[to], ids[from]];
    return change(() => supabaseBrowser().rpc("reorder_songs", { ids }));
  };

  return (
    <>
      <div className="flex items-center justify-between">
        <h1 className="font-display text-5xl tracking-tight">{archive ? t.archived : t.title}</h1>
        <button type="button" onClick={onSignOut} className={quiet}>
          {t.signOut}
        </button>
      </div>

      {archive ? (
        <a href={href(lang, "/admin")} className={`${quiet} mt-8 inline-block`}>
          ← {t.title}
        </a>
      ) : (
        <AddSong t={t} onAdded={load} />
      )}

      {problem && (
        <p role="alert" className="mt-8 rounded-xl border border-wine/50 px-4 py-3 text-sm text-wine">
          {problem}
        </p>
      )}

      {songs === null ? (
        <p className="mt-12 text-sand">…</p>
      ) : archive ? (
        <Section title={t.archived} count={archived.length} none={t.none}>
          {archived.map((song) => (
            <SongCard key={song.id} lang={lang} song={song} onUpdate={update} onRemove={remove} />
          ))}
        </Section>
      ) : (
        <>
          {requests.length > 0 && (
            <Section title={t.requests} count={requests.length}>
              {requests.map((request) => (
                <li key={request.id} className="flex items-start justify-between gap-4 rounded-2xl border border-line bg-coal p-5">
                  <div className="min-w-0">
                    <p className="font-medium break-words">{request.song}</p>
                    <p className="mt-1.5 flex flex-wrap gap-x-3 text-sm text-sand">
                      {request.name && <span className="text-cream">{request.name}</span>}
                      <a href={`mailto:${request.email}`} className="break-all text-cream underline decoration-line underline-offset-4 hover:decoration-brass">
                        {request.email}
                      </a>
                      <time dateTime={request.created_at} className="tabular-nums">
                        {new Date(request.created_at).toLocaleString(lang, { dateStyle: "medium", timeStyle: "short" })}
                      </time>
                      {request.paid_at && <span className="text-brass-bright">{t.requestPaid}</span>}
                    </p>
                  </div>
                  <button type="button" className={`${quiet} shrink-0`} onClick={() => finishRequest(request)}>
                    {t.requestDone}
                  </button>
                </li>
              ))}
            </Section>
          )}

          {inProgress.length > 0 && (
            <Section title={t.processing} count={inProgress.length}>
              {inProgress.map((song) => (
                <li key={song.id} className="rounded-2xl border border-line bg-coal p-5">
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <p className="truncate font-medium">{song.title || song.youtube_url}</p>
                      <Progress t={t} song={song} />
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      {song.status === "failed" && (
                        <button
                          type="button"
                          className={quiet}
                          onClick={() => void update(song, { status: "queued", error: "", step: "", step_detail: "" })}
                        >
                          {t.retry}
                        </button>
                      )}
                      <button type="button" className={danger} onClick={() => remove(song)}>
                        {t.remove}
                      </button>
                    </div>
                  </div>
                </li>
              ))}
            </Section>
          )}

          <Section title={t.drafts} count={drafts.length} none={t.none}>
            {drafts.map((song) => (
              <SongCard key={song.id} lang={lang} song={song} onUpdate={update} onRemove={remove} />
            ))}
          </Section>

          <Section title={t.published} count={published.length} none={t.none} help={t.orderHelp}>
            {published.map((song, index) => (
              <SongCard
                key={song.id}
                lang={lang}
                song={song}
                onUpdate={update}
                onRemove={remove}
                order={{
                  number: index + 1,
                  up: index > 0 ? () => move(song, -1) : undefined,
                  down: index < published.length - 1 ? () => move(song, 1) : undefined,
                }}
              />
            ))}
          </Section>

          <a href={href(lang, "/admin/archive")} className={`${quiet} mt-14 inline-flex items-baseline gap-3`}>
            {t.archived}
            <span className="text-sand tabular-nums">{archived.length}</span>
            <span aria-hidden>→</span>
          </a>
        </>
      )}
    </>
  );
}

function Section(props: { title: string; count: number; none?: string; help?: string; children: React.ReactNode }) {
  return (
    <section className="mt-14">
      <h2 className="flex items-baseline gap-3 text-xs font-medium tracking-[0.28em] text-brass uppercase">
        {props.title}
        <span className="tracking-normal text-sand tabular-nums">{props.count}</span>
      </h2>
      {props.help && props.count > 1 && <p className="mt-2 text-sm text-sand/70">{props.help}</p>}
      {props.count === 0 ? (
        <p className="mt-5 text-sand">{props.none}</p>
      ) : (
        <ul className="mt-5 space-y-3">{props.children}</ul>
      )}
    </section>
  );
}

/** What the worker is doing with a song right now. */
function Progress({ t, song }: { t: Dict["admin"]; song: Song }) {
  if (song.status === "failed") {
    return (
      <p className="mt-1.5 text-sm text-wine">
        {t.failed}
        {song.error ? `: ${song.error}` : ""}
      </p>
    );
  }
  const queued = song.status === "queued";
  return (
    <p className="mt-1.5 flex items-start gap-2.5 text-sm text-sand">
      <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${queued ? "bg-sand/50" : "animate-pulse bg-brass"}`} />
      <span>
        {queued ? t.queued : (t.steps[song.step] ?? t.queued)}
        {!queued && song.step_detail ? ` · ${song.step_detail}` : ""}
        {queued && <span className="mt-0.5 block text-sand/70">{t.queuedHelp}</span>}
      </span>
    </p>
  );
}

function AddSong({ t, onAdded }: { t: Dict["admin"]; onAdded: () => Promise<void> }) {
  const [url, setUrl] = useState("");
  const [instrumental, setInstrumental] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const id = youtubeId(url);
    if (!id) return setProblem(t.badUrl);
    setBusy(true);
    setProblem("");
    // The worker replaces the address (slug) with one made from the title.
    const { error } = await supabaseBrowser()
      .from("songs")
      .insert({ youtube_id: id, youtube_url: `https://www.youtube.com/watch?v=${id}`, slug: id, instrumental });
    setBusy(false);
    if (error) return setProblem(error.code === "23505" ? t.duplicate : `${t.failedGeneric} (${error.message})`);
    setUrl("");
    setInstrumental(false);
    await onAdded();
  };

  return (
    <form onSubmit={submit} className="mt-10 rounded-3xl border border-line bg-coal p-6 sm:p-8">
      <h2 className="font-display text-3xl">{t.addTitle}</h2>
      <p className="mt-2 text-sm leading-relaxed text-sand">{t.addHelp}</p>
      <div className="mt-6 flex flex-col gap-3 sm:flex-row">
        <input
          type="url"
          inputMode="url"
          required
          value={url}
          onChange={(event) => setUrl(event.target.value)}
          placeholder={t.urlPlaceholder}
          aria-label="YouTube URL"
          className={field}
        />
        <button type="submit" disabled={busy} className={`${primary} shrink-0 px-7`}>
          {busy ? t.adding : t.add}
        </button>
      </div>
      <label className="mt-4 flex items-center gap-2.5 text-sm text-sand">
        <input
          type="checkbox"
          checked={instrumental}
          onChange={(event) => setInstrumental(event.target.checked)}
          className={checkbox}
        />
        {t.instrumental}
      </label>
      {problem && (
        <p role="alert" className="mt-4 text-sm text-wine">
          {problem}
        </p>
      )}
    </form>
  );
}

/** Where a published song sits in the list, and how to move it; a direction is missing at the ends. */
type Order = { number: number; up?: () => Promise<boolean>; down?: () => Promise<boolean> };

/**
 * A finished song: fix its details, listen to it, publish it or take it down.
 * Published songs can be moved in the list; drafts can be archived, and archived songs go back to the drafts.
 */
function SongCard(props: {
  lang: Lang;
  song: Song;
  onUpdate: (song: Song, fields: Partial<Song>) => Promise<boolean>;
  onRemove: (song: Song) => void;
  order?: Order;
}) {
  const { lang, song, onUpdate, onRemove, order } = props;
  const t = dictionaries[lang].admin;
  const labels = dictionaries[lang].song;
  const [title, setTitle] = useState(song.title);
  const [artist, setArtist] = useState(song.artist);
  const [firstPerformed, setFirstPerformed] = useState(song.first_performed);
  const [firstSinger, setFirstSinger] = useState(song.first_singer);
  const [instrumental, setInstrumental] = useState(song.instrumental);
  const [composer, setComposer] = useState(song.composer);
  const [requestedBy, setRequestedBy] = useState(song.requested_by);
  // Where the song starts and ends, as typed (m:ss); blank means the recording's own start or end.
  const [startsAt, setStartsAt] = useState(song.start_seconds === null ? "" : formatTimeExact(song.start_seconds));
  const [endsAt, setEndsAt] = useState(song.end_seconds === null ? "" : formatTimeExact(song.end_seconds));
  const [busy, setBusy] = useState(false);
  // Closed, the card is one line with the song's title; opened, it shows the details and the buttons.
  const [open, setOpen] = useState(false);
  const isDraft = song.status === "draft";
  const isArchived = song.status === "archived";
  const tenths = (seconds: number | null) => (seconds === null ? null : Math.round(seconds * 10) / 10);
  const start = tenths(parseTime(startsAt));
  const end = tenths(parseTime(endsAt));
  const full = song.duration_seconds;
  const badTrim =
    Number.isNaN(start) ||
    Number.isNaN(end) ||
    (start !== null && end !== null && start >= end) ||
    (full !== null && ((start !== null && start >= full) || (end !== null && end > full + 1)));
  const details = {
    title: title.trim(),
    artist: artist.trim(),
    first_performed: firstPerformed.trim(),
    first_singer: firstSinger.trim(),
    instrumental,
    composer: composer.trim(),
    requested_by: requestedBy.trim(),
    start_seconds: badTrim ? song.start_seconds : start,
    end_seconds: badTrim ? song.end_seconds : end,
  };
  const edited =
    details.title !== song.title ||
    details.artist !== song.artist ||
    details.first_performed !== song.first_performed ||
    details.first_singer !== song.first_singer ||
    details.instrumental !== song.instrumental ||
    details.composer !== song.composer ||
    details.requested_by !== song.requested_by ||
    details.start_seconds !== song.start_seconds ||
    details.end_seconds !== song.end_seconds;
  const length = badTrim ? null : playableLength({ ...song, start_seconds: start, end_seconds: end });

  const run = async (fields: Partial<Song>) => {
    setBusy(true);
    await onUpdate(song, fields);
    setBusy(false);
  };
  const moveWith = async (step: () => Promise<boolean>) => {
    setBusy(true);
    await step();
    setBusy(false);
  };

  return (
    <li className="rounded-2xl border border-line bg-coal">
      <div className="flex items-center gap-3 px-5 py-3 sm:px-6">
        {order && (
          <span className="font-display text-2xl text-brass tabular-nums">{String(order.number).padStart(2, "0")}</span>
        )}
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen(!open)}
          className="flex min-h-9 min-w-0 flex-1 items-center gap-3 text-left"
        >
          <span className={`truncate font-medium ${title.trim() ? "" : "text-sand"}`}>{title.trim() || t.untitled}</span>
          <span aria-hidden className={`ml-auto shrink-0 text-sand transition-transform ${open ? "rotate-180" : ""}`}>
            ▾
          </span>
        </button>
        {order && (
          <span className="flex shrink-0 gap-1">
            <OrderButton label={t.moveUp} onClick={order.up && (() => moveWith(order.up!))} disabled={busy}>
              ↑
            </OrderButton>
            <OrderButton label={t.moveDown} onClick={order.down && (() => moveWith(order.down!))} disabled={busy}>
              ↓
            </OrderButton>
          </span>
        )}
      </div>
      {open && (
        <div className="border-t border-line p-5 sm:p-6">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-xs text-sand">
              {t.songTitle}
              <input value={title} onChange={(event) => setTitle(event.target.value)} className={`${field} mt-1.5 text-base`} />
            </label>
            <label className="block text-xs text-sand">
              {labels.singer}
              <input value={artist} onChange={(event) => setArtist(event.target.value)} className={`${field} mt-1.5 text-base`} />
            </label>
            <label className="block text-xs text-sand">
              {labels.firstPerformed}
              <input
                value={firstPerformed}
                onChange={(event) => setFirstPerformed(event.target.value)}
                className={`${field} mt-1.5 text-base`}
              />
            </label>
            <label className="block text-xs text-sand">
              {instrumental ? labels.firstPlayer : labels.firstSinger}
              <input
                value={firstSinger}
                onChange={(event) => setFirstSinger(event.target.value)}
                className={`${field} mt-1.5 text-base`}
              />
            </label>
            <label className="block text-xs text-sand">
              {labels.composer}
              <input value={composer} onChange={(event) => setComposer(event.target.value)} className={`${field} mt-1.5 text-base`} />
            </label>
            <label className="block text-xs text-sand">
              {labels.requestedBy}
              <input
                value={requestedBy}
                onChange={(event) => setRequestedBy(event.target.value)}
                maxLength={100}
                className={`${field} mt-1.5 text-base`}
              />
            </label>
            <label className="flex items-center gap-2.5 text-sm text-sand sm:col-span-2">
              <input
                type="checkbox"
                checked={instrumental}
                onChange={(event) => setInstrumental(event.target.checked)}
                className={checkbox}
              />
              {t.instrumental}
            </label>
          </div>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <label className="block text-xs text-sand">
              {t.startsAt}
              <input
                value={startsAt}
                onChange={(event) => setStartsAt(event.target.value)}
                placeholder="0:00"
                inputMode="numeric"
                aria-invalid={badTrim}
                className={`${field} mt-1.5 text-base tabular-nums`}
              />
            </label>
            <label className="block text-xs text-sand">
              {t.endsAt}
              <input
                value={endsAt}
                onChange={(event) => setEndsAt(event.target.value)}
                placeholder={full ? formatTime(full) : "–"}
                inputMode="numeric"
                aria-invalid={badTrim}
                className={`${field} mt-1.5 text-base tabular-nums`}
              />
            </label>
            <p className={`text-xs sm:col-span-2 ${badTrim ? "text-wine" : "text-sand/70"}`} role={badTrim ? "alert" : undefined}>
              {badTrim ? t.badTime : t.trimHelp}
            </p>
          </div>
          <div className="mt-5 flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={busy || badTrim}
              className={primary}
              onClick={() => void run({ ...details, status: isDraft ? "published" : "draft" })}
            >
              {isDraft ? t.publish : isArchived ? t.restore : t.unpublish}
            </button>
            <a href={href(lang, `/songs/${song.slug}`)} target="_blank" rel="noreferrer" className={quiet}>
              {isDraft || isArchived ? t.test : t.view} ↗
            </a>
            {edited && (
              <button type="button" disabled={busy || badTrim} className={quiet} onClick={() => void run(details)}>
                {t.save}
              </button>
            )}
            {length ? (
              <span className="ml-2 text-sm text-sand tabular-nums">
                {t.plays} {formatTime(length)}
                {full && Math.round(length) !== Math.round(full) ? ` / ${formatTime(full)}` : ""}
              </span>
            ) : null}
            {isDraft && (
              <button
                type="button"
                disabled={busy || badTrim}
                className={`${danger} ml-auto`}
                onClick={() => void run({ ...details, status: "archived" })}
              >
                {t.archive}
              </button>
            )}
            <button type="button" disabled={busy} className={`${danger} ${isDraft ? "" : "ml-auto"}`} onClick={() => onRemove(song)}>
              {t.remove}
            </button>
          </div>
        </div>
      )}
    </li>
  );
}

/** An arrow that moves a song in the list. Without onClick it is at the end of the list and greyed out. */
function OrderButton(props: { label: string; onClick?: () => void; disabled: boolean; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-label={props.label}
      title={props.label}
      disabled={props.disabled || !props.onClick}
      onClick={props.onClick}
      className="grid h-9 w-9 place-items-center rounded-full border border-line text-sand transition-colors hover:border-cream/40 hover:text-cream disabled:opacity-30 disabled:hover:border-line disabled:hover:text-sand"
    >
      {props.children}
    </button>
  );
}
