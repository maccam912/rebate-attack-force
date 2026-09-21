import test from "node:test";
import assert from "node:assert/strict";
import {
  FIXED_STEP,
  GameEngine,
  GRAPPLE_RANGE,
  PLAYER_RADIUS,
  RETREAT_SECONDS,
  WATER_Y,
  WIDTH,
  SPAWNS,
} from "../shared/game.js";
import type { PlayerInput } from "../shared/types.js";

const input = (overrides: Partial<PlayerInput> = {}): PlayerInput => ({
  left: false,
  right: false,
  up: false,
  down: false,
  aimX: 1280,
  aimY: 632,
  ...overrides,
});
function advance(game: GameEngine, seconds: number): void {
  for (let frame = 0; frame < Math.ceil(seconds / FIXED_STEP); frame++)
    game.step(FIXED_STEP);
}
function walkToFirstCrate(game: GameEngine): void {
  const player = game.state.players.find(
    (candidate) => candidate.id === game.state.activePlayerId,
  )!;
  const crate = game.state.crates[0]!;
  for (let frame = 0; frame < 360 && !player.hasCrate; frame++) {
    game.setInput(
      player.id,
      input({ left: crate.x < player.x, right: crate.x > player.x }),
    );
    game.step(FIXED_STEP);
  }
  game.setInput(player.id, input());
  assert.equal(
    player.hasCrate,
    true,
    "the fresh supply crate is reachable by walking",
  );
}

test("a crate is required to attack, and one pickup permits exactly one shot", () => {
  const game = new GameEngine();
  assert.equal(game.command("p1", { type: "fire" }), false);
  assert.equal(game.state.projectiles.length, 0);
  walkToFirstCrate(game);
  assert.equal(game.state.players[0]!.weapon, "rocket");
  game.setInput("p1", input({ aimX: -1000, aimY: -1000 }));
  assert.equal(game.command("p1", { type: "fire" }), true);
  assert.equal(game.state.phase, "retreat");
  assert.equal(game.state.timeLeft, RETREAT_SECONDS);
  assert.equal(game.state.players[0]!.weapon, null);
  assert.equal(game.command("p1", { type: "fire" }), false);
  advance(game, RETREAT_SECONDS + 3);
  assert.equal(game.state.activePlayerId, "p2");
  assert.equal(game.state.phase, "playing");
  assert.equal(game.state.players[1]!.hasCrate, false);
  assert.equal(game.command("p2", { type: "fire" }), false);
});

test("inactive and unknown players cannot move, jump, end turns, or attack", () => {
  const game = new GameEngine();
  const other = game.state.players[1]!;
  const startX = other.x;
  game.setInput("p2", input({ left: true }));
  game.setInput("missing", input({ right: true }));
  for (const type of [
    "jump",
    "grapple",
    "release",
    "fire",
    "endTurn",
    "selectWeapon",
  ] as const) {
    assert.equal(game.command("p2", { type }), false);
    assert.equal(game.command("missing", { type }), false);
  }
  advance(game, 1);
  assert.equal(other.x, startX);
  assert.equal(game.state.turn, 1);
});

test("grapple raycast catches solid geometry, reels in, and release preserves momentum", () => {
  const game = new GameEngine();
  const player = game.state.players[0]!;
  game.setInput("p1", input({ aimX: 420, aimY: 1400 }));
  assert.equal(game.command("p1", { type: "grapple" }), true);
  assert.ok(player.rope);
  assert.ok(player.rope.length <= GRAPPLE_RANGE);
  const originalLength = player.rope.length;
  const originalY = player.y;
  game.setInput("p1", input({ aimX: 420, aimY: 1400, right: true, up: true }));
  advance(game, 0.75);
  assert.ok(player.rope);
  assert.ok(player.rope.length < originalLength - 100, "up reels the rope in");
  assert.ok(player.y < originalY - 22, "reeling lifts the character away from the ground");
  assert.ok(
    Math.hypot(player.x - player.rope.x, player.y - player.rope.y) <=
      player.rope.length + 1,
  );
  const vx = player.vx;
  const vy = player.vy;
  assert.ok(Math.hypot(vx, vy) > 20, "steering builds swing momentum");
  assert.equal(game.command("p1", { type: "release" }), true);
  assert.equal(player.rope, null);
  assert.equal(player.vx, vx);
  assert.equal(player.vy, vy);
  game.setInput("p1", input());
  const x = player.x;
  game.step(FIXED_STEP);
  assert.ok(
    Math.abs(player.x - x) > 0.01,
    "momentum carries through after release",
  );
});

