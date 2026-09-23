import test from "node:test";
import assert from "node:assert/strict";
import { GameEngine } from "../shared/game.js";
import type { GameState } from "../shared/types.js";
import { followCamera, screenToWorld } from "../src/camera.js";

const cameraState = () => new GameEngine({
  players: [{ id: "p1", name: "Moss", frogs: 1 }, { id: "p2", name: "Tangerine", frogs: 1 }],
}).state;

test("the camera follows movement, clamps at world edges, and switches active players", () => {
  const state = cameraState();
  const start = followCamera(null, state, 1440, 900, 1 / 60);
  assert.ok(start.width < state.width / 3);
  state.players[0].x = 1900;
  state.players[0].y = 700;
  const moving = followCamera(start, state, 1440, 900, .1);
  assert.ok(moving.x > start.x && moving.y < start.y);
  state.activePlayerId = state.players[1].id;
  const switched = followCamera(moving, state, 1440, 900, 1 / 60);
  const destination = followCamera(null, state, 1440, 900, 1 / 60);
  assert.ok(switched.x > moving.x && switched.x < destination.x, "A new turn pans toward its frog without snapping");
  let arrived = switched;
  for (let i = 1; i < 36; i++) arrived = followCamera(arrived, state, 1440, 900, 1 / 60);
  assert.ok(visible(arrived, state.players[1]), "The next frog comes into view during the handoff");
  assert.ok(Math.abs(arrived.x - destination.x) < 50, "The handoff settles promptly");
  assert.ok(switched.x >= 0 && switched.x + switched.width <= state.width);
  assert.ok(switched.y >= 0 && switched.y + switched.height <= state.height);
});

test("large moves of the same target pan smoothly at different frame rates", () => {
  const state = cameraState();
  const frog = state.players.find((p) => p.id === state.activePlayerId)!;
  const start = followCamera(null, state, 1280, 800, 1 / 60);
  frog.x = state.width - 500;
  const destination = followCamera(null, state, 1280, 800, 1 / 60);
  assert.ok(destination.x - start.x > 1400, "Exercise the former teleport threshold");
  assert.deepEqual(followCamera(start, state, 1280, 800, 0), start, "No elapsed time means no camera movement");
  const arrivals = [30, 60, 120].map((fps) => {
    let camera = start;
    for (let i = 0; i < fps / 2; i++) {
      const next = followCamera(camera, state, 1280, 800, 1 / fps);
      assert.ok(next.x > camera.x && next.x < destination.x, "Each frame approaches without snapping or overshooting");
      camera = next;
    }
    assert.ok(visible(camera, frog), "The distant frog comes into view within half a second");
    return camera;
  });
  for (const camera of arrivals) assert.ok(Math.abs(camera.x - arrivals[0].x) < 1e-8,
    "Equal elapsed time gives the same pan at different frame rates");
});

test("aim conversion respects camera translation, zoom, and resized viewports", () => {
  const state = cameraState();
  for (const [width, height] of [[1440, 900], [390, 844], [844, 390], [2560, 1440]]) {
    const camera = followCamera(null, state, width, height, 1 / 60);
    const point = screenToWorld(camera, { x: width / 2, y: height / 2 });
    assert.ok(Math.abs(point.x - camera.x - camera.width / 2) < 1e-8);
    assert.ok(Math.abs(point.y - camera.y - camera.height / 2) < 1e-8);
    assert.ok(camera.width <= state.width && camera.height <= state.height);
  }
});

test("touch cameras keep the frog visible with room to aim above the control deck", () => {
  const state = cameraState();
  for (const [width, height] of [[320, 352], [390, 628], [844, 224]]) {
    const camera = followCamera(null, state, width, height, 1 / 60, true);
    const frog = state.players[0];
    assert.ok(camera.width >= 700, "Touch aiming includes nearby grapple targets");
    assert.ok(frog.x >= camera.x && frog.x <= camera.x + camera.width);
    assert.ok(frog.y >= camera.y && frog.y <= camera.y + camera.height);
    const point = screenToWorld(camera, { x: width / 2, y: height / 2 });
    assert.equal(point.x, camera.x + camera.width / 2);
    assert.equal(point.y, camera.y + camera.height / 2);
  }
});

function outcome(state: GameState) {
  state.resolution = {
    affectedPlayerIds: [], pendingDamage: {}, drownedPlayerIds: [],
    focus: null, reveal: null, slowMotionRemaining: 0, impact: 0,
  };
  return state.resolution;
}

function settleCamera(state: GameState, previous = followCamera(null, state, 1280, 800, 1 / 60)) {
  let camera = previous;
  for (let i = 0; i < 120; i++) camera = followCamera(camera, state, 1280, 800, 1 / 60);
  return camera;
}

