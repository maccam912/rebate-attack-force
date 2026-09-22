import test from "node:test";
import assert from "node:assert/strict";
import { DOUBLE_JUMP_SECONDS, FIXED_STEP, GameEngine, PLAYER_RADIUS, WATER_Y } from "../shared/game";
import { MAX_FROGS, MAX_HP, validTeamSettings } from "../shared/settings";

const advance = (game: GameEngine, seconds: number) => {
  for (let i = 0; i < Math.ceil(seconds / FIXED_STEP); i++) game.step(FIXED_STEP);
};
const end = (game: GameEngine) => {
  assert.equal(game.command(game.state.activePlayerId, { type: "endTurn" }), true);
  advance(game, .1);
};
function teams() {
  return new GameEngine({ players: [
    { id: "a", name: "A", frogs: 3, hp: 175 },
    { id: "b", name: "B", frogs: 2, hp: 250 },
    { id: "c", name: "C", frogs: 1, hp: 80 },
  ] });
}

test("team settings create distinct supported frogs with independent HP and inventory", () => {
  const game = new GameEngine({ players: [0, 1, 2, 3].map((i) => ({
    id: `t${i}`, name: `Team ${i}`, frogs: MAX_FROGS, hp: MAX_HP,
  })) });
  assert.equal(game.state.players.length, 24);
  assert.equal(new Set(game.state.players.map((p) => p.id)).size, 24);
  for (const frog of game.state.players) {
    assert.equal(frog.hp, MAX_HP);
    assert.equal(frog.maxHp, MAX_HP);
    assert.ok(game.state.platforms.some((platform) =>
      frog.x - PLAYER_RADIUS >= platform.x && frog.x + PLAYER_RADIUS <= platform.x + platform.w &&
      frog.y + PLAYER_RADIUS === platform.y));
  }
  advance(game, 1);
  assert.ok(game.state.players.every((p) => p.alive && p.grounded));
  const otherAmmo = game.state.players[1].inventory.rocket;
  game.state.players[0].inventory.rocket = 17;
  assert.equal(game.state.players[1].inventory.rocket, otherAmmo);
  for (const value of [null, {}, { frogs: 0, hp: 100 }, { frogs: 7, hp: 100 },
    { frogs: 2.5, hp: 100 }, { frogs: 2, hp: NaN }, { frogs: 2, hp: 501 }, { frogs: 2, hp: "100" }])
    assert.equal(validTeamSettings(value), false);
});

test("turns alternate teams and round robin uneven rosters, skipping dead frogs", () => {
  const game = teams();
  const expected = ["a", "b", "c", "a:frog-2", "b:frog-2", "c", "a:frog-3", "b", "c", "a"];
  for (const id of expected) {
    assert.equal(game.state.activePlayerId, id);
    end(game);
  }
  const dead = game.state.players.find((p) => p.id === "a:frog-2")!;
  dead.alive = false;
  dead.hp = 0;
  end(game); // B -> C
  end(game); // C -> A3
  assert.equal(game.state.activePlayerId, "a:frog-3");
  assert.equal(game.command("a", { type: "jump" }), false, "inactive teammate cannot act");
  assert.equal(game.command("a:frog-3", { type: "jump" }), true);
});

test("an eliminated team is skipped and victory belongs to the last surviving team", () => {
  const game = teams();
  game.removePlayer("b");
  end(game);
  assert.equal(game.state.activeTeamId, "c");
  assert.ok(game.state.players.filter((p) => p.teamId === "b").every((p) => !p.alive));
  game.removePlayer("c");
  advance(game, .1);
  assert.equal(game.state.phase, "finished");
  assert.equal(game.state.winnerId, "a");
  assert.equal(game.state.players.filter((p) => p.alive).length, 3);
});

test("team victory waits for all surviving frogs to settle, including a falling teammate", () => {
  const game = teams();
  const falling = game.state.players[1];
  Object.assign(falling, { y: WATER_Y - 80, x: 10, vy: 400, grounded: false });
  game.removePlayer("b");
  game.removePlayer("c");
  assert.equal(game.state.phase, "settling");
  assert.equal(game.state.winnerId, null);
  advance(game, 3);
  assert.equal(falling.alive, false);
  assert.equal(game.state.winnerId, "a");
});

