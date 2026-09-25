import type { Platform, Point } from "./types.js";

export type PixelRect = [x: number, y: number, w: number, h: number];

/** Lossless run-length geometry: ONLY alpha 255 is solid, including edge pixels. */
export function opaqueRectangles(width: number, height: number, rgba: ArrayLike<number>): PixelRect[] {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 ||
      rgba.length !== width * height * 4) throw new Error("Invalid RGBA image dimensions");
  const rectangles: PixelRect[] = [];
  let previous = new Map<string, PixelRect>();
  for (let y = 0; y < height; y++) {
    const row = new Map<string, PixelRect>();
    for (let x = 0; x < width;) {
      if (rgba[(y * width + x) * 4 + 3] !== 255) { x++; continue; }
      const start = x;
      while (x < width && rgba[(y * width + x) * 4 + 3] === 255) x++;
      const key = `${start}:${x}`;
      const existing = previous.get(key);
      const rectangle: PixelRect = existing ?? [start, y, x - start, 0];
      rectangle[3]++;
      if (!existing) rectangles.push(rectangle);
      row.set(key, rectangle);
    }
    previous = row;
  }
  return rectangles;
}

/** Broad phase only; callers still perform their exact contact/segment tests. */
const indices = new WeakMap<Platform[], Map<string, Platform[]>>();
const CELL = 128;
export function terrainIn(platforms: Platform[], left: number, top: number, right: number, bottom: number): Platform[] {
  // Small legacy layouts are cheaper to scan and may be edited by test fixtures.
  if (platforms.length < 100) return platforms;
  let index = indices.get(platforms);
  if (!index) {
    index = new Map();
    for (const p of platforms) {
      for (let y = Math.floor(p.y / CELL); y <= Math.floor((p.y + p.h) / CELL); y++) {
        for (let x = Math.floor(p.x / CELL); x <= Math.floor((p.x + p.w) / CELL); x++) {
          const key = `${x},${y}`;
          const bucket = index.get(key);
          if (bucket) bucket.push(p); else index.set(key, [p]);
        }
      }
    }
    indices.set(platforms, index);
  }
  const found = new Set<Platform>();
  for (let y = Math.floor(top / CELL); y <= Math.floor(bottom / CELL); y++)
    for (let x = Math.floor(left / CELL); x <= Math.floor(right / CELL); x++)
      for (const p of index.get(`${x},${y}`) ?? [])
        if (p.x <= right && p.x + p.w >= left && p.y <= bottom && p.y + p.h >= top) found.add(p);
  // Retain the original order, including corner-contact tie breaking, on all peers.
  return [...found].sort((a, b) => a.y - b.y || a.x - b.x);
}

export function bodyTerrain(platforms: Platform[], x: number, y: number, radius: number): Platform[] {
  return terrainIn(platforms, x - radius, y - radius, x + radius, y + radius);
}

/** Find exposed surfaces, ignoring the internal seams of the pixel-run geometry. */
function columnSurface(platforms: Platform[], x: number, nearY: number): number | undefined {
  const top = nearY - 192, bottom = nearY + 192;
  const column = terrainIn(platforms, x, top, x, bottom)
    .filter((p) => x >= p.x && x < p.x + p.w)
    .sort((a, b) => a.y - b.y);
  let coveredTo = -Infinity, best: number | undefined;
  for (const p of column) {
    if (p.y > coveredTo && p.y > top && p.y <= bottom &&
      (best === undefined || Math.abs(p.y - nearY) < Math.abs(best - nearY))) best = p.y;
    coveredTo = Math.max(coveredTo, p.y + p.h);
  }
  return best;
}

