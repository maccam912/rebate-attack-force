import test from "node:test";
import assert from "node:assert/strict";
import { FIXED_STEP, GameEngine, HEIGHT, makePlatforms, PLAYER_RADIUS, SPAWNS, WATER_Y, WIDTH } from "../shared/game.js";
import { DEFAULT_MAP_ID, getMap, isMapId, MAPS } from "../shared/maps.js";
import { MAX_FROGS, MAX_MINES } from "../shared/settings.js";
import type { GameState, Point } from "../shared/types.js";
import { WEAPON_CATALOG } from "../shared/weapons.js";
import { imageSurface } from "../shared/image-terrain.js";

function advance(game: GameEngine, seconds: number): void {
  for (let frame = 0; frame < Math.ceil(seconds / FIXED_STEP); frame++) game.step(FIXED_STEP);
}

function assertExposedTop(state: GameState, point: Point, radius: number): void {
  assert.ok(point.x >= radius && point.x <= state.width - radius && point.y >= radius);
  const support = state.platforms.find((platform) =>
    point.y + radius === platform.y && (getMap(state.mapId).image
      ? point.x + radius > platform.x && point.x - radius < platform.x + platform.w
      : point.x - radius >= platform.x && point.x + radius <= platform.x + platform.w));
  assert.ok(support, `supported position at ${point.x}, ${point.y}`);
  assert.ok(!support.boundary, "nothing spawns above an enclosing wall");
  if (getMap(state.mapId).image) assert.equal(imageSurface(state.platforms, point.x, point.y + radius, radius)?.steep, false,
    "starting positions and supplies must be on stable surfaces");
  assert.ok(state.platforms.every((platform) => platform === support ||
    point.x + radius <= platform.x || point.x - radius >= platform.x + platform.w ||
    point.y + radius <= platform.y || point.y - radius >= platform.y + platform.h), "position is not inside terrain");
  if (state.hasWater !== false) assert.ok(point.y + radius < state.waterY);
}

test("the authored catalog includes different scales, dry enclosed terrain, and tree and animal platforms", () => {
  assert.equal(new Set(MAPS.map((map) => map.id)).size, MAPS.length);
  assert.deepEqual(new Set(MAPS.map((map) => map.size)), new Set(["Small", "Medium", "Large"]));
  assert.ok(getMap("pocket-yard").width < WIDTH && getMap("wild-canopy").width > WIDTH);
  assert.equal(getMap("crystal-cave").hasWater, false);
  for (const map of MAPS) {
    assert.ok(isMapId(map.id));
    assert.equal(getMap(map.id), map);
    assert.equal(new Set(map.platforms.map((platform) => platform.id)).size, map.platforms.length);
    assert.ok(map.spawnPlatformIds.every((id) => map.platforms.some((platform) => platform.id === id)));
    if (!map.hasWater) assert.ok(map.waterY > map.height);
  }
  for (const appearance of ["canopy", "branch", "tortoise", "crocodile"])
    assert.ok(getMap("wild-canopy").platforms.some((platform) => platform.appearance === appearance));
  const canopy = getMap("wild-canopy").platforms;
  assert.ok(canopy.some((cap) => cap.appearance === "canopy" && canopy.some((base) =>
    base !== cap && cap.y + cap.h === base.y && cap.x > base.x && cap.x + cap.w < base.x + base.w)),
  "leaf crowns have actual stepped collision surfaces");
  for (const value of [undefined, null, "", "missing", "toString", "__proto__", 0, {}, []]) {
    assert.equal(isMapId(value), false);
    assert.equal(getMap(value as string | undefined).id, DEFAULT_MAP_ID);
  }
});

