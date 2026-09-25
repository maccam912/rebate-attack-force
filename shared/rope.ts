import type { Platform, Point, Rope } from "./types.js";
import { bodyTerrain, terrainIn } from "./image-terrain.js";

const distance = (a: Point, b: Point) => Math.hypot(b.x - a.x, b.y - a.y);

/** An internal seam between touching pixel runs is solid, not a rope-sized hole. */
function sharedEdgeBlocked(a: Point, b: Point, p: Platform, platforms: Platform[]): boolean {
  if (Math.abs(a.y - b.y) < 1e-9 && (a.y === p.y || a.y === p.y + p.h)) {
    const left = Math.max(Math.min(a.x, b.x), p.x), right = Math.min(Math.max(a.x, b.x), p.x + p.w);
    return right > left && terrainIn(platforms, left, a.y, right, a.y).some((q) => q !== p &&
      (a.y === p.y ? q.y + q.h === a.y : q.y === a.y) && Math.min(right, q.x + q.w) > Math.max(left, q.x));
  }
  if (Math.abs(a.x - b.x) < 1e-9 && (a.x === p.x || a.x === p.x + p.w)) {
    const top = Math.max(Math.min(a.y, b.y), p.y), bottom = Math.min(Math.max(a.y, b.y), p.y + p.h);
    return bottom > top && terrainIn(platforms, a.x, top, a.x, bottom).some((q) => q !== p &&
      (a.x === p.x ? q.x + q.w === a.x : q.x === a.x) && Math.min(bottom, q.y + q.h) > Math.max(top, q.y));
  }
  return false;
}

/** Boundary contact is allowed; crossing the interior of a solid is not. */
export function ropeSegmentBlocked(a: Point, b: Point, platforms: Platform[]): boolean {
  return terrainIn(platforms, Math.min(a.x, b.x), Math.min(a.y, b.y), Math.max(a.x, b.x), Math.max(a.y, b.y)).some((p) => {
    let near = 0;
    let far = 1;
    for (const [origin, delta, low, high] of [
      [a.x, b.x - a.x, p.x + 0.01, p.x + p.w - 0.01],
      [a.y, b.y - a.y, p.y + 0.01, p.y + p.h - 0.01],
    ]) {
      if (Math.abs(delta) < 1e-9) {
        if (origin <= low || origin >= high) return sharedEdgeBlocked(a, b, p, platforms);
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

const boundaryCache = new WeakMap<Platform[], Point[]>();
function imageBoundary(platforms: Platform[]): Point[] {
  const cached = boundaryCache.get(platforms);
  if (cached) return cached;
  // Retain all four extrema of each small boundary cell. Pixel runs inside the
  // terrain are excluded. Every proposed edge is still tested against exact pixels.
  const cells = new Map<string, Point[]>();
  for (const p of platforms) {
    // Leave a few pixels outside the silhouette: sparsely sampled points only
    // half a pixel out can be mutually occluded along a smooth convex branch.
    for (const x of [p.x - 3, p.x + p.w + 3]) for (const y of [p.y - 3, p.y + p.h + 3]) {
      if (bodyTerrain(platforms, x, y, 0).some((s) => x > s.x && x < s.x + s.w && y > s.y && y < s.y + s.h)) continue;
      const point = { x, y }, key = `${Math.floor(x / 24)},${Math.floor(y / 24)}`;
      const extrema = cells.get(key);
      if (!extrema) { cells.set(key, [point, point, point, point]); continue; }
      if (x + y < extrema[0].x + extrema[0].y) extrema[0] = point;
      if (x - y < extrema[1].x - extrema[1].y) extrema[1] = point;
      if (x + y > extrema[2].x + extrema[2].y) extrema[2] = point;
      if (x - y > extrema[3].x - extrema[3].y) extrema[3] = point;
    }
  }
  const result = [...new Set([...cells.values()].flat())];
  boundaryCache.set(platforms, result);
  return result;
}

/** Find a taut route around any intervening rectangles, including adjacent solids. */
function route(a: Point, b: Point, platforms: Platform[]): Point[] | null {
  const margin = 0.5;
  const nodes: Point[] = [a, b];
  if (platforms.length >= 100) {
    // Bounded local visibility graph: thousands of image runs must never create
    // an unbounded all-pairs graph on a simulation frame.
    const candidates = imageBoundary(platforms).map((point) => ({ point, cost: distance(a, point) + distance(point, b) }));
    candidates.sort((p, q) => p.cost - q.cost);
    nodes.push(...candidates.slice(0, 192).map(({ point }) => point));
  } else {
    for (const p of platforms) {
      for (const x of [p.x - margin, p.x + p.w + margin])
        for (const y of [p.y - margin, p.y + p.h + margin]) {
          const point = { x, y };
          if (!platforms.some((solid) => x > solid.x && x < solid.x + solid.w && y > solid.y && y < solid.y + solid.h))
            nodes.push(point);
        }
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
