import type {
  GameCommand,
  GameOptions,
  GameSoundEvent,
  GameSoundKind,
  GameState,
  Platform,
  Player,
  PlayerInput,
  Point,
  Projectile,
  WeaponId,
} from "./types.js";

import { ropeFixedLength, ropePathLength, updateRopePath } from "./rope.js";
import { teamSettings } from "./settings.js";
import { createInventory, WEAPON_CATALOG, WEAPON_IDS, type WeaponDefinition } from "./weapons.js";
import type { GameSnapshot } from "./protocol.js";
import { applyImpulse, GRAVITY, WALK_SPEED, HARD_IMPACT_SPEED, limitBodySpeed, surfaceImpact, updateBodyAttitude } from "./physics.js";

export type * from "./types.js";

export const WIDTH = 4320;
export const HEIGHT = 1800;
export const WATER_Y = 1730;
export const PLAYER_RADIUS = 18;
export const FIXED_STEP = 1 / 120;
export const GRAPPLE_RANGE = 680;
export const TURN_SECONDS = 45;
export const RETREAT_SECONDS = 5;
export const DAMAGE_REVEAL_SECONDS = 1.6;
export const DAMAGE_APPLY_SECONDS = 0.55;
const SETTLED_HOLD_SECONDS = 0.35;
export const DOUBLE_JUMP_SECONDS = 0.32;
export const MAX_SOUND_EVENTS = 128;

// A normal jump can land on a frog; a longer fall becomes a stomp.
const STOMP_SPEED = 560;
const COLORS = ["#9fe870", "#ffb86b", "#b9a2ff", "#71dce4"];

const clamp = (value: number, low: number, high: number) =>
  Math.max(low, Math.min(high, value));
const finite = (value: unknown, fallback: number) =>
  typeof value === "number" && Number.isFinite(value) ? value : fallback;
const blankInput = (
  lookAt: Point = { x: WIDTH / 2, y: HEIGHT / 2 },
): PlayerInput => ({
  left: false,
  right: false,
  up: false,
  down: false,
  aimX: lookAt.x,
  aimY: lookAt.y,
});

export const SPAWNS = [
  { x: 220, y: 1600 - PLAYER_RADIUS },
  { x: 4000, y: 1600 - PLAYER_RADIUS },
  { x: 1300, y: 1480 - PLAYER_RADIUS },
  { x: 2990, y: 1460 - PLAYER_RADIUS },
];

function frogSpawn(teamIndex: number, frogIndex: number): Point {
  const spawn = SPAWNS[teamIndex]!;
  const direction = teamIndex === 1 || teamIndex === 3 ? -1 : 1;
  // The quarry's shorter starting ledge needs tighter spacing for six frogs.
  return { x: spawn.x + direction * frogIndex * (teamIndex === 3 ? 42 : 64), y: spawn.y };
}

export function makePlatforms(): Platform[] {
  return [
    { id: "west-island", x: 60, y: 1600, w: 720, h: 200 },
    { id: "east-island", x: 3540, y: 1600, w: 720, h: 200 },
    { id: "foundry", x: 1060, y: 1480, w: 680, h: 320 },
    { id: "stepping-stone", x: 2050, y: 1600, w: 480, h: 200 },
    { id: "quarry", x: 2750, y: 1460, w: 480, h: 340 },
    { id: "west-shelf", x: 300, y: 1400, w: 280, h: 34 },
    { id: "west-bar", x: 100, y: 1130, w: 300, h: 28 },
    { id: "west-bridge", x: 650, y: 1170, w: 260, h: 34 },
    { id: "west-canopy", x: 480, y: 900, w: 280, h: 34 },
    { id: "west-tower", x: 60, y: 660, w: 320, h: 28 },
    { id: "west-summit", x: 540, y: 390, w: 320, h: 34 },
    { id: "foundry-shelf", x: 1130, y: 1210, w: 280, h: 36 },
    { id: "foundry-bar", x: 990, y: 930, w: 240, h: 34 },
    { id: "lookout", x: 1440, y: 720, w: 260, h: 32 },
    { id: "high-bridge", x: 1060, y: 450, w: 280, h: 32 },
    { id: "summit", x: 1550, y: 210, w: 380, h: 36 },
    { id: "central-shelf", x: 1740, y: 1080, w: 260, h: 38 },
    { id: "central-step", x: 2170, y: 1330, w: 300, h: 34 },
    { id: "central-canopy", x: 2140, y: 800, w: 280, h: 36 },
    { id: "central-tower", x: 1970, y: 480, w: 300, h: 34 },
    { id: "east-summit", x: 2460, y: 280, w: 300, h: 32 },
    { id: "quarry-bar", x: 2700, y: 650, w: 300, h: 34 },
    { id: "quarry-step", x: 2590, y: 1080, w: 260, h: 34 },
    { id: "quarry-shelf", x: 3040, y: 1220, w: 280, h: 34 },
    { id: "east-bridge", x: 3240, y: 930, w: 300, h: 34 },
    { id: "east-tower", x: 3190, y: 440, w: 280, h: 34 },
    { id: "east-canopy", x: 3760, y: 680, w: 300, h: 34 },
    { id: "east-bar", x: 3830, y: 1130, w: 300, h: 28 },
    { id: "east-shelf", x: 3690, y: 1400, w: 280, h: 34 },
  ];
}

/** An authoritative, JSON-only simulation shared by the browser and room server. */
export class GameEngine {
  state: GameState;
  private inputs = new Map<string, PlayerInput>();
  private accumulator = 0;
  private serial = 0;
  private randomSeed: number;
  private settlingTime = 0;
  private elapsed = 0;
  private jump: { id: string; at: number; facing: -1 | 1 } | null = null;
  private lastFrog = new Map<string, string>();

  constructor(options: GameOptions = {}) {
    this.randomSeed = finite(options.seed, 7351) >>> 0 || 1;
    const definitions = options.players?.length
      ? options.players.slice(0, 4)
      : [
          { id: "p1", name: "Moss", color: COLORS[0] },
          { id: "p2", name: "Tangerine", color: COLORS[1] },
        ];
    // A practice target remains available even when a room supplies a single player.
    if (definitions.length === 1)
      definitions.push({
        id: "practice-target",
        name: "Target",
        color: COLORS[1],
      });
    const teams = definitions.map((definition, index) => ({
      id: definition.id,
      name: definition.name,
      color: definition.color ?? COLORS[index]!,
      connected: definition.connected !== false,
      ...teamSettings({ frogs: definition.frogs ?? 1, hp: definition.hp ?? 100 }),
    }));
    const players: Player[] = teams.flatMap((team, index) =>
      Array.from({ length: team.frogs }, (_, frog): Player => {
        const spawn = frogSpawn(index, frog);
        return {
          id: frog === 0 ? team.id : `${team.id}:frog-${frog + 1}`,
          teamId: team.id,
          number: frog + 1,
          name: team.frogs === 1 ? team.name : `${team.name} ${frog + 1}`,
          color: team.color,
          ...spawn,
          vx: 0,
          vy: 0,
          hp: team.hp,
          maxHp: team.hp,
          facing: spawn.x < WIDTH / 2 ? 1 : -1,
          alive: true,
          grounded: true,
          lookAt: { x: spawn.x + 200, y: spawn.y - 220 },
          rope: null,
          rotation: 0,
          angularVelocity: 0,
          impact: 0,
          tumble: 0,
          inventory: createInventory(options.mode),
          weapon: "rocket",
          hasCrate: true,
        };
      }));
    const firstTeam = teams.find((team) => team.connected) ?? teams[0]!;
    const firstFrog = players.find((player) => player.teamId === firstTeam.id)!;
    this.state = {
      width: WIDTH,
      height: HEIGHT,
      waterY: WATER_Y,
      platforms: makePlatforms(),
      players,
      teams,
      crates: [],
      projectiles: [],
      mines: [],
      explosions: [],
      soundEvents: [],
      soundSequence: 0,
      resolution: null,
      activePlayerId: firstFrog.id,
      activeTeamId: firstTeam.id,
      phase: "playing",
      turn: 1,
      timeLeft: options.mode === "practice" ? 90 : TURN_SECONDS,
      mode: options.mode ?? "versus",
      winnerId: null,
      message: "Choose from your arsenal. Make your shot. Get out of the way.",
    };
    players.forEach((player) => this.inputs.set(player.id, blankInput(player.lookAt)));
    if (firstTeam.connected) this.lastFrog.set(firstTeam.id, firstFrog.id);
    this.spawnCrates();
    if (!firstTeam.connected) this.beginSettling();
  }

