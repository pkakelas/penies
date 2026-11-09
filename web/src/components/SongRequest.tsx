"use client";

import { useId, useRef, useState, type FormEvent, type MouseEvent } from "react";
import type { Dict, Lang } from "@/lib/i18n";
import { supabaseBrowser } from "@/lib/supabase";

const field =
  "mt-2 w-full rounded-xl border border-line bg-ink px-4 py-3 text-base text-cream placeholder:text-sand/60 transition-colors focus:border-brass focus:outline-none";

/** A button that opens a form for asking for a song. The request shows up in /admin. */
export function SongRequest({ lang, t }: { lang: Lang; t: Dict["request"] }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const [state, setState] = useState<"idle" | "sending" | "sent" | "failed">("idle");

  const open = () => {
    dialog.current?.showModal();
    dialog.current?.querySelector<HTMLInputElement>("input[name=song]")?.focus();
  };
  const close = () => dialog.current?.close();
  // Once closed, a sent or failed request gives way to an empty form for the next one.
  const reset = () => setState((now) => (now === "sending" ? now : "idle"));
  // The dialog element itself is only hit by a click on the dimmed page around the form.
  const closeFromOutside = (event: MouseEvent<HTMLDialogElement>) => {
    if (event.target === event.currentTarget) close();
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setState("sending");
    const { error } = await supabaseBrowser()
      .from("song_requests")
      .insert({ song: String(form.get("song")), email: String(form.get("email")), lang });
    setState(error ? "failed" : "sent");
  };

  return (
    <>
      <button
        type="button"
        onClick={open}
        className="rounded-full border border-brass/60 px-5 py-2.5 text-sm font-medium text-brass-bright transition-colors hover:border-brass hover:bg-brass hover:text-ink"
      >
        {t.button}
      </button>
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
            {t.title}
          </h2>
          {state === "sent" ? (
            <>
              <p role="status" className="mt-5 leading-relaxed text-cream">
                {t.sent}
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
              <label className="mt-7 block text-sm text-sand">
                {t.song}
                <input name="song" required minLength={2} maxLength={300} placeholder={t.songPlaceholder} className={field} />
              </label>
              <label className="mt-5 block text-sm text-sand">
                {t.email}
                <input name="email" type="email" required maxLength={254} autoComplete="email" className={field} />
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
                {state === "sending" ? t.sending : t.send}
              </button>
            </form>
          )}
        </div>
      </dialog>
    </>
  );
}