test("grapple rejects empty sky and geometry outside maximum range", () => {
  const game = new GameEngine();
  game.state.platforms = [{ id: "test-lookout", x: 600, y: 290, w: 240, h: 32 }];
  game.setInput("p1", input({ aimX: 10, aimY: 100 }));
  assert.equal(game.command("p1", { type: "grapple" }), false);
  game.state.players[0]!.x = 30;
  game.state.players[0]!.y = 300;
  game.setInput("p1", input({ aimX: 2000, aimY: 300 }));
  assert.equal(
    game.command("p1", { type: "grapple" }),
    true,
    "the lookout is within reach",
  );
  game.state.players[0]!.y = 400;
  game.setInput("p1", input({ aimX: 2000, aimY: 400 }));
  assert.equal(game.command("p1", { type: "grapple" }), false);
});

test("fast falling characters cannot tunnel through thin shelves", () => {
  const game = new GameEngine();
  const player = game.state.players[0]!;
  player.x = 420;
  player.y = 1335;
  player.vy = 1000;
  player.grounded = false;
  advance(game, 0.15);
  assert.equal(player.y, 1400 - PLAYER_RADIUS);
  assert.equal(player.vy, 0);
  assert.equal(player.grounded, true);
});

test("water eliminates a player and resolves the winner", () => {
  const game = new GameEngine();
  game.state.players[0]!.x = 25;
  game.state.players[0]!.y = WATER_Y - PLAYER_RADIUS;
  game.step(FIXED_STEP);
  assert.equal(game.state.players[0]!.alive, false);
  assert.equal(game.state.players[0]!.hp, 0);
  assert.equal(game.state.phase, "finished");
  assert.equal(game.state.winnerId, "p2");
});

test("a departed active room member is eliminated and play advances to a survivor", () => {
  const game = new GameEngine({
    players: [
      { id: "a", name: "A" },
      { id: "b", name: "B" },
      { id: "c", name: "C" },
    ],
  });
  game.removePlayer("a");
  assert.equal(game.state.players[0]!.alive, false);
  assert.equal(game.state.activePlayerId, "b");
  assert.equal(game.state.phase, "playing");
  game.removePlayer("c");
  assert.equal(game.state.phase, "finished");
  assert.equal(game.state.winnerId, "b");
});

test("practice respawns drowned players and always returns control to its first player", () => {
  const game = new GameEngine({ mode: "practice" });
  game.state.players[0]!.x = 25;
  game.state.players[0]!.y = WATER_Y - PLAYER_RADIUS;
  advance(game, 0.1);
  assert.equal(game.state.phase, "playing");
  assert.equal(game.state.players[0]!.alive, true);
  assert.equal(game.state.players[0]!.hp, 100);
  assert.equal(game.state.activePlayerId, "p1");
  assert.equal(game.state.winnerId, null);
  const turn = game.state.turn;
  advance(game, 95);
  assert.equal(
    game.state.timeLeft,
    90,
    "practice has no action-phase countdown",
  );
  assert.equal(game.state.turn, turn, "practice does not expire a turn");
  walkToFirstCrate(game);
  game.setInput("p1", input({ aimX: -1000, aimY: -1000 }));
  assert.equal(game.command("p1", { type: "fire" }), true);
  advance(game, RETREAT_SECONDS + 3);
  assert.equal(
    game.state.turn,
    turn + 1,
    "practice still counts down its retreat phase",
  );
  assert.equal(game.state.timeLeft, 90);
});

test("invalid inputs cannot introduce NaN, infinity, or an unbounded simulation jump", () => {
  const game = new GameEngine();
  game.setInput("p1", input({ aimX: Number.NaN, aimY: Infinity }));
  game.command("p1", { type: "grapple" });
  walkToFirstCrate(game);
  assert.equal(game.command("p1", { type: "fire", power: Number.NaN }), true);
  game.step(Number.NaN);
  game.step(Infinity);
  game.step(-100);
  game.step(100000);
  assert.equal(game.state.turn, 1);
  for (const player of game.state.players) {
    assert.ok(Number.isFinite(player.x) && Number.isFinite(player.y));
    assert.ok(Number.isFinite(player.vx) && Number.isFinite(player.vy));
  }
});

test("the simulation produces the same state at different rendering frame rates", () => {
  const a = new GameEngine({ seed: 12 });
  const b = new GameEngine({ seed: 12 });
  a.setInput("p1", input({ right: true }));
  b.setInput("p1", input({ right: true }));
  for (let frame = 0; frame < 120; frame++) a.step(1 / 60);
  for (let frame = 0; frame < 60; frame++) b.step(1 / 30);
  assert.deepEqual(a.state, b.state);
});

