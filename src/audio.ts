import type { WeaponId } from "../shared/types";
import { WEAPON_CATALOG } from "../shared/weapons";

export type SoundName =
  | "ui" | "jump" | "backflip" | "grapple" | "release" | "land" | "bounce"
  | "hurt" | "death" | "splash" | "respawn" | "shot" | "explosion" | "pickup"
  | "switch" | "select" | "mineArm" | "mineTrigger" | "victory" | "panic"
  | "step" | "reel" | "empty" | "tick";

export interface SoundOptions {
  volume?: number;
  pitch?: number;
  pan?: number;
  weapon?: WeaponId;
  intensity?: number;
}

interface MotionSound {
  wind: number;
  swing: number;
  charge: number;
  pan: number;
}

interface Voice {
  gain: GainNode;
  panner: StereoPannerNode;
  nodes: AudioNode[];
  sources: Set<AudioScheduledSourceNode>;
  pitch: number;
  start: number;
  closed: boolean;
}

interface MotionLoop {
  voice: Voice;
  filter?: BiquadFilterNode;
  oscillator?: OscillatorNode;
  harmonic?: OscillatorNode;
  stopping: boolean;
}

const QUIET = 0.0001;
const MAX_VOICES = 28;
const ZERO_MOTION: MotionSound = { wind: 0, swing: 0, charge: 0, pan: 0 };
const clamp = (value: number, min = 0, max = 1) =>
  Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : min;

/** Original, download-free cartoon foley. The audio graph is created by a user gesture only. */
export class GameAudio {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private compressor: DynamicsCompressorNode | null = null;
  private noiseBuffer: AudioBuffer | null = null;
  private voices = new Set<Voice>();
  private loops = new Map<"wind" | "swing" | "charge", MotionLoop>();
  private enabled = true;
  private suspended = false;
  private disposed = false;
  private motion: MotionSound = { ...ZERO_MOTION };

  get diagnostics() {
    return {
      enabled: this.enabled,
      unlocked: this.context?.state === "running",
      suspended: this.suspended,
      activeVoices: this.voices.size,
      activeLoops: this.loops.size,
      motion: { ...this.motion },
    };
  }

  unlock(): void {
    if (this.disposed || !this.enabled || this.suspended) return;
    try {
      if (!this.context) {
        const constructors = globalThis as typeof globalThis & {
          webkitAudioContext?: typeof AudioContext;
        };
        const AudioContextClass = constructors.AudioContext ?? constructors.webkitAudioContext;
        if (!AudioContextClass) return;
        const context = new AudioContextClass();
        this.context = context;
        const master = context.createGain();
        master.gain.value = 0.72;
        const compressor = context.createDynamicsCompressor();
        compressor.threshold.value = -14;
        compressor.knee.value = 12;
        compressor.ratio.value = 7;
        compressor.attack.value = 0.004;
        compressor.release.value = 0.18;
        compressor.connect(master);
        master.connect(context.destination);
        this.master = master;
        this.compressor = compressor;
        // A single shared noise buffer supplies every whoosh, splash, and impact.
        const noise = context.createBuffer(1, context.sampleRate * 2, context.sampleRate);
        const samples = noise.getChannelData(0);
        for (let i = 0; i < samples.length; i++) samples[i] = Math.random() * 2 - 1;
        this.noiseBuffer = noise;
      }
      if (this.context.state !== "running") {
        // Some browsers reject resume during an unavailable/interrupted gesture. Retry next gesture.
        void this.context.resume().then(() => {
          if (this.canPlay()) this.updateMotion();
        }).catch(() => {});
      } else {
        this.updateMotion();
      }
    } catch {
      // An unavailable audio device must never interrupt play or produce an unhandled rejection.
      this.disposeGraph();
    }
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    this.updateOutput();
  }

  setSuspended(suspended: boolean): void {
    this.suspended = suspended;
    this.updateOutput();
  }