test("default and unknown maps retain the original arena, frog positions, and independent terrain copies", () => {
  const options = { players: Array.from({ length: 4 }, (_, index) => ({ id: `t${index}`, name: `Team ${index}`, frogs: 1 })) };
  const game = new GameEngine(options);
  assert.equal(game.state.mapId, DEFAULT_MAP_ID);
  assert.deepEqual([game.state.width, game.state.height, game.state.waterY], [WIDTH, HEIGHT, WATER_Y]);
  assert.equal(game.state.platforms.length, 29);
  assert.deepEqual(game.state.platforms, makePlatforms());
  assert.deepEqual(game.state.players.map(({ x, y }) => ({ x, y })), SPAWNS);
  assert.deepEqual(new GameEngine({ ...options, mapId: "unknown" }).capture(), game.capture());
  game.state.platforms[0]!.x = -100;
  assert.equal(getMap().platforms[0]!.x, 60, "playing one arena cannot mutate the catalog or another game");
});

for (const map of MAPS) {
  test(`${map.name}: full six-frog teams and expanded rosters start safely with exposed supplies and mines`, () => {
    for (const teamCount of [2, map.spawnPlatformIds.length, map.spawnPlatformIds.length + 2]) {
      const game = new GameEngine({ mapId: map.id, seed: 762, mineCount: MAX_MINES,
        players: Array.from({ length: teamCount }, (_, index) => ({ id: `team-${index}`, name: `Team ${index}`, frogs: MAX_FROGS })),
      });
      assert.equal(game.state.height, map.height);
      assert.equal(game.state.hasWater, map.hasWater);
      assert.equal(new Set(game.state.platforms.map((platform) => platform.id)).size, game.state.platforms.length);
      for (const [index, frog] of game.state.players.entries()) {
        assertExposedTop(game.state, frog, PLAYER_RADIUS);
        assert.ok(game.state.players.slice(index + 1).every((other) => Math.hypot(frog.x - other.x, frog.y - other.y) >= PLAYER_RADIUS * 2),
          `${frog.id} starts separated from every other frog`);
      }
      assert.ok(game.state.crates.length > 0);
      for (const crate of game.state.crates) assertExposedTop(game.state, crate, PLAYER_RADIUS);
      for (const mine of game.state.mines) {
        assertExposedTop(game.state, mine, 8);
        assert.ok(game.state.players.every((frog) => Math.hypot(frog.x - mine.x, frog.y - mine.y) >= WEAPON_CATALOG.mine.range + PLAYER_RADIUS));
      }
      const positions = game.state.players.map(({ x, y }) => ({ x, y }));
      advance(game, 0.2);
      assert.deepEqual(game.state.players.map(({ x, y }) => ({ x, y })), positions);
      assert.ok(game.state.players.every((frog) => frog.alive && frog.grounded && frog.hp === frog.maxHp));
      assert.ok(game.state.mines.every((mine) => mine.settled && mine.fuse === null));
      if (teamCount > map.spawnPlatformIds.length) {
        assert.equal(game.state.width, map.width * 2);
        assert.ok(game.state.players.some((frog) => frog.x > map.width));
      }
    }
  });

  test(`${map.name}: practice respawns and JSON checkpoints retain the selected map`, () => {
    const game = new GameEngine({ mapId: map.id, mode: "practice", seed: 326, players: [
      { id: "a", name: "A", frogs: 2 }, { id: "b", name: "B", frogs: 2 },
    ] });
    const frog = game.state.players[3]!;
    const spawn = { x: frog.x, y: frog.y };
    Object.assign(frog, { alive: false, hp: 0, x: 40, y: 40 });
    const restored = new GameEngine();
    restored.restore(JSON.parse(JSON.stringify(game.capture())));
    for (const engine of [game, restored]) {
      assert.ok(engine.command(engine.state.activePlayerId, { type: "endTurn" }));
      advance(engine, 0.2);
      assert.deepEqual({ x: engine.state.players[3]!.x, y: engine.state.players[3]!.y }, spawn);
      assert.equal(engine.state.players[3]!.alive, true);
      assert.equal(engine.state.mapId, map.id);
    }
    assert.deepEqual(restored.capture(), game.capture());
  });
}