test("point blank rockets hit nearby enemies instead of skipping past their body", () => {
  const game = new GameEngine();
  const shooter = game.state.players[0]!;
  const target = game.state.players[1]!;
  target.x = shooter.x + 25;
  target.y = shooter.y;
  shooter.hasCrate = true;
  shooter.weapon = "rocket";
  shooter.inventory.rocket = 1;
  game.setInput("p1", input({ aimX: target.x, aimY: target.y }));
  assert.equal(game.command("p1", { type: "fire" }), true);
  advance(game, 0.02);
  assert.ok(target.hp < 100);
  assert.equal(game.state.projectiles.length, 0);
});

test("grenades arc, bounce off terrain, and explode when their fuse expires", () => {
  const game = new GameEngine();
  const player = game.state.players[0]!;
  player.weapon = "grenade";
  player.hasCrate = true;
  player.inventory.grenade = 1;
  game.setInput("p1", input({ aimX: player.x + 100, aimY: player.y + 100 }));
  assert.equal(game.command("p1", { type: "fire", power: 0.2 }), true);
  advance(game, 0.1);
  assert.equal(
    game.state.projectiles.length,
    1,
    "terrain contact does not detonate a grenade",
  );
  assert.ok(
    game.state.projectiles[0]!.vy < 0,
    "the grenade bounced upward off the island",
  );
  advance(game, 2.05);
  assert.equal(game.state.projectiles.length, 0);
  assert.ok(game.state.explosions.length > 0, "the fuse produced an explosion");
  assert.ok(player.hp < 100, "the blast can damage its owner");
});

test("pulse is a short-range directional blast that spares its owner", () => {
  const game = new GameEngine();
  const player = game.state.players[0]!;
  const target = game.state.players[1]!;
  target.x = player.x + 130;
  player.weapon = "pulse";
  player.hasCrate = true;
  player.inventory.pulse = 1;
  game.setInput("p1", input({ aimX: target.x, aimY: target.y }));
  assert.equal(game.command("p1", { type: "fire" }), true);
  assert.equal(game.state.projectiles.length, 0);
  assert.ok(target.hp < 100);
  assert.ok(target.vx > 0);
  assert.equal(player.hp, 100);
});

test("the turn deadline switches players and preserves unused ammunition", () => {
  const game = new GameEngine();
  walkToFirstCrate(game);
  game.state.timeLeft = 0.01;
  advance(game, 1);
  assert.equal(game.state.activePlayerId, "p2");
  assert.equal(game.state.turn, 2);
  assert.equal(game.state.players[0]!.inventory.rocket, 1);
  assert.equal(game.state.players[0]!.weapon, "rocket");
  assert.equal(game.command("p2", { type: "endTurn" }), true);
  advance(game, 0.1);
  assert.equal(game.state.activePlayerId, "p1");
  assert.equal(game.state.players[0]!.hasCrate, true);
  game.setInput("p1", input({ aimX: -1000, aimY: -1000 }));
  assert.equal(
    game.command("p1", { type: "fire" }),
    true,
    "saved ammo can be fired without finding another crate",
  );
  assert.equal(game.state.players[0]!.inventory.rocket, 0);
});

test("skipping a turn preserves saved ammo and the selected weapon", () => {
  const game = new GameEngine();
  walkToFirstCrate(game);
  const player = game.state.players[0]!;
  player.inventory.grenade = 2;
  assert.equal(
    game.command("p1", { type: "selectWeapon", weapon: "grenade" }),
    true,
  );
  assert.equal(game.command("p1", { type: "endTurn" }), true);
  advance(game, 1);
  assert.equal(game.state.activePlayerId, "p2");
  game.command("p2", { type: "endTurn" });
  advance(game, 0.1);
  assert.equal(game.state.activePlayerId, "p1");
  assert.deepEqual(player.inventory, { rocket: 1, grenade: 2, pulse: 0 });
  assert.equal(player.weapon, "grenade");
  assert.equal(player.hasCrate, true);
});

