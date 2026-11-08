"use client";

import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { StemEngine, type StemFiles } from "@/lib/engine";
import { dictionaries, formatTime, type Lang } from "@/lib/i18n";
import { playableLength, playableRange, STEMS_BUCKET, supabaseBrowser, type Song } from "@/lib/supabase";

const STEMS = ["instruments", "rhythm-guitar", "lead-guitar", "vocals"] as const;
const MIN_SPEED = 50;
const MAX_SPEED = 150;

/**
 * The stems a song is played from. An instrumental's vocals stem, if one was
 * uploaded, is only noise and is left out.
 */
const stemNames = (song: Song) =>
  STEMS.filter((name) => song.stems[name] && !(name === "vocals" && song.instrumental));

/** How far along a slider is, for its brass fill. */
const fill = (value: number, min: number, max: number) =>
  ({ "--fill": `${max > min ? ((value - min) / (max - min)) * 100 : 0}%` }) as CSSProperties;

/**
 * Plays a song's backing with the bouzouki and the vocals on switches, at
 * any speed from 50% to 150%. The audio itself is in lib/engine.ts.
 */
export function Player({ lang, song }: { lang: Lang; song: Song }) {
  const t = dictionaries[lang].player;
  const engine = useRef<StemEngine | null>(null);
  const names = stemNames(song);
  const hasVocals = names.includes("vocals");

  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [fetched, setFetched] = useState(0); // stems downloaded so far
  const [playing, setPlaying] = useState(false);
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(playableLength(song) ?? 0);
  const [lead, setLead] = useState(false);
  const [vocals, setVocals] = useState(true);
  const [speed, setSpeed] = useState(100);

  // Download and decode the stems.
  useEffect(() => {
    let cancelled = false;
    const storage = supabaseBrowser().storage.from(STEMS_BUCKET);
    const load = async () => {
      const files: Partial<Record<(typeof STEMS)[number], ArrayBuffer>> = {};
      await Promise.all(
        stemNames(song).map(async (name) => {
          const { data, error } = await storage.download(song.stems[name]);
          if (error) throw error;
          files[name] = await data.arrayBuffer();
          if (!cancelled) setFetched((n) => n + 1);
        }),
      );
      if (cancelled) return;
      const created = await StemEngine.create(files as StemFiles, { vocals: true, lead: false }, playableRange(song));
      if (cancelled) return created.destroy();
      engine.current = created;
      setDuration(created.duration);
      setState("ready");
    };
    load().catch(() => {
      if (!cancelled) setState("error");
    });
    return () => {
      cancelled = true;
      engine.current?.destroy();
      engine.current = null;
    };
  }, [song]);

  // Keep the engine in step with the controls.
  useEffect(() => {
    if (state === "ready") engine.current?.setLead(lead);
  }, [state, lead]);
  useEffect(() => {
    if (state === "ready") engine.current?.setVocals(vocals);
  }, [state, vocals]);
  useEffect(() => {
    if (state === "ready") engine.current?.setRate(speed / 100);
  }, [state, speed]);

  // Follow the position while playing; stop at the end.
  useEffect(() => {
    if (!playing) return;
    let frame = 0;
    const tick = () => {
      const current = engine.current;
      if (!current) return;
      if (current.finishIfEnded()) {
        setPlaying(false);
        setPosition(0);
        return;
      }
      setPosition(current.position());
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing]);

  const toggle = useCallback(() => {
    const current = engine.current;
    if (!current) return;
    if (current.playing) {
      current.pause();
      setPosition(current.position());
      setPlaying(false);
    } else {
      current.play();
      setPlaying(true);
    }
  }, []);

  // Space plays and pauses, unless it is being typed or is pressing a button.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.code !== "Space" || event.repeat || event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement;
      const isSlider = target instanceof HTMLInputElement && target.type === "range";
      if (!isSlider && target.closest("button, a, input, textarea, select, [contenteditable]")) return;
      event.preventDefault();
      toggle();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggle]);

  const seek = (seconds: number) => {
    engine.current?.seek(seconds);
    setPosition(seconds);
  };

  const ready = state === "ready";
  return (
    <section className="rise mt-12 rounded-3xl border border-line bg-coal p-6 shadow-2xl shadow-black/40 [animation-delay:160ms] sm:p-9">
      <div className="flex items-center gap-5 sm:gap-7">
        <button
          type="button"
          onClick={toggle}
          disabled={!ready}
          aria-label={playing ? t.pause : t.play}
          className="relative grid h-18 w-18 shrink-0 place-items-center rounded-full bg-brass text-ink transition-all hover:scale-105 hover:bg-brass-bright active:scale-95 disabled:scale-100 disabled:bg-ember disabled:text-sand sm:h-22 sm:w-22"
        >
          {!ready && state !== "error" ? (
            <span className="h-7 w-7 animate-spin rounded-full border-2 border-sand/30 border-t-brass" />
          ) : playing ? (
            <svg viewBox="0 0 24 24" className="h-8 w-8" aria-hidden="true">
              <rect x="6" y="5" width="4.2" height="14" rx="1.2" fill="currentColor" />
              <rect x="13.8" y="5" width="4.2" height="14" rx="1.2" fill="currentColor" />
            </svg>
          ) : (
            <svg viewBox="0 0 24 24" className="h-8 w-8" aria-hidden="true">
              <path d="M8 5.6v12.8c0 .8.9 1.3 1.6.9l10-6.4c.6-.4.6-1.400 0-1.800l-10-6.400c-.7-.4-1.600.1-1.600.9Z" fill="currentColor" />
            </svg>
          )}
        </button>
        <div className="min-w-0 flex-1">
          {state === "loading" ? (
            <div role="status">
              <p className="text-sm text-sand">
                {t.loading}
                <span className="ml-2 tabular-nums">
                  {fetched}/{names.length}
                </span>
              </p>
              <div className="mt-3 h-[3px] overflow-hidden rounded-full bg-cream/10">
                <div
                  className="h-full rounded-full bg-brass transition-[width] duration-500"
                  style={{ width: `${8 + (fetched / Math.max(1, names.length)) * 84}%` }}
                />
              </div>
            </div>
          ) : state === "error" ? (
            <p role="alert" className="text-sm text-wine">
              {t.loadError}
            </p>
          ) : (
            <>
              <input
                type="range"
                className="range"
                aria-label={t.position}
                aria-valuetext={formatTime(position)}
                min={0}
                max={duration}
                step={0.1}
                value={position}
                style={fill(position, 0, duration)}
                onChange={(event) => seek(Number(event.target.value))}
              />
              <div className="mt-1 flex justify-between text-sm text-sand tabular-nums">
                <span>{formatTime(position)}</span>
                <span>{formatTime(duration)}</span>
              </div>
            </>
          )}
        </div>
      </div>

      <div className="mt-8 grid gap-3 sm:grid-cols-2">
        <Switch label={t.bouzouki} detail={lead ? t.bouzoukiOn : t.bouzoukiOff} checked={lead} onChange={setLead} />
        <Switch
          label={t.vocals}
          detail={song.instrumental ? t.instrumental : !hasVocals ? t.noVocals : vocals ? t.vocalsOn : t.vocalsOff}
          checked={hasVocals && vocals}
          disabled={!hasVocals}
          onChange={setVocals}
        />
      </div>

      <div className="mt-8">
        <div className="flex items-baseline justify-between">
          <label htmlFor="speed" className="font-medium">
            {t.speed}
          </label>
          <span className="flex items-baseline gap-4">
            {speed !== 100 && (
              <button
                type="button"
                onClick={() => setSpeed(100)}
                className="text-sm text-sand underline decoration-line underline-offset-4 transition-colors hover:text-cream"
              >
                {t.reset}
              </button>
            )}
            <output htmlFor="speed" className="font-display text-3xl tabular-nums">
              {speed}%
            </output>
          </span>
        </div>
        <input
          id="speed"
          type="range"
          className="range mt-2"
          min={MIN_SPEED}
          max={MAX_SPEED}
          step={1}
          value={speed}
          style={fill(speed, MIN_SPEED, MAX_SPEED)}
          onChange={(event) => setSpeed(Number(event.target.value))}
        />
        <div className="flex justify-between text-xs text-sand tabular-nums">
          <span>{MIN_SPEED}%</span>
          <span>100%</span>
          <span>{MAX_SPEED}%</span>
        </div>
      </div>

      <p className="mt-8 hidden text-xs text-sand/80 sm:block">{t.spaceHint}</p>
    </section>
  );
}

function Switch(props: {
  label: string;
  detail: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (on: boolean) => void;
}) {
  const { label, detail, checked, disabled, onChange } = props;
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`flex items-center justify-between gap-4 rounded-2xl border px-5 py-4 text-left transition-colors disabled:opacity-50 ${
        checked ? "border-brass/50 bg-brass/[0.07]" : "border-line hover:border-cream/25"
      }`}
    >
      <span className="min-w-0">
        <span className="block font-medium">{label}</span>
        <span className="mt-0.5 block text-sm text-sand">{detail}</span>
      </span>
      <span
        aria-hidden="true"
        className={`relative h-7 w-12 shrink-0 rounded-full transition-colors ${checked ? "bg-brass" : "bg-cream/15"}`}
      >
        <span
          className={`absolute top-1 left-1 h-5 w-5 rounded-full bg-cream transition-transform ${checked ? "translate-x-5" : ""}`}
        />
      </span>
    </button>
  );
}
