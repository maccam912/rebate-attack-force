import { EXPLOSION_SECONDS, GameEngine } from "../shared/game";
import {
  INTERPOLATION_DELAY,
  MAX_PENDING_FRAMES,
  NETWORK_STEP,
  stateWithoutNetwork,
  type InputFrame,
  type ServerState,
} from "../shared/protocol";
import type { GameCommand, GameState, Player, PlayerInput, Point, TurnResolution } from "../shared/types";

const neutral = (point: Point = { x: 0, y: 0 }): PlayerInput => ({
  left: false, right: false, up: false, down: false, aimX: point.x, aimY: point.y,
});
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const angleDifference = (a: number, b: number) => Math.atan2(Math.sin(b - a), Math.cos(b - a));
const lerpAngle = (a: number, b: number, t: number) => a + angleDifference(a, b) * t;
type TimedState = { at: number; receivedAt: number; state: GameState };
type Correction = { x: number; y: number; rotation: number };

function interpolateResolution(a: TurnResolution | null | undefined,
  b: TurnResolution | null | undefined, t: number): TurnResolution | null | undefined {
  if (!a || !b) return a;
  const sameReveal = a.reveal && b.reveal && a.reveal.playerId === b.reveal.playerId &&
    a.reveal.applied === b.reveal.applied;
  return {
    ...a,
    // A new hit is discrete; do not show its shake or slow motion before its blast.
    slowMotionRemaining: b.slowMotionRemaining <= a.slowMotionRemaining
      ? lerp(a.slowMotionRemaining, b.slowMotionRemaining, t) : a.slowMotionRemaining,
    impact: b.impact <= a.impact ? lerp(a.impact, b.impact, t) : a.impact,
    focus: a.focus && b.focus && (!a.reveal || sameReveal) ? {
      x: lerp(a.focus.x, b.focus.x, t), y: lerp(a.focus.y, b.focus.y, t),
    } : a.focus,
    // Keep the HP debit, deaths and the next recipient on their snapshot boundary.
    reveal: sameReveal ? { ...a.reveal!, elapsed: lerp(a.reveal!.elapsed, b.reveal!.elapsed, t) } : a.reveal,
  };
}

function interpolatePlayer(a: Player, b: Player, t: number): Player {
  if (a.alive !== b.alive || Math.hypot(a.x - b.x, a.y - b.y) > 500) return a;
  const result: Player = {
    ...a,
    x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t),
    vx: lerp(a.vx, b.vx, t), vy: lerp(a.vy, b.vy, t),
    rotation: lerpAngle(a.rotation, b.rotation, t),
    angularVelocity: lerp(a.angularVelocity, b.angularVelocity, t),
    impact: lerp(a.impact, b.impact, t),
    tumble: lerp(a.tumble, b.tumble, t),
    lookAt: { x: lerp(a.lookAt.x, b.lookAt.x, t), y: lerp(a.lookAt.y, b.lookAt.y, t) },
  };
  if (a.rope && b.rope && a.rope.x === b.rope.x && a.rope.y === b.rope.y &&
    a.rope.bends.length === b.rope.bends.length) {
    const nextRope = b.rope;
    result.rope = {
      ...a.rope, length: lerp(a.rope.length, nextRope.length, t),
      bends: a.rope.bends.map((point, i) => ({
        x: lerp(point.x, nextRope.bends[i].x, t),
        y: lerp(point.y, nextRope.bends[i].y, t),
      })),
    };
  }
  return result;
}

/** Interpolate recorded physics, including shots and rope poses, without simulating a watcher. */
export function interpolateStates(a: GameState, b: GameState, amount: number): GameState {
  if (a.turn !== b.turn || a.activePlayerId !== b.activePlayerId) return b;
  const t = Math.max(0, Math.min(1, amount));
  if (t >= 1) return b;
  const players = new Map(b.players.map((player) => [player.id, player]));
  const projectiles = new Map(b.projectiles.map((projectile) => [projectile.id, projectile]));
  const explosions = new Map(b.explosions.map((explosion) => [explosion.id, explosion]));
  const mines = new Map((b.mines ?? []).map((mine) => [mine.id, mine]));
  return {
    ...a,
    timeLeft: lerp(a.timeLeft, b.timeLeft, t),
    resolution: interpolateResolution(a.resolution, b.resolution, t),
    players: a.players.map((player) => {
      const next = players.get(player.id);
      return next ? interpolatePlayer(player, next, t) : player;
    }),
    projectiles: a.projectiles.map((projectile) => {
      const next = projectiles.get(projectile.id);
      return next ? {
        ...projectile,
        x: lerp(projectile.x, next.x, t), y: lerp(projectile.y, next.y, t),
        vx: lerp(projectile.vx, next.vx, t), vy: lerp(projectile.vy, next.vy, t),
        life: lerp(projectile.life, next.life, t),
        age: lerp(projectile.age ?? 0, next.age ?? 0, t),
      } : projectile;
    }),
    mines: (a.mines ?? []).map((mine) => {
      const next = mines.get(mine.id);
      return next ? {
        ...mine, x: lerp(mine.x, next.x, t), y: lerp(mine.y, next.y, t),
        vx: lerp(mine.vx, next.vx, t), vy: lerp(mine.vy, next.vy, t),
        fuse: mine.fuse !== null && next.fuse !== null ? lerp(mine.fuse, next.fuse, t) : mine.fuse,
      } : mine;
    }),
    explosions: a.explosions.map((explosion) => {
      const next = explosions.get(explosion.id);
      return next ? { ...explosion, age: lerp(explosion.age, next.age, t) } : explosion;
    }),
  };
}

