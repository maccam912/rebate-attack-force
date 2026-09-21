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
  const rotation = clamp(player.vx / 1000, -0.3, 0.3) + player.rotation;
  const direction = rotate({ x: aim.x - player.x, y: aim.y - player.y }, -rotation);
  const length = Math.hypot(direction.x, direction.y) || 1;
  const alarmed = players.some(
    (other) => other.teamId !== player.teamId && other.alive &&
      Math.hypot(other.x - player.x, other.y - player.y) < 160,
  );
  const legs = ([-1, 1] as const).map((side) => {
    let foot: Point;
    if (player.grounded) {
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
      // Tuck near the jump apex; extend for takeoff/landing and trail a swing.
      const extension = clamp(Math.abs(player.vy) / 450, 0, 1);
      foot = rotate({
        x: side * (15 + extension * 5) - clamp(player.vx * 0.055, -25, 25),
        y: 8 + extension * 21,
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
