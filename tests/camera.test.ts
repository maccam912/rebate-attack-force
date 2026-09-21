import test from "node:test";
import assert from "node:assert/strict";
import { GameEngine } from "../shared/game.js";
import { followCamera, screenToWorld } from "../src/camera.js";

test("the camera follows movement, clamps at world edges, and switches active players", () => {
  const state = new GameEngine().state;
  const start = followCamera(null, state, 1440, 900, 1 / 60);
  assert.ok(start.width < state.width / 3);
  state.players[0].x = 1900;
  state.players[0].y = 700;
  const moving = followCamera(start, state, 1440, 900, .1);
  assert.ok(moving.x > start.x && moving.y < start.y);
  state.activePlayerId = state.players[1].id;
  const switched = followCamera(moving, state, 1440, 900, 1 / 60);
  assert.ok(state.players[1].x >= switched.x && state.players[1].x <= switched.x + switched.width);
  assert.ok(switched.x >= 0 && switched.x + switched.width <= state.width);
  assert.ok(switched.y >= 0 && switched.y + switched.height <= state.height);
});

test("aim conversion respects camera translation, zoom, and resized viewports", () => {
  const state = new GameEngine().state;
  for (const [width, height] of [[1440, 900], [390, 844], [844, 390], [2560, 1440]]) {
    const camera = followCamera(null, state, width, height, 1 / 60);
    const point = screenToWorld(camera, { x: width / 2, y: height / 2 });
    assert.ok(Math.abs(point.x - camera.x - camera.width / 2) < 1e-8);
    assert.ok(Math.abs(point.y - camera.y - camera.height / 2) < 1e-8);
    assert.ok(camera.width <= state.width && camera.height <= state.height);
  }
});
