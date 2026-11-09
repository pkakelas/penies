// Plays a song's stems in sync, at any speed, without changing the pitch.
//
// The stems are decoded and mixed into six channels:
//   0-1  backing: instruments (always heard). Songs split before the MVSEP
//        preset have the rhythm guitar as a stem of its own, which is added here.
//   2-3  vocals
//   4-5  lead guitar (the bouzouki)
// All six go into ONE Signalsmith Stretch node (public/vendor/SignalsmithStretch.js),
// which does the time-stretch; one node for everything keeps the stems aligned.
// Its output is split back into the three pairs, with a gain on vocals and lead.

type StretchNode = AudioWorkletNode & {
  schedule(change: { active?: boolean; input?: number; output?: number; rate?: number }): Promise<unknown>;
  addBuffers(channels: Float32Array[], transfer?: ArrayBuffer[]): Promise<number>;
  dropBuffers(): Promise<unknown>;
  latency(): Promise<number>;
};

declare global {
  interface Window {
    SignalsmithStretch?: (context: AudioContext, options: AudioWorkletNodeOptions) => Promise<StretchNode>;
  }
  interface Navigator {
    /** WebKit's Audio Session API (iOS 17+); other browsers do not have it. */
    audioSession?: { type: string };
  }
}

const CHANNELS = 6;
const LIBRARY = "/vendor/SignalsmithStretch.js";

let libraryLoading: Promise<void> | undefined;

/** Load the stretcher library once, as a plain script (that is how it finds its own code). */
function loadLibrary(): Promise<void> {
  libraryLoading ??= new Promise((resolve, reject) => {
    if (window.SignalsmithStretch) return resolve();
    const script = document.createElement("script");
    script.src = LIBRARY;
    script.onload = () => resolve();
    script.onerror = () => {
      libraryLoading = undefined;
      reject(new Error("could not load the audio engine"));
    };
    document.head.append(script);
  });
  return libraryLoading;
}

/** Encoded audio files by stem name. `rhythm-guitar` and `vocals` are optional. */
export type StemFiles = {
  instruments: ArrayBuffer;
  "rhythm-guitar"?: ArrayBuffer;
  "lead-guitar": ArrayBuffer;
  vocals?: ArrayBuffer;
};

/** The part of the recording to play, in seconds. Missing or null means the recording's own start or end. */
export type PlayRange = { start?: number | null; end?: number | null };

/** Silence as a WAV file (8-bit mono, 8 kHz: 8 kB per second). */
function silentWav(seconds: number): Blob {
  const rate = 8000;
  const bytes = new Uint8Array(44 + rate * seconds).fill(0x80, 44); // 0x80 is zero in 8-bit PCM
  const view = new DataView(bytes.buffer);
  const text = (at: number, value: string) => {
    for (let i = 0; i < value.length; i++) bytes[at + i] = value.charCodeAt(i);
  };
  text(0, "RIFF");
  view.setUint32(4, bytes.length - 8, true);
  text(8, "WAVEfmt ");
  view.setUint32(16, 16, true); // size of the format block
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // one channel
  view.setUint32(24, rate, true); // samples per second
  view.setUint32(28, rate, true); // bytes per second
  view.setUint16(32, 1, true); // bytes per sample
  view.setUint16(34, 8, true); // bits per sample
  text(36, "data");
  view.setUint32(40, rate * seconds, true);
  return new Blob([bytes], { type: "audio/wav" });
}

export class StemEngine {
  /** Length of what is played, in seconds (after trimming to the range). */
  duration = 0;
  playing = false;
  /** Called when `playing` changes, also when the engine itself starts or stops (see `silence`). */
  onchange?: () => void;

