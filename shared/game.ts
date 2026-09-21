import type {
  GameCommand,
  GameOptions,
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

export type * from "./types.js";

export const WIDTH = 4320;
export const HEIGHT = 1800;
export const WATER_Y = 1730;
export const PLAYER_RADIUS = 18;
export const FIXED_STEP = 1 / 120;
export const GRAPPLE_RANGE = 680;
export const TURN_SECONDS = 45;
export const RETREAT_SECONDS = 10;
export const DOUBLE_JUMP_SECONDS = 0.32;

const GRAVITY = 1050;
const MAX_SPEED = 1100;
// A normal jump can land on a frog; a longer fall becomes a stomp.
const STOMP_SPEED = 560;
const COLORS = ["#9fe870", "#ffb86b", "#b9a2ff", "#71dce4"];
const WEAPONS: WeaponId[] = ["rocket", "grenade", "pulse"];
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
          tumble: 0,
          inventory: { rocket: 0, grenade: 0, pulse: 0 },
          weapon: null,
          hasCrate: false,
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
      explosions: [],
      activePlayerId: firstFrog.id,
      activeTeamId: firstTeam.id,
      phase: "playing",
      turn: 1,
      timeLeft: options.mode === "practice" ? 90 : TURN_SECONDS,
      mode: options.mode ?? "versus",
      winnerId: null,
      message: "Grab a crate. Make your shot. Get out of the way.",
    };
    players.forEach((player) => this.inputs.set(player.id, blankInput(player.lookAt)));
    if (firstTeam.connected) this.lastFrog.set(firstTeam.id, firstFrog.id);
    this.spawnCrates();
    if (!firstTeam.connected) this.beginSettling();
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
        player.grounded = false;
        return true;
      case "backflip":
        if (!this.jump || this.jump.id !== id || player.grounded ||
          this.elapsed - this.jump.at > DOUBLE_JUMP_SECONDS) return false;
        player.vy = -760;
        player.vx = -this.jump.facing * 310;
        player.rope = null;
        this.jump = null;
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
        return true;
      }
      case "release": {
        const wasAttached = player.rope !== null;
        player.rope = null;
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
          !WEAPONS.includes(command.weapon) ||
          player.inventory[command.weapon] <= 0
        )
          return false;
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

  private canMovePhase(): boolean {
    return this.state.phase === "playing" || this.state.phase === "retreat";
  }

  private tick(dt: number): void {
    this.elapsed += dt;
    this.state.explosions.forEach((explosion) => {
      explosion.age += dt;
    });
    this.state.explosions = this.state.explosions.filter(
      (explosion) => explosion.age < 0.55,
    );
    if (this.state.phase === "finished") return;

    for (const player of this.state.players) {
      if (!player.alive) continue;
      const isActive =
        player.id === this.state.activePlayerId && this.canMove();
      this.updatePlayer(
        player,
        isActive ? (this.inputs.get(player.id) ?? blankInput()) : blankInput(),
        dt,
        isActive,
      );
    }
    this.resolvePlayerContacts();
    for (const player of this.state.players) {
      if (!player.alive) continue;
      // Contact separation wins if another body blocks a taut rope.
      if (player.rope) {
        if (updateRopePath(player.rope, player, this.state.platforms))
          player.rope.length = Math.max(player.rope.length, ropePathLength(player.rope, player));
        else player.rope = null;
      }
      if (player.y + PLAYER_RADIUS >= WATER_Y) this.kill(player);
    }
    this.updateProjectiles(dt);
    this.pickUpCrates();

    if (this.state.mode === "versus") {
      const survivors = this.state.players.filter((player) => player.alive);
      const survivingTeams = new Set(survivors.map((player) => player.teamId));
      if (survivingTeams.size <= 1) {
        // A killing blast can launch the apparent winner into the water, too.
        // Finish only after the surviving body and all shots have settled.
        if (this.state.phase !== "settling") this.beginSettling();
        const survivor = this.state.teams.find((team) => survivingTeams.has(team.id));
        if (
          !survivor ||
          (this.state.projectiles.length === 0 &&
            survivors.every((player) => player.grounded && Math.hypot(player.vx, player.vy) < 42))
        ) {
          this.state.phase = "finished";
          this.state.winnerId = survivor?.id ?? null;
          this.state.timeLeft = 0;
          this.state.message = survivor
            ? `${survivor.name} wins the rebate!`
            : "Everyone took the plunge. Draw!";
        }
        return;
      }
    }

    if (this.state.phase === "waiting") {
      if (this.state.teams.some((team) => team.connected &&
        this.state.players.some((player) => player.teamId === team.id && player.alive)))
        this.nextTurn();
      return;
    }

    const active = this.state.players.find(
      (player) => player.id === this.state.activePlayerId,
    );
    if (!active?.alive && this.state.phase !== "settling") this.beginSettling();
    if (this.state.phase === "settling") {
      this.settlingTime += dt;
      const moving = this.state.players.some(
        (player) => player.alive && Math.hypot(player.vx, player.vy) > 42,
      );
      if (
        this.state.projectiles.length === 0 &&
        (!moving || this.settlingTime > 2.5)
      )
        this.nextTurn();
      return;
    }

    if (this.state.mode === "practice" && this.state.phase === "playing")
      return;
    this.state.timeLeft = Math.max(0, this.state.timeLeft - dt);
    if (this.state.timeLeft <= 0) this.beginSettling();
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
      const acceleration = player.rope ? 990 : wasGrounded ? 1800 : 520;
      player.vx += axis * acceleration * dt;
      if (wasGrounded && !player.rope && player.tumble <= 0) player.vx = clamp(player.vx, -245, 245);
    } else if (wasGrounded) player.vx *= Math.exp(-(player.tumble > 0 ? 1.3 : 10) * dt);
    else player.vx *= Math.exp(-0.1 * dt);

    player.vy += GRAVITY * dt;
    if (player.rope && active) {
      player.rope.length = clamp(
        player.rope.length + (Number(input.down) - Number(input.up)) * 205 * dt,
        42,
        GRAPPLE_RANGE,
      );
    }
    player.vx = clamp(player.vx, -MAX_SPEED, MAX_SPEED);
    player.vy = clamp(player.vy, -MAX_SPEED, MAX_SPEED);
    player.grounded = false;
    this.movePlayer(player, player.vx * dt, player.vy * dt);

    if (player.tumble > 0) {
      player.tumble = Math.max(0, player.tumble - dt);
      const angle = player.rotation + player.vx * dt / PLAYER_RADIUS;
      player.rotation = Math.atan2(Math.sin(angle), Math.cos(angle));
    } else player.rotation *= Math.exp(-14 * dt);
    this.constrainRope(player);
  }

  private constrainRope(player: Player): void {
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
      if (distance <= freeLength + 0.001) break;
      const nx = dx / distance;
      const ny = dy / distance;
      const previousY = player.y;
      this.movePlayer(player, -nx * (distance - freeLength), -ny * (distance - freeLength));
      if (player.y < previousY - 0.01) player.grounded = false;
      const radialVelocity = player.vx * nx + player.vy * ny;
      if (radialVelocity > 0) {
        player.vx -= nx * radialVelocity;
        player.vy -= ny * radialVelocity;
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
    const players = this.state.players.filter((p) => p.alive);
    for (let iteration = 0; iteration < 8; iteration++) {
      for (let i = 0; i < players.length; i++) {
        for (let j = i + 1; j < players.length; j++) {
          const a = players[i];
          const b = players[j];
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
            const impulse = -closing * 0.54;
            a.vx -= impulse * nx;
            a.vy -= impulse * ny;
            b.vx += impulse * nx;
            b.vy += impulse * ny;
            if (Math.abs(ny) > 0.55 && closing < -STOMP_SPEED) {
              const upper = ny > 0 ? a : b;
              const lower = ny > 0 ? b : a;
              const direction = Math.sign(lower.x - upper.x) || Math.sign(upper.vx) || 1;
              lower.vx += direction * Math.min(570, -closing * 0.7);
              lower.vy = Math.min(lower.vy, -Math.min(260, -closing * 0.28));
              upper.vy = Math.min(upper.vy, -Math.min(210, -closing * 0.22));
              lower.grounded = false;
              upper.grounded = false;
              lower.tumble = 1.8;
              lower.rope = null;
            } else if (Math.abs(ny) < 0.55 && closing < -260) {
              a.tumble = b.tumble = 1.1;
            }
          }
          if (ny > 0.55 && a.vy >= b.vy && b.grounded) {
            a.grounded = true;
            a.vy = b.vy;
          } else if (ny < -0.55 && b.vy >= a.vy && a.grounded) {
            b.grounded = true;
            b.vy = a.vy;
          }
        }
      }
    }
  }

  /** Small swept axis moves keep fast launches from crossing thin platforms. */
  private movePlayer(player: Player, dx: number, dy: number): void {
    const steps = Math.max(
      1,
      Math.ceil(Math.max(Math.abs(dx), Math.abs(dy)) / 6),
    );
    const stepX = dx / steps;
    const stepY = dy / steps;
    for (let step = 0; step < steps; step++) {
      let nextX = clamp(player.x + stepX, PLAYER_RADIUS, WIDTH - PLAYER_RADIUS);
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
          player.vx = 0;
        } else if (
          stepX < 0 &&
          player.x - PLAYER_RADIUS >= platform.x + platform.w - 0.1 &&
          nextX - PLAYER_RADIUS <= platform.x + platform.w
        ) {
          nextX = Math.max(nextX, platform.x + platform.w + PLAYER_RADIUS);
          player.vx = 0;
        }
      }
      if (nextX <= PLAYER_RADIUS || nextX >= WIDTH - PLAYER_RADIUS)
        player.vx = 0;
      player.x = nextX;

      let nextY = player.y + stepY;
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
          player.vy = 0;
          player.grounded = true;
        } else if (
          stepY < 0 &&
          player.y - PLAYER_RADIUS >= platform.y + platform.h - 0.1 &&
          nextY - PLAYER_RADIUS <= platform.y + platform.h
        ) {
          nextY = Math.max(nextY, platform.y + platform.h + PLAYER_RADIUS);
          player.vy = Math.max(0, player.vy);
        }
      }
      player.y = Math.max(-220, nextY);
    }
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
    for (const crate of collected) active.inventory[crate.weapon]++;
    this.selectAvailableWeapon(active);
    active.hasCrate = true;
    this.state.message = `${active.name} added ${collected.length === 1 ? `a ${collected[0]!.weapon}` : `${collected.length} rounds`} to their pack. Aim, fire, then retreat!`;
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
    const power = clamp(finite(requestedPower, 1), 0.2, 1);
    if (weapon === "pulse") {
      this.explode(
        player.x + direction.x * 92,
        player.y + direction.y * 92,
        108,
        44,
        player.id,
      );
    } else {
      const speed = weapon === "rocket" ? 800 * power : 630 * power;
      // Start at the shooter's center and ignore only the shooter. This catches
      // point-blank enemies and walls instead of teleporting a muzzle past them.
      this.state.projectiles.push({
        id: this.id("shot"),
        ownerId: player.id,
        x: player.x,
        y: player.y,
        vx: direction.x * speed + player.vx * 0.25,
        vy: direction.y * speed + player.vy * 0.25,
        kind: weapon,
        life: weapon === "rocket" ? 5 : 2.1,
        radius: weapon === "rocket" ? 94 : 126,
        damage: weapon === "rocket" ? 66 : 78,
      });
    }
    player.inventory[weapon]--;
    this.selectAvailableWeapon(player);
    player.hasCrate = false;
    this.state.phase = "retreat";
    this.state.timeLeft = RETREAT_SECONDS;
    this.state.message = "Shot sent! Ten seconds to find cover.";
    return true;
  }

  private updateProjectiles(dt: number): void {
    const remaining: Projectile[] = [];
    for (const projectile of this.state.projectiles) {
      projectile.life -= dt;
      if (projectile.kind === "grenade") projectile.vy += GRAVITY * dt;
      const distance = Math.hypot(projectile.vx, projectile.vy) * dt;
      const steps = Math.max(1, Math.ceil(distance / 4));
      let detonate = false;
      for (let step = 0; step < steps && !detonate; step++) {
        const prevX = projectile.x;
        const prevY = projectile.y;
        projectile.x += (projectile.vx * dt) / steps;
        projectile.y += (projectile.vy * dt) / steps;
        const hitPlayer = this.state.players.some(
          (player) =>
            player.alive &&
            player.id !== projectile.ownerId &&
            Math.hypot(player.x - projectile.x, player.y - projectile.y) <=
              PLAYER_RADIUS + 5,
        );
        if (hitPlayer) {
          detonate = true;
          break;
        }
        const platform = this.state.platforms.find(
          (candidate) =>
            projectile.x + 5 >= candidate.x &&
            projectile.x - 5 <= candidate.x + candidate.w &&
            projectile.y + 5 >= candidate.y &&
            projectile.y - 5 <= candidate.y + candidate.h,
        );
        if (platform) {
          if (projectile.kind === "rocket") {
            detonate = true;
            break;
          }
          if (prevY + 5 <= platform.y) {
            projectile.y = platform.y - 5.1;
            projectile.vy = -Math.abs(projectile.vy) * 0.54;
            projectile.vx *= 0.78;
          } else if (prevY - 5 >= platform.y + platform.h) {
            projectile.y = platform.y + platform.h + 5.1;
            projectile.vy = Math.abs(projectile.vy) * 0.54;
          } else {
            projectile.x =
              prevX < platform.x
                ? platform.x - 5.1
                : platform.x + platform.w + 5.1;
            projectile.vx *= -0.54;
          }
        }
      }
      if (
        projectile.y >= WATER_Y ||
        projectile.x < -100 ||
        projectile.x > WIDTH + 100 ||
        projectile.y < -500
      )
        continue;
      if (detonate || projectile.life <= 0)
        this.explode(
          projectile.x,
          projectile.y,
          projectile.radius,
          projectile.damage,
        );
      else remaining.push(projectile);
    }
    this.state.projectiles = remaining;
  }

  private explode(
    x: number,
    y: number,
    radius: number,
    damage: number,
    immunePlayerId?: string,
  ): void {
    this.state.explosions.push({ id: this.id("blast"), x, y, radius, age: 0 });
    for (const player of this.state.players) {
      if (!player.alive || player.id === immunePlayerId) continue;
      const dx = player.x - x;
      const dy = player.y - y;
      const distance = Math.hypot(dx, dy);
      if (distance > radius + PLAYER_RADIUS) continue;
      const force = Math.max(0, 1 - distance / (radius + PLAYER_RADIUS));
      player.hp = Math.max(
        0,
        player.hp - Math.round(damage * (0.28 + force * 0.72)),
      );
      const length = Math.max(distance, 1);
      player.vx += (dx / length) * (220 + force * 620);
      player.vy += (dy / length) * (180 + force * 520) - 160;
      player.grounded = false;
      player.rope = null;
      if (player.hp <= 0) this.kill(player);
    }
  }

  private kill(player: Player): void {
    player.alive = false;
    player.hp = 0;
    player.rope = null;
    player.weapon = null;
    player.hasCrate = false;
    player.vx = 0;
    player.vy = 0;
    this.state.message = `${player.name} is out!`;
  }

  private beginSettling(): void {
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
    if (this.state.mode === "practice") {
      this.state.players.forEach((player) => {
        if (!player.alive) {
          const index = this.state.teams.findIndex((team) => team.id === player.teamId);
          Object.assign(player, frogSpawn(index, player.number - 1));
          player.rotation = 0;
          player.tumble = 0;
          player.vx = 0;
          player.vy = 0;
          player.hp = player.maxHp;
          player.alive = true;
          player.grounded = true;
          player.lookAt = { x: player.x + 200, y: player.y - 220 };
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
      this.selectAvailableWeapon(player);
      player.hasCrate = player.alive && player.weapon !== null;
      player.rope = null;
      this.inputs.set(player.id, blankInput(player.lookAt));
    });
    this.state.turn++;
    this.state.phase = "playing";
    this.state.timeLeft = this.state.mode === "practice" ? 90 : TURN_SECONDS;
    const active = this.state.players.find(
      (player) => player.id === this.state.activePlayerId,
    )!;
    this.state.message = `${active.name}'s turn. ${active.hasCrate ? "Use your saved ammo or collect more supplies." : "Find a supply crate."}`;
    this.spawnCrates();
  }

  private selectAvailableWeapon(player: Player): void {
    if (!player.weapon || player.inventory[player.weapon] <= 0) {
      player.weapon =
        WEAPONS.find((weapon) => player.inventory[weapon] > 0) ?? null;
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
        weapon:
          this.state.turn === 1
            ? "rocket"
            : WEAPONS[Math.floor(this.random() * WEAPONS.length)]!,
      },
      ...this.state.platforms.filter((p) => p.h < 100).map((p, index) => ({
        id: this.id("crate"),
        x: p.x + p.w / 2,
        y: p.y - PLAYER_RADIUS,
        weapon: WEAPONS[(index + 1) % WEAPONS.length]!,
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
