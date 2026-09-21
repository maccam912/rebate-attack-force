import type { GameState, Point } from "../shared/types";

export interface Camera extends Point {
  width: number;
  height: number;
  zoom: number;
  targetId: string;
}
const clamp = (n: number, low: number, high: number) => Math.max(low, Math.min(high, n));

export function followCamera(previous: Camera | null, state: GameState, width: number, height: number, dt: number): Camera {
  const target = state.players.find((p) => p.id === state.activePlayerId)!;
  const zoom = Math.max(width / state.width, height / state.height,
    Math.max(0.65, Math.min(width / 1100, height / 760, 1.4)));
  const viewWidth = width / zoom;
  const viewHeight = height / zoom;
  const x = clamp(target.x + clamp(target.vx * 0.14, -100, 100) - viewWidth * 0.5, 0, state.width - viewWidth);
  const y = clamp(target.y - viewHeight * 0.6, 0, state.height - viewHeight);
  const snap = !previous || previous.targetId !== target.id || Math.hypot(x - previous.x, y - previous.y) > 1400;
  const blend = snap ? 1 : 1 - Math.exp(-dt * 9);
  return {
    x: clamp((previous?.x ?? x) + (x - (previous?.x ?? x)) * blend, 0, state.width - viewWidth),
    y: clamp((previous?.y ?? y) + (y - (previous?.y ?? y)) * blend, 0, state.height - viewHeight),
    width: viewWidth, height: viewHeight, zoom, targetId: target.id,
  };
}

export function screenToWorld(camera: Camera, point: Point): Point {
  return { x: camera.x + point.x / camera.zoom, y: camera.y + point.y / camera.zoom };
}