  private updateOutput(): void {
    if (!this.enabled || this.suspended) this.reset();
    const context = this.context;
    const master = this.master;
    if (!context || !master) return;
    master.gain.cancelScheduledValues(context.currentTime);
    // Lifecycle/mute changes must silence even notes scheduled for later in a jingle.
    master.gain.setValueAtTime(this.enabled && !this.suspended ? 0.72 : 0, context.currentTime);
  }

  play(name: SoundName, options: SoundOptions = {}): void {
    if (!this.canPlay()) return;
    const volume = clamp(options.volume ?? 1, 0, 1.5);
    if (!volume) return;
    const voice = this.createVoice(volume, options.pan ?? 0, options.pitch ?? 1);
    if (!voice) return;
    const intensity = clamp(options.intensity ?? 0.65, 0.1, 1.5);
    try {
      switch (name) {
        case "ui":
          this.tone(voice, 0, 0.085, 530, 680, 0.11, "sine");
          break;
        case "select":
          this.tone(voice, 0, 0.085, 440, 620, 0.12, "triangle");
          this.tone(voice, 0.07, 0.12, 830, 810, 0.085);
          break;
        case "step":
          this.tone(voice, 0, 0.065, 115, 56, 0.16);
          this.noise(voice, 0, 0.055, 850, 260, 0.12, 0.7);
          this.tone(voice, 0.015, 0.05, 360, 170, 0.035);
          break;
        case "jump":
          this.boing(voice, 0, 0.24, 170, 530, 0.17);
          this.noise(voice, 0, 0.07, 750, 1900, 0.08);
          break;
        case "backflip":
          this.boing(voice, 0, 0.31, 180, 900, 0.18);
          this.tone(voice, 0.1, 0.23, 490, 1100, 0.07, "triangle");
          this.noise(voice, 0, 0.14, 900, 2600, 0.09);
          break;
        case "grapple":
          this.noise(voice, 0, 0.12, 800, 3200, 0.19, 1.1);
          this.tone(voice, 0, 0.13, 210, 690, 0.105, "triangle");
          this.tone(voice, 0.09, 0.11, 450, 130, 0.12);
          break;
        case "release":
          this.tone(voice, 0, 0.11, 580, 180, 0.105);
          this.noise(voice, 0, 0.075, 1800, 700, 0.08);
          break;
        case "reel":
          this.tone(voice, 0, 0.035, 780, 520, 0.07, "triangle");
          this.noise(voice, 0, 0.035, 2300, 1100, 0.045, 2);
          break;
        case "land":
          this.tone(voice, 0, 0.17, 110 + intensity * 40, 42, 0.15 + intensity * 0.08);
          this.noise(voice, 0, 0.14, 900 + intensity * 900, 260, 0.12 + intensity * 0.08);
          this.tone(voice, 0.02, 0.1, 300, 150, 0.04);
          break;
        case "bounce":
          this.boing(voice, 0, 0.24 + intensity * 0.08, 400 + intensity * 160, 90, 0.18);
          this.noise(voice, 0, 0.065, 700, 280, 0.08);
          break;
        case "hurt":
          this.vowel(voice, 0, 0.24, 205, 110, 650, 1500, 0.24);
          this.noise(voice, 0, 0.06, 1300, 420, 0.1);
          break;
        case "panic":
          // Rounded "oh", then a nasal onset and falling "nooo": a tiny frog voice.
          this.vowel(voice, 0, 0.21, 165, 215, 440, 850, 0.26);
          this.vowel(voice, 0.22, 0.085, 210, 215, 260, 1400, 0.16);
          this.vowel(voice, 0.28, 0.43, 220, 105, 490, 960, 0.3);
          break;
        case "death":
          this.vowel(voice, 0, 0.48, 185, 55, 550, 1050, 0.26);
          this.tone(voice, 0.05, 0.55, 740, 90, 0.09, "triangle");
          this.tone(voice, 0.48, 0.18, 100, 45, 0.1);
          break;
        case "splash":
          this.noise(voice, 0, 0.5, 2500, 240, 0.48, 0.55);
          this.noise(voice, 0.025, 0.22, 4300, 1200, 0.17, 0.8);
          this.tone(voice, 0, 0.16, 120, 40, 0.19);
          for (let i = 0; i < 6; i++) {
            const frequency = 220 + Math.random() * 340;
            this.tone(voice, 0.12 + i * 0.064, 0.11, frequency, frequency * 1.8, 0.05);
          }
          break;
        case "respawn":
          this.chime(voice, [330, 440, 660, 880], 0.075, 0.22, 0.13);
          this.noise(voice, 0, 0.2, 400, 2200, 0.065);
          break;
        case "shot":
          this.weapon(voice, options.weapon ?? "rocket");
          break;
        case "explosion":
          if (options.weapon && this.effectWeapon(voice, options.weapon, true, intensity)) {
            // Persistent fields and status weapons have material-specific impact sounds.
          } else if (options.weapon === "gust") {
            this.noise(voice, 0, 0.32, 2100, 450, 0.25, 0.5);
          } else if (options.weapon === "pulse") {
            this.vowel(voice, 0, 0.2, 120, 65, 330, 850, 0.17);
            this.tone(voice, 0, 0.23, 145, 48, 0.13);
          } else if (options.weapon === "golf" || options.weapon === "bat" || options.weapon === "boxing") {
            this.tone(voice, 0, 0.16, options.weapon === "golf" ? 370 : 135, 55, 0.22, "triangle");
            this.noise(voice, 0, 0.13, 1500, 350, 0.2);
          } else if (options.weapon === "vacuum") {
            this.noise(voice, 0, 0.6, 2000, 100, 0.32);
            this.tone(voice, 0, 0.55, 340, 42, 0.24, "triangle");
          } else if (options.weapon === "springMine") {
            this.boing(voice, 0, 0.55, 120, 820, 0.24);
            this.noise(voice, 0, 0.12, 1800, 500, 0.18);
          } else if (options.weapon === "anvil") {
            this.tone(voice, 0, 0.18, 105, 35, 0.28);
            this.chime(voice, [570, 811, 1231], 0.012, 0.42, 0.07);
            this.noise(voice, 0, 0.25, 3000, 240, 0.35);
          } else {
            const size = options.weapon === "meteor" || options.weapon === "megaBomb" ? 1.3 : intensity;
            this.noise(voice, 0, 0.3 + size * 0.38, 2700, 130, 0.35 + size * 0.13, 0.55);
            this.noise(voice, 0, 0.09, 4200, 700, 0.25, 0.7);
            this.tone(voice, 0, 0.2 + size * 0.22, 125, 32, 0.3, "sine");
            this.tone(voice, 0.035, 0.28, 75, 35, 0.15, "triangle");
            if (options.weapon === "cluster" || options.weapon === "firework") {
              for (let i = 0; i < 3; i++) this.noise(voice, 0.1 + i * 0.09, 0.07, 3000, 900, 0.1);
            }
          }
          break;
        case "pickup":
          this.chime(voice, [523, 659, 784, 1047], 0.055, 0.2, 0.13);
          break;
        case "switch":
          this.tone(voice, 0, 0.12, 262, 392, 0.13, "triangle");
          this.chime(voice, [523, 784], 0.085, 0.19, 0.11);
          break;
        case "mineArm":
          this.noise(voice, 0, 0.06, 3000, 1300, 0.11);
          this.chime(voice, [660, 880], 0.1, 0.09, 0.105);
          break;
        case "mineTrigger":
          this.chime(voice, [920, 920, 1160, 1160], 0.1, 0.075, 0.12);
          break;
        case "victory":
          this.chime(voice, [392, 523, 659, 784, 659, 1047], 0.14, 0.35, 0.15);
          this.tone(voice, 0.7, 0.55, 523, 523, 0.07, "triangle");
          break;
        case "empty":
          this.noise(voice, 0, 0.05, 1100, 430, 0.1, 2);
          this.tone(voice, 0, 0.1, 155, 100, 0.12, "triangle");
          break;
        case "tick":
          this.tone(voice, 0, 0.075, 880, 720, 0.09);
          break;
      }
      if (!voice.sources.size) this.stopVoice(voice);
    } catch {
      this.stopVoice(voice);
    }
  }

