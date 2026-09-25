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
import { bodyTerrain, imageSurface, terrainIn } from "./image-terrain.js";
import { DEFAULT_MAP_ID, getMap, mapPlatforms, type ArenaMap } from "./maps.js";
import { DEFAULT_MINE_COUNT, DEFAULT_TEAM_SETTINGS, teamColor, teamSettings, validMineCount } from "./settings.js";
import { createInventory, WEAPON_CATALOG, WEAPON_IDS, type WeaponDefinition } from "./weapons.js";
import type { GameSnapshot } from "./protocol.js";
import { applyImpulse, GRAVITY, WALK_SPEED, HARD_IMPACT_SPEED, limitBodySpeed, surfaceImpact, updateBodyAttitude } from "./physics.js";
import { addStatus, hasStatus, hazardTouches, MAX_HAZARDS, projectHazard, ropeIntersectsCircle, ropeIntersectsWire } from "./effects.js";

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
export const EXPLOSION_SECONDS = 0.55;
const SETTLED_HOLD_SECONDS = 0.35;
export const DOUBLE_JUMP_SECONDS = 0.32;
export const MAX_SOUND_EVENTS = 128;

// A normal jump can land on a frog; a longer fall becomes a stomp.
const STOMP_SPEED = 560;
const MINE_RADIUS = 8;
const MINE_SPACING = 48;

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

function frogSpawn(map: ArenaMap, teamIndex: number, frogIndex: number): Point {
  const slot = teamIndex % map.spawnPlatformIds.length;
  const offset = Math.floor(teamIndex / map.spawnPlatformIds.length) * map.width;
  if (map.spawnGroups) {
    const point = map.spawnGroups[slot]![frogIndex]!;
    return { x: point.x + offset, y: point.y };
  }
  if (map.id === DEFAULT_MAP_ID && slot < SPAWNS.length) {
    const spawn = SPAWNS[slot]!;
    const direction = slot === 1 || slot === 3 ? -1 : 1;
    // Preserve the original starting positions and room for six frogs per team.
    return { x: offset + spawn.x + direction * frogIndex * (slot === 3 ? 42 : 64), y: spawn.y };
  }
  const platform = map.platforms.find((candidate) => candidate.id === map.spawnPlatformIds[slot])!;
  const spacing = Math.min(42, (platform.w - PLAYER_RADIUS * 2 - 8) / 5);
  return {
    x: offset + platform.x + platform.w / 2 + (frogIndex - 2.5) * spacing,
    y: platform.y - PLAYER_RADIUS,
  };
}

/** Default geometry remains public for existing callers and old saved games. */
export function makePlatforms(): Platform[] {
  return getMap().platforms.map((platform) => ({ ...platform }));
}

