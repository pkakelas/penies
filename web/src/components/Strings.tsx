"use client";

import { useEffect, useRef } from "react";

// The eight strings of a bouzouki as four pairs, highest on top, tuned
// D-A-F-C. The two lower pairs are an octave apart, the two upper in unison.
// `hz` only sets how fast a string swings on screen; there is no sound.
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

/** Bouzouki strings across the page. Moving the pointer across a string makes it vibrate. */
export function Strings() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

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

    const pluck = (i: number, x: number, amp: number) => {
      plucks[i] = { at: performance.now(), x: Math.min(0.94, Math.max(0.06, x)), amp };
      wake();
    };

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
          if (at >= from && at < to) pluck(i, (event.clientX - box.left) / box.width, calm ? 0 : strength);
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
        pluck(nearest, (event.clientX - box.left) / box.width, calm ? 0 : 12);
      }
    };
    window.addEventListener("pointermove", onMove);
    canvas.addEventListener("pointerdown", onDown);

    // A strum on arrival, then the odd soft pluck, so the strings look alive.
    const timers: number[] = [];
    if (!calm) {
      STRINGS.forEach((_, i) => {
        timers.push(window.setTimeout(() => pluck(i, 0.72, 9), 700 + i * 70));
      });
      timers.push(
        window.setInterval(() => {
          if (document.visibilityState === "visible" && plucks.every((p) => p === null)) {
            pluck(Math.floor(Math.random() * STRINGS.length), 0.2 + Math.random() * 0.6, 5);
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

  return (
    <canvas
      ref={canvasRef}
      className="block h-[34svh] min-h-52 w-full touch-pan-y [mask-image:linear-gradient(to_right,transparent,black_14%,black_86%,transparent)]"
    />
  );
}
