import { singleFrogGame } from "./fixtures.js";
import test from "node:test";
import assert from "node:assert/strict";
import { DOUBLE_JUMP_SECONDS, FIXED_STEP, GameEngine, PLAYER_RADIUS, WATER_Y, WIDTH } from "../shared/game";
import { DEFAULT_TEAM_SETTINGS, MAX_FROGS, MAX_HP, teamColor, teamSettings, validTeamSettings } from "../shared/settings";
import { createInventory, WEAPON_CATALOG } from "../shared/weapons";

function collect(game: GameEngine, id = "mystery") {
  const frog = game.state.players.find((player) => player.id === game.state.activePlayerId)!;
  game.state.crates = [{ id, x: frog.x, y: frog.y }];
  game.step(FIXED_STEP);
  return game.state.soundEvents!.filter((event) => event.kind === "pickup").at(-1)!.weapon!;
}

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

test("lobby, direct engine, partial settings and invalid settings default to three 100-HP frogs", () => {
  assert.deepEqual(DEFAULT_TEAM_SETTINGS, { frogs: 3, hp: 100 });
  assert.deepEqual(teamSettings({}), DEFAULT_TEAM_SETTINGS);
  assert.deepEqual(teamSettings({ hp: 175 }), { frogs: 3, hp: 175 });
  assert.deepEqual(teamSettings({ frogs: NaN }), DEFAULT_TEAM_SETTINGS);
  for (const options of [{}, { players: [{ id: "a", name: "A" }, { id: "b", name: "B" }] },
    { players: [{ id: "a", name: "A", frogs: 0, hp: -1 }, { id: "b", name: "B" }] }]) {
    const game = new GameEngine(options);
    assert.equal(game.state.players.length, 6);
    for (const team of game.state.teams) {
      assert.equal(team.frogs, 3);
      assert.equal(team.hp, 100);
      assert.deepEqual(team.inventory, createInventory());
      for (const player of game.state.players.filter((frog) => frog.teamId === team.id)) {
        assert.equal(player.hp, 100);
        assert.equal(player.maxHp, 100);
        assert.equal(player.inventory, team.inventory);
        assert.equal(player.weapon, null);
      }
    }
  }
});

test("pickups add to the whole team, keep usable selections, and can be spent by the next frog", () => {
  const game = new GameEngine({ seed: 260, players: [
    { id: "a", name: "A", frogs: 2 }, { id: "b", name: "B", frogs: 1 },
  ] });
  const [first, teammate, opponent] = game.state.players;
  const firstReward = collect(game);
  assert.equal(firstReward, "sniper");
  assert.equal(first.inventory, teammate.inventory);
  assert.equal(first.inventory, game.state.teams[0].inventory);
  assert.notEqual(first.inventory, opponent.inventory);
  assert.equal(teammate.inventory[firstReward], WEAPON_CATALOG[firstReward].ammo);
  assert.equal(teammate.hasCrate, true);
  assert.equal(game.command(teammate.id, { type: "selectWeapon", weapon: firstReward }), false);
  assert.equal(game.command(first.id, { type: "selectWeapon", weapon: "rocket" }), false);
  const secondReward = collect(game, "another-mystery");
  assert.notEqual(firstReward, secondReward);
  assert.equal(first.weapon, firstReward, "a pickup must not replace a usable selection");
  assert.equal(teammate.weapon, firstReward);
  end(game); // A1 -> B
  end(game); // B -> A2
  assert.equal(game.state.activePlayerId, teammate.id);
  assert.equal(game.command(teammate.id, { type: "selectWeapon", weapon: secondReward }), true);
  assert.equal(game.command(teammate.id, { type: "selectWeapon", weapon: firstReward }), true);
  game.setInput(teammate.id, { left: false, right: false, up: false, down: false, aimX: -1000, aimY: -1000 });
  assert.equal(game.command(teammate.id, { type: "fire" }), true);
  assert.equal(game.state.teams[0].inventory[firstReward], 0);
  assert.equal(first.inventory[firstReward], 0, "one shot consumes one shared round");
  assert.equal(first.weapon, secondReward, "another frog cannot retain an exhausted selection");
  assert.equal(teammate.weapon, secondReward);
  assert.equal(game.command(teammate.id, { type: "fire" }), false);
  assert.deepEqual(opponent.inventory, createInventory());
});

test("the team retains collected equipment after the collecting frog dies", () => {
  const game = new GameEngine({ seed: 260, players: [
    { id: "a", name: "A", frogs: 2 }, { id: "b", name: "B", frogs: 1 },
  ] });
  const [collector, survivor] = game.state.players;
  const reward = collect(game);
  Object.assign(collector, { x: 10, y: WATER_Y, vy: 400, grounded: false });
  advance(game, 3);
  assert.equal(collector.alive, false);
  assert.equal(collector.weapon, null);
  assert.equal(survivor.inventory[reward], WEAPON_CATALOG[reward].ammo);
  assert.equal(game.state.activeTeamId, "b");
  end(game);
  assert.equal(game.state.activePlayerId, survivor.id);
  assert.equal(game.command(survivor.id, { type: "selectWeapon", weapon: reward }), true);
  assert.equal(game.command(survivor.id, { type: "fire" }), true);
  assert.equal(survivor.inventory[reward], 0);
  assert.equal(collector.weapon, null, "refreshing the stash must not rearm a dead frog");
});