/**
 * The active client replays unacknowledged input through the actual shared engine.
 * Everyone else renders a small snapshot buffer. Corrections only offset drawing;
 * collision, HP, inventory, random choices and turns always use the restored server state.
 */
export class ClientPrediction {
  private latest: ServerState | null = null;
  private sessionId = "";
  private context = "";
  private engine: GameEngine | null = null;
  private pending: InputFrame[] = [];
  private queuedCommands: GameCommand[] = [];
  private heldInput = neutral();
  private sequence = 0;
  private accumulator = 0;
  private corrections = new Map<string, Correction>();
  private shown: GameState | null = null;
  private snapshots: TimedState[] = [];
  private playbackAt = 0;
  private fallbackTime = 0;

  constructor(private readonly send: (frame: InputFrame) => void) {}

  get canControl(): boolean {
    return !!this.latest && this.latest.activeTeamId === this.sessionId &&
      (this.latest.phase === "playing" || this.latest.phase === "retreat") &&
      (!this.engine || (this.engine.state.turn === this.latest.turn &&
        this.engine.state.activePlayerId === this.latest.activePlayerId &&
        (this.engine.state.phase === "playing" || this.engine.state.phase === "retreat")));
  }

  get pendingCount(): number { return this.pending.length; }
  get isPredicting(): boolean { return this.engine !== null; }

  input(input: PlayerInput): void { this.heldInput = { ...input }; }

  command(command: GameCommand): void {
    if (this.canControl && this.queuedCommands.length < 6)
      this.queuedCommands.push({ ...command });
  }

  reset(): void {
    this.latest = null;
    this.context = "";
    this.engine = null;
    this.pending = [];
    this.queuedCommands = [];
    this.heldInput = neutral();
    this.accumulator = 0;
    this.corrections.clear();
    this.snapshots = [];
    this.shown = null;
    this.sequence = 0;
    this.playbackAt = this.fallbackTime = 0;
  }

  receive(snapshot: ServerState, sessionId: string, nowMs = performance.now()): void {
    const net = snapshot.net;
    const context = `${net?.epoch ?? "legacy"}:${snapshot.turn}:${snapshot.activePlayerId}`;
    if (this.latest?.net && net && this.latest.net.epoch === net.epoch &&
      net.tick < this.latest.net.tick) return;
    const changed = context !== this.context || sessionId !== this.sessionId;
    const previous = this.shown;
    this.sessionId = sessionId;
    this.context = context;
    this.latest = snapshot;
    const state = stateWithoutNetwork(snapshot);
    const now = nowMs / 1000;
    const at = net ? net.simulation.elapsed : (this.fallbackTime += 0.05);
    if (changed) {
      this.pending = [];
      this.queuedCommands = [];
      this.heldInput = neutral(state.players.find((player) => player.id === state.activePlayerId)?.lookAt);
      this.accumulator = 0;
      this.corrections.clear();
      this.snapshots = [];
      this.playbackAt = at - INTERPOLATION_DELAY;
    }
    this.sequence = Math.max(changed ? 0 : this.sequence, net?.ack ?? 0);
    this.snapshots.push({ at, receivedAt: now, state });
    if (this.snapshots.length > 32) this.snapshots.shift();

    if (net && state.activeTeamId === sessionId && state.phase !== "finished" && state.phase !== "waiting") {
      this.engine ??= new GameEngine();
      this.engine.restore({ state, simulation: net.simulation });
      this.pending = this.pending.filter((frame) => frame.seq > net.ack);
      for (const frame of this.pending) this.simulate(frame);
      if (!changed && previous) {
        this.corrections.clear();
        for (const player of this.fractionalState().players) {
          const shown = previous.players.find((candidate) => candidate.id === player.id);
          if (!shown || shown.alive !== player.alive) continue;
          const x = shown.x - player.x, y = shown.y - player.y;
          if (Math.hypot(x, y) < 180)
            this.corrections.set(player.id, { x, y, rotation: angleDifference(player.rotation, shown.rotation) });
        }
      }
      this.shown = this.correctedState(0);
    } else {
      this.engine = null;
      this.pending = [];
      this.queuedCommands = [];
      this.corrections.clear();
      if (changed || !this.shown) this.shown = state;
    }
  }

