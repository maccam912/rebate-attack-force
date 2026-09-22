import test from "node:test";
import assert from "node:assert/strict";
import { FIXED_STEP, GameEngine, PLAYER_RADIUS, WIDTH } from "../shared/game.js";
import { applyImpulse } from "../shared/physics.js";
import type { PlayerInput } from "../shared/types.js";

const input = (patch: Partial<PlayerInput> = {}): PlayerInput => ({
  left: false, right: false, up: false, down: false, aimX: 700, aimY: 600, ...patch,
});
function arena() {
  const game = new GameEngine();
  game.state.platforms = [{ id: "floor", x: 0, y: 1500, w: WIDTH, h: 300 }];
  game.state.crates = [];
  const [frog, other] = game.state.players;
  Object.assign(frog, { x: 400, y: 1500 - PLAYER_RADIUS });
  Object.assign(other, { x: 3000, y: 1500 - PLAYER_RADIUS });
  return { game, frog, other };
}
function advance(game: GameEngine, seconds: number) {
  for (let i = 0; i < Math.round(seconds / FIXED_STEP); i++) game.step(FIXED_STEP);
}

test("active jumps, backflips and long falls land safely while hard falls rebound", () => {
  for (const flip of [false, true]) {
    const { game, frog } = arena();
    frog.x = 1400;
    game.command(frog.id, { type: "jump" });
    if (flip) {
      advance(game, 0.05);
      game.command(frog.id, { type: "backflip" });
    }
    advance(game, 2);
    assert.equal(frog.hp, 100, "intentional traversal jumps are safe");
    assert.equal(frog.grounded, true);
  }
  const { game, frog } = arena();
  Object.assign(frog, { y: 600, grounded: false });
  let bounced = false;
  for (let i = 0; i < 180; i++) {
    const before = frog.vy;
    game.step(FIXED_STEP);
    assert.ok(frog.y <= 1500 - PLAYER_RADIUS + 0.001);
    if (before > 0 && frog.vy < 0) { bounced = true; break; }
  }
  assert.ok(bounced);
  assert.equal(frog.hp, 100, "active terrain traversal does not queue damage");
  assert.equal(game.state.resolution?.pendingDamage[frog.id] ?? 0, 0);
  assert.ok(frog.impact > 0.8);
});

test("an inactive launched frog rebounds from thin walls and world boundaries with pending impact damage", () => {
  for (const boundary of [false, true]) {
    const { game, other: frog } = arena();
    if (!boundary) game.state.platforms.push({ id: "wall", x: 500, y: 500, w: 8, h: 1000 });
    Object.assign(frog, { x: boundary ? WIDTH - 90 : 430, y: 1000, grounded: false });
    applyImpulse(frog, 1450, -80, 8);
    advance(game, 0.08);
    assert.ok(frog.vx < -800, "the body retains a lively rebound");
    assert.equal(frog.hp, 100);
    assert.ok(game.state.resolution!.pendingDamage[frog.id] > 0);
    assert.ok(frog.x < (boundary ? WIDTH : 500) - PLAYER_RADIUS);
    assert.ok(Math.abs(frog.angularVelocity) > 1);
  }
});

test("walk input cannot clamp away a weapon launch and rolling sheds speed gradually", () => {
  const { game, frog } = arena();
  applyImpulse(frog, 1200, 0);
  game.setInput(frog.id, input({ right: true }));
  game.step(FIXED_STEP);
  assert.ok(frog.vx > 1100);
  advance(game, 0.35);
  assert.ok(frog.vx > 700);
  assert.ok(Math.abs(frog.rotation) > 0.1);
  assert.ok(frog.tumble > 1);
  assert.equal(frog.hp, 100, "rolling on a flat surface is not repeated impact damage");
  game.setInput(frog.id, input({ left: true }));
  const before = frog.vx;
  advance(game, 0.1);
  assert.ok(frog.vx < before, "countersteering brakes instead of immobilizing the frog");
  assert.ok(frog.vx > 245);
});

test("opposing maximum-speed diagonal launches cannot cross through each other", () => {
  const { game, frog, other } = arena();
  Object.assign(frog, { x: 1000, y: 900, vx: 1800, vy: 1800, grounded: false });
  Object.assign(other, { x: 1027, y: 927, vx: -1800, vy: -1800, grounded: false });
  game.step(FIXED_STEP);
  assert.ok(frog.x < other.x && frog.y < other.y, "the collision keeps the original body order");
  assert.ok(Math.hypot(other.x - frog.x, other.y - frog.y) >= PLAYER_RADIUS * 2 - 0.1);
  assert.equal(frog.hp, 100);
  assert.equal(other.hp, 100);
  assert.ok(game.state.resolution!.pendingDamage[other.id] > 0, "the lower frog takes the diagonal stomp damage");
});

