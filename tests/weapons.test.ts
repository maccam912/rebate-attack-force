import test from "node:test";
import assert from "node:assert/strict";
import { FIXED_STEP, GameEngine, PLAYER_RADIUS, WIDTH } from "../shared/game.js";
import { createInventory, WEAPON_CATALOG, WEAPON_IDS } from "../shared/weapons.js";
import type { GameCommand, GameMode, PlayerInput, WeaponId } from "../shared/types.js";

const input = (aimX: number, aimY: number): PlayerInput => ({ left: false, right: false, up: false, down: false, aimX, aimY });
function advance(game: GameEngine, seconds: number): void {
  for (let frame = 0; frame < Math.ceil(seconds / FIXED_STEP); frame++) game.step(FIXED_STEP);
}
function arena(mode: GameMode = "practice") {
  const game = new GameEngine({ mode, seed: 123 });
  game.state.platforms = [{ id: "floor", x: 0, y: 1000, w: WIDTH, h: 800 }];
  game.state.crates = [];
  const [a, b] = game.state.players;
  Object.assign(a, { x: 500, y: 1000 - PLAYER_RADIUS, hp: 1000, maxHp: 1000 });
  Object.assign(b, { x: 1500, y: 1000 - PLAYER_RADIUS, hp: 1000, maxHp: 1000 });
  return { game, a, b };
}
function fire(game: GameEngine, weapon: WeaponId, aimX = 1200, aimY = 500, power = 1) {
  const id = game.state.activePlayerId;
  assert.equal(game.command(id, { type: "selectWeapon", weapon }), true);
  game.setInput(id, input(aimX, aimY));
  assert.equal(game.command(id, { type: "fire", power }), true);
}

test("all 24 weapons are stocked in normal matches and refilled each practice turn", () => {
  assert.equal(new Set(WEAPON_IDS).size, 24);
  const normal = new GameEngine();
  for (const player of normal.state.players) {
    assert.deepEqual(player.inventory, createInventory());
    for (const weapon of WEAPON_IDS) assert.ok(player.inventory[weapon] > 0);
  }
  const { game, a } = arena();
  fire(game, "golf");
  assert.equal(a.inventory.golf, 8);
  assert.equal(game.command(a.id, { type: "endTurn" }), false, "melee already ended control");
  advance(game, 0.6);
  assert.equal(game.state.turn, 2);
  assert.deepEqual(a.inventory, createInventory("practice"));
});

test("every arsenal command spends exactly one round and rejects another shot", () => {
  for (const weapon of WEAPON_IDS) {
    const { game, a } = arena();
    const count = a.inventory[weapon];
    fire(game, weapon);
    assert.equal(a.inventory[weapon], count - 1, weapon);
    assert.equal(game.state.phase, ["melee", "blast"].includes(WEAPON_CATALOG[weapon].attack) ? "settling" : "retreat", weapon);
    assert.equal(game.command(a.id, { type: "fire" }), false, weapon);
    assert.equal(game.command(a.id, { type: "selectWeapon", weapon: "rocket" }), false, weapon);
    advance(game, 0.2);
    for (const player of game.state.players) assert.ok(Number.isFinite(player.x + player.y + player.vx + player.vy), weapon);
  }
});

test("weapon commands reject unknown ids, empty ammo, inactive callers and invalid aim", () => {
  const { game, a, b } = arena();
  for (const weapon of ["constructor", "__proto__", "missing", 3, {}]) {
    assert.equal(game.command(a.id, { type: "selectWeapon", weapon } as GameCommand), false);
  }
  a.inventory.meteor = 0;
  assert.equal(game.command(a.id, { type: "selectWeapon", weapon: "meteor" }), false);
  assert.equal(game.command(b.id, { type: "selectWeapon", weapon: "bat" }), false);
  assert.equal(game.command(b.id, { type: "fire" }), false);
  game.setInput(a.id, input(a.x, a.y));
  const inventory = { ...a.inventory };
  assert.equal(game.command(a.id, { type: "fire", power: Infinity }), false);
  assert.deepEqual(a.inventory, inventory);
  assert.equal(game.state.phase, "playing");
  fire(game, "rocket", 1200, 500, NaN);
  assert.ok(Number.isFinite(game.state.projectiles[0].vx));
});

test("cluster shells emit exactly one generation of deterministic live bomblets", () => {
  for (const [weapon, count] of [["cluster", 7], ["banana", 5], ["firework", 9]] as const) {
    const { game, a } = arena();
    Object.assign(a, { x: 300, y: 300, grounded: false });
    fire(game, weapon, 1000, 200);
    const parent = game.state.projectiles[0];
    parent.life = FIXED_STEP;
    parent.x = 1500;
    parent.y = 350;
    game.step(FIXED_STEP);
    assert.equal(game.state.projectiles.length, count, weapon);
    assert.ok(game.state.projectiles.every((p) => p.variant === "fragment" && p.ownerId === a.id));
    assert.equal(new Set(game.state.projectiles.map((p) => `${Math.round(p.vx)},${Math.round(p.vy)}`)).size, count, "fan directions are distinct");
    for (const fragment of game.state.projectiles) fragment.life = FIXED_STEP;
    game.step(FIXED_STEP);
    assert.equal(game.state.projectiles.length, 0, "fragments cannot recursively multiply");
  }
});

