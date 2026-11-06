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

export class StemEngine {
  duration = 0;
  playing = false;

  private ctx: AudioContext;
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
    this.ctx = new AudioContext();
  }

  /** Decode the stems and get ready to play. Works before any click; sound starts on play(). */
  static async create(files: StemFiles, levels: { vocals: boolean; lead: boolean }): Promise<StemEngine> {
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
      const channels = mixChannels([
        rhythm ? [instruments, rhythm] : [instruments],
        voice ? [voice] : [],
        [leadGuitar],
      ]);
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
    void this.ctx.resume();
    this.playing = true;
    this.startAt(this.anchorPos >= this.duration ? 0 : this.anchorPos, this.startDelay);
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
  }

  // A short fade instead of a hard switch, to avoid a click.
  private fade(gain: GainNode, on: boolean): void {
    gain.gain.setTargetAtTime(on ? 1 : 0, this.ctx.currentTime, 0.015);
  }
}

// Mix decoded stems into six equally long channels. `groups` holds three
// lists of AudioBuffers (backing, vocals, lead); each list is summed into one
// stereo pair, and an empty list leaves its pair silent.
function mixChannels(groups: AudioBuffer[][]): Float32Array[] {
  const frames = Math.min(...groups.flat().map((buffer) => buffer.length));
  const side = (buffer: AudioBuffer, i: number) =>
    buffer.getChannelData(Math.min(i, buffer.numberOfChannels - 1));
  return groups.flatMap((buffers) =>
    [0, 1].map((s) => {
      const out = new Float32Array(frames);
      buffers.forEach((buffer, n) => {
        const data = side(buffer, s);
        if (n === 0) out.set(data.subarray(0, frames));
        else for (let i = 0; i < frames; i++) out[i] += data[i];
      });
      return out;
    }),
  );
}
