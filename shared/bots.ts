import { GameEngine, PLAYER_RADIUS } from "./game.js";
import { hazardTouches, projectHazard, ropeIntersectsCircle } from "./effects.js";
import type { ArenaHazard, GameState, Platform, Player, Point, StatusKind, WeaponId } from "./types.js";
import { WEAPONS, type WeaponDefinition } from "./weapons.js";

interface Shot {
  weapon: WeaponId;
  aim: Point;
  power: number;
  score: number;
}

const THINK_SECONDS = 0.55;
const MAX_TURN_SECONDS = 12;
const clamp = (value: number, low: number, high: number) => Math.max(low, Math.min(high, value));
const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);

/** Distance along a segment to a solid, including the projectile's body. */
function intersection(a: Point, b: Point, platform: Platform, radius = 0): number | null {
  let near = 0, far = 1;
  for (const [origin, delta, low, high] of [
    [a.x, b.x - a.x, platform.x - radius, platform.x + platform.w + radius],
    [a.y, b.y - a.y, platform.y - radius, platform.y + platform.h + radius],
  ]) {
    if (Math.abs(delta) < 1e-8) {
      if (origin < low || origin > high) return null;
    } else {
      const first = (low - origin) / delta, second = (high - origin) / delta;
      near = Math.max(near, Math.min(first, second));
      far = Math.min(far, Math.max(first, second));
      if (near > far) return null;
    }
  }
  return near;
}

function covered(state: GameState, a: Point, b: Point): boolean {
  const length = distance(a, b);
  if (length <= PLAYER_RADIUS) return false;
  const end = { x: a.x + (b.x - a.x) * (1 - PLAYER_RADIUS / length),
    y: a.y + (b.y - a.y) * (1 - PLAYER_RADIUS / length) };
  return state.platforms.some((platform) => {
    const hit = intersection(a, end, platform);
    return hit !== null && hit * length > 1;
  });
}

const STATUS_VALUE: Record<StatusKind, number> = {
  slippery: 12, sticky: 20, burning: 28, poisoned: 32, chilled: 22, confused: 16,
  dazzled: 15, pixelated: 15, inverted: 24, heavy: 18, feather: 16, bouncy: 18,
};

function statusScore(player: Player, weapon: WeaponDefinition): number {
  if (!weapon.status) return 0;
  const existing = player.statuses?.find((status) => status.kind === weapon.status!.kind)?.remaining ?? 0;
  // Refreshing an almost-full debuff should not crowd out a useful different shot.
  const extension = clamp((weapon.status.duration - existing) / weapon.status.duration, 0, 1);
  return STATUS_VALUE[weapon.status.kind] * extension;
}

function previewHazard(state: GameState, point: Point, weapon: WeaponDefinition): ArenaHazard | null {
  if (!weapon.hazard) return null;
  const placement = projectHazard(point, weapon.hazard.kind, weapon.hazard.radius, state.platforms, state.waterY);
  if (!placement) return null;
  return { id: "preview", ...placement, kind: weapon.hazard.kind,
    remainingTurns: weapon.hazard.turns, createdTurn: state.turn, weapon: weapon.id, hitPlayerIds: [] };
}

function blastScore(state: GameState, shooter: Player, point: Point, weapon: WeaponDefinition, immuneId?: string): number {
  let score = 0;
  const hazard = previewHazard(state, point, weapon);
  const hazardOrigin = hazard && { x: hazard.x,
    y: hazard.y - (["gravity", "repulsor", "updraft"].includes(hazard.kind) ? 0 : 6) };
  for (const player of state.players) {
    if (!player.alive || player.id === immuneId) continue;
    const separation = distance(player, point);
    let value = 0;
    if (separation <= weapon.radius + PLAYER_RADIUS) {
      const force = 1 - separation / (weapon.radius + PLAYER_RADIUS);
      const occluded = covered(state, point, player);
      const damage = weapon.damage * (0.28 + force * 0.72) * (occluded ? 0.4 : 1);
      value += Math.min(player.hp, damage) + force * weapon.impulse / 180;
      if (!occluded) value += statusScore(player, weapon);
    }
    if (hazard && hazardTouches(hazard, player) && !covered(state, hazardOrigin!, player)) {
      const force = clamp(1 - distance(player, hazard) / (hazard.radius + PLAYER_RADIUS), 0, 1);
      value += (weapon.hazard!.kind === "wire" ? 24 : 18) * (0.5 + force * 0.5);
    }
    if (weapon.cutsRopes && ropeIntersectsCircle(player, point, weapon.radius)) value += 20;
    score += value * (player.teamId === shooter.teamId ? -1.8 : 1);
  }
  return score;
}