test("mines stay safe on their placement turn and while an inactive frog is nearby", () => {
  const { game, a, b } = arena("versus");
  fire(game, "mine", a.x, a.y + 100, 0.2);
  assert.equal(game.state.mines.length, 1);
  const mine = game.state.mines[0];
  Object.assign(mine, { x: b.x, y: b.y + 10, vx: 0, vy: 0, settled: true });
  // Even an active deployer standing at the mine cannot trigger it this turn.
  a.x = mine.x - 45;
  advance(game, 0.7);
  assert.equal(mine.fuse, null);
  a.x = 500;
  game.state.turn = 2;
  advance(game, 0.7);
  assert.equal(mine.fuse, null, "a waiting opponent does not trigger a mine");
  assert.equal(game.state.mines.length, 1);
  game.command(a.id, { type: "endTurn" });
  advance(game, 0.4);
  assert.equal(game.state.activePlayerId, b.id, "an idle mine does not block the next turn");
  assert.notEqual(mine.fuse, null, "the nearby opponent starts its own turn and trips the mine");
  game.command(b.id, { type: "endTurn" });
  advance(game, 0.1);
  assert.equal(game.state.phase, "settling", "a lit fuse finishes before the next handoff");
  advance(game, 0.4);
  assert.equal(game.state.mines.length, 0);
  assert.equal(b.hp, 1000);
  assert.ok(game.state.resolution!.pendingDamage[b.id] > 0);
  assert.ok(b.tumble > 0);
});

test("proximity mines cannot sense the active frog through a solid wall", () => {
  const { game, a } = arena();
  game.state.turn = 2;
  game.state.platforms.push({ id: "wall", x: a.x + 24, y: 800, w: 12, h: 200 });
  game.state.mines.push({ id: "hidden", ownerId: "p2", x: a.x + 55, y: a.y + 10,
    vx: 0, vy: 0, kind: "mine", placedTurn: 1, fuse: null, settled: true });
  advance(game, 0.7);
  assert.equal(game.state.mines[0].fuse, null);
  assert.equal(a.hp, 1000);
});

test("spring mines trade damage for a dramatic upward launch", () => {
  const { game, a } = arena();
  game.state.turn = 2;
  game.state.mines.push({ id: "spring", ownerId: "p2", x: a.x, y: a.y + 10,
    vx: 0, vy: 0, kind: "springMine", placedTurn: 1, fuse: 0, settled: true });
  game.step(FIXED_STEP);
  assert.ok(a.vy < -1200);
  assert.ok(a.hp >= 988);
  assert.equal(a.grounded, false);
  assert.equal(game.state.mines.length, 0);
});

test("melee requires reach, facing and an unobstructed line to the target", () => {
  for (const scenario of ["hit", "behind", "far", "wall"] as const) {
    const { game, a, b } = arena();
    b.x = a.x + (scenario === "behind" ? -70 : scenario === "far" ? 220 : 85);
    if (scenario === "wall") game.state.platforms.push({ id: "wall", x: a.x + 35, y: 850, w: 12, h: 150 });
    fire(game, "bat", a.x + 500, a.y);
    if (scenario === "hit") {
      assert.equal(b.hp, 1000);
      assert.ok(game.state.resolution!.pendingDamage[b.id] > 0);
      assert.ok(b.vx > 1200);
      assert.ok(b.angularVelocity > 0);
    } else {
      assert.equal(b.hp, 1000, scenario);
      assert.equal(b.vx, 0, scenario);
    }
  }
});

test("golf, bat and boxing deliver distinct launch angles and recoil", () => {
  const result = new Map<WeaponId, { vx: number; vy: number; recoil: number }>();
  for (const weapon of ["golf", "bat", "boxing"] as const) {
    const { game, a, b } = arena();
    b.x = a.x + 65;
    fire(game, weapon, b.x, b.y);
    result.set(weapon, { vx: b.vx, vy: b.vy, recoil: a.vx });
  }
  assert.ok(result.get("golf")!.vy < result.get("bat")!.vy - 400);
  assert.ok(result.get("bat")!.vx > result.get("golf")!.vx + 300);
  assert.ok(result.get("boxing")!.recoil < 0);
});

test("air support starts above the arena, targets the cursor and is blocked by roofs", () => {
  for (const roof of [false, true]) {
    const { game, b } = arena();
    if (roof) game.state.platforms.push({ id: "bunker", x: b.x - 350, y: 600, w: 700, h: 40 });
    fire(game, "airstrike", b.x, b.y);
    assert.equal(game.state.projectiles.length, 5);
    assert.ok(game.state.projectiles.every((p) => p.y < 0 && p.variant === "strike"));
    advance(game, 1.8);
    if (roof) assert.equal(b.hp, 1000);
    else assert.ok((game.state.resolution?.pendingDamage[b.id] ?? 0) > 0 || b.hp < 1000, "the exposed target is hit");
  }
});