export interface ImageSurface { slope: number; steep: boolean; sharp: boolean }
/** Sample the silhouette over 24px, so single-pixel stairs don't masquerade as flat ground. */
export function imageSurface(platforms: Platform[], x: number, footY: number, radius = 18): ImageSurface | null {
  const supports = terrainIn(platforms, x - radius, footY - .2, x + radius, footY + .2)
    .filter((p) => Math.abs(p.y - footY) < .2 && x + radius > p.x && x - radius < p.x + p.w);
  if (!supports.length) return null;
  let contactX = x, closest = Infinity;
  for (const p of supports) {
    const px = Math.max(p.x + .5, Math.min(p.x + p.w - .5, x));
    if (Math.abs(px - x) < closest) { contactX = px; closest = Math.abs(px - x); }
  }
  const left = columnSurface(platforms, contactX - 12, footY);
  const right = columnSurface(platforms, contactX + 12, footY);
  if (left === undefined || right === undefined) return { slope: 0, steep: false, sharp: false };
  // A symmetric peak has an average slope of zero but is not a stable perch.
  const sharp = left - footY > 8 && right - footY > 8;
  const slope = sharp ? (x < contactX ? -(left - footY) / 12 : (right - footY) / 12) : (right - left) / 24;
  if (!sharp && Math.abs(slope) > .75) {
    const middle = columnSurface(platforms, x, footY);
    const heel = columnSurface(platforms, x - radius + 1, footY);
    const toe = columnSurface(platforms, x + radius - 1, footY);
    // A frog wedged between opposing faces rests in the valley/fork. Otherwise
    // two steep normals fight forever and prevent the turn from settling.
    if (middle !== undefined && middle > footY + 6 && heel !== undefined && toe !== undefined &&
      Math.abs(heel - footY) <= 4 && Math.abs(toe - footY) <= 4)
      return { slope: 0, steep: false, sharp: false };
  }
  return { slope, steep: sharp || Math.abs(slope) > .75, sharp };
}

/** Stable, exposed individual body positions; no flat platform or spawn marker required. */
export function imageSurfaceSites(width: number, height: number, rgba: ArrayLike<number>,
  platforms: Platform[], radius: number, waterY = height + 1000): Point[] {
  const sites: Point[] = [];
  for (let x = radius + 12; x < width - radius - 12; x += 12) {
    const rows = new Uint16Array(height);
    for (let y = 0; y < height; y++)
      for (let xx = x - radius; xx < x + radius; xx++)
        if (rgba[(y * width + xx) * 4 + 3] === 255) rows[y]++;
    let above = 0;
    const clearance = radius * 2 + 6;
    for (let y = 0; y < Math.min(height, waterY - 24); y++) {
      if (y >= 60 && rows[y] && !above) {
        const surface = imageSurface(platforms, x, y, radius);
        if (surface && !surface.steep) sites.push({ x, y: y - radius });
      }
      above += rows[y];
      if (y >= clearance) above -= rows[y - clearance];
    }
  }
  return sites;
}

/** Six nearby but individually supported frogs, on roots, branches or uneven ground. */
export function imageSpawnGroups(sites: Point[], maxGroups = 4): Point[][] {
  const groups: Point[][] = [];
  let available = [...sites];
  while (groups.length < maxGroups && available.length >= 6) {
    const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
    const score = (point: Point) => groups.length ? Math.min(...groups.flat().map((p) => distance(point, p))) : -point.x;
    const anchors = [...available].sort((a, b) => score(b) - score(a) || b.y - a.y);
    let group: Point[] | undefined;
    for (const anchor of anchors) {
      const neighbors = available.filter((p) => distance(anchor, p) <= 330).sort((a, b) => distance(anchor, a) - distance(anchor, b));
      const chosen: Point[] = [];
      for (const p of neighbors) {
        if (chosen.every((q) => distance(p, q) >= 44)) chosen.push(p);
        if (chosen.length === 6) break;
      }
      if (chosen.length === 6) { group = chosen; break; }
    }
    if (!group) break;
    groups.push(group);
    available = available.filter((p) => group!.every((q) => distance(p, q) >= 160));
  }
  return groups;
}
