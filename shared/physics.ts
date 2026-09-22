import type { Player } from "./types.js";

export const GRAVITY = 1050;
export const MAX_BODY_SPEED = 1800;
export const WALK_SPEED = 245;
// A deliberate jump/backflip is safe; a long drop or a weapon-speed impact hurts.
export const HARD_IMPACT_SPEED = 790;
const RADIUS = 18;
const clamp = (value: number, low: number, high: number) => Math.max(low, Math.min(high, value));
export const wrapAngle = (angle: number): number => Math.atan2(Math.sin(angle), Math.cos(angle));

export function limitBodySpeed(player: Player): void {
  const speed = Math.hypot(player.vx, player.vy);
  if (speed > MAX_BODY_SPEED) {
    player.vx *= MAX_BODY_SPEED / speed;
    player.vy *= MAX_BODY_SPEED / speed;
  }
}

/** All weapon/body launches use the same state, including during client replay. */
export function applyImpulse(player: Player, vx: number, vy: number, spin?: number): void {
  if (!player.alive) return;
  player.vx += vx;
  player.vy += vy;
  limitBodySpeed(player);
  const strength = Math.hypot(vx, vy);
  player.angularVelocity = clamp(
    player.angularVelocity + (spin ?? (Math.sign(vx) || player.facing) * Math.min(15, strength / 70)),
    -24, 24,
  );
  player.tumble = Math.max(player.tumble, clamp(strength / 560, 0.4, 2.4));
  player.grounded = false;
  player.rope = null;
}

/** Contact normals point away from the solid. Constraint corrections never call this. */
export function surfaceImpact(player: Player, nx: number, ny: number): number {
  const speed = -(player.vx * nx + player.vy * ny);
  if (speed <= 0) return 0;
  const floor = ny < -0.5;
  const bouncing = speed > (floor && player.tumble <= 0 ? HARD_IMPACT_SPEED : 270);
  const restitution = bouncing ? (floor ? 0.42 : 0.64) : 0;
  player.vx += nx * speed * (1 + restitution);
  player.vy += ny * speed * (1 + restitution);
  if (speed > 120) player.impact = Math.max(player.impact, clamp(speed / 1000, 0, 1));
  if (speed > HARD_IMPACT_SPEED) {
    player.tumble = Math.max(player.tumble, 1.25);
  }
  if (bouncing) {
    // Ground scrubs a little energy into rolling. Wall/ceiling contacts kick spin.
    player.angularVelocity = clamp(
      player.angularVelocity * 0.65 + (floor ? player.vx / RADIUS * 0.35 : -nx * speed / 150 + player.vx * ny / 180),
      -24, 24,
    );
    player.tumble = Math.max(player.tumble, 0.65);
  }
  if (floor) {
    player.grounded = !bouncing;
    if (speed > 120 && player.tumble > 0) player.vx *= 0.94;
  }
  // The engine decides immunity and records this for the end-of-turn reveal.
  return speed > HARD_IMPACT_SPEED
    ? Math.min(75, Math.round((speed - HARD_IMPACT_SPEED) * 0.085 + 3)) : 0;
}

/** Damped physical attitude: track the flight arc, retain launched spin, then roll. */
export function updateBodyAttitude(player: Player, dt: number): void {
  player.impact *= Math.exp(-8 * dt);
  player.tumble = Math.max(0, player.tumble - dt);
  if (player.grounded && player.tumble > 0 && Math.abs(player.vx) > 45) {
    const rolling = clamp(player.vx / RADIUS, -24, 24);
    player.angularVelocity += (rolling - player.angularVelocity) * (1 - Math.exp(-12 * dt));
  } else {
    const direction = Math.abs(player.vx) > 40 ? Math.sign(player.vx) : player.facing;
    const target = player.grounded ? 0 : clamp(Math.atan2(player.vy, Math.abs(player.vx) + 180) * direction, -1.2, 1.2);
    const spinning = player.tumble > 0.35;
    const stiffness = spinning ? 4 : player.grounded ? 125 : 36;
    const damping = spinning ? 1.35 : player.grounded ? 18 : 9;
    player.angularVelocity += (wrapAngle(target - player.rotation) * stiffness - player.angularVelocity * damping) * dt;
  }
  player.rotation = wrapAngle(player.rotation + player.angularVelocity * dt);
}