  /** Checkpoints preserve hidden timers and PRNG state for exact prediction replay. */
  capture(): GameSnapshot {
    return structuredClone({
      state: this.state,
      simulation: {
        inputs: [...this.inputs],
        accumulator: this.accumulator,
        serial: this.serial,
        randomSeed: this.randomSeed,
        settlingTime: this.settlingTime,
        elapsed: this.elapsed,
        jump: this.jump,
        lastFrog: [...this.lastFrog],
      },
    });
  }

  restore(snapshot: GameSnapshot): void {
    const { state, simulation } = structuredClone(snapshot);
    this.state = state;
    this.inputs = new Map(simulation.inputs);
    this.accumulator = simulation.accumulator;
    this.serial = simulation.serial;
    this.randomSeed = simulation.randomSeed;
    this.settlingTime = simulation.settlingTime;
    this.elapsed = simulation.elapsed;
    this.jump = simulation.jump;
    this.lastFrog = new Map(simulation.lastFrog);
  }

  setInput(id: string, input: PlayerInput): void {
    const player = this.state.players.find((candidate) => candidate.id === id);
    if (
      !player?.alive ||
      id !== this.state.activePlayerId ||
      !this.canMove() ||
      !input ||
      typeof input !== "object"
    )
      return;
    const prior = this.inputs.get(id) ?? blankInput(player.lookAt);
    const next = {
      left: input.left === true,
      right: input.right === true,
      up: input.up === true,
      down: input.down === true,
      aimX: clamp(finite(input.aimX, prior.aimX), -WIDTH, WIDTH * 2),
      aimY: clamp(finite(input.aimY, prior.aimY), -HEIGHT, HEIGHT * 2),
    };
    this.inputs.set(id, next);
    player.lookAt = { x: next.aimX, y: next.aimY };
  }

  /** Explicit departures forfeit the team; accidental drops use setTeamConnected. */
  removePlayer(id: string): void {
    if (this.state.phase === "finished") return;
    for (const player of this.state.players.filter((p) => p.teamId === id)) {
      if (player.alive) this.kill(player);
      this.inputs.delete(player.id);
    }
    const team = this.state.teams.find((team) => team.id === id);
    if (team) team.connected = false;
    if (id === this.state.activeTeamId) this.beginSettling();
    this.tick(FIXED_STEP);
  }

  setTeamConnected(id: string, connected: boolean): void {
    const team = this.state.teams.find((team) => team.id === id);
    if (!team || team.connected === connected) return;
    team.connected = connected;
    if (!connected) {
      for (const player of this.state.players.filter((p) => p.teamId === id)) {
        this.inputs.delete(player.id);
        player.rope = null;
      }
      if (id === this.state.activeTeamId && this.canMovePhase()) this.beginSettling();
    }
  }

  command(id: string, command: GameCommand): boolean {
    const player = this.state.players.find((candidate) => candidate.id === id);
    if (
      !player?.alive ||
      id !== this.state.activePlayerId ||
      !this.canMove() ||
      !command
    )
      return false;
    const input = this.inputs.get(id) ?? blankInput();
    switch (command.type) {
      case "jump":
        if (!player.grounded) return false;
        if (input.left !== input.right) player.facing = input.right ? 1 : -1;
        this.jump = { id, at: this.elapsed, facing: player.facing };
        player.vy = -525;
        player.angularVelocity += player.facing * -1.8;
        player.grounded = false;
        this.playerSound("jump", player);
        return true;
      case "backflip":
        if (!this.jump || this.jump.id !== id || player.grounded ||
          this.elapsed - this.jump.at > DOUBLE_JUMP_SECONDS) return false;
        player.vy = -760;
        player.vx = -this.jump.facing * 310;
        player.angularVelocity = -this.jump.facing * 13;
        player.tumble = 0.7;
        player.rope = null;
        this.jump = null;
        this.playerSound("backflip", player);
        return true;
      case "grapple": {
        const direction = this.aim(player, input);
        if (!direction) return false;
        const hit = this.raycast(
          player.x,
          player.y,
          direction.x,
          direction.y,
          GRAPPLE_RANGE,
        );
        if (!hit || hit.distance < 24) return false;
        player.rope = {
          x: hit.x,
          y: hit.y,
          length: Math.max(40, hit.distance),
          bends: [],
        };
        this.playerSound("grapple", player);
        return true;
      }
      case "release": {
        const wasAttached = player.rope !== null;
        player.rope = null;
        if (wasAttached) this.playerSound("release", player);
        return wasAttached;
      }
      case "fire":
        if (
          this.state.phase !== "playing" ||
          !player.hasCrate ||
          !player.weapon ||
          player.inventory[player.weapon] <= 0
        ) {
          if (this.state.phase === "playing")
            this.state.message =
              "Your pack is empty. Collect a supply crate first.";
          return false;
        }
        return this.fire(player, input, command.power);
      case "selectWeapon":
        if (
          this.state.phase !== "playing" ||
          !command.weapon ||
          !WEAPON_IDS.includes(command.weapon) ||
          player.inventory[command.weapon] <= 0
        )
          return false;
        if (player.weapon !== command.weapon)
          this.playerSound("select", player, { weapon: command.weapon });
        player.weapon = command.weapon;
        return true;
      case "endTurn":
        this.beginSettling();
        return true;
      default:
        return false;
    }
  }

  /** Consume real elapsed seconds with fixed physics steps; long pauses never fast-forward turns. */
  step(dtSeconds: number): void {
    if (!Number.isFinite(dtSeconds) || dtSeconds <= 0) return;
    this.accumulator += Math.min(dtSeconds, 0.25);
    while (this.accumulator + 1e-9 >= FIXED_STEP) {
      this.accumulator -= FIXED_STEP;
      this.tick(FIXED_STEP);
    }
  }

  private canMove(): boolean {
    return this.canMovePhase() && this.state.teams.some(
      (team) => team.id === this.state.activeTeamId && team.connected);
  }

  private sound(kind: GameSoundKind, point: Point,
    detail: Omit<Partial<GameSoundEvent>, "id" | "kind" | "x" | "y"> = {}): void {
    // Sound IDs must never consume gameplay IDs or random numbers.
    const events = this.state.soundEvents ??= [];
    const id = (this.state.soundSequence ?? events.at(-1)?.id ?? 0) + 1;
    this.state.soundSequence = id;
    events.push({ id, kind, x: point.x, y: point.y, ...detail });
    if (events.length > MAX_SOUND_EVENTS) events.splice(0, events.length - MAX_SOUND_EVENTS);
  }

  private playerSound(kind: GameSoundKind, player: Player,
    detail: Pick<Partial<GameSoundEvent>, "weapon" | "intensity"> = {}): void {
    this.sound(kind, player, { playerId: player.id, ...detail });
  }