test("jungle frogs, projectiles, and mines use its river height instead of the original scrapyard waterline", () => {
  const game = new GameEngine({ mapId: "wild-canopy", mode: "practice", players: [
    { id: "a", name: "A", frogs: 1 }, { id: "b", name: "B", frogs: 1 },
  ] });
  const frog = game.state.players[0]!;
  Object.assign(frog, { x: 20, y: 1800, grounded: false });
  game.state.projectiles = [{ id: "test-projectile", ownerId: frog.id, x: 20, y: 1850, vx: 0, vy: 0,
    kind: "rocket", life: 5, radius: 90, damage: 30 }];
  game.state.mines = [{ id: "test-mine", ownerId: frog.id, x: 20, y: 1900, vx: 0, vy: 0,
    kind: "mine", placedTurn: game.state.turn, fuse: null, settled: false }];
  game.step(FIXED_STEP);
  assert.equal(game.state.projectiles.length, 1);
  assert.equal(game.state.mines.length, 1);
  assert.ok(!game.state.soundEvents!.some((event) => event.kind === "splash"));
  assert.ok(!game.state.resolution?.drownedPlayerIds.includes(frog.id));
  frog.y = game.state.waterY - PLAYER_RADIUS + 1;
  game.state.projectiles[0]!.y = game.state.waterY + 1;
  game.state.mines[0]!.y = game.state.waterY + 1;
  game.step(FIXED_STEP);
  assert.equal(game.state.projectiles.length, 0);
  assert.equal(game.state.mines.length, 0);
  assert.ok(game.state.resolution?.drownedPlayerIds.includes(frog.id));
  assert.equal(game.state.soundEvents!.filter((event) => event.kind === "splash").length, 3);
});

test("dry caves disable water damage and splash events, even when reading a water marker inside the arena", () => {
  const game = new GameEngine({ mapId: "crystal-cave", mode: "practice" });
  game.state.waterY = 1000;
  game.state.projectiles = [{ id: "test-projectile", ownerId: game.state.activePlayerId, x: 2000, y: 1200, vx: 0, vy: 0,
    kind: "rocket", life: 5, radius: 90, damage: 30 }];
  game.state.mines = [{ id: "test-mine", ownerId: game.state.activePlayerId, x: 2000, y: 1250, vx: 0, vy: 0,
    kind: "mine", placedTurn: game.state.turn, fuse: null, settled: false }];
  game.step(FIXED_STEP);
  assert.equal(game.state.projectiles.length, 1);
  assert.equal(game.state.mines.length, 1);
  assert.ok(game.state.players.every((frog) => frog.alive && frog.hp === frog.maxHp));
  assert.ok(!game.state.soundEvents!.some((event) => event.kind === "splash"));
  assert.ok(!game.state.resolution?.drownedPlayerIds.length);
});

test("expanded caves retain a sealed outer boundary and a traversable passage between sections", () => {
  const map = getMap("crystal-cave");
  const game = new GameEngine({ mapId: map.id, players: Array.from({ length: map.spawnPlatformIds.length + 1 },
    (_, index) => ({ id: `t${index}`, name: `Team ${index}`, frogs: 1 })) });
  const walls = game.state.platforms.filter((platform) => platform.boundary);
  assert.equal(walls.length, 2);
  assert.equal(walls.find((wall) => wall.boundary === "left")!.x, 0);
  assert.equal(walls.find((wall) => wall.boundary === "right")!.x, game.state.width - 90);
  const frog = game.state.players[0]!;
  Object.assign(frog, { x: map.width - 40, y: 1560 - PLAYER_RADIUS, vx: 0, vy: 0, grounded: true });
  game.setInput(frog.id, { left: false, right: true, up: false, down: false, aimX: map.width + 200, aimY: frog.y });
  advance(game, 0.5);
  assert.ok(frog.x > map.width + 20, "no internal enclosing wall traps teams in separate caves");
});

test("legacy snapshots without map metadata still drown frogs at their saved waterline", () => {
  const game = new GameEngine();
  const snapshot = game.capture();
  delete snapshot.state.mapId;
  delete snapshot.state.hasWater;
  game.restore(snapshot);
  const frog = game.state.players[0]!;
  Object.assign(frog, { x: 20, y: WATER_Y - PLAYER_RADIUS + 1, grounded: false });
  game.step(FIXED_STEP);
  assert.ok(game.state.resolution?.drownedPlayerIds.includes(frog.id));
  assert.ok(game.state.soundEvents!.some((event) => event.kind === "splash"));
});
