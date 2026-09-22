import type { GameState, Point } from "../shared/types";

export interface Camera extends Point {
  width: number;
  height: number;
  zoom: number;
  targetId: string;
}
const clamp = (n: number, low: number, high: number) => Math.max(low, Math.min(high, n));

export function followCamera(previous: Camera | null, state: GameState, width: number, height: number, dt: number, touch = false): Camera {
  const active = state.players.find((p) => p.id === state.activePlayerId) ?? state.players[0];
  const resolution = state.resolution;
  const reveal = state.phase === "damage" ? resolution?.reveal : null;
  const revealedFrog = reveal && state.players.find((p) => p.id === reveal.playerId);
  const worldZoom = Math.max(width / state.width, height / state.height);
  const normalZoom = Math.max(worldZoom,
    Math.max(touch ? 0.45 : 0.65, Math.min(width / 1100, height / 760, 1.4)));
  let targetZoom = normalZoom;
  let target: Point = active
    ? { x: active.x + clamp(active.vx * 0.14, -100, 100), y: active.y }
    : { x: state.width / 2, y: state.height / 2 };
  let targetId = active?.id ?? "arena";
  let verticalAnchor = 0.6;
  const cinematic = state.phase === "settling" || state.phase === "damage" || state.phase === "retreat";

  if (revealedFrog && reveal) {
    target = { x: revealedFrog.x, y: reveal.drowned ? state.waterY - 35 : revealedFrog.y };
    targetId = `damage:${revealedFrog.id}`;
    targetZoom = Math.max(worldZoom, Math.min(normalZoom * 1.12, 1.5));
  } else if (cinematic) {
    const points: Point[] = [];
    if (state.phase === "retreat" && active) points.push(active);
    for (const projectile of state.projectiles) {
      points.push(projectile, {
        x: projectile.x + clamp(projectile.vx * 0.16, -170, 170),
        y: projectile.y + clamp(projectile.vy * 0.16, -150, 150),
      });
    }
    for (const mine of state.mines ?? []) {
      if (mine.fuse !== null || (state.phase === "retreat" && mine.placedTurn === state.turn)) points.push(mine);
    }
    const affected = new Set(resolution?.affectedPlayerIds ?? []);
    for (const frog of state.players) {
      if (!frog.alive || !affected.has(frog.id)) continue;
      const drowned = resolution?.drownedPlayerIds.includes(frog.id);
      points.push({ x: frog.x, y: drowned ? state.waterY - 25 : frog.y });
      if (!drowned) points.push({
        x: frog.x + clamp(frog.vx * 0.2, -220, 220),
        y: frog.y + clamp(frog.vy * 0.2, -190, 190),
      });
    }
    if (resolution?.focus && (!points.length || state.explosions.some((e) => e.age < 0.3))) points.push(resolution.focus);
    if (points.length) {
      const minX = Math.min(...points.map((p) => p.x));
      const maxX = Math.max(...points.map((p) => p.x));
      const minY = Math.min(...points.map((p) => p.y));
      const maxY = Math.max(...points.map((p) => p.y));
      // Leave room for airborne bodies and names, widening as the mayhem spreads.
      targetZoom = Math.max(worldZoom, Math.min(normalZoom, width / (maxX - minX + 320), height / (maxY - minY + 310)));
      target = { x: (minX + maxX) / 2, y: (minY + maxY) / 2 };
      targetId = `action:${state.turn}`;
      verticalAnchor = 0.54;
    }
  }

  // Only initialize instantly; turn changes and distant targets use the same smooth follow.
  const snap = !previous;
  const zoomBlend = snap ? 1 : 1 - Math.exp(-Math.max(0, dt) * (targetZoom < previous.zoom ? 9 : 4));
  const zoom = Math.max(worldZoom, (previous?.zoom ?? targetZoom) + (targetZoom - (previous?.zoom ?? targetZoom)) * zoomBlend);
  const viewWidth = width / zoom;
  const viewHeight = height / zoom;
  const x = clamp(target.x - viewWidth * 0.5, 0, state.width - viewWidth);
  const y = clamp(target.y - viewHeight * verticalAnchor, 0, state.height - viewHeight);
  const blend = snap ? 1 : 1 - Math.exp(-Math.max(0, dt) * (reveal ? 9 : 7));
  // Blend centers so a changing zoom does not appear to pull toward the corner.
  const centerX = (previous ? previous.x + previous.width / 2 : target.x);
  const centerY = (previous ? previous.y + previous.height / 2 : target.y);
  return {
    x: clamp(centerX + (x + viewWidth / 2 - centerX) * blend - viewWidth / 2, 0, state.width - viewWidth),
    y: clamp(centerY + (y + viewHeight / 2 - centerY) * blend - viewHeight / 2, 0, state.height - viewHeight),
    width: viewWidth, height: viewHeight, zoom, targetId,
  };
}

export function screenToWorld(camera: Camera, point: Point): Point {
  return { x: camera.x + point.x / camera.zoom, y: camera.y + point.y / camera.zoom };
}
