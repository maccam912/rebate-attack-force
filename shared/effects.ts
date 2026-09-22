import type { ArenaHazard, HazardKind, Platform, Player, Point, StatusKind, WeaponId } from "./types.js";

export const MAX_HAZARDS = 64;

/** Shared placement keeps bot previews consistent with terrain-bound spills. */
export function projectHazard(point: Point, kind: HazardKind, radius: number,
  platforms: Platform[], waterY: number): (Point & { radius: number }) | null {
  if (["gravity", "repulsor", "updraft"].includes(kind)) return { ...point, radius };
  const floor = platforms.filter((platform) =>
    point.x >= platform.x - 6 && point.x <= platform.x + platform.w + 6 &&
    platform.y >= point.y - 1 && platform.y - point.y <= 520)
    .sort((a, b) => a.y - b.y)[0];
  if (!floor || floor.y >= waterY) return null;
  radius = Math.min(radius, floor.w / 2);
  return { x: Math.max(floor.x + radius, Math.min(floor.x + floor.w - radius, point.x)), y: floor.y, radius };
}

export function hasStatus(player: Player, kind: StatusKind): boolean {
  return player.statuses?.some((effect) => effect.kind === kind && effect.remaining > 0) ?? false;
}

/** Refresh a condition without stacking its force or restarting its damage clock. */
export function addStatus(player: Player, kind: StatusKind, duration: number, source: WeaponId): void {
  const statuses = player.statuses ??= [];
  const existing = statuses.find((effect) => effect.kind === kind);
  if (existing) {
    existing.remaining = Math.max(existing.remaining, duration);
    existing.source = source;
  } else statuses.push({ kind, remaining: duration, source, tick: 0 });
}

export function pointSegmentDistance(point: Point, start: Point, end: Point): number {
  const dx = end.x - start.x, dy = end.y - start.y;
  const length = dx * dx + dy * dy;
  const along = length === 0 ? 0 : Math.max(0, Math.min(1,
    ((point.x - start.x) * dx + (point.y - start.y) * dy) / length));
  return Math.hypot(point.x - start.x - along * dx, point.y - start.y - along * dy);
}

/** Ropes may wrap around many corners; testing only the anchor misses the live span. */
export function ropeIntersectsCircle(player: Player, center: Point, radius: number): boolean {
  if (!player.rope) return false;
  const points = [player.rope, ...player.rope.bends, player];
  return points.slice(1).some((end, index) => pointSegmentDistance(center, points[index], end) <= radius);
}

/** Surface hazards are shallow strips; gravity fields occupy their whole circle. */
export function hazardTouches(hazard: ArenaHazard, player: Point, bodyRadius = 18): boolean {
  if (["gravity", "repulsor", "updraft"].includes(hazard.kind))
    return Math.hypot(player.x - hazard.x, player.y - hazard.y) <= hazard.radius + bodyRadius;
  const height = hazard.kind === "poison" ? 72 : hazard.kind === "fire" ? 48 : 25;
  return Math.abs(player.x - hazard.x) <= hazard.radius + bodyRadius &&
    player.y + bodyRadius >= hazard.y - height && player.y - bodyRadius <= hazard.y + 3;
}

/** Wire is a horizontal strip, not a circular blast reaching below the platform. */
export function ropeIntersectsWire(player: Player, hazard: ArenaHazard): boolean {
  if (!player.rope) return false;
  const points = [player.rope, ...player.rope.bends, player];
  const left = hazard.x - hazard.radius, right = hazard.x + hazard.radius;
  const top = hazard.y - 25, bottom = hazard.y + 3;
  return points.slice(1).some((end, index) => {
    const start = points[index];
    let enter = 0, leave = 1;
    for (const [origin, delta, min, max] of [
      [start.x, end.x - start.x, left, right],
      [start.y, end.y - start.y, top, bottom],
    ]) {
      if (Math.abs(delta) < 1e-9) {
        if (origin < min || origin > max) return false;
      } else {
        const a = (min - origin) / delta, b = (max - origin) / delta;
        enter = Math.max(enter, Math.min(a, b));
        leave = Math.min(leave, Math.max(a, b));
        if (enter > leave) return false;
      }
    }
    return true;
  });
}