/** A small, bounded trajectory preview. It never advances or mutates the game. */
function projectileScore(state: GameState, shooter: Player, weapon: WeaponDefinition,
  start: Point, initialVx: number, initialVy: number): number {
  let x = start.x, y = start.y, vx = initialVx, vy = initialVy;
  const radius = weapon.id === "anvil" ? 12 : weapon.id === "megaBomb" ? 9 : 5;
  const dt = 1 / 45;
  for (let time = 0; time < Math.min(weapon.life, 8); time += dt) {
    vy += weapon.gravity * dt;
    const previous = { x, y }, next = { x: x + vx * dt, y: y + vy * dt };
    let first = 2;
    let solid: Platform | null = null;
    for (const platform of state.platforms) {
      const hit = intersection(previous, next, platform, radius);
      if (hit !== null && hit < first) { first = hit; solid = platform; }
    }
    let hitFrog = false;
    const dx = next.x - x, dy = next.y - y, lengthSquared = dx * dx + dy * dy;
    for (const player of state.players) {
      if (!player.alive || player.id === shooter.id) continue;
      const t = clamp(((player.x - x) * dx + (player.y - y) * dy) / Math.max(1, lengthSquared), 0, 1);
      if (t < first && Math.hypot(player.x - x - dx * t, player.y - y - dy * t) <= PLAYER_RADIUS + radius) {
        first = t; hitFrog = true;
      }
    }
    x = previous.x + dx * Math.min(1, first);
    y = previous.y + dy * Math.min(1, first);
    if (hitFrog || (solid && weapon.contact !== "bounce"))
      return blastScore(state, shooter, { x, y }, weapon);
    if (solid) {
      if (previous.y + radius <= solid.y + 0.1) {
        y = solid.y - radius - 0.1;
        vy = Math.abs(vy) < 35 ? 0 : -Math.abs(vy) * weapon.bounce;
        vx *= weapon.bounce > 0.85 ? 0.98 : 0.82;
      } else if (previous.y - radius >= solid.y + solid.h - 0.1) {
        y = solid.y + solid.h + radius + 0.1;
        vy = Math.abs(vy) * weapon.bounce;
      } else {
        x = previous.x < solid.x ? solid.x - radius - 0.1 : solid.x + solid.w + radius + 0.1;
        vx *= -weapon.bounce;
      }
    }
    if (y >= state.waterY || y < -650 || x < -100 || x > state.width + 100) return 0;
  }
  return blastScore(state, shooter, { x, y }, weapon);
}