/** Use safe team areas first, then repeat the layout without internal cave walls. */
function makeArena(map: ArenaMap, teamCount: number): { width: number; platforms: Platform[] } {
  const sections = Math.ceil(teamCount / map.spawnPlatformIds.length);
  return {
    width: map.width * sections,
    platforms: mapPlatforms(map, sections),
  };
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
      ? [...options.players]
      : [
          { id: "p1", name: "Moss", color: teamColor(0) },
          { id: "p2", name: "Tangerine", color: teamColor(1) },
        ];
    // A practice target remains available even when a room supplies a single player.
    if (definitions.length === 1)
      definitions.push({
        id: "practice-target",
        name: "Target",
        color: teamColor(1),
      });
    const teams = definitions.map((definition, index) => ({
      id: definition.id,
      name: definition.name,
      color: definition.color ?? teamColor(index),
      connected: definition.connected !== false,
      bot: definition.bot === true,
      inventory: createInventory(options.mode),
      ...teamSettings({ frogs: definition.frogs ?? DEFAULT_TEAM_SETTINGS.frogs,
        hp: definition.hp ?? DEFAULT_TEAM_SETTINGS.hp }),
    }));
    const map = getMap(options.mapId);
    const arena = makeArena(map, teams.length);
    const players: Player[] = teams.flatMap((team, index) =>
      Array.from({ length: team.frogs }, (_, frog): Player => {
        const spawn = frogSpawn(map, index, frog);
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
          facing: spawn.x < arena.width / 2 ? 1 : -1,
          alive: true,
          grounded: true,
          lookAt: { x: spawn.x + 200, y: spawn.y - 220 },
          rope: null,
          rotation: 0,
          angularVelocity: 0,
          impact: 0,
          tumble: 0,
          statuses: [],
          inventory: team.inventory,
          weapon: options.mode === "practice" ? "rocket" : null,
          hasCrate: options.mode === "practice",
        };
      }));
    const firstTeam = teams.find((team) => team.connected) ?? teams[0]!;
    const firstFrog = players.find((player) => player.teamId === firstTeam.id)!;
    this.state = {
      mapId: map.id,
      hasWater: map.hasWater,
      width: arena.width,
      height: map.height,
      waterY: map.waterY,
      platforms: arena.platforms,
      players,
      teams,
      crates: [],
      projectiles: [],
      mines: [],
      hazards: [],
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
      message: options.mode === "practice" ? "Choose from your arsenal. Make your shot. Get out of the way."
        : "Collect a mystery crate to add a random weapon to your team's inventory.",
    };
    players.forEach((player) => this.inputs.set(player.id, blankInput(player.lookAt)));
    if (firstTeam.connected) this.lastFrog.set(firstTeam.id, firstFrog.id);
    this.spawnCrates();
    this.seedMines(validMineCount(options.mineCount) ? options.mineCount : DEFAULT_MINE_COUNT);
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
    // JSON transport duplicates the compatibility aliases. The team stash is
    // authoritative, so every frog must point back to it before replay begins.
    for (const team of state.teams) {
      team.inventory ??= this.state.players.find((player) => player.teamId === team.id)?.inventory ?? createInventory(state.mode);
      for (const player of state.players)
        if (player.teamId === team.id) player.inventory = team.inventory;
    }
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
      aimX: clamp(finite(input.aimX, prior.aimX), -this.state.width, this.state.width * 2),
      aimY: clamp(finite(input.aimY, prior.aimY), -this.state.height, this.state.height * 2),
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
        if (input.left !== input.right)
          player.facing = (input.right !== hasStatus(player, "inverted")) ? 1 : -1;
        this.jump = { id, at: this.elapsed, facing: player.facing };
        player.vy = -525 * this.jumpStrength(player);
        player.angularVelocity += player.facing * -1.8;
        player.grounded = false;
        this.playerSound("jump", player);
        return true;
      case "backflip":
        if (!this.jump || this.jump.id !== id || player.grounded ||
          this.elapsed - this.jump.at > DOUBLE_JUMP_SECONDS) return false;
        player.vy = -760 * this.jumpStrength(player);
        player.vx = -this.jump.facing * 310 * this.jumpStrength(player);
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
        if (this.cutWireRope(player)) return false;
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
          !player.weapon ||
          player.inventory[player.weapon] <= 0
        ) {
          if (this.state.phase === "playing")
            this.state.message =
              "Your team's inventory is empty. Collect a mystery crate first.";
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
        player.hasCrate = true;
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
    this.state.explosions = this.state.explosions.filter((explosion) => explosion.age < EXPLOSION_SECONDS);
    if (this.state.phase === "finished") return;
    if (this.state.phase === "damage") {
      this.updateDamageReveal(realDt);
      return;
    }

    this.updateEffects(realDt, dt);

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
      this.cutWireRope(player);
      if (this.state.hasWater !== false && player.y + PLAYER_RADIUS >= this.state.waterY) this.drown(player);
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

  private jumpStrength(player: Player): number {
    return hasStatus(player, "sticky") ? 0.68 : hasStatus(player, "heavy") ? 0.75 :
      hasStatus(player, "chilled") ? 0.8 : 1;
  }

  private cutWireRope(player: Player): boolean {
    if (!player.rope || !(this.state.hazards ?? []).some((hazard) =>
      hazard.kind === "wire" && ropeIntersectsWire(player, hazard))) return false;
    player.rope = null;
    this.playerSound("release", player, { weapon: "razorWire", intensity: 0.9 });
    if (player.id === this.state.activePlayerId && this.canMovePhase())
      this.state.message = "Razor wire cut your rope! Keep your momentum and find another anchor.";
    return true;
  }

  private cutRopes(center: Point, radius: number, immuneId?: string): void {
    for (const player of this.state.players) {
      if (!this.isPhysical(player) || player.id === immuneId || !ropeIntersectsCircle(player, center, radius)) continue;
      player.rope = null;
      this.playerSound("release", player, { intensity: 1 });
    }
  }

  private createHazard(x: number, y: number, definition: WeaponDefinition): void {
    const effect = definition.hazard!;
    const placement = projectHazard({ x, y }, effect.kind, effect.radius, this.state.platforms, this.state.waterY);
    if (!placement) return;
    const hazards = this.state.hazards ??= [];
    hazards.push({ id: this.id("hazard"), kind: effect.kind, ...placement,
      remainingTurns: effect.turns, createdTurn: this.state.turn, weapon: definition.id, hitPlayerIds: [] });
    if (hazards.length > MAX_HAZARDS) hazards.splice(0, hazards.length - MAX_HAZARDS);
  }

  /** Debuffs spend the victim's control time; presentation and other teams cannot exhaust them. */
  private updateEffects(realDt: number, dt: number): void {
    if (!this.canMove()) return;
    const player = this.state.players.find((p) => p.id === this.state.activePlayerId && this.isPhysical(p));
    if (!player) return;
    for (const status of player.statuses ?? []) {
      const elapsed = Math.min(status.remaining, realDt);
      status.remaining = Math.max(0, status.remaining - realDt);
      if (status.kind !== "burning" && status.kind !== "poisoned") continue;
      status.tick = (status.tick ?? 0) + elapsed;
      if (status.tick >= 1 - 1e-9) {
        status.tick = Math.max(0, status.tick - 1);
        this.recordDamage(player, status.kind === "burning" ? 3 : 2);
      }
    }
    player.statuses = (player.statuses ?? []).filter((status) => status.remaining > 1e-9);
    for (const hazard of this.state.hazards ?? []) {
      if (!hazardTouches(hazard, player)) continue;
      const origin = { x: hazard.x, y: hazard.y -
        (["gravity", "repulsor", "updraft"].includes(hazard.kind) ? 0 : 6) };
      const dx = player.x - origin.x, dy = player.y - origin.y;
      const distance = Math.hypot(dx, dy);
      if (distance > 1 && this.raycast(origin.x, origin.y, dx / distance, dy / distance,
        Math.max(0, distance - PLAYER_RADIUS))) continue;
      if (hazard.kind === "oil" || hazard.kind === "ice" || hazard.kind === "glue") {
        addStatus(player, hazard.kind === "glue" ? "sticky" : hazard.kind === "ice" ? "chilled" : "slippery",
          0.2, hazard.weapon);
      } else if (hazard.kind === "gravity" || hazard.kind === "repulsor" || hazard.kind === "updraft") {
        this.affect(player);
        const strength = Math.max(0.15, 1 - distance / (hazard.radius + PLAYER_RADIUS));
        if (hazard.kind === "updraft") player.vy -= 1850 * dt;
        else {
          const force = (hazard.kind === "gravity" ? -2100 : 2500) * strength * dt;
          player.vx += dx / Math.max(20, distance) * force;
          player.vy += dy / Math.max(20, distance) * force;
        }
        limitBodySpeed(player);
      } else if (!hazard.hitPlayerIds.includes(player.id)) {
        hazard.hitPlayerIds.push(player.id);
        if (hazard.kind === "wire") {
          this.recordDamage(player, 8);
          addStatus(player, "sticky", 0.7, hazard.weapon);
          this.playerSound("hurt", player, { weapon: hazard.weapon, intensity: 0.25 });
        } else if (hazard.kind === "fire" || hazard.kind === "poison") {
          addStatus(player, hazard.kind === "fire" ? "burning" : "poisoned",
            hazard.kind === "fire" ? 4 : 6, hazard.weapon);
        } else if (hazard.kind === "spring") {
          this.affect(player);
          applyImpulse(player, 100 * player.facing, -880, player.facing * 8);
          this.playerSound("bounce", player, { weapon: hazard.weapon, intensity: 0.8 });
        }
      }
    }
    this.cutWireRope(player);
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
    this.sound("splash", { x: player.x, y: this.state.waterY },
      { playerId: player.id, intensity: clamp(Math.hypot(player.vx, player.vy) / 1000, 0.5, 1) });
    this.recordDamage(player, Math.max(0, player.hp - (this.resolution().pendingDamage[player.id] ?? 0)));
    const resolution = this.resolution();
    this.affect(player);
    resolution.drownedPlayerIds.push(player.id);
    resolution.focus = { x: player.x, y: this.state.waterY - PLAYER_RADIUS };
    player.y = this.state.waterY - PLAYER_RADIUS;
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
        this.sound("victory", survivors[0] ?? { x: this.state.width / 2, y: this.state.height / 2 },
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
    const axis = (Number(input.right) - Number(input.left)) * (hasStatus(player, "inverted") ? -1 : 1);
    const slippery = hasStatus(player, "slippery") || hasStatus(player, "chilled");
    const sticky = hasStatus(player, "sticky");
    const chilled = hasStatus(player, "chilled");
    const walkSpeed = WALK_SPEED * (sticky ? 0.35 : chilled ? 0.58 : hasStatus(player, "heavy") ? 0.7 : 1);
    const imageTerrain = !!getMap(this.state.mapId).image;
    const surface = imageTerrain && player.vy >= 0 && !player.rope
      ? imageSurface(this.state.platforms, player.x, player.y + PLAYER_RADIUS) : null;
    const sliding = surface?.steep === true;
    const wasGrounded = player.grounded && !sliding;
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
        player.vx += direction * dy / distance * 850 * effort * dt * (sticky ? 0.4 : 1);
        player.vy -= direction * dx / distance * 850 * effort * dt * (sticky ? 0.4 : 1);
      } else if (wasGrounded) {
        const speed = player.vx * axis;
        // A motor can accelerate to walking pace or brake a launch, never erase it.
        if (speed < walkSpeed) {
          const acceleration = (player.tumble > 0 ? 520 : 1800) * (slippery ? 0.18 : sticky ? 0.5 : 1);
          player.vx += axis * Math.min(acceleration * dt, walkSpeed - speed);
        }
      } else player.vx += axis * (sliding ? 80 : player.tumble > 0 ? 240 : 520) * dt;
    }
    if (wasGrounded) {
      const rolling = player.tumble > 0 || Math.abs(player.vx) > WALK_SPEED + 10;
      player.vx *= Math.exp(-(slippery ? (this.canMovePhase() ? 0.12 : 1.8) : sticky ? 14 : rolling ? 0.9 : axis ? 0 : 10) * dt);
    } else player.vx *= Math.exp(-0.025 * dt);

    if (sliding) {
      // Gravity along the actual silhouette defeats uphill steering on steep rock.
      // A pointed summit deterministically sheds a frog to one side.
      player.vx += GRAVITY * surface.slope / (1 + surface.slope ** 2) * dt;
      player.grounded = false;
    }

    player.vy += GRAVITY * dt * (hasStatus(player, "heavy") ? 2.1 : hasStatus(player, "feather") ? 0.3 : 1);
    let reelSpeed = 0;
    if (player.rope && active) {
      const oldLength = player.rope.length;
      player.rope.length = clamp(
        player.rope.length + (Number(input.down) - Number(input.up)) * 205 * dt *
          (hasStatus(player, "inverted") ? -1 : 1) * (sticky ? 0.4 : 1),
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
    this.movePlayer(player, player.vx * dt, player.vy * dt, true,
      wasGrounded && player.vy >= 0 && player.tumble <= 0 && !player.rope && imageTerrain);

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
  private movePlayer(player: Player, dx: number, dy: number, physical = false, walkSlope = false): void {
    const steps = Math.max(
      1,
      Math.ceil(Math.max(Math.abs(dx), Math.abs(dy)) / 6),
    );
    let stepX = dx / steps;
    let stepY = dy / steps;
    let impactSound: { kind: "land" | "bounce"; speed: number } | undefined;
    const contact = (nx: number, ny: number, footY = player.y + PLAYER_RADIUS) => {
      const surface = ny < 0 && getMap(this.state.mapId).image
        ? imageSurface(this.state.platforms, player.x, footY) : null;
      if (surface?.steep) {
        const length = Math.hypot(surface.slope, 1);
        nx = surface.slope / length;
        ny = -1 / length;
      }
      if (physical) {
        const speed = -(player.vx * nx + player.vy * ny);
        const damage = surfaceImpact(player, nx, ny);
        if (hasStatus(player, "bouncy") && speed > 180) {
          const outgoing = player.vx * nx + player.vy * ny;
          const restitution = this.canMovePhase() ? 0.85 : 0.55;
          const extra = Math.max(0, speed * restitution - outgoing);
          player.vx += nx * extra;
          player.vy += ny * extra;
          player.grounded = false;
          player.tumble = Math.max(player.tumble, 0.5);
        }
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
      if (surface?.steep) player.grounded = false;
    };
    for (let step = 0; step < steps; step++) {
      let nextX = clamp(player.x + stepX, PLAYER_RADIUS, this.state.width - PLAYER_RADIUS);
      if (walkSlope && stepX) {
        // Step up pixel staircases, only with full headroom. Never climb real walls
        // or allow airborne/reeling/weapon-launched frogs to use this assistance.
        const free = (y: number) => !bodyTerrain(this.state.platforms, nextX, y, PLAYER_RADIUS).some((p) =>
          nextX + PLAYER_RADIUS > p.x && nextX - PLAYER_RADIUS < p.x + p.w &&
          y + PLAYER_RADIUS > p.y && y - PLAYER_RADIUS < p.y + p.h);
        if (!free(player.y)) {
          for (let rise = 1; rise <= 6; rise++) {
            if (!free(player.y - rise)) continue;
            if (imageSurface(this.state.platforms, nextX, player.y - rise + PLAYER_RADIUS)?.steep) break;
            // The entire upward sweep must be clear, not merely its endpoint.
            const ceiling = terrainIn(this.state.platforms, player.x - PLAYER_RADIUS,
              player.y - PLAYER_RADIUS - rise, player.x + PLAYER_RADIUS, player.y - PLAYER_RADIUS)
              .some((p) => player.x + PLAYER_RADIUS > p.x && player.x - PLAYER_RADIUS < p.x + p.w &&
                player.y - PLAYER_RADIUS > p.y && player.y - PLAYER_RADIUS - rise < p.y + p.h);
            if (!ceiling) player.y -= rise;
            break;
          }
        }
      }
      let hitX = 0;
      for (const platform of terrainIn(this.state.platforms, Math.min(player.x, nextX) - PLAYER_RADIUS,
        player.y - PLAYER_RADIUS, Math.max(player.x, nextX) + PLAYER_RADIUS, player.y + PLAYER_RADIUS)) {
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
      else if (nextX >= this.state.width - PLAYER_RADIUS && stepX > 0) hitX = -1;
      if (hitX) { contact(hitX, 0); stepX = 0; }
      player.x = nextX;

      let nextY = player.y + stepY;
      let hitY = 0;
      for (const platform of terrainIn(this.state.platforms, player.x - PLAYER_RADIUS,
        Math.min(player.y, nextY) - PLAYER_RADIUS, player.x + PLAYER_RADIUS, Math.max(player.y, nextY) + PLAYER_RADIUS)) {
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
      if (hitY) { contact(0, hitY, nextY + PLAYER_RADIUS); stepY = 0; }
      player.y = Math.max(-220, nextY);
      if (walkSlope && !hitY && stepY >= 0) {
        const foot = player.y + PLAYER_RADIUS;
        const floor = terrainIn(this.state.platforms, player.x - PLAYER_RADIUS, foot,
          player.x + PLAYER_RADIUS, foot + 6).filter((p) => p.y >= foot && p.y <= foot + 6 &&
            player.x + PLAYER_RADIUS > p.x && player.x - PLAYER_RADIUS < p.x + p.w)
          .sort((a, b) => a.y - b.y)[0];
        if (floor) { player.y = floor.y - PLAYER_RADIUS; contact(0, -1); stepY = 0; }
      }
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
    const rewards = collected.map(() => WEAPON_IDS[Math.floor(this.random() * WEAPON_IDS.length)]!);
    for (const weapon of rewards) {
      active.inventory[weapon] += WEAPON_CATALOG[weapon].ammo;
      this.playerSound("pickup", active, { weapon });
    }
    this.refreshTeamWeapons(active.teamId);
    const names = rewards.map((weapon) => WEAPON_CATALOG[weapon].name).join(", ");
    this.state.message = `${active.name} found ${names} for their team. Choose from your team's inventory, then fire!`;
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
      if (definition.cutsRopes) this.cutRopes({ x: player.x + direction.x * definition.range / 2,
        y: player.y + direction.y * definition.range / 2 }, definition.range, player.id);
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
        if (definition.status) addStatus(target, definition.status.kind, definition.status.duration, weapon);
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
      const center = clamp(input.aimX, 24, this.state.width - 24);
      for (let index = 0; index < definition.pellets; index++) {
        const offset = (index - (definition.pellets - 1) / 2) * definition.spread;
        this.state.projectiles.push({ id: this.id("shot"), ownerId: player.id,
          x: clamp(center + offset, 12, this.state.width - 12), y: -100 - index * 85,
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
    this.refreshTeamWeapons(player.teamId);
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
        const platform = bodyTerrain(this.state.platforms, projectile.x, projectile.y, bodyRadius).find((candidate) =>
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
        if (contact === "bounce" && (projectile.x < bodyRadius || projectile.x > this.state.width - bodyRadius)) {
          contactSpeed = Math.max(contactSpeed, Math.abs(projectile.vx));
          projectile.x = clamp(projectile.x, bodyRadius, this.state.width - bodyRadius);
          projectile.vx *= -definition.bounce;
        }
      }
      if (contactSpeed > 120) this.sound("bounce", projectile,
        { weapon: projectile.kind, intensity: clamp(contactSpeed / 1000, 0.15, 1) });
      const inWater = this.state.hasWater !== false && projectile.y >= this.state.waterY;
      if (inWater) this.sound("splash", projectile,
        { weapon: projectile.kind, intensity: 0.4 });
      if (inWater || projectile.y > this.state.height + 200 || projectile.x < -100 || projectile.x > this.state.width + 100 || projectile.y < -650) continue;
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
          mine.x = clamp(mine.x + mine.vx * dt / steps, 8, this.state.width - 8);
          mine.y += mine.vy * dt / steps;
          const platform = bodyTerrain(this.state.platforms, mine.x, mine.y, 8).find((p) => mine.x + 8 >= p.x && mine.x - 8 <= p.x + p.w && mine.y + 8 >= p.y && mine.y - 8 <= p.y + p.h);
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
      if (this.state.hasWater !== false && mine.y >= this.state.waterY) {
        this.sound("splash", mine, { weapon: mine.kind, intensity: 0.4 });
        return false;
      }
      if (mine.y > this.state.height + 200) return false;
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
    if (!deathBlast && definition.cutsRopes) this.cutRopes({ x, y }, radius, immunePlayerId);
    this.beginSettling();
    this.impactBeat({ x, y }, clamp(radius / 200 * impulseScale, 0.25, 1));
    this.sound("explosion", { x, y }, { ...(deathBlast ? {} : { weapon: definition.id }),
      intensity: clamp(radius / 180 * impulseScale, 0.2, 1) });
    this.state.explosions.push({ id: this.id("blast"), x, y, radius, age: 0,
      kind: definition.kind, ...(deathBlast ? {} : { weapon: definition.id }), color: definition.color,
      ...(direction ? { direction: Math.atan2(direction.y, direction.x) } : {}) });
    if (!deathBlast && definition.hazard) this.createHazard(x, y, definition);
    for (const player of this.state.players) {
      if (!this.isPhysical(player) || player.id === immunePlayerId) continue;
      const dx = player.x - x, dy = player.y - y;
      const distance = Math.hypot(dx, dy);
      if (distance > radius + PLAYER_RADIUS) continue;
      const force = Math.max(0, 1 - distance / (radius + PLAYER_RADIUS));
      const nx = distance > 1 ? dx / distance : 0;
      const ny = distance > 1 ? dy / distance : -1;
      const cover = this.raycast(x, y, nx, ny, Math.max(0, distance - PLAYER_RADIUS)) ? 0.4 : 1;
      if (!deathBlast && definition.status && cover === 1)
        addStatus(player, definition.status.kind, definition.status.duration, definition.id);
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
    player.statuses = [];
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
          Object.assign(player, frogSpawn(getMap(this.state.mapId), index, player.number - 1));
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
    if (this.state.mode === "practice") {
      for (const team of this.state.teams) Object.assign(team.inventory, createInventory("practice"));
    }
    this.state.players.forEach((player) => {
      this.selectAvailableWeapon(player);
      player.hasCrate = player.alive && player.weapon !== null;
      player.rope = null;
      this.inputs.set(player.id, blankInput(player.lookAt));
    });
    this.state.turn++;
    this.state.hazards = (this.state.hazards ?? []).filter((hazard) => {
      hazard.hitPlayerIds = [];
      return --hazard.remainingTurns > 0;
    });
    for (const mine of this.state.mines)
      if (mine.placedTurn === this.state.turn - 1)
        this.sound("mineArm", mine, { weapon: mine.kind });
    this.state.phase = "playing";
    this.state.timeLeft = this.state.mode === "practice" ? 90 : TURN_SECONDS;
    const active = this.state.players.find(
      (player) => player.id === this.state.activePlayerId,
    )!;
    this.playerSound("switch", active);
    this.state.message = `${active.name}'s turn. ${active.hasCrate ? "Choose a weapon from your team's inventory or collect more supplies." : "Find a mystery crate for your team."}`;
    this.spawnCrates();
  }

  private selectAvailableWeapon(player: Player): void {
    if (!player.alive) { player.weapon = null; return; }
    if (!player.weapon || player.inventory[player.weapon] <= 0) {
      player.weapon =
        WEAPON_IDS.find((weapon) => player.inventory[weapon] > 0) ?? null;
    }
  }

  private refreshTeamWeapons(teamId: string): void {
    for (const player of this.state.players) {
      if (player.teamId !== teamId) continue;
      this.selectAvailableWeapon(player);
      player.hasCrate = player.alive && player.weapon !== null;
    }
  }

  /** Exclude roofs, walls, submerged ledges, and covered pieces of a platform top. */
  private clearPlatformTop(platform: Platform, x: number, radius: number): boolean {
    const y = platform.y - radius;
    return !platform.boundary && y >= radius && x - radius >= platform.x &&
      x + radius <= platform.x + platform.w &&
      (this.state.hasWater === false || platform.y < this.state.waterY) &&
      !bodyTerrain(this.state.platforms, x, y, radius).some((other) => other !== platform &&
        x + radius > other.x && x - radius < other.x + other.w &&
        y + radius > other.y && y - radius < other.y + other.h);
  }

  private cratePoint(platform: Platform, preferredX = platform.x + platform.w / 2): Point | undefined {
    if (platform.w < 56) return;
    const x = clamp(preferredX, platform.x + 28, platform.x + platform.w - 28);
    if (this.clearPlatformTop(platform, x, PLAYER_RADIUS)) return { x, y: platform.y - PLAYER_RADIUS };
    for (let candidate = platform.x + 28; candidate <= platform.x + platform.w - 28; candidate += 48)
      if (this.clearPlatformTop(platform, candidate, PLAYER_RADIUS))
        return { x: candidate, y: platform.y - PLAYER_RADIUS };
  }

  private spawnCrates(): void {
    const map = getMap(this.state.mapId);
    if (map.supplySites) {
      this.state.crates = [];
      for (let offset = 0; offset < this.state.width; offset += map.width) {
        for (const point of map.supplySites) {
          const x = point.x + offset;
          if (this.state.crates.some((crate) => Math.hypot(crate.x - x, crate.y - point.y) < 200)) continue;
          this.state.crates.push({ id: this.id("crate"), x, y: point.y });
        }
      }
      return;
    }
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
    const platform = support ?? this.state.platforms.find((candidate) => this.cratePoint(candidate))!;
    if (!platform) { this.state.crates = []; return; }
    const direction = player.x > platform.x + platform.w / 2 ? -1 : 1;
    const nearX = clamp(
      player.x + direction * 110,
      platform.x + 28,
      platform.x + platform.w - 28,
    );
    const nearPoint = this.cratePoint(platform, nearX);
    this.state.crates = [
      ...(nearPoint ? [{ id: this.id("crate"), ...nearPoint }] : []),
      ...this.state.platforms.filter((p) => p.h < 100 ||
        p.appearance === "canopy" || p.appearance === "tortoise" || p.appearance === "crocodile").flatMap((p) => {
        const point = this.cratePoint(p);
        return point ? [{ id: this.id("crate"), ...point }] : [];
      }),
    ];
  }

  private seedMines(count: number): void {
    if (count === 0) return;
    const candidates: Point[] = [];
    const clearance = WEAPON_CATALOG.mine.range + PLAYER_RADIUS;
    const map = getMap(this.state.mapId);
    if (map.mineSites) {
      for (let offset = 0; offset < this.state.width; offset += map.width)
        for (const point of map.mineSites) {
          const x = point.x + offset;
          if (this.state.players.every((player) => Math.hypot(player.x - x, player.y - point.y) >= clearance))
            candidates.push({ x, y: point.y });
        }
    } else {
      for (const platform of this.state.platforms) {
        for (let x = platform.x + MINE_SPACING / 2; x <= platform.x + platform.w - MINE_SPACING / 2; x += MINE_SPACING) {
          const y = platform.y - MINE_RADIUS;
          if (!this.clearPlatformTop(platform, x, MINE_RADIUS) ||
            this.state.players.some((player) => Math.hypot(player.x - x, player.y - y) < clearance)) continue;
          candidates.push({ x, y });
        }
      }
    }
    // Shuffle a finite set: completely occupied ledges can reduce safe capacity,
    // but never cause an unbounded search or traps beneath starting frogs.
    for (let index = candidates.length - 1; index > 0; index--) {
      const other = Math.floor(this.random() * (index + 1));
      [candidates[index], candidates[other]] = [candidates[other]!, candidates[index]!];
    }
    for (const point of candidates) {
      if (this.state.mines.length >= count) break;
      if (this.state.mines.some((mine) => Math.hypot(mine.x - point.x, mine.y - point.y) < MINE_SPACING)) continue;
      this.state.mines.push({
        id: this.id("mine"), ownerId: "", ...point, vx: 0, vy: 0,
        kind: "mine", placedTurn: 0, fuse: null, settled: true,
      });
    }
  }

  private raycast(
    x: number,
    y: number,
    dx: number,
    dy: number,
    maxDistance: number,
  ): { x: number; y: number; distance: number } | null {
    let closest = maxDistance + 1;
    for (const platform of terrainIn(this.state.platforms, Math.min(x, x + dx * maxDistance),
      Math.min(y, y + dy * maxDistance), Math.max(x, x + dx * maxDistance), Math.max(y, y + dy * maxDistance))) {
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
