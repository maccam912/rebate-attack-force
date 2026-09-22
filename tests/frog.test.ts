import test from "node:test";
import assert from "node:assert/strict";
import { GameEngine } from "../shared/game.js";
import { FrogAnimator, frogPose, solveLeg } from "../src/frog.js";

test("two-bone frog legs keep their lengths for reachable, distant, and coincident targets", () => {
  const hip = { x: 13, y: 4 };
  for (const target of [{ x: 19, y: 15 }, { x: 100, y: -100 }, hip]) {
    for (const side of [-1, 1] as const) {
      const leg = solveLeg(hip, target, side);
      assert.ok(Math.abs(Math.hypot(leg.knee.x - hip.x, leg.knee.y - hip.y) - 17) < 1e-8);
      assert.ok(Math.abs(Math.hypot(leg.foot.x - leg.knee.x, leg.foot.y - leg.knee.y) - 16) < 1e-8);
    }
  }
});

test("grounded feet stay planted during stance in either walking direction", () => {
  const player = new GameEngine().state.players[0];
  for (const vx of [-180, 180]) {
    player.vx = vx;
    const feet = [210, 212, 214].map((x) => {
      player.x = x;
      const pose = frogPose(player, []);
      const foot = pose.legs[0].foot;
      return {
        x: player.x + foot.x * Math.cos(pose.rotation) - foot.y * Math.sin(pose.rotation),
        y: player.y + foot.x * Math.sin(pose.rotation) + foot.y * Math.cos(pose.rotation),
      };
    });
    for (const foot of feet) {
      assert.ok(Math.abs(foot.x - feet[0].x) < 1e-8);
      assert.ok(Math.abs(foot.y - (player.y + 15)) < 1e-8);
    }
  }
});

test("airborne legs trail movement and tuck near the jump apex", () => {
  const player = new GameEngine().state.players[0];
  player.grounded = false;
  player.vy = -450;
  const extended = frogPose(player, []);
  player.vy = 0;
  const tucked = frogPose(player, []);
  assert.ok(extended.legs[0].foot.y > tucked.legs[0].foot.y + 10);
  player.vx = 300;
  const right = frogPose(player, []);
  player.vx = -300;
  const left = frogPose(player, []);
  assert.ok(right.legs[0].foot.x < left.legs[0].foot.x);
});

test("gaze stays aligned with world aim even while the frog rotates", () => {
  const player = new GameEngine().state.players[0];
  player.rotation = Math.PI / 2;
  player.lookAt = { x: player.x + 100, y: player.y };
  const pose = frogPose(player, []);
  const worldX = pose.eyes.x * Math.cos(pose.rotation) - pose.eyes.y * Math.sin(pose.rotation);
  const worldY = pose.eyes.x * Math.sin(pose.rotation) + pose.eyes.y * Math.cos(pose.rotation);
  assert.ok(worldX > 2.7 && Math.abs(worldY) < 1e-8);
});

test("the alarmed face appears only near a living opponent and clears when they leave", () => {
  const players = new GameEngine().state.players;
  const [player, other] = players;
  assert.equal(frogPose(player, players).alarmed, false);
  other.x = player.x + 100;
  other.y = player.y;
  assert.equal(frogPose(player, players).alarmed, true);
  other.alive = false;
  assert.equal(frogPose(player, players).alarmed, false);
  other.alive = true;
  other.x += 200;
  assert.equal(frogPose(player, players).alarmed, false);
});

test("nearby teammates do not trigger the alarmed face", () => {
  const players = new GameEngine({ players: [
    { id: "a", name: "Team A", frogs: 2 },
    { id: "b", name: "Team B" },
  ] }).state.players;
  const [first, teammate] = players;
  assert.ok(Math.hypot(first.x - teammate.x, first.y - teammate.y) < 160);
  assert.equal(frogPose(first, players).alarmed, false);
});

test("diving feet trail above the frog and cosmetic springs preserve leg length without mutating physics", () => {
  const player = new GameEngine().state.players[0];
  player.grounded = false;
  player.vy = 900;
  player.vx = 250;
  player.rotation = 0.7;
  const snapshot = JSON.stringify(player);
  const animator = new FrogAnimator();
  for (let frame = 0; frame < 30; frame++) {
    const pose = animator.pose(player, [], undefined, frame / 60);
    for (const leg of pose.legs) {
      assert.ok(Math.abs(Math.hypot(leg.knee.x - leg.hip.x, leg.knee.y - leg.hip.y) - 17) < 1e-8);
      assert.ok(Math.abs(Math.hypot(leg.foot.x - leg.knee.x, leg.foot.y - leg.knee.y) - 16) < 1e-8);
      const worldY = leg.foot.x * Math.sin(pose.rotation) + leg.foot.y * Math.cos(pose.rotation);
      assert.ok(worldY < 0, "fast falling legs trail upward");
    }
    assert.equal(pose.alarmed, true);
  }
  assert.equal(JSON.stringify(player), snapshot);
});