function chooseShot(state: GameState, shooter: Player, enemies: Player[]): Shot | null {
  let best: Shot | null = null;
  const consider = (weapon: WeaponDefinition, aim: Point, power: number, score: number) => {
    if (score > (best?.score ?? 5)) best = { weapon: weapon.id, aim, power, score };
  };
  // Keep planning work bounded as room populations grow.
  const targets = enemies.slice(0, 4);
  for (const weapon of WEAPONS) {
    if (shooter.inventory[weapon.id] <= 0 || weapon.attack === "mine" || weapon.id === "boomerang") continue;
    for (const target of targets) {
      const dx = target.x - shooter.x, dy = target.y - shooter.y, length = Math.hypot(dx, dy);
      if (length < 1) continue;
      if (weapon.attack === "melee") {
        if (length > weapon.range + PLAYER_RADIUS || covered(state, shooter, target)) continue;
        let score = 0;
        for (const player of state.players) {
          const px = player.x - shooter.x, py = player.y - shooter.y, separation = Math.hypot(px, py);
          if (!player.alive || player.id === shooter.id || separation > weapon.range + PLAYER_RADIUS ||
            (px * dx + py * dy) / Math.max(1, separation * length) < 0.5 || covered(state, shooter, player)) continue;
          score += (weapon.damage + weapon.impulse / 180 + statusScore(player, weapon) +
            (weapon.cutsRopes && player.rope ? 20 : 0)) * (player.teamId === shooter.teamId ? -1.8 : 1);
        }
        consider(weapon, target, 1, score);
      } else if (weapon.attack === "blast") {
        if (length > weapon.range + weapon.radius) continue;
        const point = { x: shooter.x + dx / length * weapon.range, y: shooter.y + dy / length * weapon.range };
        if (!covered(state, shooter, point)) {
          consider(weapon, target, 1, blastScore(state, shooter, point, weapon, shooter.id));
        }
      } else if (weapon.attack === "airstrike") {
        // Adjacent open columns can reach a frog sheltered directly underneath a roof.
        for (const offset of [0, -0.5, 0.5, -0.65, 0.65, -0.9, 0.9]) {
          const center = clamp(target.x + offset * weapon.radius, 24, state.width - 24);
          let score = 0;
          for (let pellet = 0; pellet < weapon.pellets; pellet++) {
            score += projectileScore(state, shooter, weapon,
              { x: clamp(center + (pellet - (weapon.pellets - 1) / 2) * weapon.spread, 12, state.width - 12),
                y: -100 - pellet * 85 }, weapon.id === "airstrike" ? 38 : 0, weapon.speed);
          }
          consider(weapon, { x: center, y: target.y }, 1, score * 0.85);
        }
      } else {
        for (const power of weapon.gravity === 0 ? [1] : [1, 0.65]) {
          const speed = weapon.speed * power;
          const angles: number[] = [];
          if (weapon.gravity === 0 || Math.abs(dx) < 1) angles.push(Math.atan2(dy, dx));
          else {
            const g = weapon.gravity;
            const discriminant = speed ** 4 - g * (g * dx * dx - 2 * dy * speed * speed);
            if (discriminant >= 0) {
              for (const sign of [-1, 1]) {
                const tangent = (-speed * speed + sign * Math.sqrt(discriminant)) / (g * Math.abs(dx));
                const angle = Math.atan(tangent);
                angles.push(dx > 0 ? angle : Math.PI - angle);
              }
            }
          }
          for (const angle of angles) {
            const vx = Math.cos(angle), vy = Math.sin(angle);
            const score = projectileScore(state, shooter, weapon, shooter,
              vx * speed + shooter.vx * 0.35, vy * speed + shooter.vy * 0.35);
            // The center pellet is a conservative estimate for spread weapons.
            consider(weapon, { x: shooter.x + vx * 1000, y: shooter.y + vy * 1000 }, power, score);
          }
        }
      }
    }
  }
  return best;
}

/** Drives only explicitly marked, connected bot teams through ordinary player commands. */
export class BotController {
  private game: GameEngine | null = null;
  private turn = -1;
  private playerId = "";
  private elapsed = 0;
  private nextThink = 0;
  private nextJump = 0;
  private support: Platform | null = null;

  reset(): void {
    this.game = null;
    this.turn = -1;
    this.playerId = "";
    this.elapsed = this.nextThink = this.nextJump = 0;
    this.support = null;
  }