test("disconnect skips an active team without damage or losing its frog rotation", () => {
  const game = teams();
  game.state.players[0].hp = 123;
  game.state.players[0].inventory.grenade = 2;
  game.setInput("a", { left: false, right: true, up: false, down: false, aimX: 800, aimY: 1200 });
  game.setTeamConnected("a", false);
  assert.equal(game.command("a", { type: "jump" }), false);
  advance(game, .1);
  assert.equal(game.state.activeTeamId, "b");
  assert.equal(game.state.players[0].hp, 123);
  assert.equal(game.state.players[0].inventory.grenade, 2);
  assert.equal(game.state.players[0].vx, 0);
  end(game); // C
  end(game); // skips A and goes to B2
  assert.equal(game.state.activePlayerId, "b:frog-2");
  game.setTeamConnected("a", true);
  assert.equal(game.state.activePlayerId, "b:frog-2", "rejoin must not steal an existing turn");
  end(game); // C
  end(game); // A2
  assert.equal(game.state.activePlayerId, "a:frog-2");
  assert.ok(game.state.players.every((p) => p.alive));
});

test("all disconnected teams wait without cycling turns or declaring a winner", () => {
  const game = teams();
  for (const team of game.state.teams) game.setTeamConnected(team.id, false);
  advance(game, 1);
  const turn = game.state.turn;
  assert.equal(game.state.phase, "waiting");
  advance(game, 5);
  assert.equal(game.state.turn, turn);
  assert.equal(game.state.winnerId, null);
  assert.ok(game.state.players.every((p) => p.alive));
  game.setTeamConnected("b", true);
  advance(game, .1);
  assert.equal(game.state.phase, "playing");
  assert.equal(game.state.activePlayerId, "b");
  end(game);
  assert.equal(game.state.activePlayerId, "b:frog-2");
  game.setTeamConnected("c", true);
  end(game);
  assert.equal(game.state.activePlayerId, "c", "skipped teams keep their place in frog order");
});

function jumpingGame() {
  const game = new GameEngine({ mode: "practice" });
  game.state.platforms = [{ id: "floor", x: 0, y: 1600, w: 4320, h: 200 }];
  return game;
}

test("a quick second jump upgrades to a higher backward jump in either facing direction", () => {
  for (const facing of [-1, 1] as const) {
    const game = jumpingGame();
    const frog = game.state.players[0];
    frog.x = 800;
    frog.facing = facing;
    assert.equal(game.command(frog.id, { type: "backflip" }), false);
    assert.equal(game.command(frog.id, { type: "jump" }), true);
    assert.equal(frog.vy, -525);
    advance(game, .1);
    assert.equal(game.command(frog.id, { type: "backflip" }), true);
    assert.equal(frog.vy, -760);
    assert.equal(Math.sign(frog.vx), -facing);
    assert.equal(game.command(frog.id, { type: "backflip" }), false, "no repeated boosts");
    advance(game, .5);
    assert.ok(1582 - frog.y > 260, "backward jump rises higher than the normal 131px jump");
    assert.equal(game.state.turn, 1);
  }
});

test("late second presses, airborne launches, and turn changes cannot grant a backflip", () => {
  const game = jumpingGame();
  const frog = game.state.players[0];
  assert.equal(game.command(frog.id, { type: "jump" }), true);
  advance(game, DOUBLE_JUMP_SECONDS + .02);
  assert.equal(game.command(frog.id, { type: "backflip" }), false);
  assert.equal(game.command(frog.id, { type: "jump" }), false);
  advance(game, 1);
  assert.equal(game.command(frog.id, { type: "jump" }), true);
  game.command(frog.id, { type: "endTurn" });
  assert.equal(game.command(frog.id, { type: "backflip" }), false);
});


test("a match started with an offline first team preserves that team's first frog", () => {
  const game = new GameEngine({ players: [
    { id: "a", name: "A", frogs: 3, connected: false },
    { id: "b", name: "B", frogs: 2 },
  ] });
  assert.equal(game.state.activePlayerId, "b");
  game.setTeamConnected("a", true);
  end(game);
  assert.equal(game.state.activePlayerId, "a");
});
