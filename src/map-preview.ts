import { getMap } from "../shared/maps";
import { drawTerrainBackground, drawTerrainPlatform, drawTerrainScenery, drawTerrainWater } from "./terrain-renderer";
import { drawImageTerrain, mapImage } from "./image-terrain-renderer";

const requestedMaps = new WeakMap<HTMLCanvasElement, string>();

/** Static preview uses the actual collision layout and the same art as the match. */
export function drawMapPreview(canvas: HTMLCanvasElement, mapId: string) {
  const map = getMap(mapId);
  requestedMaps.set(canvas, mapId);
  const image = mapImage(map);
  if (image && !image.complete) image.addEventListener("load", () => {
    if (canvas.isConnected && requestedMaps.get(canvas) === mapId) drawMapPreview(canvas, mapId);
  }, { once: true });
  const bounds = canvas.getBoundingClientRect();
  const width = bounds.width || 720;
  const height = bounds.height || 380;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(height * dpr);
  const c = canvas.getContext("2d");
  if (!c) return;
  const scene = { ...map, mapId: map.id };
  c.setTransform(dpr, 0, 0, dpr, 0, 0);
  c.fillStyle = map.theme === "cave" ? "#162c36" : "#233f36";
  c.fillRect(0, 0, width, height);
  const inset = 8;
  const scale = Math.min((width - inset * 2) / map.width, (height - inset * 2) / map.height);
  const x = (width - map.width * scale) / 2;
  const y = (height - map.height * scale) / 2;
  c.save();
  c.translate(x, y);
  c.scale(scale, scale);
  c.beginPath(); c.rect(0, 0, map.width, map.height); c.clip();
  drawTerrainBackground(c, scene, 0);
  if (!drawImageTerrain(c, scene)) {
    drawTerrainScenery(c, scene, map.platforms, 0);
    map.platforms.forEach((p, i) => drawTerrainPlatform(c, p, i, 0, map.theme));
  }
  drawTerrainWater(c, scene, 0);
  // Starting positions give a useful size reference while leaving the terrain visible.
  for (let i = 0; i < Math.min(4, map.spawnPlatformIds.length); i++) {
    const p = map.platforms.find((platform) => platform.id === map.spawnPlatformIds[i]);
    if (!p) continue;
    const point = map.spawnGroups?.[i]?.[0];
    const cx = point?.x ?? p.x + p.w / 2, cy = point ? point.y - 3 : p.y - 21;
    c.beginPath(); c.ellipse(cx, cy, 17, 12, 0, 0, Math.PI * 2);
    c.fillStyle = ["#d2df87", "#f0b184", "#a9d0dc", "#dda9d1"][i % 4]; c.fill();
    c.strokeStyle = "#244439"; c.lineWidth = 2; c.stroke();
    for (const dx of [-7, 7]) {
      c.beginPath(); c.arc(cx + dx, cy - 10, 6, 0, Math.PI * 2); c.fill(); c.stroke();
      c.beginPath(); c.arc(cx + dx, cy - 11, 2, 0, Math.PI * 2); c.fillStyle = "#244439"; c.fill();
      c.fillStyle = ["#d2df87", "#f0b184", "#a9d0dc", "#dda9d1"][i % 4];
    }
  }
  c.restore();
  c.strokeStyle = "#e8ecc32e";
  c.lineWidth = 1;
  c.strokeRect(x + .5, y + .5, map.width * scale - 1, map.height * scale - 1);
}