  private damageSound(player: Player, previousHp: number, weapon?: WeaponId): void {
    if (player.hp < previousHp)
      this.playerSound("hurt", player, { ...(weapon ? { weapon } : {}),
        intensity: clamp((previousHp - player.hp) / 60, 0.15, 1) });
  }

  private canMovePhase(): boolean {
    return this.state.phase === "playing" || this.state.phase === "retreat";
  }

  private tick(realDt: number): void {
    // The wall clock is fixed-step, including in prediction. Only physical time
    // slows: a dramatic hit never stretches a fuse or a reveal unpredictably.
    this.elapsed += realDt;
    const resolution = this.state.resolution;
    const dt = realDt * (resolution && resolution.slowMotionRemaining > 0 ? 0.28 : 1);
    if (resolution) {
      resolution.slowMotionRemaining = Math.max(0, resolution.slowMotionRemaining - realDt);
      resolution.impact *= Math.exp(-10 * realDt);
    }
    this.state.explosions.forEach((explosion) => { explosion.age += dt; });
    this.state.explosions = this.state.explosions.filter((explosion) => explosion.age < 0.55);
    if (this.state.phase === "finished") return;
    if (this.state.phase === "damage") {
      this.updateDamageReveal(realDt);
      return;
    }

    for (const player of this.state.players) {
      if (!this.isPhysical(player)) continue;
      const isActive = player.id === this.state.activePlayerId && this.canMove();
      this.updatePlayer(player,
        isActive ? (this.inputs.get(player.id) ?? blankInput()) : blankInput(), dt, isActive);
    }
    this.resolvePlayerContacts();
    for (const player of this.state.players) {
      if (!this.isPhysical(player)) continue;
      if (player.rope) {
        if (updateRopePath(player.rope, player, this.state.platforms))
          player.rope.length = Math.max(player.rope.length, ropePathLength(player.rope, player));
        else player.rope = null;
      }
      if (player.y + PLAYER_RADIUS >= WATER_Y) this.drown(player);
    }
    this.updateProjectiles(dt, realDt);
    this.updateMines(dt, realDt);
    this.pickUpCrates();

    if (this.state.phase === "waiting") {
      if (this.state.teams.some((team) => team.connected &&
        this.state.players.some((player) => player.teamId === team.id && player.alive)))
        this.nextTurn();
      return;
    }

    const survivingTeams = new Set(this.state.players.filter((p) => p.alive).map((p) => p.teamId));
    const active = this.state.players.find((player) => player.id === this.state.activePlayerId);
    if ((!active || !this.isPhysical(active) ||
      (this.state.mode === "versus" && survivingTeams.size <= 1)) && this.state.phase !== "settling")
      this.beginSettling();

    // A missed shot that leaves the world is also over. Traps instead retain
    // their five-second placement retreat and arm on the following turn.
    const weapon = this.state.resolution?.weapon;
    if (this.state.phase === "retreat" && weapon && WEAPON_CATALOG[weapon].attack !== "mine" &&
      this.state.projectiles.length === 0) this.beginSettling();

    if (this.state.phase === "settling") {
      if (this.isSettled()) {
        this.settlingTime += realDt;
        if (this.settlingTime >= (this.state.resolution ? SETTLED_HOLD_SECONDS : 0))
          this.revealNextDamage();
      } else this.settlingTime = 0;
      return;
    }
    if (this.state.mode === "practice" && this.state.phase === "playing") return;
    this.state.timeLeft = Math.max(0, this.state.timeLeft - realDt);
    if (this.state.timeLeft <= 0) this.beginSettling();
  }

  private isPhysical(player: Player): boolean {
    return player.alive && !this.state.resolution?.drownedPlayerIds.includes(player.id);
  }

  private resolution() {
    return this.state.resolution ??= {
      affectedPlayerIds: [], pendingDamage: {}, drownedPlayerIds: [],
      focus: null, reveal: null, slowMotionRemaining: 0, impact: 0,
    };
  }

  private affect(player: Player): void {
    const resolution = this.resolution();
    if (!resolution.affectedPlayerIds.includes(player.id)) resolution.affectedPlayerIds.push(player.id);
  }

  private recordDamage(player: Player, damage: number): void {
    if (!this.isPhysical(player) || damage <= 0) return;
    this.affect(player);
    const pending = this.resolution().pendingDamage;
    pending[player.id] = (pending[player.id] ?? 0) + Math.round(damage);
  }

  private impactBeat(point: Point, strength: number): void {
    const resolution = this.resolution();
    resolution.focus = { x: point.x, y: point.y };
    // A burst of pellets shares a beat instead of stacking long pauses.
    if (resolution.impact < 0.2) resolution.slowMotionRemaining = 0.16 + strength * 0.12;
    resolution.impact = Math.max(resolution.impact, clamp(strength, 0, 1));
  }

  private drown(player: Player): void {
    this.sound("splash", { x: player.x, y: WATER_Y },
      { playerId: player.id, intensity: clamp(Math.hypot(player.vx, player.vy) / 1000, 0.5, 1) });
    this.recordDamage(player, Math.max(0, player.hp - (this.resolution().pendingDamage[player.id] ?? 0)));
    const resolution = this.resolution();
    this.affect(player);
    resolution.drownedPlayerIds.push(player.id);
    resolution.focus = { x: player.x, y: WATER_Y - PLAYER_RADIUS };
    player.y = WATER_Y - PLAYER_RADIUS;
    player.vx = player.vy = 0;
    player.rope = null;
    this.beginSettling();
  }

  private isSettled(): boolean {
    return this.state.projectiles.length === 0 &&
      !this.state.mines.some((mine) => mine.fuse !== null || !mine.settled) &&
      this.state.players.every((player) => !this.isPhysical(player) ||
        (player.grounded && Math.hypot(player.vx, player.vy) < 18));
  }

  private revealNextDamage(): void {
    const resolution = this.state.resolution;
    const player = resolution && resolution.affectedPlayerIds
      .map((id) => this.state.players.find((p) => p.id === id))
      .find((p) => p?.alive && (resolution.pendingDamage[p.id] ?? 0) > 0);
    if (!resolution || !player) {
      this.finishTurn();
      return;
    }
    const damage = resolution.pendingDamage[player.id]!;
    delete resolution.pendingDamage[player.id];
    resolution.reveal = { playerId: player.id, damage, fromHp: player.hp,
      toHp: Math.max(0, player.hp - damage), elapsed: 0, applied: false,
      drowned: resolution.drownedPlayerIds.includes(player.id) };
    resolution.focus = { x: player.x, y: player.y };
    resolution.slowMotionRemaining = 0;
    this.state.phase = "damage";
    this.state.message = `${player.name}'s turn outcome…`;
  }

  private updateDamageReveal(dt: number): void {
    const reveal = this.state.resolution?.reveal;
    const player = this.state.players.find((p) => p.id === reveal?.playerId);
    if (!reveal || !player || !player.alive) {
      this.beginSettling();
      return;
    }
    reveal.elapsed += dt;
    if (!reveal.applied && reveal.elapsed >= DAMAGE_APPLY_SECONDS) {
      player.hp = reveal.toHp;
      reveal.applied = true;
      this.damageSound(player, reveal.fromHp);
      this.state.message = `${player.name}: −${reveal.damage} HP${reveal.drowned ? " · into the drink!" : player.hp === 0 ? " · knocked out!" : ""}`;
    }
    if (reveal.elapsed < DAMAGE_REVEAL_SECONDS) return;
    this.state.resolution!.reveal = null;
    if (player.hp === 0) {
      this.kill(player, true);
      this.beginSettling();
    } else this.revealNextDamage();
  }