  setMotion(motion: MotionSound): void {
    this.motion = {
      wind: clamp(motion.wind),
      swing: clamp(motion.swing),
      charge: clamp(motion.charge),
      pan: clamp(motion.pan, -1, 1),
    };
    if (this.canPlay()) this.updateMotion();
  }

  reset(): void {
    this.motion = { ...ZERO_MOTION };
    this.loops.clear();
    for (const voice of this.voices) this.stopVoice(voice);
  }

  dispose(): void {
    this.disposed = true;
    this.disposeGraph();
  }

  private disposeGraph(): void {
    this.reset();
    this.master?.disconnect();
    this.compressor?.disconnect();
    const context = this.context;
    this.context = null;
    this.master = null;
    this.compressor = null;
    this.noiseBuffer = null;
    if (context && context.state !== "closed") void context.close().catch(() => {});
  }

  private canPlay(): boolean {
    // Do not queue one-shots in an interrupted/autoplay-blocked context: they would all burst
    // out together on a later gesture. Continuous motion is restored once resume succeeds.
    return !this.disposed && this.enabled && !this.suspended && !!this.context &&
      this.context.state === "running" && !!this.compressor;
  }

  private createVoice(volume: number, pan: number, pitch = 1): Voice | null {
    const context = this.context;
    if (!context || !this.compressor) return null;
    // Groups include every layer of an effect, so a busy chain reaction cannot grow the graph forever.
    if (this.voices.size >= MAX_VOICES) {
      const loopVoices = new Set([...this.loops.values()].map((loop) => loop.voice));
      const oldest = [...this.voices].find((voice) => !loopVoices.has(voice));
      if (oldest) this.stopVoice(oldest);
      else return null;
    }
    const gain = context.createGain();
    const panner = context.createStereoPanner();
    gain.gain.value = volume;
    panner.pan.value = clamp(pan, -1, 1);
    gain.connect(panner);
    panner.connect(this.compressor);
    const voice: Voice = {
      gain, panner, nodes: [gain, panner], sources: new Set(),
      pitch: clamp(pitch, 0.4, 2.5) * (0.97 + Math.random() * 0.06),
      start: context.currentTime + 0.005,
      closed: false,
    };
    this.voices.add(voice);
    return voice;
  }