test("sticky gum stays on terrain and follows an attached moving frog until its fuse expires", () => {
  for (const targetType of ["wall", "frog"] as const) {
    const { game, a, b } = arena();
    b.x = a.x + 100;
    if (targetType === "wall") game.state.platforms.push({ id: "wall", x: a.x + 50, y: 800, w: 14, h: 200 });
    fire(game, "sticky", b.x, b.y);
    advance(game, 0.2);
    const shot = game.state.projectiles[0];
    assert.ok(shot.stuck, targetType);
    if (targetType === "frog") {
      assert.equal(shot.attachedPlayerId, b.id);
      b.x += 100;
      game.step(FIXED_STEP);
      assert.equal(shot.x, b.x);
    } else assert.equal(shot.attachedPlayerId, undefined);
    shot.life = FIXED_STEP;
    game.step(FIXED_STEP);
    assert.equal(game.state.projectiles.length, 0);
    assert.ok(game.state.explosions.some((e) => e.weapon === "sticky"));
  }
});

test("push and pull weapons reverse radial impulse while the gust deals no direct damage", () => {
  const gust = arena();
  gust.b.x = gust.a.x + 180;
  fire(gust.game, "gust", gust.b.x, gust.b.y);
  assert.equal(gust.b.hp, 1000);
  assert.ok(gust.b.vx > 800);
  assert.ok(gust.b.vy < 0);
  const vacuum = arena();
  fire(vacuum.game, "vacuum");
  Object.assign(vacuum.game.state.projectiles[0], { x: vacuum.b.x - 80, y: vacuum.b.y - 40, vx: 0, vy: 0, life: FIXED_STEP });
  vacuum.game.step(FIXED_STEP);
  assert.ok(vacuum.b.vx < -500, "the singularity pulls toward its center");
  assert.ok(vacuum.b.vy < 0);
});

test("shotgun fans seven pellets and the returning boomerang reverses its horizontal flight", () => {
  const shotgun = arena();
  fire(shotgun.game, "shotgun", 1200, shotgun.a.y);
  assert.equal(shotgun.game.state.projectiles.length, 7);
  assert.ok(shotgun.game.state.projectiles[0].vy < 0);
  assert.ok(shotgun.game.state.projectiles[6].vy > 0);
  assert.ok(shotgun.a.vx < 0, "pellet spray has recoil");
  const boomerang = arena();
  boomerang.b.x = 2500;
  fire(boomerang.game, "boomerang", 2000, boomerang.a.y);
  advance(boomerang.game, 1.25);
  assert.equal(boomerang.game.state.projectiles.length, 1);
  assert.ok(boomerang.game.state.projectiles[0].vx < 0);
});

test("random mystery crate contents are deterministic by seed and vary between turns", () => {
  const a = new GameEngine({ seed: 73 }), b = new GameEngine({ seed: 73 });
  const before = a.state.crates.map((c) => c.weapon);
  assert.deepEqual(before, b.state.crates.map((c) => c.weapon));
  assert.ok(new Set(before).size > 8);
  a.command(a.state.activePlayerId, { type: "endTurn" });
  advance(a, 0.1);
  assert.notDeepEqual(before, a.state.crates.map((c) => c.weapon));
  const player = a.state.players.find((p) => p.id === a.state.activePlayerId)!;
  const crate = a.state.crates[0];
  const original = player.inventory[crate.weapon];
  crate.x = player.x;
  crate.y = player.y;
  a.step(FIXED_STEP);
  assert.equal(player.inventory[crate.weapon], original + WEAPON_CATALOG[crate.weapon].ammo);
  assert.match(a.state.message, new RegExp(WEAPON_CATALOG[crate.weapon].name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
});

test("all weapon simulations, including split shells and traps, match at different render rates", () => {
  for (const weapon of WEAPON_IDS) {
    const a = arena(), b = arena();
    fire(a.game, weapon, 1000, 600);
    fire(b.game, weapon, 1000, 600);
    for (let frame = 0; frame < 120; frame++) a.game.step(1 / 60);
    for (let frame = 0; frame < 60; frame++) b.game.step(1 / 30);
    assert.deepEqual(a.game.state, b.game.state, weapon);
  }
});


test("a point-blank sonic burp launches targets along the aim even behind its blast center", () => {
  const { game, a, b } = arena();
  b.x = a.x + 60;
  fire(game, "pulse", a.x + 400, a.y);
  assert.ok(b.vx > 800);
  assert.equal(b.hp, 1000);
  assert.ok(game.state.resolution!.pendingDamage[b.id] > 0);
  assert.equal(a.hp, 1000);
});