  private finishTurn(): void {
    if (this.state.mode === "versus") {
      const survivors = this.state.players.filter((player) => player.alive);
      const teams = new Set(survivors.map((player) => player.teamId));
      if (teams.size <= 1) {
        const winner = this.state.teams.find((team) => teams.has(team.id));
        this.state.phase = "finished";
        this.state.winnerId = winner?.id ?? null;
        this.state.timeLeft = 0;
        this.state.message = winner ? `${winner.name} wins the rebate!` : "Everyone took the plunge. Draw!";
        this.sound("victory", survivors[0] ?? { x: WIDTH / 2, y: HEIGHT / 2 },
          survivors[0] ? { playerId: survivors[0].id } : {});
        return;
      }
    }
    this.nextTurn();
  }

  private updatePlayer(
    player: Player,
    input: PlayerInput,
    dt: number,
    active: boolean,
  ): void {
    const axis = Number(input.right) - Number(input.left);
    const wasGrounded = player.grounded;
    if (axis) {
      player.facing = axis > 0 ? 1 : -1;
      if (player.rope) {
        const pivot = player.rope.bends.at(-1) ?? player.rope;
        const dx = player.x - pivot.x, dy = player.y - pivot.y;
        const distance = Math.hypot(dx, dy) || 1;
        // Pump along the swing arc; steering also works above the anchor.
        const direction = dy < 0 ? -axis : axis;
        const tangent = (player.vx * dy - player.vy * dx) / distance;
        const effort = clamp(1 - tangent * direction / 1100, 0, 1);
        player.vx += direction * dy / distance * 850 * effort * dt;
        player.vy -= direction * dx / distance * 850 * effort * dt;
      } else if (wasGrounded) {
        const speed = player.vx * axis;
        // A motor can accelerate to walking pace or brake a launch, never erase it.
        if (speed < WALK_SPEED) {
          const acceleration = player.tumble > 0 ? 520 : 1800;
          player.vx += axis * Math.min(acceleration * dt, WALK_SPEED - speed);
        }
      } else player.vx += axis * (player.tumble > 0 ? 240 : 520) * dt;
    }
    if (wasGrounded) {
      const rolling = player.tumble > 0 || Math.abs(player.vx) > WALK_SPEED + 10;
      player.vx *= Math.exp(-(rolling ? 0.9 : axis ? 0 : 10) * dt);
    } else player.vx *= Math.exp(-0.025 * dt);

    player.vy += GRAVITY * dt;
    let reelSpeed = 0;
    if (player.rope && active) {
      const oldLength = player.rope.length;
      player.rope.length = clamp(
        player.rope.length + (Number(input.down) - Number(input.up)) * 205 * dt,
        42,
        GRAPPLE_RANGE,
      );
      reelSpeed = (player.rope.length - oldLength) / dt;
      if (reelSpeed < 0 && ropePathLength(player.rope, player) >= oldLength - 2) {
        const pivot = player.rope.bends.at(-1) ?? player.rope;
        const dx = player.x - pivot.x, dy = player.y - pivot.y;
        const distance = Math.hypot(dx, dy) || 1;
        const tx = dy / distance, ty = -dx / distance;
        const tangent = player.vx * tx + player.vy * ty;
        const free = Math.max(PLAYER_RADIUS + 2, player.rope.length - ropeFixedLength(player.rope));
        // Reeling does work: preserve angular momentum as the radius shrinks.
        const boost = Math.min(0.035, (oldLength - player.rope.length) / free) *
          clamp((1250 - Math.abs(tangent)) / 500, 0, 1);
        player.vx += tx * tangent * boost;
        player.vy += ty * tangent * boost;
      }
    }
    limitBodySpeed(player);
    player.grounded = false;
    this.movePlayer(player, player.vx * dt, player.vy * dt, true);

    this.constrainRope(player, reelSpeed);
    updateBodyAttitude(player, dt);
  }

  private constrainRope(player: Player, reelSpeed = 0): void {
    const rope = player.rope;
    if (!rope) return;
    for (let iteration = 0; iteration < 3; iteration++) {
      if (!updateRopePath(rope, player, this.state.platforms)) {
        player.rope = null;
        return;
      }
      const pivot = rope.bends.at(-1) ?? rope;
      const freeLength = Math.max(PLAYER_RADIUS + 2, rope.length - ropeFixedLength(rope));
      const dx = player.x - pivot.x;
      const dy = player.y - pivot.y;
      const distance = Math.hypot(dx, dy);
      if (distance < freeLength - 0.001 || distance < 0.001) break;
      const nx = dx / distance;
      const ny = dy / distance;
      const previousY = player.y;
      const excess = Math.max(0, distance - freeLength);
      this.movePlayer(player, -nx * excess, -ny * excess);
      if (player.y < previousY - 0.01) player.grounded = false;
      const radialVelocity = player.vx * nx + player.vy * ny;
      if (radialVelocity > reelSpeed) {
        player.vx -= nx * (radialVelocity - reelSpeed);
        player.vy -= ny * (radialVelocity - reelSpeed);
      }
    }
    if (!updateRopePath(rope, player, this.state.platforms)) {
      player.rope = null;
      return;
    }
    // If a solid blocks reeling, pay out the actual routed length.
    rope.length = Math.max(rope.length, ropePathLength(rope, player));
  }