  private connectSource(voice: Voice, source: AudioScheduledSourceNode): void {
    voice.sources.add(source);
    voice.nodes.push(source);
    source.onended = () => {
      voice.sources.delete(source);
      source.disconnect();
      if (!voice.sources.size) this.stopVoice(voice);
    };
  }

  private stopVoice(voice: Voice): void {
    if (voice.closed) return;
    voice.closed = true;
    for (const source of voice.sources) {
      source.onended = null;
      try { source.stop(); } catch { /* A source may already have ended. */ }
    }
    voice.sources.clear();
    for (const node of voice.nodes) node.disconnect();
    voice.nodes.length = 0;
    this.voices.delete(voice);
  }

  private envelope(voice: Voice, start: number, duration: number, amplitude: number, attack = 0.006, sustain = 0): GainNode {
    const gain = this.context!.createGain();
    const peak = Math.max(QUIET, amplitude);
    gain.gain.setValueAtTime(QUIET, start);
    gain.gain.exponentialRampToValueAtTime(peak, start + Math.min(attack, duration * 0.2));
    if (sustain) gain.gain.setValueAtTime(peak, start + duration * sustain);
    gain.gain.exponentialRampToValueAtTime(QUIET, start + duration);
    gain.connect(voice.gain);
    voice.nodes.push(gain);
    return gain;
  }