  update(game: GameEngine, dt: number): void {
    if (!Number.isFinite(dt) || dt <= 0) return;
    const state = game.state;
    if (state.phase !== "playing" && state.phase !== "retreat") return;
    const team = state.teams.find((candidate) => candidate.id === state.activeTeamId);
    if (!team?.bot || !team.connected) return;
    const player = state.players.find((candidate) => candidate.id === state.activePlayerId);
    if (!player?.alive) return;
    if (game !== this.game || state.turn !== this.turn || player.id !== this.playerId) {
      this.reset();
      this.game = game;
      this.turn = state.turn;
      this.playerId = player.id;
      this.nextThink = 0.6;
      this.nextJump = 1.5;
    }
    this.elapsed += Math.min(dt, 0.25);
    const enemies = state.players.filter((candidate) => candidate.alive && candidate.teamId !== player.teamId)
      .sort((a, b) => distance(a, player) - distance(b, player));
    const target = enemies[0];
    if (!target) { game.command(player.id, { type: "endTurn" }); return; }
    if (player.grounded) this.support = state.platforms.find((platform) =>
      Math.abs(player.y + PLAYER_RADIUS - platform.y) < 4 &&
      player.x + PLAYER_RADIUS >= platform.x && player.x - PLAYER_RADIUS <= platform.x + platform.w) ?? null;

    const aim = state.phase === "retreat" ? player.lookAt : target;
    const hasAmmo = WEAPONS.some((weapon) => team.inventory[weapon.id] > 0);
    let direction = 0;
    if (state.phase === "playing" && this.elapsed >= this.nextThink) {
      this.nextThink = this.elapsed + THINK_SECONDS;
      if (hasAmmo) {
        const shot = chooseShot(state, player, enemies);
        if (shot) {
          game.setInput(player.id, { left: false, right: false, up: false, down: false,
            aimX: shot.aim.x, aimY: shot.aim.y });
          if (game.command(player.id, { type: "selectWeapon", weapon: shot.weapon }) &&
            game.command(player.id, { type: "fire", power: shot.power })) return;
        }
      }
      if (this.elapsed >= MAX_TURN_SECONDS) {
        game.command(player.id, { type: "endTurn" });
        return;
      }
    }
    if (this.support) {
      const safeLeft = this.support.x + PLAYER_RADIUS + 20;
      const safeRight = this.support.x + this.support.w - PLAYER_RADIUS - 20;
      let goalX = target.x;
      if (state.phase === "retreat") {
        const threat = state.projectiles.filter((projectile) => distance(projectile, player) < 240)
          .sort((a, b) => distance(a, player) - distance(b, player))[0];
        goalX = threat ? player.x + (player.x >= threat.x ? 100 : -100) : player.x;
      } else {
        const crate = state.crates.filter((candidate) => Math.abs(candidate.y + PLAYER_RADIUS - this.support!.y) < 4 &&
          candidate.x >= safeLeft && candidate.x <= safeRight)
          .sort((a, b) => distance(a, player) - distance(b, player))[0];
        if (crate && (!hasAmmo || this.elapsed > 2)) goalX = crate.x;
      }
      const difference = clamp(goalX, safeLeft, safeRight) - player.x;
      if (Math.abs(difference) > 12) direction = Math.sign(difference);
      // Do not walk off a ledge while retreating or searching for another angle.
      if ((direction < 0 && player.x < safeLeft) || (direction > 0 && player.x > safeRight)) direction = 0;
      const landingX = player.x + player.vx * 0.45;
      if (!player.grounded && ((player.vx < 0 && landingX < safeLeft) ||
        (player.vx > 0 && landingX > safeRight))) direction = -Math.sign(player.vx);
    }
    game.setInput(player.id, { left: direction < 0, right: direction > 0, up: false, down: false,
      aimX: aim.x, aimY: aim.y });
    const landingX = player.x + player.vx;
    const safeJump = this.support && landingX > this.support.x + PLAYER_RADIUS + 25 &&
      landingX < this.support.x + this.support.w - PLAYER_RADIUS - 25;
    if (state.phase === "playing" && player.grounded && safeJump && this.elapsed >= this.nextJump) {
      this.nextJump = this.elapsed + 2;
      game.command(player.id, { type: "jump" });
    }
  }
}
