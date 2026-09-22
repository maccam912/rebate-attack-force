import test from "node:test";
import assert from "node:assert/strict";
import { FIXED_STEP, GameEngine, PLAYER_RADIUS, WIDTH } from "../shared/game.js";
import { DEFAULT_MINE_COUNT, MAX_FROGS, MAX_MINES, validMineCount } from "../shared/settings.js";
import type { GameOptions } from "../shared/types.js";
import { WEAPON_CATALOG } from "../shared/weapons.js";

function advance(game: GameEngine, seconds: number): void {
  for (let frame = 0; frame < Math.ceil(seconds / FIXED_STEP); frame++) game.step(FIXED_STEP);
}

function assertSafeMines(game: GameEngine): void {
  for (const [index, mine] of game.state.mines.entries()) {
    assert.equal(mine.kind, "mine");
    assert.equal(mine.ownerId, "");
    assert.equal(mine.placedTurn, 0);
    assert.equal(mine.settled, true);
    assert.equal(mine.fuse, null);
    assert.equal(mine.vx, 0);
    assert.equal(mine.vy, 0);
    assert.ok(mine.x >= 8 && mine.x <= game.state.width - 8);
    assert.ok(mine.y >= 8 && mine.y + 8 < game.state.waterY);
    const support = game.state.platforms.find((platform) =>
      mine.y + 8 === platform.y && mine.x - 8 >= platform.x && mine.x + 8 <= platform.x + platform.w);
    assert.ok(support, `${mine.id} sits on a platform top`);
    assert.ok(game.state.platforms.every((platform) => platform === support ||
      mine.x + 8 <= platform.x || mine.x - 8 >= platform.x + platform.w ||
      mine.y + 8 <= platform.y || mine.y - 8 >= platform.y + platform.h), "mine is exposed");
    assert.ok(game.state.players.every((frog) =>
      Math.hypot(frog.x - mine.x, frog.y - mine.y) >= WEAPON_CATALOG.mine.range + PLAYER_RADIUS),
    "every starting frog has clearance beyond the trigger radius");
    assert.ok(game.state.mines.slice(index + 1).every((other) =>
      Math.hypot(mine.x - other.x, mine.y - other.y) >= 48), "mines remain spaced apart");
  }
}

test("starting mine count accepts only bounded integers and defaults to the original empty arena", () => {
  assert.equal(DEFAULT_MINE_COUNT, 0);
  const original = new GameEngine({ seed: 310 }).capture();
  assert.equal(original.state.mines.length, 0);
  for (const count of [0, 1, 12, MAX_MINES]) {
    assert.equal(validMineCount(count), true);
    const game = new GameEngine({ mineCount: count, seed: 310 });
    assert.equal(game.state.mines.length, count);
    assertSafeMines(game);
  }
  for (const count of [undefined, null, "5", false, {}, [], -1, 0.5, MAX_MINES + 1, Infinity, NaN]) {
    assert.equal(validMineCount(count), false);
    const game = new GameEngine({ mineCount: count as GameOptions["mineCount"], seed: 310 });
    assert.deepEqual(game.capture(), original, "invalid options preserve the default simulation and PRNG");
  }
  assert.deepEqual(new GameEngine({ mineCount: 0, seed: 310 }).capture(), original);
});

test("starting mine positions are deterministic and vary with the match seed", () => {
  const first = new GameEngine({ seed: 502, mineCount: MAX_MINES });
  const repeat = new GameEngine({ seed: 502, mineCount: MAX_MINES });
  const different = new GameEngine({ seed: 503, mineCount: MAX_MINES });
  assert.deepEqual(first.capture(), repeat.capture());
  assert.notDeepEqual(first.state.mines, different.state.mines);
  assert.equal(new Set(first.state.mines.map((mine) => mine.id)).size, MAX_MINES);
});

test("seeding protects all frogs and supports large rosters and expanded arenas", () => {
  for (const teamCount of [2, 4, 12, 29, 32, 58]) {
    const game = new GameEngine({ seed: 612, mineCount: MAX_MINES,
      players: Array.from({ length: teamCount }, (_, index) => ({
        id: `team-${index}`, name: `Team ${index}`, frogs: MAX_FROGS,
      })),
    });
    if (teamCount === 29 || teamCount === 58) {
      assert.ok(game.state.mines.length > 0 && game.state.mines.length < MAX_MINES,
        "fully occupied ledges use their smaller safe capacity");
    } else assert.equal(game.state.mines.length, MAX_MINES);
    assertSafeMines(game);
    if (teamCount === 32) assert.ok(game.state.mines.some((mine) => mine.x > WIDTH),
      "mines use exposed platforms in expanded arenas");
    const initialMines = structuredClone(game.state.mines);
    advance(game, 0.1);
    assert.deepEqual(game.state.mines, initialMines, "starting positions do not trigger or drop mines");
    assert.ok(game.state.players.every((frog) => frog.alive && frog.hp === frog.maxHp));
  }
});

test("seeded mines are armed on turn one and their warning fuse replays exactly", () => {
  const game = new GameEngine({ seed: 731, mineCount: 1 });
  const mine = game.state.mines[0]!;
  const active = game.state.players.find((frog) => frog.id === game.state.activePlayerId)!;
  active.x = mine.x;
  active.y = mine.y + 8 - PLAYER_RADIUS;
  game.step(FIXED_STEP);
  assert.equal(game.state.turn, 1);
  assert.ok(mine.fuse !== null && mine.fuse > 0, "the first active frog can trigger a seeded mine");
  assert.equal(game.state.soundEvents!.filter((event) => event.kind === "mineTrigger").length, 1);
  const restored = new GameEngine();
  restored.restore(game.capture());
  advance(game, 0.5);
  advance(restored, 0.5);
  assert.deepEqual(restored.capture(), game.capture());
  assert.equal(game.state.mines.length, 0);
  assert.ok(game.state.soundEvents!.some((event) => event.kind === "explosion" && event.weapon === "mine"));
  assert.ok((game.state.resolution?.pendingDamage[active.id] ?? 0) > 0);
});

test("turn changes and checkpoint restoration preserve remaining mines without reseeding", () => {
  const game = new GameEngine({ seed: 810, mineCount: MAX_MINES });
  game.state.mines.splice(0, 3);
  const remaining = structuredClone(game.state.mines);
  const restored = new GameEngine({ seed: 42, mineCount: 1 });
  restored.restore(game.capture());
  for (let turn = 0; turn < 6; turn++) {
    for (const engine of [game, restored]) {
      assert.equal(engine.command(engine.state.activePlayerId, { type: "endTurn" }), true);
      advance(engine, 0.1);
      assert.deepEqual(engine.state.mines, remaining);
    }
    assert.deepEqual(restored.capture(), game.capture());
  }
  assert.equal(game.state.turn, 7);
});