  private tone(voice: Voice, delay: number, duration: number, from: number, to: number, amplitude: number, type: OscillatorType = "sine"): OscillatorNode {
    const oscillator = this.context!.createOscillator();
    const start = voice.start + delay;
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(Math.max(20, from * voice.pitch), start);
    oscillator.frequency.exponentialRampToValueAtTime(Math.max(20, to * voice.pitch), start + duration);
    oscillator.connect(this.envelope(voice, start, duration, amplitude));
    this.connectSource(voice, oscillator);
    oscillator.start(start);
    oscillator.stop(start + duration + 0.012);
    return oscillator;
  }

  private boing(voice: Voice, delay: number, duration: number, from: number, to: number, amplitude: number): void {
    const oscillator = this.tone(voice, delay, duration, from, to, amplitude, "triangle");
    const start = voice.start + delay;
    oscillator.frequency.cancelScheduledValues(start);
    const frequencies = new Float32Array(48);
    for (let i = 0; i < frequencies.length; i++) {
      const phase = i / (frequencies.length - 1);
      const glide = from * Math.pow(to / from, phase);
      frequencies[i] = glide * (1 + Math.sin(phase * Math.PI * 9) * 0.22 * (1 - phase)) * voice.pitch;
    }
    oscillator.frequency.setValueCurveAtTime(frequencies, start, duration);
  }

  private noise(voice: Voice, delay: number, duration: number, from: number, to: number, amplitude: number, resonance = 0.7): void {
    const context = this.context!;
    const source = context.createBufferSource();
    source.buffer = this.noiseBuffer;
    const filter = context.createBiquadFilter();
    const start = voice.start + delay;
    filter.type = "bandpass";
    filter.Q.value = resonance;
    filter.frequency.setValueAtTime(from * voice.pitch, start);
    filter.frequency.exponentialRampToValueAtTime(to * voice.pitch, start + duration);
    source.connect(filter);
    filter.connect(this.envelope(voice, start, duration, amplitude, 0.009));
    voice.nodes.push(filter);
    this.connectSource(voice, source);
    source.start(start, Math.random() * Math.max(0, 1.8 - duration));
    source.stop(start + duration + 0.012);
  }

  private vowel(voice: Voice, delay: number, duration: number, from: number, to: number, firstFormant: number, secondFormant: number, amplitude: number): void {
    const context = this.context!;
    const source = context.createOscillator();
    const start = voice.start + delay;
    source.type = "sawtooth";
    source.frequency.setValueAtTime(from * voice.pitch, start);
    source.frequency.exponentialRampToValueAtTime(to * voice.pitch, start + duration);
    const envelope = this.envelope(voice, start, duration, amplitude, 0.028, 0.45);
    for (const frequency of [firstFormant, secondFormant]) {
      const filter = context.createBiquadFilter();
      filter.type = "bandpass";
      filter.frequency.value = frequency * voice.pitch;
      filter.Q.value = 5;
      source.connect(filter);
      filter.connect(envelope);
      voice.nodes.push(filter);
    }
    this.connectSource(voice, source);
    source.start(start);
    source.stop(start + duration + 0.012);
    // Fundamental gives the band-limited vowels a little friendly, throaty frog body.
    this.tone(voice, delay, duration, from, to, amplitude * 0.17);
  }

  private chime(voice: Voice, notes: number[], spacing: number, duration: number, amplitude: number): void {
    notes.forEach((note, i) => {
      this.tone(voice, i * spacing, duration, note, note * 0.995, amplitude, "triangle");
      this.tone(voice, i * spacing, duration * 0.6, note * 2, note * 2, amplitude * 0.2);
    });
  }

