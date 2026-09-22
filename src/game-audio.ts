import type { GameState, Point } from "../shared/types";
import type { GameAudio, SoundOptions } from "./audio";

type SoundSink = Pick<GameAudio, "play" | "setMotion" | "reset">;
type MotionOptions = { audible: boolean; charge: number; listener: Point };
type BodySound = { x: number; y: number; stride: number; ropeLength: number | null; reel: number; panicked: boolean; lastPanic: number };
const clamp = (value: number, min = 0, max = 1) => Math.max(min, Math.min(max, value));

/** Discrete cues come from authoritative events; continuous foley follows the displayed pose. */
export class GameSoundDirector {
  private lastEvent = 0;
  private clock = 0;
  private bodies = new Map<string, BodySound>();
  private lastSecond: number | null = null;
  private turn = 0;

  constructor(private readonly audio: SoundSink) {}

  reset(state: GameState): void {
    this.lastEvent = state.soundSequence ?? 0;
    this.bodies.clear();
    this.lastSecond = null;
    this.turn = state.turn;
    this.audio.reset();
  }

  observe(state: GameState, listener: Point, audible = true): void {
    for (const event of state.soundEvents ?? []) {
      if (event.id <= this.lastEvent) continue;
      this.lastEvent = event.id;
      if (!audible) continue;
      const centered = event.kind === "switch" || event.kind === "victory" || event.kind === "select";
      const spatial = centered ? { volume: 0.85, pan: 0 } : this.spatial(event, listener);
      // An instant practice respawn may already have moved the listener away from the splash.
      if (event.playerId === state.activePlayerId) spatial.volume = Math.max(0.65, spatial.volume!);
      this.audio.play(event.kind, {
        ...spatial,
        intensity: event.intensity,
        weapon: event.weapon,
        pitch: 0.96 + (event.id % 7) * 0.014,
      });
    }
    this.lastEvent = Math.max(this.lastEvent, state.soundSequence ?? 0);
  }

  update(state: GameState, dtSeconds: number, options: MotionOptions): void {
    const dt = clamp(Number.isFinite(dtSeconds) ? dtSeconds : 0, 0, 0.1);
    this.clock += dt;
    let wind = 0, swing = 0, pan = 0, loudest = 0;
    const alive = new Set<string>();
    for (const player of state.players) {
      if (!player.alive) continue;
      alive.add(player.id);
      const before = this.bodies.get(player.id);
      const body: BodySound = before ?? {
        x: player.x, y: player.y, stride: 0,
        ropeLength: player.rope?.length ?? null, reel: 0,
        panicked: false, lastPanic: -Infinity,
      };
      const distance = Math.hypot(player.x - body.x, player.y - body.y);
      const teleported = distance > 160;
      const spatial = this.spatial(player, options.listener);
      const speed = Math.hypot(player.vx, player.vy);
      if (options.audible && !teleported && player.grounded && player.tumble <= 0 && Math.abs(player.vx) > 35) {
        body.stride += Math.abs(player.x - body.x);
        if (body.stride >= 46) {
          this.audio.play("step", { ...spatial, volume: spatial.volume! * 0.65, pitch: 0.92 + (Math.floor(player.x / 46) % 3) * 0.07 });
          body.stride %= 46;
        }
      } else body.stride = 0;

      if (options.audible && player.rope && body.ropeLength !== null &&
        Math.abs(player.rope.length - body.ropeLength) > 0.4 && !teleported) {
        body.reel += dt;
        if (body.reel >= 0.13) {
          this.audio.play("reel", { ...spatial, volume: spatial.volume! * 0.5,
            pitch: player.rope.length < body.ropeLength ? 1.1 : 0.85 });
          body.reel %= 0.13;
        }
      } else body.reel = 0;

      const danger = !player.grounded && ((speed > 800 && player.tumble > 0.4) ||
        (player.vy > 650 && player.y > state.waterY - 270));
      if (player.grounded || speed < 450 || teleported) body.panicked = false;
      if (danger && !body.panicked && !teleported) {
        body.panicked = true;
        if (options.audible && this.clock - body.lastPanic > 4) {
          this.audio.play("panic", { ...spatial, pitch: 0.94 + (player.number % 3) * 0.065 });
          body.lastPanic = this.clock;
        }
      }

      if (options.audible && !player.grounded && !teleported) {
        const air = clamp((speed - 400) / 1200) * spatial.volume!;
        const rope = player.rope ? clamp((speed - 80) / 900) * spatial.volume! : 0;
        wind = Math.max(wind, air);
        swing = Math.max(swing, rope);
        if (air + rope > loudest) { loudest = air + rope; pan = spatial.pan!; }
      }
      Object.assign(body, { x: player.x, y: player.y, ropeLength: player.rope?.length ?? null });
      this.bodies.set(player.id, body);
    }
    for (const id of this.bodies.keys()) if (!alive.has(id)) this.bodies.delete(id);

    const second = Math.ceil(state.timeLeft);
    if (options.audible && state.mode !== "practice" && this.turn === state.turn &&
      (state.phase === "playing" || state.phase === "retreat") && second > 0 && second <= 5 &&
      this.lastSecond !== null && second < this.lastSecond) this.audio.play("tick", { volume: 0.65 });
    this.turn = state.turn;
    this.lastSecond = second;
    this.audio.setMotion({ wind, swing, pan, charge: options.audible ? clamp(options.charge) : 0 });
  }

  private spatial(point: Point, listener: Point): SoundOptions {
    const distance = Math.hypot(point.x - listener.x, point.y - listener.y);
    return { volume: clamp(1 / (1 + (distance / 900) ** 2), 0.06, 1), pan: clamp((point.x - listener.x) / 1000, -0.85, 0.85) };
  }
}