function visible(camera: ReturnType<typeof followCamera>, point: { x: number; y: number }) {
  return point.x >= camera.x && point.x <= camera.x + camera.width &&
    point.y >= camera.y && point.y <= camera.y + camera.height;
}

test("retreat frames the shooter and travelling weapon, then the payoff follows the weapon", () => {
  const state = cameraState();
  const start = followCamera(null, state, 1280, 800, 1 / 60);
  const grenade = { id: "shot", ownerId: state.activePlayerId, kind: "grenade" as const,
    x: 1750, y: 1000, vx: 300, vy: 150, life: 2, radius: 100, damage: 40 };
  state.projectiles.push(grenade);
  state.phase = "retreat";
  const retreat = settleCamera(state, start);
  assert.ok(visible(retreat, state.players[0]), "Retreating frog remains in view");
  assert.ok(visible(retreat, grenade), "Weapon remains in view until impact");
  assert.ok(retreat.zoom < start.zoom, "Separation widens the shot");
  assert.ok(!visible(retreat, state.players[1]), "Unrelated opponents do not pull the camera away");
  state.phase = "settling";
  grenade.x = 3100;
  const payoff = settleCamera(state, retreat);
  assert.ok(visible(payoff, grenade));
  assert.ok(!visible(payoff, state.players[0]), "Once control ends the camera follows the action");
});

test("the impact camera widens to follow scattered frogs including a water landing", () => {
  const state = cameraState();
  state.phase = "settling";
  const resolution = outcome(state);
  const [left, right] = state.players;
  Object.assign(left, { x: 1000, y: 450, vx: -850, vy: -220 });
  Object.assign(right, { x: 2800, y: state.waterY + 50, vx: 0, vy: 0 });
  resolution.affectedPlayerIds = [left.id, right.id];
  resolution.drownedPlayerIds = [right.id];
  const camera = settleCamera(state);
  assert.ok(visible(camera, left));
  assert.ok(visible(camera, { x: right.x, y: state.waterY - 25 }));
  assert.ok(camera.zoom < 0.8, "A wide launch needs a wide view");
  assert.ok(camera.x >= 0 && camera.y >= 0);
  assert.ok(camera.x + camera.width <= state.width && camera.y + camera.height <= state.height);
});

test("damage recipients get a smooth camera handoff and are framed before subtraction", () => {
  const state = cameraState();
  const resolution = outcome(state);
  state.phase = "damage";
  Object.assign(state.players[0], { x: 800, y: 1000 });
  Object.assign(state.players[1], { x: 3450, y: 1500 });
  resolution.reveal = { playerId: state.players[0].id, damage: 24, fromHp: 100,
    toHp: 76, elapsed: 1, applied: true, drowned: false };
  const first = settleCamera(state);
  resolution.reveal = { ...resolution.reveal, playerId: state.players[1].id, elapsed: 0, applied: false };
  const moving = followCamera(first, state, 1280, 800, 1 / 60);
  const destination = followCamera(null, state, 1280, 800, 1 / 60);
  assert.ok(moving.x > first.x && moving.x < destination.x, "Switching recipients pans without snapping");
  let arrived = moving;
  for (let i = 1; i < 33; i++) arrived = followCamera(arrived, state, 1280, 800, 1 / 60);
  assert.ok(visible(arrived, state.players[1]), "Recipient is on screen by the .55s subtraction cue");
  assert.ok(Math.abs(arrived.x - destination.x) < 35);
  assert.equal(arrived.targetId, `damage:${state.players[1].id}`);
  state.phase = "playing";
  state.activePlayerId = state.players[0].id;
  const nextTurn = followCamera(arrived, state, 1280, 800, 1 / 60);
  const nextDestination = followCamera(null, state, 1280, 800, 1 / 60);
  assert.equal(nextTurn.targetId, state.players[0].id);
  assert.ok(nextTurn.x < arrived.x && nextTurn.x > nextDestination.x, "Returning to play pans without snapping");
  assert.ok(nextTurn.zoom < arrived.zoom && nextTurn.zoom > nextDestination.zoom, "Returning to play also eases the zoom");
  const nextArrived = settleCamera(state, nextTurn);
  assert.ok(visible(nextArrived, state.players[0]), "The handoff reaches the next controllable frog");
});

test("zooming action cameras preserve aim conversion and mobile world bounds", () => {
  const state = cameraState();
  const resolution = outcome(state);
  resolution.affectedPlayerIds = state.players.map((player) => player.id);
  state.phase = "settling";
  for (const [width, height] of [[390, 628], [844, 224], [2560, 1440]]) {
    const camera = followCamera(null, state, width, height, 1 / 60, true);
    const point = screenToWorld(camera, { x: width / 2, y: height / 2 });
    assert.equal(point.x, camera.x + camera.width / 2);
    assert.equal(point.y, camera.y + camera.height / 2);
    assert.ok(camera.width <= state.width && camera.height <= state.height);
  }
});