  /** Shared effect metadata gives future weapons a matching sound without another ID switch. */
  private effectWeapon(voice: Voice, weapon: WeaponId, impact = false, intensity = 0.65): boolean {
    const definition = WEAPON_CATALOG[weapon];
    const effect = definition.hazard?.kind ?? definition.status?.kind ?? (definition.cutsRopes ? "wire" : undefined);
    if (!effect) return false;
    const duration = impact ? 0.48 : 0.25;
    const level = impact ? 0.18 + intensity * 0.045 : 0.17;
    // Rays have a higher register than the corresponding thrown environmental hazard.
    const register = definition.hazard ? 1 : 1.35;
    switch (effect) {
      case "oil": case "slippery":
        this.boing(voice, 0, duration, 310 * register, impact ? 65 : 530, level);
        this.noise(voice, 0, duration * 0.7, 1050, 280, level * 0.8, 1.6);
        this.tone(voice, 0.06, 0.14, 520, 150, level * 0.6);
        break;
      case "ice": case "chilled":
        this.noise(voice, 0, duration * 0.55, 4800, 1800, level, 2);
        this.chime(voice, impact ? [1480, 1110, 830] : [830, 1110, 1660], 0.035, duration, level * 0.45);
        break;
      case "glue": case "sticky":
        this.tone(voice, 0, duration, 780 * register, impact ? 65 : 130, level);
        this.noise(voice, 0, duration * 0.65, 1300, 260, level * 0.85, 2.5);
        this.boing(voice, 0.06, duration * 0.6, 190, 430, level * 0.45);
        break;
      case "wire":
        this.noise(voice, 0, 0.065, 4700, 1700, level, 2.2);
        this.noise(voice, 0.08, 0.06, 3600, 1000, level * 0.75, 2.2);
        this.chime(voice, impact ? [1310, 1777, 2161] : [1777, 1310], 0.035, duration, level * 0.35);
        break;
      case "fire": case "burning":
        this.noise(voice, 0, duration, impact ? 3700 : 900, impact ? 430 : 3100, level * 1.5, 0.5);
        this.tone(voice, 0, duration * 0.7, 140 * register, 45, level * 0.75);
        for (let i = 0; i < 3; i++) this.noise(voice, i * 0.085, 0.055, 2900, 1100, level * 0.45, 1.8);
        break;
      case "poison": case "poisoned":
        this.noise(voice, 0, duration, 950, 2600, level, 1.8);
        for (let i = 0; i < 3; i++) this.tone(voice, i * 0.065, duration * 0.5, (210 + i * 83) * register, 580 - i * 110, level * 0.65);
        break;
      case "gravity": case "heavy":
        this.tone(voice, 0, duration + 0.12, impact ? 220 : 70, impact ? 36 : 260, level, "triangle");
        this.tone(voice, 0.02, duration, impact ? 237 : 76, impact ? 40 : 287, level * 0.6);
        this.noise(voice, 0, duration, 1600, 180, level * 0.85);
        break;
      case "repulsor":
        this.tone(voice, 0, duration, 90, impact ? 740 : 470, level, "triangle");
        this.tone(voice, 0.035, duration, 135, impact ? 1110 : 705, level * 0.5);
        this.noise(voice, 0, duration, 330, 2500, level * 1.15, 0.6);
        break;
      case "updraft": case "feather":
        this.noise(voice, 0, duration + 0.12, 480, 3200, level, 0.5);
        this.chime(voice, impact ? [490, 660, 880] : [660, 990], 0.055, duration, level * 0.35);
        break;
      case "spring": case "bouncy":
        this.boing(voice, 0, duration + 0.1, impact ? 130 : 230, impact ? 930 : 700, level * 1.2);
        this.noise(voice, 0, 0.07, 1200, 460, level * 0.65);
        break;
      case "confused":
        this.chime(voice, impact ? [510, 643, 485, 727] : [727, 510, 643], 0.065, duration, level * 0.5);
        this.boing(voice, 0, duration, 210, 370, level * 0.5);
        break;
      case "dazzled":
        this.noise(voice, 0, 0.085, 4200, 1400, level * 1.2, 0.6);
        this.chime(voice, [1320, 1660, 1980], 0.025, duration, level * 0.28);
        break;
      case "pixelated":
        for (const [i, note] of [660, 330, 990, 495, 1320].entries()) {
          this.tone(voice, i * 0.043, 0.07, note, note, level * 0.45, "square");
        }
        break;
      case "inverted":
        this.tone(voice, 0, duration, 230, 980, level * 0.8, "triangle");
        this.tone(voice, 0, duration, 980, 230, level * 0.6, "triangle");
        this.noise(voice, 0, duration * 0.45, 1800, 430, level * 0.6);
        break;
    }
    if (definition.hazard && definition.status) {
      // Combination weapons retain their additional status identity over the field sound.
      this.chime(voice, [610, 773, 517], 0.055, duration * 0.8, level * 0.32);
    }
    if (definition.cutsRopes && effect !== "wire") {
      this.noise(voice, 0.025, 0.06, 4400, 1400, level * 0.8, 2);
    }
    return true;
  }