  private ctx: AudioContext;
  // Android only. To Chrome on Android, Web Audio alone is not "playing media":
  // once the browser is in the background the system slows it down, the
  // stretcher no longer keeps up and the sound breaks up. An <audio> element
  // does count (it gets the media notification), so a silent one plays in a
  // loop for as long as the song does. The notification's pause button, a phone
  // call or unplugged headphones pause that element, and the song follows it.
  private silence?: HTMLAudioElement;
  private stretch!: StretchNode;
  private vocalGain!: GainNode;
  private leadGain!: GainNode;
  private startDelay = 0; // seconds the stretcher needs to start a note cleanly
  private rate = 1;
  // Where we are: at context time `anchorTime` the song was at `anchorPos`
  // seconds, and (while playing) it moves on from there at `rate`.
  private anchorPos = 0;
  private anchorTime = 0;

  private constructor() {
    // On iOS, Web Audio is muted by the ring/silent switch unless the page asks
    // for a "playback" session, the way a music app does.
    if (navigator.audioSession) navigator.audioSession.type = "playback";
    this.ctx = new AudioContext();
    // iOS stops the context ("interrupted") on a phone call or when the browser
    // goes to the background. Hold the position, so play() carries on from there.
    this.ctx.onstatechange = () => {
      if (this.playing && this.ctx.state !== "running") this.stopAt(this.position());
    };
    if (/Android/i.test(navigator.userAgent)) {
      // Longer than 5 seconds: Chrome shows no notification for shorter sounds.
      const silence = new Audio(URL.createObjectURL(silentWav(10)));
      silence.loop = true;
      // The events arrive a moment late, so look at the element itself: after a
      // quick play and pause, the "play" event must not start the song again.
      silence.onpause = () => {
        if (silence.paused) this.pause();
      };
      silence.onplay = () => {
        if (!silence.paused) this.play();
      };
      // In the background the page draws no frames, so the player's own check for the end does not run.
      silence.ontimeupdate = () => this.finishIfEnded();
      this.silence = silence;
    }
  }

  /**
   * Decode the stems and get ready to play. Works before any click; sound starts on play().
   * With a `range`, only that part of the recording is kept: position 0 is its start.
   */
  static async create(
    files: StemFiles,
    levels: { vocals: boolean; lead: boolean },
    range: PlayRange = {},
  ): Promise<StemEngine> {
    const engine = new StemEngine();
    try {
      await loadLibrary();
      const ctx = engine.ctx;
      const node = await window.SignalsmithStretch!(ctx, {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        outputChannelCount: [CHANNELS],
      });
      engine.startDelay = await node.latency();

      const split = ctx.createChannelSplitter(CHANNELS);
      const backing = ctx.createChannelMerger(2);
      const vocals = ctx.createChannelMerger(2);
      const lead = ctx.createChannelMerger(2);
      engine.vocalGain = ctx.createGain();
      engine.leadGain = ctx.createGain();
      engine.vocalGain.gain.value = levels.vocals ? 1 : 0;
      engine.leadGain.gain.value = levels.lead ? 1 : 0;
      node.connect(split);
      split.connect(backing, 0, 0);
      split.connect(backing, 1, 1);
      split.connect(vocals, 2, 0);
      split.connect(vocals, 3, 1);
      split.connect(lead, 4, 0);
      split.connect(lead, 5, 1);
      backing.connect(ctx.destination);
      vocals.connect(engine.vocalGain).connect(ctx.destination);
      lead.connect(engine.leadGain).connect(ctx.destination);
      engine.stretch = node;

      const decode = (file: ArrayBuffer) => ctx.decodeAudioData(file);
      const [instruments, rhythm, leadGuitar, voice] = await Promise.all([
        decode(files.instruments),
        files["rhythm-guitar"] ? decode(files["rhythm-guitar"]) : null,
        decode(files["lead-guitar"]),
        files.vocals ? decode(files.vocals) : null,
      ]);
      const channels = mixChannels(
        [rhythm ? [instruments, rhythm] : [instruments], voice ? [voice] : [], [leadGuitar]],
        range,
        ctx.sampleRate,
      );
      engine.duration = channels[0].length / ctx.sampleRate;
      // Hand the channels over to the stretcher (moved, not copied).
      await node.addBuffers(channels, channels.map((channel) => channel.buffer as ArrayBuffer));
      return engine;
    } catch (error) {
      engine.destroy();
      throw error;
    }
  }