test("crates add ammunition, selection spends only its weapon, and spare ammo cannot grant a second shot", () => {
  const game = new GameEngine();
  walkToFirstCrate(game);
  const player = game.state.players[0]!;
  game.state.crates.push(
    { id: "extra-rocket", x: player.x, y: player.y, weapon: "rocket" },
    { id: "extra-grenade", x: player.x, y: player.y, weapon: "grenade" },
  );
  game.step(FIXED_STEP);
  assert.deepEqual(player.inventory, { rocket: 2, grenade: 1, pulse: 0 });
  assert.equal(
    player.weapon,
    "rocket",
    "collecting another type preserves the stocked selection",
  );
  assert.equal(
    game.command("p1", { type: "selectWeapon", weapon: "pulse" }),
    false,
  );
  assert.equal(
    game.command("p1", { type: "selectWeapon", weapon: "grenade" }),
    true,
  );
  game.setInput("p1", input({ aimX: 600, aimY: 350 }));
  assert.equal(game.command("p1", { type: "fire" }), true);
  assert.deepEqual(player.inventory, { rocket: 2, grenade: 0, pulse: 0 });
  assert.equal(
    player.weapon,
    "rocket",
    "an exhausted weapon falls back to stocked ammunition",
  );
  assert.equal(player.hasCrate, false);
  assert.equal(game.command("p1", { type: "fire" }), false);
  assert.equal(
    game.command("p1", { type: "selectWeapon", weapon: "rocket" }),
    false,
  );
  game.state.crates.push({
    id: "retreat-supply",
    x: player.x,
    y: player.y,
    weapon: "rocket",
  });
  game.step(FIXED_STEP);
  assert.equal(
    player.inventory.rocket,
    2,
    "retreat cannot collect another crate and rearm",
  );
});

test("a killing blast keeps simulating its airborne survivor and can produce a draw", () => {
  const game = new GameEngine();
  const shooter = game.state.players[0]!;
  const target = game.state.players[1]!;
  Object.assign(shooter, {
    x: WIDTH - 30,
    y: WATER_Y - 50,
    vy: 450,
    grounded: false,
    hasCrate: true,
    weapon: "rocket",
  });
  shooter.inventory.rocket = 1;
  Object.assign(target, { x: WIDTH - 40, y: WATER_Y - 45, vy: 450, hp: 1, grounded: false });
  game.setInput("p1", input({ aimX: target.x, aimY: target.y }));
  assert.equal(game.command("p1", { type: "fire" }), true);
  game.step(FIXED_STEP);
  assert.equal(target.alive, false);
  assert.equal(shooter.alive, true);
  assert.equal(game.state.phase, "settling");
  assert.equal(game.state.winnerId, null);
  advance(game, 1);
  assert.equal(shooter.alive, false);
  assert.equal(game.state.phase, "finished");
  assert.equal(game.state.winnerId, null);
});

test("a complete match progresses through reachable crates, attacks, turns, and a winner", () => {
  const game = new GameEngine({ seed: 5 });
  // A clear combat lane keeps this lifecycle test independent of map traversal.
  game.state.platforms = [
    { id: "west-test-island", x: 60, y: 1600, w: 550, h: 200 },
    { id: "east-test-island", x: 830, y: 1600, w: 550, h: 200 },
  ];
  game.state.players[1]!.x = 1280;
  let attacks = 0;
  for (let turns = 0; turns < 12 && game.state.phase !== "finished"; turns++) {
    walkToFirstCrate(game);
    const player = game.state.players.find(
      (candidate) => candidate.id === game.state.activePlayerId,
    )!;
    const target = game.state.players.find(
      (candidate) => candidate.alive && candidate.id !== player.id,
    )!;
    // The opening shot intentionally misses so the test also covers a handoff.
    game.setInput(
      player.id,
      input(
        turns === 0
          ? { aimX: -1000, aimY: -1000 }
          : { aimX: target.x, aimY: target.y },
      ),
    );
    // All actual combat is exercised with the crate's awarded weapon.
    assert.equal(game.command(player.id, { type: "fire" }), true);
    attacks++;
    advance(game, RETREAT_SECONDS + 3);
  }
  assert.ok(attacks >= 2);
  assert.equal(game.state.phase, "finished");
  assert.ok(game.state.winnerId);
  assert.equal(game.state.players.filter((player) => player.alive).length, 1);
});


test("the expanded arena provides elevated routes and supported spawns", () => {
  const game = new GameEngine();
  assert.ok(game.state.width >= 4000 && game.state.height >= 1700);
  assert.ok(game.state.platforms.length >= 25);
  for (const spawn of SPAWNS)
    assert.ok(game.state.platforms.some((p) => spawn.x > p.x && spawn.x < p.x + p.w && spawn.y + PLAYER_RADIUS === p.y));
  assert.ok(game.state.crates.some((crate) => crate.x > 3000));
  assert.ok(game.state.crates.some((crate) => crate.y < 400));
});