  private weapon(voice: Voice, weapon: WeaponId): void {
    if (this.effectWeapon(voice, weapon)) return;
    switch (weapon) {
      case "pulse":
        this.vowel(voice, 0, 0.34, 110, 45, 400, 950, 0.37);
        this.tone(voice, 0, 0.28, 270, 70, 0.19, "triangle");
        break;
      case "gust":
        this.noise(voice, 0, 0.5, 460, 2400, 0.4, 0.5);
        break;
      case "golf": case "bat": case "boxing":
        this.noise(voice, 0, 0.17, 550, 2600, 0.23);
        this.tone(voice, 0.075, 0.15, weapon === "golf" ? 720 : 175, weapon === "golf" ? 440 : 55, 0.23, "triangle");
        this.noise(voice, 0.075, 0.085, 2200, 430, 0.2);
        break;
      case "mine": case "springMine":
        this.noise(voice, 0, 0.065, 2000, 630, 0.16);
        this.tone(voice, 0.055, 0.12, weapon === "mine" ? 380 : 650, 270, 0.1, "triangle");
        break;
      case "shotgun":
        this.noise(voice, 0, 0.2, 4400, 350, 0.45, 0.5);
        this.tone(voice, 0, 0.14, 165, 45, 0.25);
        this.noise(voice, 0.17, 0.05, 1900, 900, 0.1, 2);
        break;
      case "sniper":
        this.noise(voice, 0, 0.12, 5100, 700, 0.4, 0.5);
        this.tone(voice, 0, 0.22, 1250, 190, 0.1, "triangle");
        break;
      case "airstrike":
        this.chime(voice, [660, 880, 660], 0.075, 0.07, 0.13);
        this.noise(voice, 0.12, 0.5, 600, 1700, 0.22);
        break;
      case "meteor":
        this.tone(voice, 0, 0.65, 480, 65, 0.16, "triangle");
        this.noise(voice, 0, 0.65, 2400, 400, 0.28);
        break;
      case "anvil":
        this.chime(voice, [740, 1087], 0.018, 0.25, 0.11);
        this.tone(voice, 0, 0.4, 900, 160, 0.095);
        break;
      case "firework":
        this.tone(voice, 0, 0.45, 600, 1750, 0.11);
        this.noise(voice, 0, 0.4, 1500, 3200, 0.2);
        break;
      case "vacuum":
        this.tone(voice, 0, 0.45, 100, 430, 0.14, "triangle");
        this.tone(voice, 0.04, 0.4, 107, 480, 0.1);
        this.noise(voice, 0, 0.35, 1800, 400, 0.15);
        break;
      case "disco":
        this.chime(voice, [392, 494, 587, 784], 0.06, 0.16, 0.13);
        break;
      case "bouncer": case "banana":
        this.boing(voice, 0, 0.3, weapon === "banana" ? 300 : 200, 700, 0.2);
        this.noise(voice, 0, 0.09, 600, 1800, 0.13);
        break;
      case "boomerang":
        this.noise(voice, 0, 0.32, 450, 2700, 0.2, 1.5);
        this.tone(voice, 0, 0.28, 290, 790, 0.08, "triangle");
        break;
      case "sticky":
        this.tone(voice, 0, 0.17, 660, 90, 0.18);
        this.noise(voice, 0, 0.15, 1600, 420, 0.15);
        break;
      case "grenade": case "megaBomb": case "cluster":
        this.noise(voice, 0, 0.19, 400, 1900, 0.18);
        this.tone(voice, 0, 0.14, weapon === "megaBomb" ? 130 : 270, 75, 0.16, "triangle");
        if (weapon === "cluster") this.chime(voice, [780, 1050], 0.045, 0.08, 0.06);
        break;
      case "rocket": case "mortar":
        this.tone(voice, 0, 0.23, weapon === "mortar" ? 155 : 230, 45, 0.24);
        this.noise(voice, 0, weapon === "rocket" ? 0.4 : 0.24, 800, 2800, 0.28, 0.6);
        this.noise(voice, 0, 0.09, 2600, 700, 0.18);
        break;
    }
  }