  /** Seconds into the song. */
  position(): number {
    if (!this.playing) return this.anchorPos;
    const moved = Math.max(0, this.ctx.currentTime - this.anchorTime) * this.rate;
    return Math.min(this.duration, this.anchorPos + moved);
  }

  play(): void {
    if (this.playing) return;
    // Must be called from the user's tap: browsers only let sound start that way.
    void this.ctx.resume();
    // Refused or cut short by a quick pause: the song plays all the same.
    this.silence?.play().catch(() => {});
    this.playing = true;
    this.startAt(this.anchorPos >= this.duration ? 0 : this.anchorPos, this.startDelay);
    this.onchange?.();
  }

  pause(): void {
    if (this.playing) this.stopAt(this.position());
  }

  seek(seconds: number): void {
    const pos = Math.min(this.duration, Math.max(0, seconds));
    if (this.playing) this.startAt(pos);
    else this.anchorPos = pos;
  }

  /** 1 = normal speed. */
  setRate(rate: number): void {
    const pos = this.position(); // read before the speed changes
    this.rate = rate;
    if (this.playing) this.startAt(pos);
  }

  setVocals(on: boolean): void {
    this.fade(this.vocalGain, on);
  }

  setLead(on: boolean): void {
    this.fade(this.leadGain, on);
  }

  /** Call regularly while playing: at the end of the song it stops and rewinds. Returns true when that happened. */
  finishIfEnded(): boolean {
    if (!this.playing || this.position() < this.duration) return false;
    this.stopAt(0);
    return true;
  }

  destroy(): void {
    this.playing = false;
    this.onchange = undefined;
    if (this.silence) {
      this.silence.pause();
      URL.revokeObjectURL(this.silence.src);
      this.silence.removeAttribute("src");
    }
    if (this.ctx.state !== "closed") void this.ctx.close();
  }

  private startAt(pos: number, delay = 0): void {
    this.anchorPos = pos;
    this.anchorTime = this.ctx.currentTime + delay;
    void this.stretch.schedule({ active: true, input: pos, output: this.anchorTime, rate: this.rate });
  }

  private stopAt(pos: number): void {
    this.anchorPos = pos;
    this.playing = false;
    void this.stretch.schedule({ active: false, output: this.ctx.currentTime });
    this.silence?.pause();
    this.onchange?.();
  }

  // A short fade instead of a hard switch, to avoid a click.
  private fade(gain: GainNode, on: boolean): void {
    gain.gain.setTargetAtTime(on ? 1 : 0, this.ctx.currentTime, 0.015);
  }
}

// Mix decoded stems into six equally long channels, keeping only the frames
// inside `range`. `groups` holds three lists of AudioBuffers (backing, vocals,
// lead); each list is summed into one stereo pair, and an empty list leaves
// its pair silent.
function mixChannels(groups: AudioBuffer[][], range: PlayRange, sampleRate: number): Float32Array[] {
  const total = Math.min(...groups.flat().map((buffer) => buffer.length));
  const { from, to } = trimFrames(range, total, sampleRate);
  const frames = to - from;
  const side = (buffer: AudioBuffer, i: number) =>
    buffer.getChannelData(Math.min(i, buffer.numberOfChannels - 1));
  return groups.flatMap((buffers) =>
    [0, 1].map((s) => {
      const out = new Float32Array(frames);
      buffers.forEach((buffer, n) => {
        const data = side(buffer, s).subarray(from, to);
        if (n === 0) out.set(data);
        else for (let i = 0; i < frames; i++) out[i] += data[i];
      });
      return out;
    }),
  );
}

// The first and last frame to keep. A range that leaves less than a second,
// or lies outside the recording, is ignored and the whole recording is kept.
function trimFrames(range: PlayRange, total: number, sampleRate: number): { from: number; to: number } {
  const start = Math.max(0, range.start ?? 0);
  const end = range.end ?? Infinity;
  const from = Math.min(total, Math.round(start * sampleRate));
  const to = Math.min(total, Math.round(end * sampleRate));
  if (to - from < sampleRate) return { from: 0, to: total };
  return { from, to };
}
