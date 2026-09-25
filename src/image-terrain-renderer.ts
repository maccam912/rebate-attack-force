import { getMap, type ArenaMap } from "../shared/maps";
import type { TerrainScene } from "./terrain-renderer";

const images = new Map<string, HTMLImageElement>();
export function mapImage(map: ArenaMap): HTMLImageElement | undefined {
  if (!map.image) return;
  let image = images.get(map.image);
  if (!image) {
    image = new Image();
    image.src = map.image;
    images.set(map.image, image);
  }
  return image;
}

/** Draw the actual source art at 1:1 world scale, also in expanded arenas. */
export function drawImageTerrain(c: CanvasRenderingContext2D, scene: TerrainScene): boolean {
  const map = getMap(scene.mapId);
  const image = mapImage(map);
  if (!image) return false;
  c.save();
  c.imageSmoothingEnabled = false;
  for (let x = 0; x < scene.width; x += map.width) {
    if (image.complete && image.naturalWidth) c.drawImage(image, x, 0);
    else {
      // An exact collision silhouette is visible while artwork loads or if it fails.
      c.fillStyle = "#8c9e84";
      for (const p of map.platforms) c.fillRect(x + p.x, p.y, p.w, p.h);
    }
  }
  c.restore();
  return true;
}