  private updateMotion(): void {
    const context = this.context;
    if (!context || !this.canPlay()) return;
    for (const kind of ["wind", "swing", "charge"] as const) {
      const amount = this.motion[kind];
      let loop = this.loops.get(kind);
      if (amount <= 0.015) {
        if (loop && !loop.stopping) {
          loop.stopping = true;
          loop.voice.gain.gain.setTargetAtTime(QUIET, context.currentTime, 0.035);
          for (const source of loop.voice.sources) source.stop(context.currentTime + 0.18);
          this.loops.delete(kind);
        }
        continue;
      }
      if (!loop) {
        loop = this.createLoop(kind);
        if (!loop) continue;
        this.loops.set(kind, loop);
      }
      const now = context.currentTime;
      loop.voice.gain.gain.setTargetAtTime(amount * (kind === "wind" ? 0.2 : kind === "swing" ? 0.11 : 0.055), now, 0.065);
      loop.voice.panner.pan.setTargetAtTime(this.motion.pan, now, 0.09);
      if (loop.filter) loop.filter.frequency.setTargetAtTime(kind === "wind" ? 380 + amount * 1900 : 650 + amount * 1550, now, 0.09);
      if (loop.oscillator) loop.oscillator.frequency.setTargetAtTime(kind === "charge" ? 150 + amount * 460 : 85 + amount * 135, now, 0.06);
      if (loop.harmonic) loop.harmonic.frequency.setTargetAtTime(302 + amount * 920, now, 0.065);
    }
  }

  private createLoop(kind: "wind" | "swing" | "charge"): MotionLoop | undefined {
    const context = this.context!;
    const voice = this.createVoice(QUIET, this.motion.pan);
    if (!voice) return;
    const loop: MotionLoop = { voice, stopping: false };
    if (kind === "wind" || kind === "swing") {
      const source = context.createBufferSource();
      const filter = context.createBiquadFilter();
      source.buffer = this.noiseBuffer;
      source.loop = true;
      filter.type = "bandpass";
      filter.Q.value = kind === "wind" ? 0.55 : 1.8;
      filter.frequency.value = 600;
      source.connect(filter);
      filter.connect(voice.gain);
      voice.nodes.push(filter);
      this.connectSource(voice, source);
      source.start(context.currentTime, Math.random());
      loop.filter = filter;
    }
    if (kind === "charge" || kind === "swing") {
      const oscillator = context.createOscillator();
      oscillator.type = "sine";
      oscillator.frequency.value = kind === "charge" ? 150 : 85;
      const level = context.createGain();
      level.gain.value = kind === "charge" ? 0.7 : 0.2;
      oscillator.connect(level);
      level.connect(voice.gain);
      voice.nodes.push(level);
      this.connectSource(voice, oscillator);
      oscillator.start();
      loop.oscillator = oscillator;
      if (kind === "charge") {
        const harmonic = context.createOscillator();
        const harmonicGain = context.createGain();
        harmonic.frequency.value = 302;
        harmonicGain.gain.value = 0.2;
        harmonic.connect(harmonicGain);
        harmonicGain.connect(voice.gain);
        voice.nodes.push(harmonicGain);
        this.connectSource(voice, harmonic);
        harmonic.start();
        loop.harmonic = harmonic;
      }
    }
    return loop;
  }
}