  advance(dtSeconds: number, nowMs = performance.now()): GameState | null {
    const dt = Number.isFinite(dtSeconds) ? Math.max(0, Math.min(0.1, dtSeconds)) : 0;
    if (!this.latest) return this.shown;
    if (this.engine && this.latest.net) {
      this.accumulator = Math.min(this.accumulator + dt, 0.1);
      while (this.accumulator + 1e-9 >= NETWORK_STEP) {
        this.accumulator -= NETWORK_STEP;
        // Bound both replay work and input backlog during a long stalled connection.
        if (this.pending.length >= MAX_PENDING_FRAMES) continue;
        const frame: InputFrame = {
          seq: ++this.sequence,
          epoch: this.latest.net.epoch,
          turn: this.latest.turn,
          playerId: this.latest.activePlayerId,
          input: { ...this.heldInput },
          commands: this.queuedCommands.splice(0),
        };
        this.pending.push(frame);
        this.simulate(frame);
        this.send(frame);
      }
      this.shown = this.correctedState(dt);
    } else if (this.snapshots.length) {
      const latest = this.snapshots.at(-1)!;
      const desired = latest.at + Math.max(0, nowMs / 1000 - latest.receivedAt) - INTERPOLATION_DELAY;
      // Gently discipline the playback clock; packet jitter never sends it backwards.
      const rate = Math.max(0.9, Math.min(1.1, 1 + (desired - this.playbackAt) * 2));
      this.playbackAt = Math.min(latest.at, this.playbackAt + dt * rate);
      while (this.snapshots.length > 2 && this.snapshots[1].at <= this.playbackAt)
        this.snapshots.shift();
      const a = this.snapshots[0];
      const b = this.snapshots[1] ?? a;
      const fraction = b.at > a.at ? (this.playbackAt - a.at) / (b.at - a.at) : 1;
      this.shown = interpolateStates(a.state, b.state, fraction);
    }
    return this.shown;
  }

  private simulate(frame: InputFrame): void {
    if (!this.engine) return;
    // A predicted turn change grants no authority to steer a subsequent frog.
    if (this.engine.state.turn === frame.turn && this.engine.state.activePlayerId === frame.playerId) {
      this.engine.setInput(frame.playerId, frame.input);
      for (const command of frame.commands) this.engine.command(frame.playerId, command);
    }
    this.engine.step(NETWORK_STEP);
  }

  private correctedState(dt: number): GameState {
    const state = this.fractionalState();
    const decay = Math.exp(-18 * dt);
    return {
      ...state,
      players: state.players.map((player) => {
        const correction = this.corrections.get(player.id);
        if (!correction) return { ...player };
        correction.x *= decay;
        correction.y *= decay;
        correction.rotation *= decay;
        return {
          ...player,
          x: player.x + correction.x,
          y: player.y + correction.y,
          rotation: player.rotation + correction.rotation,
        };
      }),
    };
  }

  private fractionalState(): GameState {
    const state = this.engine!.state;
    // Input/replay remains fixed at 60 Hz. Draw the remaining fraction of that
    // interval as well, so 120/144 Hz and uneven animation frames do not alternate
    // between a held pose and a full network-step jump. This short visual lead
    // never simulates a collision, consumes ammo, or changes the authoritative pose.
    const dt = this.pending.length < MAX_PENDING_FRAMES ? Math.max(0, this.accumulator) : 0;
    if (dt < 1e-9 || state.phase === "damage" || state.phase === "finished" || state.phase === "waiting")
      return state;
    const slow = Math.min(dt, state.resolution?.slowMotionRemaining ?? 0);
    const physicalDt = dt - slow * 0.72;
    const drowned = new Set(state.resolution?.drownedPlayerIds ?? []);
    return {
      ...state,
      players: state.players.map((player) => !player.alive || drowned.has(player.id) ? player : ({
        ...player,
        x: player.x + player.vx * physicalDt,
        y: player.y + player.vy * physicalDt,
        rotation: player.rotation + player.angularVelocity * physicalDt,
      })),
      projectiles: state.projectiles.map((projectile) => ({
        ...projectile,
        x: projectile.x + projectile.vx * physicalDt,
        y: projectile.y + projectile.vy * physicalDt,
        age: (projectile.age ?? 0) + physicalDt,
      })),
      mines: (state.mines ?? []).map((mine) => ({
        ...mine, x: mine.x + mine.vx * physicalDt, y: mine.y + mine.vy * physicalDt,
      })),
      // The visual lead can cross expiry before the next fixed physics step.
      explosions: state.explosions
        .map((explosion) => ({ ...explosion, age: explosion.age + physicalDt }))
        .filter((explosion) => explosion.age < EXPLOSION_SECONDS),
    };
  }
}