test("JSON checkpoints restore one canonical stash and replay random pickups and spending exactly", () => {
  const original = new GameEngine({ seed: 260 });
  collect(original);
  const snapshot = JSON.parse(JSON.stringify(original.capture()));
  const restored = new GameEngine();
  restored.restore(snapshot);
  for (const team of restored.state.teams)
    for (const player of restored.state.players.filter((frog) => frog.teamId === team.id))
      assert.equal(player.inventory, team.inventory, "JSON copies rebind before prediction replay");
  const run = (game: GameEngine) => {
    collect(game, "next-mystery");
    end(game);
    end(game);
    const frog = game.state.players.find((player) => player.id === game.state.activePlayerId)!;
    assert.equal(game.command(frog.id, { type: "selectWeapon", weapon: "sniper" }), true);
    assert.equal(game.command(frog.id, { type: "fire" }), true);
    game.step(FIXED_STEP);
    return game.capture();
  };
  assert.deepEqual(run(restored), run(original));
  assert.equal(snapshot.state.teams[0].inventory.sniper, 1, "restoring never mutates the supplied checkpoint");
});

test("practice keeps its full arsenal shared and refills the same team stash on each turn", () => {
  const game = new GameEngine({ mode: "practice" });
  const [first, teammate] = game.state.players;
  const stash = game.state.teams[0].inventory;
  assert.equal(first.inventory, stash);
  assert.equal(teammate.inventory, stash);
  assert.equal(game.command(first.id, { type: "selectWeapon", weapon: "golf" }), true);
  game.setInput(first.id, { left: false, right: false, up: false, down: false, aimX: -1000, aimY: first.y });
  assert.equal(game.command(first.id, { type: "fire" }), true);
  assert.equal(teammate.inventory.golf, 8);
  advance(game, 1);
  assert.equal(game.state.turn, 2);
  assert.equal(game.state.teams[0].inventory, stash);
  assert.equal(first.inventory, teammate.inventory);
  assert.deepEqual(stash, createInventory("practice"));
});

test("team settings create distinct supported frogs with independent HP and shared team inventory", () => {
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
  game.state.players[0].inventory.rocket = 17;
  assert.equal(game.state.players[1].inventory.rocket, 17);
  assert.equal(game.state.teams[0].inventory.rocket, 17);
  assert.equal(game.state.teams[1].inventory.rocket, 0);
  for (const value of [null, {}, { frogs: 0, hp: 100 }, { frogs: 7, hp: 100 },
    { frogs: 2.5, hp: 100 }, { frogs: 2, hp: NaN }, { frogs: 2, hp: 501 }, { frogs: 2, hp: "100" }])
    assert.equal(validTeamSettings(value), false);
});

test("large rosters retain every team, with separate safe spawns and colors beyond four", () => {
  for (const count of [5, 12, 32]) {
    const game = new GameEngine({ players: Array.from({ length: count }, (_, i) => ({
      id: `t${i}`, name: `Team ${i}`, frogs: MAX_FROGS, bot: i > 0,
    })) });
    assert.equal(game.state.teams.length, count);
    assert.equal(game.state.players.length, count * MAX_FROGS);
    assert.equal(new Set(game.state.teams.map((team) => team.color)).size, count);
    assert.equal(game.state.teams[0].bot, false);
    assert.ok(game.state.teams.slice(1).every((team) => team.bot));
    assert.equal(new Set(game.state.platforms.map((platform) => platform.id)).size, game.state.platforms.length);
    for (const [index, frog] of game.state.players.entries()) {
      assert.match(frog.color, /^#[0-9a-f]{6}$/i);
      assert.ok(frog.x >= PLAYER_RADIUS && frog.x <= game.state.width - PLAYER_RADIUS);
      assert.ok(game.state.platforms.some((platform) =>
        frog.x - PLAYER_RADIUS >= platform.x && frog.x + PLAYER_RADIUS <= platform.x + platform.w &&
        frog.y + PLAYER_RADIUS === platform.y), `supported spawn for ${frog.id}`);
      assert.ok(game.state.players.slice(index + 1).every((other) =>
        Math.hypot(frog.x - other.x, frog.y - other.y) >= PLAYER_RADIUS * 2), `separate spawn for ${frog.id}`);
    }
    advance(game, 1);
    assert.ok(game.state.players.every((frog) => frog.alive && frog.grounded && frog.hp === 100));
    for (let index = 0; index < count; index++) {
      assert.equal(game.state.activeTeamId, `t${index}`);
      end(game);
    }
    assert.equal(game.state.activePlayerId, "t0:frog-2");
  }
  assert.equal(teamColor(17), teamColor(17), "team colors are stable");
});

test("expanded arenas allow movement, aiming, weapons, and checkpoint replay beyond the original boundary", () => {
  const game = singleFrogGame({ players: Array.from({ length: 30 }, (_, i) => ({
    id: `t${i}`, name: `Team ${i}`, connected: i === 29,
  })) });
  const frog = game.state.players[29];
  assert.equal(game.state.activePlayerId, frog.id);
  assert.ok(frog.x > WIDTH);
  assert.ok(game.state.width > WIDTH);
  const x = frog.x;
  game.setInput(frog.id, { left: false, right: true, up: false, down: false, aimX: x + 180, aimY: frog.y });
  advance(game, .2);
  assert.ok(frog.x > x + 10, "world movement uses the expanded width");
  game.setInput(frog.id, { left: false, right: false, up: false, down: false, aimX: x + 180, aimY: frog.y });
  frog.inventory.anvil = 1;
  game.command(frog.id, { type: "selectWeapon", weapon: "anvil" });
  game.command(frog.id, { type: "fire", power: 1 });
  assert.ok(game.state.projectiles.length > 0);
  assert.ok(game.state.projectiles.every((projectile) => projectile.x > WIDTH), "air support targets the expanded arena");
  const restored = new GameEngine();
  restored.restore(game.capture());
  advance(game, .2);
  advance(restored, .2);
  assert.deepEqual(restored.capture(), game.capture());
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
  const game = singleFrogGame({ mode: "practice" });
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