function contactArena() {
  const game = new GameEngine({ mode: "practice" });
  game.state.platforms = [{ id: "floor", x: 0, y: 1000, w: WIDTH, h: 800 }];
  game.state.crates = [];
  const [a, b] = game.state.players;
  Object.assign(a, { x: 400, y: 1000 - PLAYER_RADIUS, vx: 0, vy: 0 });
  Object.assign(b, { x: 460, y: 1000 - PLAYER_RADIUS, vx: 0, vy: 0 });
  return { game, a, b };
}

test("walking pushes an inactive frog instead of crossing its body", () => {
  const { game, a, b } = contactArena();
  game.setInput(a.id, input({ right: true }));
  for (let frame = 0; frame < 180; frame++) {
    game.step(FIXED_STEP);
    assert.ok(a.x <= b.x - PLAYER_RADIUS * 2 + 0.15);
  }
  assert.ok(b.x > 540, "the inactive body receives momentum");
});

test("a frog can land on another, stand there, and jump off", () => {
  const { game, a, b } = contactArena();
  Object.assign(a, { x: b.x, y: b.y - PLAYER_RADIUS * 2 - 6, grounded: false });
  advance(game, 0.6);
  assert.ok(Math.abs(b.y - a.y - PLAYER_RADIUS * 2) < 0.15);
  assert.equal(a.grounded, true);
  assert.equal(game.command(a.id, { type: "jump" }), true);
  advance(game, 0.15);
  assert.ok(b.y - a.y > 80);
});

test("a high landing launches the lower frog into a sustained tumble", () => {
  const { game, a, b } = contactArena();
  const originalX = b.x;
  Object.assign(a, { x: b.x - 7, y: b.y - 190, vy: 700, grounded: false });
  advance(game, 0.25);
  assert.ok(b.vx > 200, "stomp sends the lower body sideways");
  assert.ok(b.tumble > 1, "the launch enables rolling friction");
  assert.ok(Math.abs(b.rotation) > 0.2, "the visible body tumbles");
  advance(game, 0.6);
  assert.ok(b.x > originalX + 180, "momentum persists after the impact");
});

test("fast opposing bodies cannot tunnel through one another", () => {
  const { game, a, b } = contactArena();
  Object.assign(a, { x: 400, y: 600, vx: 1100, grounded: false });
  Object.assign(b, { x: 447, y: 600, vx: -1100, grounded: false });
  advance(game, 0.1);
  assert.ok(a.x < b.x);
  assert.ok(Math.hypot(a.x - b.x, a.y - b.y) >= PLAYER_RADIUS * 2 - 0.2);
});

test("body separation cannot shove a pinned frog through a wall", () => {
  const { game, a, b } = contactArena();
  game.state.platforms.push({ id: "wall", x: 500, y: 800, w: 80, h: 200 });
  b.x = 500 - PLAYER_RADIUS;
  a.x = b.x - PLAYER_RADIUS * 2;
  game.setInput(a.id, input({ right: true }));
  advance(game, 2);
  assert.ok(b.x <= 500 - PLAYER_RADIUS + 0.01);
  assert.ok(b.x - a.x >= PLAYER_RADIUS * 2 - 0.15);
  assert.ok(a.y <= 1000 - PLAYER_RADIUS && b.y <= 1000 - PLAYER_RADIUS);
});


test("reeling cannot pull a frog through another body pinned against terrain", () => {
  const { game, a, b } = contactArena();
  game.state.platforms.push({ id: "wall", x: 500, y: 800, w: 80, h: 200 });
  b.x = 500 - PLAYER_RADIUS;
  a.x = b.x - PLAYER_RADIUS * 2;
  a.rope = { x: 500, y: a.y, length: 54, bends: [] };
  game.setInput(a.id, input({ up: true }));
  for (let frame = 0; frame < 120; frame++) {
    game.step(FIXED_STEP);
    assert.ok(b.x - a.x >= PLAYER_RADIUS * 2 - 0.15);
    assert.ok(b.x <= 500 - PLAYER_RADIUS + 0.01);
  }
  assert.ok(a.rope);
});


test("a short drop supports climbing onto a frog without triggering a stomp", () => {
  const { game, a, b } = contactArena();
  const originalX = b.x;
  Object.assign(a, { x: b.x, y: b.y - 95, grounded: false });
  advance(game, 0.8);
  assert.equal(b.tumble, 0);
  assert.equal(b.x, originalX);
  assert.equal(a.grounded, true);
  assert.ok(Math.abs(b.y - a.y - PLAYER_RADIUS * 2) < 0.15);
});
