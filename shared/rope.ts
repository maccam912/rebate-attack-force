import type { Platform, Point, Rope } from "./types.js";

const distance = (a: Point, b: Point) => Math.hypot(b.x - a.x, b.y - a.y);

/** Boundary contact is allowed; crossing the interior of a solid is not. */
export function ropeSegmentBlocked(a: Point, b: Point, platforms: Platform[]): boolean {
  return platforms.some((p) => {
    let near = 0;
    let far = 1;
    for (const [origin, delta, low, high] of [
      [a.x, b.x - a.x, p.x + 0.01, p.x + p.w - 0.01],
      [a.y, b.y - a.y, p.y + 0.01, p.y + p.h - 0.01],
    ]) {
      if (Math.abs(delta) < 1e-9) {
        if (origin <= low || origin >= high) return false;
      } else {
        const t1 = (low - origin) / delta;
        const t2 = (high - origin) / delta;
        near = Math.max(near, Math.min(t1, t2));
        far = Math.min(far, Math.max(t1, t2));
        if (near >= far) return false;
      }
    }
    return far > 0 && near < 1;
  });
}

/** Find a taut route around any intervening rectangles, including adjacent solids. */
function route(a: Point, b: Point, platforms: Platform[]): Point[] | null {
  const margin = 0.5;
  const nodes: Point[] = [a, b];
  for (const p of platforms) {
    for (const x of [p.x - margin, p.x + p.w + margin])
      for (const y of [p.y - margin, p.y + p.h + margin]) {
        const point = { x, y };
        if (!platforms.some((solid) => x > solid.x && x < solid.x + solid.w && y > solid.y && y < solid.y + solid.h))
          nodes.push(point);
      }
  }
  const costs = nodes.map(() => Infinity);
  const previous = nodes.map(() => -1);
  const visited = new Set<number>();
  costs[0] = 0;
  while (visited.size < nodes.length) {
    let current = -1;
    for (let i = 0; i < nodes.length; i++)
      if (!visited.has(i) && (current < 0 || costs[i] < costs[current])) current = i;
    if (current < 0 || !Number.isFinite(costs[current])) return null;
    if (current === 1) {
      const path: Point[] = [];
      for (let i = previous[1]; i > 0; i = previous[i]) path.unshift(nodes[i]);
      return path;
    }
    visited.add(current);
    for (let next = 0; next < nodes.length; next++) {
      if (visited.has(next)) continue;
      const cost = costs[current] + distance(nodes[current], nodes[next]);
      if (cost < costs[next] && !ropeSegmentBlocked(nodes[current], nodes[next], platforms)) {
        costs[next] = cost;
        previous[next] = current;
      }
    }
  }
  return null;
}

/** Keep existing contacts until the moving end can unwind past them. */
export function updateRopePath(rope: Rope, end: Point, platforms: Platform[]): boolean {
  while (rope.bends.length) {
    const prior = rope.bends.at(-2) ?? rope;
    if (ropeSegmentBlocked(prior, end, platforms)) break;
    rope.bends.pop();
  }
  const pivot = rope.bends.at(-1) ?? rope;
  if (ropeSegmentBlocked(pivot, end, platforms)) {
    const bends = route(pivot, end, platforms);
    if (!bends) return false;
    rope.bends.push(...bends);
  }
  return true;
}

export function ropeFixedLength(rope: Rope): number {
  let previous: Point = rope;
  let length = 0;
  for (const bend of rope.bends) {
    length += distance(previous, bend);
    previous = bend;
  }
  return length;
}

export function ropePathLength(rope: Rope, end: Point): number {
  return ropeFixedLength(rope) + distance(rope.bends.at(-1) ?? rope, end);
}
