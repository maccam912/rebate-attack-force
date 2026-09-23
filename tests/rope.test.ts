import { singleFrogGame } from "./fixtures.js";
import test from "node:test";
import assert from "node:assert/strict";
import { FIXED_STEP } from "../shared/game.js";
import { ropePathLength, ropeSegmentBlocked, updateRopePath } from "../shared/rope.js";
import type { Platform, Point, Rope } from "../shared/types.js";

const shelf: Platform = { id: "shelf", x: 300, y: 400, w: 240, h: 40 };
function assertClear(rope: Rope, end: Point, platforms: Platform[]) {
  const points = [rope, ...rope.bends, end];
  for (let i = 1; i < points.length; i++)
    assert.equal(ropeSegmentBlocked(points[i - 1], points[i], platforms), false, `segment ${i} crosses terrain`);
}

test("a rope wraps both corners when the player swings under its anchor platform", () => {
  const rope: Rope = { x: 420, y: 400, length: 450, bends: [] };
  const end = { x: 480, y: 550 };
  updateRopePath(rope, { x: 600, y: 550 }, [shelf]);
  assert.equal(updateRopePath(rope, end, [shelf]), true);
  assert.equal(rope.bends.length, 2);
  assert.ok(rope.bends.every((b) => b.x >= shelf.x + shelf.w));
  assertClear(rope, end, [shelf]);
  assert.ok(ropePathLength(rope, end) > Math.hypot(end.x - rope.x, end.y - rope.y) + 30);
  updateRopePath(rope, { x: 600, y: 350 }, [shelf]);
  assert.equal(rope.bends.length, 0, "contacts unwrap on the return swing");
});

test("the rope retains its winding side while passing beneath a platform", () => {
  const rope: Rope = { x: 420, y: 400, length: 600, bends: [] };
  updateRopePath(rope, { x: 600, y: 550 }, [shelf]);
  updateRopePath(rope, { x: 260, y: 550 }, [shelf]);
  assert.ok(rope.bends[0].x > shelf.x + shelf.w, "does not teleport to the shorter left route");
  assertClear(rope, { x: 260, y: 550 }, [shelf]);
});

test("ropes route around multiple solids and touching terrain", () => {
  const solids = [
    shelf,
    { id: "lower", x: 550, y: 460, w: 120, h: 130 },
    { id: "adjacent", x: 670, y: 460, w: 120, h: 130 },
  ];
  const rope: Rope = { x: 420, y: 400, length: 680, bends: [] };
  const end = { x: 800, y: 630 };
  assert.equal(updateRopePath(rope, end, solids), true);
  assertClear(rope, end, solids);
  assert.ok(rope.bends.length >= 2);
  const copy = JSON.parse(JSON.stringify(rope)) as Rope;
  assert.deepEqual(copy, rope, "contacts survive room snapshot serialization");
});

test("wrapping, reeling, and releasing use the entire routed rope length", () => {
  const game = singleFrogGame({ mode: "practice" });
  game.state.platforms = [shelf, { id: "floor", x: 0, y: 1000, w: 4320, h: 800 }];
  const player = game.state.players[0]!;
  Object.assign(player, { x: 600, y: 550, vx: 100, vy: 0, grounded: false,
    rope: { x: 420, y: 400, length: 320, bends: [] } });
  game.state.players[1]!.x = 2000;
  game.state.players[1]!.y = 982;
  game.setInput(player.id, { left: false, right: true, up: true, down: false, aimX: 420, aimY: 400 });
  for (let i = 0; i < 70; i++) {
    game.step(FIXED_STEP);
    assert.ok(player.rope);
    assertClear(player.rope, player, game.state.platforms);
    assert.ok(ropePathLength(player.rope, player) <= player.rope.length + 0.01);
  }
  assert.ok(player.rope!.length < 280, "reeling shortens the routed length");
  const { vx, vy } = player;
  assert.equal(game.command(player.id, { type: "release" }), true);
  assert.equal(player.rope, null);
  assert.equal(player.vx, vx);
  assert.equal(player.vy, vy);
});
