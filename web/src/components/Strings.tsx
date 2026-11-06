"use client";

import { useEffect, useRef, useState } from "react";

// The eight strings of a bouzouki as four pairs, highest on top, tuned
// D-A-F-C. The two lower pairs are an octave apart, the two upper in unison.
const STRINGS = [
  { hz: 293.66, width: 1.0 },
  { hz: 293.66, width: 1.0 },
  { hz: 220.0, width: 1.2 },
  { hz: 220.0, width: 1.2 },
  { hz: 349.23, width: 1.0 },
  { hz: 174.61, width: 1.7 },
  { hz: 261.63, width: 1.1 },
  { hz: 130.81, width: 2.1 },
];
const PAIR_GAP = 7; // px between the two strings of a pair
const DECAY = 1.5; // how fast a plucked string settles (per second)
const SEGMENTS = 96;

type Pluck = { at: number; x: number; amp: number };

/**
 * Bouzouki strings across the page. Moving the pointer across a string
 * plucks it; with the sound switched on it also rings at its real pitch.
 */
export function Strings({ soundOn, soundOff }: { soundOn: string; soundOff: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const pluckRef = useRef<(index: number, x: number, amp: number, audible: boolean) => void>(() => {});
  const audioRef = useRef<{ ctx: AudioContext; buffers: Map<number, AudioBuffer>; out: GainNode } | null>(null);
  const [sound, setSound] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current!;
    const g = canvas.getContext("2d")!;
    const calm = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const plucks: (Pluck | null)[] = STRINGS.map(() => null);
    let width = 0;
    let height = 0;
    let frame = 0;

    // y of each string: four pairs spread over the height.
    const stringY = (i: number) => {
      const pair = Math.floor(i / 2);
      const centre = height * (0.2 + 0.2 * pair);
      return centre + (i % 2 === 0 ? -PAIR_GAP / 2 : PAIR_GAP / 2);
    };

    const draw = (now: number) => {
      frame = 0;
      g.clearRect(0, 0, width, height);
      let moving = false;
      STRINGS.forEach((string, i) => {
        const y0 = stringY(i);
        const pluck = plucks[i];
        let amp = 0;
        let t = 0;
        if (pluck) {
          t = (now - pluck.at) / 1000;
          amp = pluck.amp * Math.exp(-t * DECAY);
          if (amp < 0.15) plucks[i] = null;
          else moving = true;
        }
        g.beginPath();
        if (!pluck || amp < 0.15) {
          g.moveTo(0, y0);
          g.lineTo(width, y0);
        } else {
          // Starts as a triangle pulled at the pluck point, then relaxes
          // into the string's smooth fundamental swing.
          const sharp = Math.exp(-t * 7);
          const swing = Math.cos(t * 2 * Math.PI * (5 + string.hz / 45));
          for (let s = 0; s <= SEGMENTS; s++) {
            const x = s / SEGMENTS;
            const triangle = x < pluck.x ? x / pluck.x : (1 - x) / (1 - pluck.x);
            const shape = sharp * triangle + (1 - sharp) * Math.sin(Math.PI * x);
            const y = y0 + amp * shape * swing;
            if (s === 0) g.moveTo(0, y);
            else g.lineTo(x * width, y);
          }
        }
        const glow = Math.min(1, amp / 10);
        g.lineWidth = string.width;
        g.strokeStyle = `rgba(${217 + 27 * glow}, ${164 + 43 * glow}, ${65 + 65 * glow}, ${0.5 + 0.5 * glow})`;
        g.shadowColor = "rgba(244, 207, 130, 0.9)";
        g.shadowBlur = glow * 16;
        g.stroke();
      });
      if (moving) frame = requestAnimationFrame(draw);
    };
    const wake = () => {
      if (!frame) frame = requestAnimationFrame(draw);
    };

    const resize = () => {
      const ratio = window.devicePixelRatio || 1;
      width = canvas.clientWidth;
      height = canvas.clientHeight;
      canvas.width = Math.round(width * ratio);
      canvas.height = Math.round(height * ratio);
      g.setTransform(ratio, 0, 0, ratio, 0, 0);
      wake();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    resize();

    const pluck = (i: number, x: number, amp: number, audible: boolean) => {
      plucks[i] = { at: performance.now(), x: Math.min(0.94, Math.max(0.06, x)), amp };
      wake();
      const audio = audioRef.current;
      if (audible && audio) {
        const source = audio.ctx.createBufferSource();
        const level = audio.ctx.createGain();
        source.buffer = audio.buffers.get(STRINGS[i].hz)!;
        level.gain.value = Math.min(1, amp / 14) * 0.6;
        source.connect(level).connect(audio.out);
        source.start();
      }
    };
    pluckRef.current = pluck;

    // Pluck every string the pointer crossed since its last position.
    let lastY: number | null = null;
    const onMove = (event: PointerEvent) => {
      const box = canvas.getBoundingClientRect();
      const y = event.clientY - box.top;
      const inside = event.clientX >= box.left && event.clientX <= box.right;
      if (inside && lastY !== null) {
        const from = Math.min(lastY, y);
        const to = Math.max(lastY, y);
        const strength = Math.min(16, Math.max(5, Math.abs(y - lastY) * 0.7));
        STRINGS.forEach((_, i) => {
          const at = stringY(i);
          if (at >= from && at < to) pluck(i, (event.clientX - box.left) / box.width, calm ? 0 : strength, true);
        });
      }
      lastY = inside ? y : null;
    };
    // A tap plucks the nearest string.
    const onDown = (event: PointerEvent) => {
      const box = canvas.getBoundingClientRect();
      const y = event.clientY - box.top;
      let nearest = 0;
      STRINGS.forEach((_, i) => {
        if (Math.abs(stringY(i) - y) < Math.abs(stringY(nearest) - y)) nearest = i;
      });
      if (Math.abs(stringY(nearest) - y) < 24) {
        pluck(nearest, (event.clientX - box.left) / box.width, calm ? 0 : 12, true);
      }
    };
    window.addEventListener("pointermove", onMove);
    canvas.addEventListener("pointerdown", onDown);

    // A silent strum on arrival, then the odd soft pluck, so the strings look alive.
    const timers: number[] = [];
    if (!calm) {
      STRINGS.forEach((_, i) => {
        timers.push(window.setTimeout(() => pluck(i, 0.72, 9, false), 700 + i * 70));
      });
      timers.push(
        window.setInterval(() => {
          if (document.visibilityState === "visible" && plucks.every((p) => p === null)) {
            pluck(Math.floor(Math.random() * STRINGS.length), 0.2 + Math.random() * 0.6, 5, false);
          }
        }, 5200),
      );
    }

    return () => {
      observer.disconnect();
      window.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerdown", onDown);
      timers.forEach((id) => window.clearTimeout(id));
      cancelAnimationFrame(frame);
    };
  }, []);

  useEffect(() => () => void audioRef.current?.ctx.close(), []);

  const toggleSound = () => {
    if (sound) {
      void audioRef.current?.ctx.suspend();
      setSound(false);
      return;
    }
    if (!audioRef.current) {
      const ctx = new AudioContext();
      const out = ctx.createGain();
      out.gain.value = 0.5;
      out.connect(ctx.destination);
      const buffers = new Map<number, AudioBuffer>();
      for (const { hz } of STRINGS) if (!buffers.has(hz)) buffers.set(hz, pluckedString(ctx, hz));
      audioRef.current = { ctx, buffers, out };
    }
    void audioRef.current.ctx.resume();
    setSound(true);
    // Answer the click with a strum.
    STRINGS.forEach((_, i) => window.setTimeout(() => pluckRef.current(i, 0.7, 11, true), i * 55));
  };

  return (
    <div className="relative">
      <canvas
        ref={canvasRef}
        className="block h-[34svh] min-h-52 w-full touch-pan-y [mask-image:linear-gradient(to_right,transparent,black_14%,black_86%,transparent)]"
      />
      <div className="pointer-events-none absolute inset-x-0 bottom-3 mx-auto flex max-w-6xl items-center px-6 text-xs tracking-wide text-sand sm:px-10">
        <button
          type="button"
          onClick={toggleSound}
          aria-pressed={sound}
          className="pointer-events-auto ml-auto flex items-center gap-2 rounded-full border border-line px-3 py-1.5 transition-colors hover:border-brass hover:text-cream"
        >
          <span className={`h-1.5 w-1.5 rounded-full ${sound ? "bg-brass-bright" : "bg-sand/50"}`} />
          {sound ? soundOn : soundOff}
        </button>
      </div>
    </div>
  );
}

/** A plucked steel string at `hz`, by Karplus-Strong synthesis. */
function pluckedString(ctx: AudioContext, hz: number): AudioBuffer {
  const rate = ctx.sampleRate;
  const period = Math.round(rate / hz);
  const buffer = ctx.createBuffer(1, Math.round(rate * 2.4), rate);
  const out = buffer.getChannelData(0);
  const ring = new Float32Array(period);
  for (let i = 0; i < period; i++) ring[i] = Math.random() * 2 - 1;
  let at = 0;
  for (let i = 0; i < out.length; i++) {
    const next = (at + 1) % period;
    out[i] = ring[at];
    ring[at] = (ring[at] + ring[next]) * 0.5 * 0.9965;
    at = next;
  }
  return buffer;
}
