import type { Player, Point } from "../shared/types";

const clamp = (n: number, min: number, max: number) =>
  Math.max(min, Math.min(max, n));
const rotate = (point: Point, angle: number): Point => ({
  x: point.x * Math.cos(angle) - point.y * Math.sin(angle),
  y: point.x * Math.sin(angle) + point.y * Math.cos(angle),
});

export interface LegPose {
  hip: Point;
  knee: Point;
  foot: Point;
}

/** Two-bone IK, with a fixed bend side and reachable ankle target. */
export function solveLeg(hip: Point, target: Point, bend: -1 | 1): LegPose {
  const thigh = 17, shin = 16;
  const dx = target.x - hip.x;
  const dy = target.y - hip.y;
  const distance = Math.hypot(dx, dy);
  const reach = clamp(distance, Math.abs(thigh - shin) + 0.001, thigh + shin - 0.001);
  const ux = distance > 0 ? dx / distance : 0;
  const uy = distance > 0 ? dy / distance : 1;
  const along = (thigh * thigh - shin * shin + reach * reach) / (2 * reach);
  const across = Math.sqrt(Math.max(0, thigh * thigh - along * along));
  return {
    hip,
    knee: {
      x: hip.x + ux * along + uy * across * bend,
      y: hip.y + uy * along - ux * across * bend,
    },
    foot: { x: hip.x + ux * reach, y: hip.y + uy * reach },
  };
}

export function frogPose(
  player: Player,
  players: Player[],
  aim: Point = player.lookAt,
) {
  const rotation = (player.grounded && player.tumble <= 0 ? clamp(player.vx / 1300, -0.2, 0.2) : 0) + player.rotation;
  const direction = rotate({ x: aim.x - player.x, y: aim.y - player.y }, -rotation);
  const length = Math.hypot(direction.x, direction.y) || 1;
  const alarmed = Math.hypot(player.vx, player.vy) > 680 || player.impact > 0.3 || players.some(
    (other) => other.teamId !== player.teamId && other.alive &&
      Math.hypot(other.x - player.x, other.y - player.y) < 160,
  );
  const legs = ([-1, 1] as const).map((side) => {
    let foot: Point;
    if (player.grounded && player.tumble <= 0) {
      // During stance, world x stays fixed as the body passes over the foot.
      // The opposite foot lifts and swings forward for the remaining 35%.
      const stride = 42;
      const phase = ((player.x / stride + (side === 1 ? 0.5 : 0)) % 1 + 1) % 1;
      const swing = clamp((phase - 0.65) / 0.35, 0, 1);
      const smooth = swing * swing * (3 - 2 * swing);
      const stepX = phase < 0.65
        ? stride * (0.5 - phase)
        : stride * (-0.15 + 0.65 * smooth);
      const walking = clamp(Math.abs(player.vx) / 120, 0, 1);
      foot = rotate({
        x: side * 19 + stepX * walking,
        y: 15 - Math.sin(swing * Math.PI) * 11 * walking,
      }, -rotation);
    } else {
      // Air drag puts the feet behind travel in WORLD space, including dives.
      // They tuck at the apex and trail upward when the body falls downward.
      const speed = Math.hypot(player.vx, player.vy);
      const extension = clamp(speed / 650, 0, 1);
      foot = rotate({
        x: side * (15 + extension * 4) - clamp(player.vx * 0.047, -28, 28),
        y: 9 - clamp(player.vy * 0.055, -26, 27),
      }, -rotation);
    }
    return solveLeg({ x: side * 13, y: 4 }, foot, side);
  });
  return {
    rotation,
    alarmed,
    legs,
    eyes: { x: direction.x / length * 2.8, y: direction.y / length * 2.8 },
  };
}

/** Cosmetic spring feet. No animation memory enters the authoritative state. */
export class FrogAnimator {
  private feet = new Map<string, { x: number; y: number; time: number; points: (Point & { vx: number; vy: number })[] }>();

  pose(player: Player, players: Player[], aim: Point | undefined, time: number) {
    const pose = frogPose(player, players, aim);
    const targets = pose.legs.map((leg) => rotate(leg.foot, pose.rotation));
    let previous = this.feet.get(player.id);
    if (!previous || time - previous.time > 0.2 || time < previous.time ||
      Math.hypot(player.x - previous.x, player.y - previous.y) > 160) {
      previous = { x: player.x, y: player.y, time, points: targets.map((p) => ({ ...p, vx: 0, vy: 0 })) };
      this.feet.set(player.id, previous);
    }
    const dt = clamp(time - previous.time, 0, 0.05);
    const steps = Math.max(1, Math.ceil(dt / (1 / 120)));
    const step = dt / steps;
    pose.legs = pose.legs.map((leg, i) => {
      const foot = previous!.points[i];
      const target = targets[i];
      if (player.grounded && player.tumble <= 0) Object.assign(foot, target, { vx: 0, vy: 0 });
      else for (let n = 0; n < steps; n++) {
        const flutter = Math.sin(time * 19 + i * 2.8 + player.number) * clamp(Math.hypot(player.vx, player.vy) / 260, 0, 3);
        foot.vx += ((target.x - foot.x) * 150 - foot.vx * 12) * step;
        foot.vy += ((target.y + flutter - foot.y) * 150 - foot.vy * 12) * step;
        foot.x += foot.vx * step;
        foot.y += foot.vy * step;
      }
      return solveLeg(leg.hip, rotate(foot, -pose.rotation), i === 0 ? -1 : 1);
    });
    previous.x = player.x;
    previous.y = player.y;
    previous.time = time;
    for (const [id, entry] of this.feet) if (time - entry.time > 2) this.feet.delete(id);
    return pose;
  }
}