  /** Equal-mass circular bodies: terrain takes priority over separation. */
  private resolvePlayerContacts(): void {
    // Resolve from the floor upward so a whole pile inherits support in one pass.
    const players = this.state.players.filter((p) => this.isPhysical(p)).sort((a, b) => b.y - a.y);
    const heardContacts = new Set<string>();
    for (let iteration = 0; iteration < 8; iteration++) {
      for (let i = 0; i < players.length; i++) {
        for (let j = i + 1; j < players.length; j++) {
          const a = players[i];
          const b = players[j];
          if (!a.alive || !b.alive) continue;
          const dx = b.x - a.x;
          const dy = b.y - a.y;
          const distance = Math.hypot(dx, dy);
          if (distance > PLAYER_RADIUS * 2 + 0.1) continue;
          const nx = distance > 0.001 ? dx / distance : 1;
          const ny = distance > 0.001 ? dy / distance : 0;
          const closing = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
          const overlap = Math.max(0, PLAYER_RADIUS * 2 - distance);
          const ax = a.x, ay = a.y, bx = b.x, by = b.y;
          this.movePlayer(a, -nx * overlap / 2, -ny * overlap / 2);
          this.movePlayer(b, nx * overlap / 2, ny * overlap / 2);
          // Transfer the unused correction when a wall or floor pins one body.
          const movedA = (ax - a.x) * nx + (ay - a.y) * ny;
          const movedB = (b.x - bx) * nx + (b.y - by) * ny;
          if (movedA < overlap / 2 - 0.001)
            this.movePlayer(b, nx * (overlap / 2 - movedA), ny * (overlap / 2 - movedA));
          if (movedB < overlap / 2 - 0.001)
            this.movePlayer(a, -nx * (overlap / 2 - movedB), -ny * (overlap / 2 - movedB));
          if (closing < 0) {
            const pair = `${i}:${j}`;
            if (closing < -120 && !heardContacts.has(pair)) {
              const softLanding = Math.abs(ny) > 0.55 && closing >= -STOMP_SPEED;
              this.playerSound(softLanding ? "land" : "bounce", ny > 0 ? a : b,
                { intensity: clamp(-closing / 1000, 0.15, 1) });
              heardContacts.add(pair);
            }
            const impulse = -closing * (closing < -STOMP_SPEED ? 0.68 : 0.54);
            a.vx -= impulse * nx;
            a.vy -= impulse * ny;
            b.vx += impulse * nx;
            b.vy += impulse * ny;
            // A body can transmit a weapon launch without the contact itself
            // hurting. Its next fall/wall impact still belongs to this attack.
            const affected = this.state.resolution?.affectedPlayerIds;
            if (closing < -260 && (affected?.includes(a.id) || affected?.includes(b.id))) {
              this.affect(a);
              this.affect(b);
            }
            if (Math.abs(ny) > 0.55 && closing < -STOMP_SPEED) {
              const upper = ny > 0 ? a : b;
              const lower = ny > 0 ? b : a;
              const direction = Math.sign(lower.x - upper.x) || Math.sign(upper.vx) || 1;
              applyImpulse(lower, direction * Math.min(680, -closing * 0.8),
                Math.min(lower.vy, -Math.min(330, -closing * 0.34)) - lower.vy);
              upper.vy = Math.min(upper.vy, -Math.min(210, -closing * 0.22));
              upper.grounded = false;
              lower.tumble = Math.max(lower.tumble, 1.8);
            } else if (Math.abs(ny) < 0.55 && closing < -260) {
              a.tumble = b.tumble = 1.1;
              a.angularVelocity -= ny * closing / 100 + nx * 4;
              b.angularVelocity += ny * closing / 100 + nx * 4;
            }
            const stomp = Math.abs(ny) > 0.55 && closing < -STOMP_SPEED;
            if (stomp || closing < -HARD_IMPACT_SPEED) {
              const threshold = stomp ? STOMP_SPEED : HARD_IMPACT_SPEED;
              const damage = Math.min(45, Math.round((-closing - threshold) * 0.05 + 2));
              // Landing on another frog turns a traversal fall into an attack.
              if (stomp) this.recordDamage(ny > 0 ? b : a, damage);
              else {
                this.recordDamage(a, damage);
                this.recordDamage(b, damage);
              }
              this.affect(a);
              this.affect(b);
              a.impact = b.impact = Math.min(1, -closing / 1000);
              this.beginSettling();
              this.impactBeat({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
                clamp(-closing / 1500, 0.3, 1));
            }
          }
          if (ny > 0.55 && a.vy >= 0 && b.grounded) {
            a.grounded = true;
            // A supported body transmits weight into the floor, not downward velocity.
            a.vy = b.vy = 0;
          } else if (ny < -0.55 && b.vy >= 0 && a.grounded) {
            b.grounded = true;
            a.vy = b.vy = 0;
          }
        }
      }
    }
  }

  /** Small swept axis moves keep fast launches from crossing thin platforms. */
  private movePlayer(player: Player, dx: number, dy: number, physical = false): void {
    const steps = Math.max(
      1,
      Math.ceil(Math.max(Math.abs(dx), Math.abs(dy)) / 6),
    );
    let stepX = dx / steps;
    let stepY = dy / steps;
    let impactSound: { kind: "land" | "bounce"; speed: number } | undefined;
    const contact = (nx: number, ny: number) => {
      if (physical) {
        const speed = -(player.vx * nx + player.vy * ny);
        const damage = surfaceImpact(player, nx, ny);
        // Traversal is safe for the active frog; weapon/body launches lose that immunity.
        if (damage > 0 && (player.id !== this.state.activePlayerId ||
          this.state.resolution?.affectedPlayerIds.includes(player.id))) {
          this.recordDamage(player, damage);
          this.beginSettling();
          this.impactBeat(player, clamp(speed / 1500, 0.3, 1));
        }
        if (speed > 120 && (!impactSound || speed > impactSound.speed))
          impactSound = { kind: ny < 0 && player.grounded ? "land" : "bounce", speed };
      }
      else {
        // Separation/reeling may touch terrain but cannot manufacture a crash.
        const inward = player.vx * nx + player.vy * ny;
        if (inward < 0) {
          player.vx -= nx * inward;
          player.vy -= ny * inward;
        }
        if (ny < 0 && player.vy >= 0) player.grounded = true;
      }
    };
    for (let step = 0; step < steps; step++) {
      let nextX = clamp(player.x + stepX, PLAYER_RADIUS, WIDTH - PLAYER_RADIUS);
      let hitX = 0;
      for (const platform of this.state.platforms) {
        const overlapsY =
          player.y + PLAYER_RADIUS > platform.y + 0.05 &&
          player.y - PLAYER_RADIUS < platform.y + platform.h - 0.05;
        if (!overlapsY) continue;
        if (
          stepX > 0 &&
          player.x + PLAYER_RADIUS <= platform.x + 0.1 &&
          nextX + PLAYER_RADIUS >= platform.x
        ) {
          nextX = Math.min(nextX, platform.x - PLAYER_RADIUS);
          hitX = -1;
        } else if (
          stepX < 0 &&
          player.x - PLAYER_RADIUS >= platform.x + platform.w - 0.1 &&
          nextX - PLAYER_RADIUS <= platform.x + platform.w
        ) {
          nextX = Math.max(nextX, platform.x + platform.w + PLAYER_RADIUS);
          hitX = 1;
        }
      }
      if (nextX <= PLAYER_RADIUS && stepX < 0) hitX = 1;
      else if (nextX >= WIDTH - PLAYER_RADIUS && stepX > 0) hitX = -1;
      if (hitX) { contact(hitX, 0); stepX = 0; }
      player.x = nextX;

      let nextY = player.y + stepY;
      let hitY = 0;
      for (const platform of this.state.platforms) {
        const overlapsX =
          player.x + PLAYER_RADIUS > platform.x &&
          player.x - PLAYER_RADIUS < platform.x + platform.w;
        if (!overlapsX) continue;
        if (
          stepY >= 0 &&
          player.y + PLAYER_RADIUS <= platform.y + 0.1 &&
          nextY + PLAYER_RADIUS >= platform.y
        ) {
          nextY = Math.min(nextY, platform.y - PLAYER_RADIUS);
          hitY = -1;
        } else if (
          stepY < 0 &&
          player.y - PLAYER_RADIUS >= platform.y + platform.h - 0.1 &&
          nextY - PLAYER_RADIUS <= platform.y + platform.h
        ) {
          nextY = Math.max(nextY, platform.y + platform.h + PLAYER_RADIUS);
          hitY = 1;
        }
      }
      if (nextY <= -220 && stepY < 0) hitY = 1;
      if (hitY) { contact(0, hitY); stepY = 0; }
      player.y = Math.max(-220, nextY);
    }
    if (impactSound) this.playerSound(impactSound.kind, player,
      { intensity: clamp(impactSound.speed / 1000, 0.15, 1) });
  }

  private pickUpCrates(): void {
    if (this.state.phase !== "playing") return;
    const active = this.state.players.find(
      (player) => player.id === this.state.activePlayerId,
    );
    if (!active?.alive) return;
    const collected = this.state.crates.filter(
      (crate) =>
        Math.hypot(crate.x - active.x, crate.y - active.y) < PLAYER_RADIUS + 22,
    );
    if (collected.length === 0) return;
    this.state.crates = this.state.crates.filter(
      (crate) => !collected.includes(crate),
    );
    for (const crate of collected) active.inventory[crate.weapon] += WEAPON_CATALOG[crate.weapon].ammo;
    this.selectAvailableWeapon(active);
    active.hasCrate = true;
    this.playerSound("pickup", active, { weapon: collected[0]!.weapon });
    this.state.message = `${active.name} added ${collected.length === 1 ? `${WEAPON_CATALOG[collected[0]!.weapon].name} resupply` : `${collected.length} rounds`} to their pack. Aim, fire, then retreat!`;
  }

  private aim(
    player: Player,
    input: PlayerInput,
  ): { x: number; y: number } | null {
    const dx = input.aimX - player.x;
    const dy = input.aimY - player.y;
    const distance = Math.hypot(dx, dy);
    return distance > 1 ? { x: dx / distance, y: dy / distance } : null;
  }

  private fire(
    player: Player,
    input: PlayerInput,
    requestedPower?: number,
  ): boolean {
    const direction = this.aim(player, input);
    if (!direction || !player.weapon) return false;
    const weapon = player.weapon;
    const definition = WEAPON_CATALOG[weapon];
    const power = clamp(finite(requestedPower, 1), 0.2, 1);
    this.resolution().weapon = weapon;
    this.playerSound("shot", player, { weapon, intensity: power });
    if (definition.attack === "melee") {
      const angle = Math.atan2(direction.y, direction.x);
      this.state.explosions.push({ id: this.id("swing"), x: player.x + direction.x * 48,
        y: player.y + direction.y * 48, radius: definition.range, age: 0,
        kind: "melee", weapon: weapon, color: definition.color, direction: angle });
      for (const target of this.state.players) {
        if (!this.isPhysical(target) || target.id === player.id) continue;
        const dx = target.x - player.x, dy = target.y - player.y;
        const distance = Math.hypot(dx, dy);
        if (distance > definition.range + PLAYER_RADIUS || distance < 1) continue;
        if ((dx * direction.x + dy * direction.y) / distance < 0.5) continue;
        if (this.raycast(player.x, player.y, dx / distance, dy / distance, distance)) continue;
        this.recordDamage(target, Math.round(definition.damage * (0.7 + power * 0.3)));
        this.affect(target);
        this.impactBeat(target, 0.85);
        applyImpulse(target, direction.x * definition.impulse * power,
          direction.y * definition.impulse * power - definition.lift,
          (Math.sign(direction.x) || player.facing) * (weapon === "golf" ? 12 : 18));
      }
      if (weapon === "boxing") applyImpulse(player, -direction.x * 140, -70, -player.facing * 2);
    } else if (definition.attack === "blast") {
      const obstruction = this.raycast(player.x, player.y, direction.x, direction.y, definition.range);
      const reach = obstruction ? Math.max(0, obstruction.distance - 5) : definition.range;
      this.explode(player.x + direction.x * reach, player.y + direction.y * reach,
        definition.radius, definition.damage, player.id, definition, direction);
    } else if (definition.attack === "mine") {
      this.state.mines.push({ id: this.id("mine"), ownerId: player.id,
        x: player.x, y: player.y, vx: direction.x * definition.speed * power + player.vx * 0.3,
        vy: direction.y * definition.speed * power - 65, kind: weapon as "mine" | "springMine",
        placedTurn: this.state.turn, fuse: null, settled: false });
    } else if (definition.attack === "airstrike") {
      const center = clamp(input.aimX, 24, WIDTH - 24);
      for (let index = 0; index < definition.pellets; index++) {
        const offset = (index - (definition.pellets - 1) / 2) * definition.spread;
        this.state.projectiles.push({ id: this.id("shot"), ownerId: player.id,
          x: clamp(center + offset, 12, WIDTH - 12), y: -100 - index * 85,
          vx: weapon === "airstrike" ? 38 : 0, vy: definition.speed,
          kind: weapon, life: definition.life, radius: definition.radius, damage: definition.damage,
          variant: "strike", age: 0 });
      }
    } else {
      for (let index = 0; index < definition.pellets; index++) {
        const offset = definition.pellets === 1 ? 0 :
          (index / (definition.pellets - 1) - 0.5) * 2 * definition.spread;
        const angle = Math.atan2(direction.y, direction.x) + offset;
        const speed = definition.speed * power;
        // Starting inside the shooter makes every wall and nearby enemy count.
        this.state.projectiles.push({ id: this.id("shot"), ownerId: player.id,
          x: player.x, y: player.y, vx: Math.cos(angle) * speed + player.vx * 0.35,
          vy: Math.sin(angle) * speed + player.vy * 0.35,
          kind: weapon, life: definition.life, radius: definition.radius,
          damage: definition.damage, age: 0 });
      }
      if (weapon === "shotgun") applyImpulse(player, -direction.x * 190, -direction.y * 190 - 40, -player.facing * 3);
    }
    player.inventory[weapon]--;
    this.selectAvailableWeapon(player);
    player.hasCrate = false;
    if (definition.attack === "melee" || definition.attack === "blast") {
      this.beginSettling();
      this.state.message = `${definition.name}! Watch the fallout…`;
    } else {
      this.state.phase = "retreat";
      this.state.timeLeft = RETREAT_SECONDS;
      this.state.message = definition.attack === "mine"
        ? `${definition.name} placed. It arms next turn. Five seconds to retreat!`
        : `${definition.name}! Retreat until impact.`;
    }
    return true;
  }

  private updateProjectiles(dt: number, realDt = dt): void {
    const remaining: Projectile[] = [];
    for (const projectile of this.state.projectiles) {
      const definition = WEAPON_CATALOG[projectile.kind];
      const isFragment = projectile.variant === "fragment";
      const contact = isFragment && projectile.kind !== "banana" ? "explode" : definition.contact;
      const gravity = isFragment ? (projectile.kind === "firework" ? 250 : 1050) : definition.gravity;
      projectile.life -= realDt;
      projectile.age = (projectile.age ?? 0) + dt;
      if (projectile.attachedPlayerId) {
        const attached = this.state.players.find((p) => p.id === projectile.attachedPlayerId && this.isPhysical(p));
        if (attached) { projectile.x = attached.x; projectile.y = attached.y; }
      }
      if (!projectile.stuck) {
        projectile.vy += gravity * dt;
        if (projectile.kind === "boomerang" && projectile.age > 0.4) {
          const owner = this.state.players.find((p) => p.id === projectile.ownerId);
          if (owner) {
            const dx = owner.x - projectile.x, dy = owner.y - projectile.y;
            const length = Math.max(1, Math.hypot(dx, dy));
            projectile.vx += dx / length * 1400 * dt;
            projectile.vy += dy / length * 1400 * dt;
          }
        }
      }
      const distance = Math.hypot(projectile.vx, projectile.vy) * dt;
      const steps = Math.max(1, Math.ceil(distance / 4));
      const bodyRadius = projectile.kind === "anvil" ? 12 : projectile.kind === "megaBomb" ? 9 : 5;
      let detonate = false;
      let contactSpeed = 0;
      for (let step = 0; step < steps && !detonate && !projectile.stuck; step++) {
        const prevX = projectile.x, prevY = projectile.y;
        projectile.x += (projectile.vx * dt) / steps;
        projectile.y += (projectile.vy * dt) / steps;
        const hitPlayer = this.state.players.find((player) => this.isPhysical(player) &&
          (player.id !== projectile.ownerId || (projectile.kind === "boomerang" && projectile.age! > 0.4)) &&
          Math.hypot(player.x - projectile.x, player.y - projectile.y) <= PLAYER_RADIUS + bodyRadius);
        if (hitPlayer) {
          if (contact === "stick") {
            contactSpeed = Math.hypot(projectile.vx, projectile.vy);
            projectile.stuck = true;
            projectile.attachedPlayerId = hitPlayer.id;
            projectile.vx = projectile.vy = 0;
          } else detonate = true;
          break;
        }
        const platform = this.state.platforms.find((candidate) =>
          projectile.x + bodyRadius >= candidate.x && projectile.x - bodyRadius <= candidate.x + candidate.w &&
          projectile.y + bodyRadius >= candidate.y && projectile.y - bodyRadius <= candidate.y + candidate.h);
        if (platform) {
          if (contact === "explode") { detonate = true; break; }
          if (contact === "stick") {
            contactSpeed = Math.hypot(projectile.vx, projectile.vy);
            projectile.x = prevX;
            projectile.y = prevY;
            projectile.stuck = true;
            projectile.vx = projectile.vy = 0;
            break;
          }
          projectile.bounces = (projectile.bounces ?? 0) + 1;
          if (prevY + bodyRadius <= platform.y + 0.1) {
            contactSpeed = Math.max(contactSpeed, Math.abs(projectile.vy));
            projectile.y = platform.y - bodyRadius - 0.1;
            projectile.vy = Math.abs(projectile.vy) < 35 ? 0 : -Math.abs(projectile.vy) * definition.bounce;
            projectile.vx *= definition.bounce > 0.85 ? 0.98 : 0.82;
          } else if (prevY - bodyRadius >= platform.y + platform.h - 0.1) {
            contactSpeed = Math.max(contactSpeed, Math.abs(projectile.vy));
            projectile.y = platform.y + platform.h + bodyRadius + 0.1;
            projectile.vy = Math.abs(projectile.vy) * definition.bounce;
          } else {
            contactSpeed = Math.max(contactSpeed, Math.abs(projectile.vx));
            projectile.x = prevX < platform.x ? platform.x - bodyRadius - 0.1 : platform.x + platform.w + bodyRadius + 0.1;
            projectile.vx *= -definition.bounce;
          }
        }
        if (contact === "bounce" && (projectile.x < bodyRadius || projectile.x > WIDTH - bodyRadius)) {
          contactSpeed = Math.max(contactSpeed, Math.abs(projectile.vx));
          projectile.x = clamp(projectile.x, bodyRadius, WIDTH - bodyRadius);
          projectile.vx *= -definition.bounce;
        }
      }
      if (contactSpeed > 120) this.sound("bounce", projectile,
        { weapon: projectile.kind, intensity: clamp(contactSpeed / 1000, 0.15, 1) });
      if (projectile.y >= WATER_Y) this.sound("splash", projectile,
        { weapon: projectile.kind, intensity: 0.4 });
      if (projectile.y >= WATER_Y || projectile.x < -100 || projectile.x > WIDTH + 100 || projectile.y < -650) continue;
      if (detonate || projectile.life <= 0) {
        this.explode(projectile.x, projectile.y, projectile.radius, projectile.damage,
          undefined, definition, undefined, isFragment ? 0.65 : 1);
        if (definition.fragments > 0 && !isFragment) {
          for (let index = 0; index < definition.fragments; index++) {
            const angle = projectile.kind === "firework"
              ? index / definition.fragments * Math.PI * 2
              : -Math.PI + (index + 0.5) / definition.fragments * Math.PI;
            const speed = projectile.kind === "banana" ? 300 + (index % 2) * 160 : 340 + (index % 3) * 60;
            remaining.push({ id: this.id("fragment"), ownerId: projectile.ownerId,
              x: projectile.x, y: projectile.y - 6, vx: Math.cos(angle) * speed + projectile.vx * 0.15,
              vy: Math.sin(angle) * speed, kind: projectile.kind, variant: "fragment", age: 0,
              life: projectile.kind === "banana" ? 1.1 + index * 0.13 : 1.6,
              radius: projectile.kind === "banana" ? 112 : projectile.kind === "firework" ? 72 : 83,
              damage: projectile.kind === "banana" ? 42 : projectile.kind === "firework" ? 24 : 31 });
          }
        }
      } else remaining.push(projectile);
    }
    this.state.projectiles = remaining;
  }

  private updateMines(dt: number, realDt = dt): void {
    const active = this.state.players.find((p) => p.id === this.state.activePlayerId && this.isPhysical(p));
    this.state.mines = this.state.mines.filter((mine) => {
      const definition = WEAPON_CATALOG[mine.kind];
      let contactSpeed = 0;
      if (!mine.settled) {
        mine.vy += GRAVITY * dt;
        const steps = Math.max(1, Math.ceil(Math.hypot(mine.vx, mine.vy) * dt / 4));
        for (let step = 0; step < steps && !mine.settled; step++) {
          const px = mine.x, py = mine.y;
          mine.x = clamp(mine.x + mine.vx * dt / steps, 8, WIDTH - 8);
          mine.y += mine.vy * dt / steps;
          const platform = this.state.platforms.find((p) => mine.x + 8 >= p.x && mine.x - 8 <= p.x + p.w && mine.y + 8 >= p.y && mine.y - 8 <= p.y + p.h);
          if (!platform) continue;
          if (py + 8 <= platform.y + 0.1) {
            contactSpeed = Math.max(contactSpeed, Math.abs(mine.vy));
            mine.y = platform.y - 8;
            mine.vx = mine.vy = 0;
            mine.settled = true;
          } else if (py - 8 >= platform.y + platform.h - 0.1) {
            contactSpeed = Math.max(contactSpeed, Math.abs(mine.vy));
            mine.y = platform.y + platform.h + 8.1;
            mine.vy = Math.abs(mine.vy) * 0.2;
          } else {
            contactSpeed = Math.max(contactSpeed, Math.abs(mine.vx));
            mine.x = px < platform.x ? platform.x - 8.1 : platform.x + platform.w + 8.1;
            mine.vx *= -0.2;
          }
        }
      }
      if (contactSpeed > 120) this.sound("bounce", mine,
        { weapon: mine.kind, intensity: clamp(contactSpeed / 1000, 0.15, 1) });
      if (mine.y >= WATER_Y) {
        this.sound("splash", mine, { weapon: mine.kind, intensity: 0.4 });
        return false;
      }
      // Persistent traps never detonate merely because a waiting frog is nearby.
      // Their deployer also gets the entire deployment turn to retreat safely.
      if (mine.fuse === null && mine.placedTurn < this.state.turn && active && this.canMovePhase()) {
        const dx = active.x - mine.x, dy = active.y - mine.y;
        const distance = Math.hypot(dx, dy);
        if (distance < definition.range && !this.raycast(mine.x, mine.y, dx / Math.max(1, distance), dy / Math.max(1, distance), distance)) {
          mine.fuse = 0.45;
          this.sound("mineTrigger", mine, { weapon: mine.kind });
          this.state.message = `${definition.name} is beeping. Move!`;
        }
      }
      if (mine.fuse !== null) {
        mine.fuse -= realDt;
        if (mine.fuse <= 0) {
          this.explode(mine.x, mine.y, definition.radius, definition.damage, undefined, definition);
          return false;
        }
      }
      return true;
    });
  }

  private explode(
    x: number,
    y: number,
    radius: number,
    damage: number,
    immunePlayerId?: string,
    definition: WeaponDefinition = WEAPON_CATALOG.rocket,
    direction?: Point,
    impulseScale = 1,
    deathBlast = false,
  ): void {
    this.beginSettling();
    this.impactBeat({ x, y }, clamp(radius / 200 * impulseScale, 0.25, 1));
    this.sound("explosion", { x, y }, { ...(deathBlast ? {} : { weapon: definition.id }),
      intensity: clamp(radius / 180 * impulseScale, 0.2, 1) });
    this.state.explosions.push({ id: this.id("blast"), x, y, radius, age: 0,
      kind: definition.kind, ...(deathBlast ? {} : { weapon: definition.id }), color: definition.color,
      ...(direction ? { direction: Math.atan2(direction.y, direction.x) } : {}) });
    for (const player of this.state.players) {
      if (!this.isPhysical(player) || player.id === immunePlayerId) continue;
      const dx = player.x - x, dy = player.y - y;
      const distance = Math.hypot(dx, dy);
      if (distance > radius + PLAYER_RADIUS) continue;
      const force = Math.max(0, 1 - distance / (radius + PLAYER_RADIUS));
      const nx = distance > 1 ? dx / distance : 0;
      const ny = distance > 1 ? dy / distance : -1;
      const cover = this.raycast(x, y, nx, ny, Math.max(0, distance - PLAYER_RADIUS)) ? 0.4 : 1;
      this.recordDamage(player, Math.round(damage * (0.28 + force * 0.72) * cover));
      this.affect(player);
      const impulse = definition.impulse * (0.32 + force * 0.68) * impulseScale * cover;
      const pull = definition.kind === "pull" ? -1 : 1;
      const launchX = definition.kind === "push" && direction ? direction.x : nx * pull;
      const launchY = definition.kind === "push" && direction ? direction.y : ny * pull;
      applyImpulse(player, launchX * impulse, launchY * impulse - definition.lift * impulseScale,
        (Math.sign(launchX) || player.facing) * (4 + force * 14) * impulseScale);
    }
  }

  private kill(player: Player, deathBlast = false): void {
    if (!player.alive) return;
    this.playerSound("death", player);
    player.alive = false;
    player.hp = 0;
    player.rope = null;
    player.weapon = null;
    player.hasCrate = false;
    player.vx = 0;
    player.vy = 0;
    this.state.message = `${player.name} is out!`;
    if (deathBlast) {
      this.explode(player.x, player.y, 96, 14, player.id,
        { ...WEAPON_CATALOG.rocket, radius: 96, damage: 14, impulse: 380, lift: 140,
          color: player.color }, undefined, 1, true);
    }
  }

  private beginSettling(): void {
    if (this.state.phase === "settling") return;
    this.jump = null;
    this.state.phase = "settling";
    this.state.timeLeft = 0;
    this.settlingTime = 0;
    this.state.players.forEach((player) => {
      player.rope = null;
    });
    this.inputs.clear();
    this.state.message = "Let the dust settle…";
  }

  private nextTurn(): void {
    this.state.resolution = null;
    if (this.state.mode === "practice") {
      this.state.players.forEach((player) => {
        if (!player.alive) {
          const index = this.state.teams.findIndex((team) => team.id === player.teamId);
          Object.assign(player, frogSpawn(index, player.number - 1));
          player.rotation = 0;
          player.angularVelocity = 0;
          player.impact = 0;
          player.tumble = 0;
          player.vx = 0;
          player.vy = 0;
          player.hp = player.maxHp;
          player.alive = true;
          player.grounded = true;
          player.lookAt = { x: player.x + 200, y: player.y - 220 };
          this.playerSound("respawn", player);
        }
      });
      this.state.activePlayerId = this.state.players[0]!.id;
      this.state.activeTeamId = this.state.players[0]!.teamId;
    } else {
      const currentIndex = this.state.teams.findIndex(
        (team) => team.id === this.state.activeTeamId,
      );
      let selected = false;
      for (let offset = 1; offset <= this.state.teams.length; offset++) {
        const team = this.state.teams[(currentIndex + offset) % this.state.teams.length]!;
        if (!team.connected) continue;
        const frogs = this.state.players.filter((player) => player.teamId === team.id);
        const last = frogs.findIndex((player) => player.id === this.lastFrog.get(team.id));
        for (let next = 1; next <= frogs.length; next++) {
          const player = frogs[(last + next) % frogs.length]!;
          if (!player.alive) continue;
          this.state.activePlayerId = player.id;
          this.state.activeTeamId = team.id;
          this.lastFrog.set(team.id, player.id);
          selected = true;
          break;
        }
        if (selected) break;
      }
      if (!selected) {
        this.state.phase = "waiting";
        this.state.timeLeft = 0;
        this.state.message = "Waiting for a team to reconnect…";
        return;
      }
    }
    this.jump = null;
    this.state.players.forEach((player) => {
      if (this.state.mode === "practice") player.inventory = createInventory("practice");
      this.selectAvailableWeapon(player);
      player.hasCrate = player.alive && player.weapon !== null;
      player.rope = null;
      this.inputs.set(player.id, blankInput(player.lookAt));
    });
    this.state.turn++;
    for (const mine of this.state.mines)
      if (mine.placedTurn === this.state.turn - 1)
        this.sound("mineArm", mine, { weapon: mine.kind });
    this.state.phase = "playing";
    this.state.timeLeft = this.state.mode === "practice" ? 90 : TURN_SECONDS;
    const active = this.state.players.find(
      (player) => player.id === this.state.activePlayerId,
    )!;
    this.playerSound("switch", active);
    this.state.message = `${active.name}'s turn. ${active.hasCrate ? "Use your saved ammo or collect more supplies." : "Find a supply crate."}`;
    this.spawnCrates();
  }

  private selectAvailableWeapon(player: Player): void {
    if (!player.weapon || player.inventory[player.weapon] <= 0) {
      player.weapon =
        WEAPON_IDS.find((weapon) => player.inventory[weapon] > 0) ?? null;
    }
  }

  private spawnCrates(): void {
    const player = this.state.players.find(
      (candidate) => candidate.id === this.state.activePlayerId,
    )!;
    const support = this.state.platforms
      .filter(
        (platform) =>
          platform.y >= player.y &&
          player.x >= platform.x - 12 &&
          player.x <= platform.x + platform.w + 12,
      )
      .sort((a, b) => a.y - b.y)[0];
    const platform = support ?? this.state.platforms[0]!;
    const direction = player.x > platform.x + platform.w / 2 ? -1 : 1;
    const nearX = clamp(
      player.x + direction * 110,
      platform.x + 28,
      platform.x + platform.w - 28,
    );
    this.state.crates = [
      {
        id: this.id("crate"),
        x: nearX,
        y: platform.y - PLAYER_RADIUS,
        weapon: WEAPON_IDS[Math.floor(this.random() * WEAPON_IDS.length)]!,
      },
      ...this.state.platforms.filter((p) => p.h < 100).map((p) => ({
        id: this.id("crate"),
        x: p.x + p.w / 2,
        y: p.y - PLAYER_RADIUS,
        weapon: WEAPON_IDS[Math.floor(this.random() * WEAPON_IDS.length)]!,
      })),
    ];
  }

  private raycast(
    x: number,
    y: number,
    dx: number,
    dy: number,
    maxDistance: number,
  ): { x: number; y: number; distance: number } | null {
    let closest = maxDistance + 1;
    for (const platform of this.state.platforms) {
      let near = 0;
      let far = maxDistance;
      let miss = false;
      for (const [origin, direction, low, high] of [
        [x, dx, platform.x, platform.x + platform.w],
        [y, dy, platform.y, platform.y + platform.h],
      ]) {
        if (Math.abs(direction!) < 1e-9) {
          if (origin! < low! || origin! > high!) {
            miss = true;
            break;
          }
        } else {
          const a = (low! - origin!) / direction!;
          const b = (high! - origin!) / direction!;
          near = Math.max(near, Math.min(a, b));
          far = Math.min(far, Math.max(a, b));
          if (near > far) {
            miss = true;
            break;
          }
        }
      }
      if (!miss && near > 1 && near < closest && near <= maxDistance)
        closest = near;
    }
    return closest <= maxDistance
      ? { x: x + dx * closest, y: y + dy * closest, distance: closest }
      : null;
  }

  private random(): number {
    this.randomSeed = (Math.imul(1664525, this.randomSeed) + 1013904223) >>> 0;
    return this.randomSeed / 4294967296;
  }

  private id(prefix: string): string {
    return `${prefix}-${++this.serial}`;
  }
}