test("flight attitude follows the rising and descending arc without removing launched spin", () => {
  const { game, frog } = arena();
  Object.assign(frog, { x: 1000, y: 900, vx: 350, vy: -450, grounded: false });
  advance(game, 0.2);
  assert.ok(frog.rotation < -0.15, "nose tilts upward during ascent");
  advance(game, 0.55);
  assert.ok(frog.rotation > 0.05, "nose follows the downward trajectory");
  applyImpulse(frog, 300, -300, 15);
  const rotation = frog.rotation;
  advance(game, 0.1);
  assert.ok(Math.abs(frog.rotation - rotation) > 0.5, "a launch can spin through the aerodynamic pose");
});

test("reeling adds swing momentum and release retains inward as well as tangential velocity", () => {
  const { game, frog } = arena();
  Object.assign(frog, { x: 1000, y: 1000, vx: 450, vy: 0, grounded: false,
    rope: { x: 1000, y: 700, length: 300, bends: [] } });
  game.setInput(frog.id, input({ up: true }));
  advance(game, 0.15);
  assert.ok(frog.rope && frog.rope.length < 270);
  const rope = frog.rope!;
  const distance = Math.hypot(frog.x - rope.x, frog.y - rope.y);
  const nx = (frog.x - rope.x) / distance, ny = (frog.y - rope.y) / distance;
  assert.ok(frog.vx * ny - frog.vy * nx > 450, "shorter rope increases angular speed");
  assert.ok(frog.vx * nx + frog.vy * ny < -150, "reeling creates real inward momentum");
  const velocity = { x: frog.vx, y: frog.vy };
  game.command(frog.id, { type: "release" });
  assert.deepEqual({ x: frog.vx, y: frog.vy }, velocity);
});

test("terrain-blocked rope corrections cannot manufacture impact damage", () => {
  const { game, frog, other } = arena();
  game.state.platforms.push({ id: "wall", x: 500, y: 1000, w: 80, h: 500 });
  Object.assign(other, { x: 500 - PLAYER_RADIUS });
  Object.assign(frog, { x: other.x - PLAYER_RADIUS * 2,
    rope: { x: 500, y: frog.y, length: 54, bends: [] } });
  game.setInput(frog.id, input({ up: true }));
  advance(game, 1);
  assert.equal(frog.hp, 100);
  assert.equal(other.hp, 100);
  assert.ok(frog.rope);
  assert.ok(other.x - frog.x >= PLAYER_RADIUS * 2 - 0.15);
});

test("settling waits for airborne frogs even at their apex and beyond 2.5 seconds", () => {
  const apex = arena();
  Object.assign(apex.frog, { y: 1000, vy: -5, grounded: false });
  apex.game.command(apex.frog.id, { type: "endTurn" });
  apex.game.step(FIXED_STEP);
  assert.equal(apex.game.state.phase, "settling", "near-zero vertical speed at the apex is not rest");
  assert.equal(apex.game.state.turn, 1);
  advance(apex.game, 3);
  assert.equal(apex.game.state.turn, 2, "control advances once the landing settles");

  const launched = arena();
  applyImpulse(launched.frog, 0, -1800, 0);
  launched.game.command(launched.frog.id, { type: "endTurn" });
  advance(launched.game, 2.6);
  assert.equal(launched.game.state.phase, "settling", "a powerful launch can stay airborne beyond the old timeout");
  assert.equal(launched.game.state.turn, 1);
  advance(launched.game, 3);
  assert.equal(launched.game.state.turn, 2);
  assert.equal(launched.frog.grounded, true);
});

test("a full roster stacked in reverse order transmits support and cannot deadlock settling", () => {
  const game = new GameEngine({ players: ["a", "b", "c", "d"].map((id) => ({ id, name: id, frogs: 6 })) });
  game.state.platforms = [{ id: "floor", x: 0, y: 1500, w: WIDTH, h: 300 }];
  game.state.crates = [];
  game.state.players.forEach((frog, index, players) => Object.assign(frog, {
    x: 1200, y: 1500 - PLAYER_RADIUS - (players.length - index - 1) * PLAYER_RADIUS * 2,
    vx: 0, vy: 0, grounded: index === players.length - 1,
  }));
  game.command(game.state.activePlayerId, { type: "endTurn" });
  advance(game, 1);
  assert.equal(game.state.turn, 2);
  assert.ok(game.state.players.every((frog) => frog.grounded && frog.vy === 0));
  assert.ok(game.state.players.every((frog) => frog.hp === frog.maxHp));
});

test("launched body physics and rope pumping remain identical at different rendering rates", () => {
  const a = arena(), b = arena();
  for (const { game, frog, other } of [a, b]) {
    Object.assign(frog, { x: 900, y: 900, grounded: false,
      rope: { x: 900, y: 600, length: 300, bends: [] } });
    Object.assign(other, { x: 2800, y: 1100, grounded: false });
    applyImpulse(other, 700, -400);
    game.setInput(frog.id, input({ right: true, up: true }));
  }
  for (let i = 0; i < 120; i++) a.game.step(1 / 60);
  for (let i = 0; i < 60; i++) b.game.step(1 / 30);
  assert.deepEqual(a.game.state, b.game.state);
});
