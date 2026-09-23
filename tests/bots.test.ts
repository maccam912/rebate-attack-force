import { singleFrogGame, stockWeapons } from "./fixtures.js";
import test from "node:test";
import assert from "node:assert/strict";
import { BotController } from "../shared/bots.js";
import { GameEngine, PLAYER_RADIUS, WIDTH } from "../shared/game.js";
import { WEAPONS, WEAPON_IDS } from "../shared/weapons.js";
import type { Player, WeaponId } from "../shared/types.js";

const FRAME = 1 / 60;
function advance(game: GameEngine, bots: BotController, seconds: number, until = () => false): void {
  for (let frame = 0; frame < Math.ceil(seconds / FRAME) && !until(); frame++) {
    bots.update(game, FRAME);
    game.step(FRAME);
  }
}
function onlyWeapon(player: Player, weapon?: WeaponId): void {
  for (const id of WEAPON_IDS) player.inventory[id] = id === weapon ? 1 : 0;
}
function arena(frogs = 1) {
  const game = singleFrogGame({ players: [
    { id: "bot", name: "Bot", bot: true, frogs },
    { id: "human", name: "Human" },
  ], seed: 260 });
  game.state.platforms = [{ id: "floor", x: 0, y: 1000, w: WIDTH, h: 800 }];
  game.state.crates = [];
  const bot = game.state.players[0]!;
  const target = game.state.players.at(-1)!;
  Object.assign(bot, { x: 500, y: 1000 - PLAYER_RADIUS });
  Object.assign(target, { x: 1000, y: 1000 - PLAYER_RADIUS });
  return { game, bot, target, controller: new BotController() };
}

test("bot updates leave human turns, disconnected bots and invalid elapsed time untouched", () => {
  const game = singleFrogGame({ players: [{ id: "human", name: "Human" }, { id: "bot", name: "Bot", bot: true }] });
  const bots = new BotController();
  const before = game.capture();
  for (let i = 0; i < 100; i++) bots.update(game, FRAME);
  assert.deepEqual(game.capture(), before);
  const isolated = arena();
  isolated.game.state.teams[0]!.connected = false;
  const disconnected = isolated.game.capture();
  for (let i = 0; i < 100; i++) bots.update(isolated.game, FRAME);
  assert.deepEqual(isolated.game.capture(), disconnected);
  isolated.game.state.teams[0]!.connected = true;
  const valid = isolated.game.capture();
  for (const dt of [NaN, Infinity, -1, 0]) bots.update(isolated.game, dt);
  assert.deepEqual(isolated.game.capture(), valid);
  for (const phase of ["waiting", "settling", "damage", "finished"] as const) {
    isolated.game.state.phase = phase;
    const paused = isolated.game.capture();
    for (let i = 0; i < 100; i++) bots.update(isolated.game, FRAME);
    assert.deepEqual(isolated.game.capture(), paused);
  }
});

test("bots spend normal ammo, hit an enemy and yield control to the human", () => {
  const { game, bot, target, controller } = arena();
  onlyWeapon(bot, "rocket");
  const humanInventory = { ...target.inventory };
  advance(game, controller, 20, () => game.state.turn > 1);
  assert.equal(bot.inventory.rocket, 0);
  assert.ok(target.hp < 100, "the ordinary projectile and damage reveal must actually hurt the target");
  assert.equal(game.state.activeTeamId, "human");
  assert.deepEqual(target.inventory, humanInventory);
  const stopped = game.capture();
  controller.update(game, 0.25);
  assert.deepEqual(game.capture(), stopped);
});

test("bots value disruption even when its immediate damage and shove are negligible", () => {
  const { game, bot, target, controller } = arena();
  const weapon = WEAPONS.find((definition) => definition.status?.kind === "chilled")!;
  onlyWeapon(bot, weapon.id);
  // A one-HP enemy contributes at most one damage point. Debuff utility is what
  // lifts this shot above the bot's threshold for spending equipment.
  target.hp = 1;
  for (let i = 0; i < 4; i++) controller.update(game, 0.25);
  assert.equal(bot.inventory[weapon.id], 0);
  assert.equal(game.state.projectiles[0]?.kind, weapon.id);
});

test("bots deploy persistent zero-damage fields and avoid debuffing an intervening teammate", () => {
  const field = arena();
  const repulsor = WEAPONS.find((definition) => definition.hazard?.kind === "repulsor")!;
  assert.equal(repulsor.damage, 0);
  onlyWeapon(field.bot, repulsor.id);
  advance(field.game, field.controller, 3, () => field.game.state.hazards?.some((hazard) => hazard.kind === "repulsor") ?? false);
  assert.equal(field.bot.inventory[repulsor.id], 0);
  assert.ok(field.game.state.hazards?.some((hazard) => hazard.kind === "repulsor"));

  const { game, bot, controller } = arena(2);
  const ray = WEAPONS.find((definition) => definition.status?.kind === "inverted")!;
  onlyWeapon(bot, ray.id);
  const ally = game.state.players[1]!;
  Object.assign(ally, { x: 650, y: bot.y });
  for (let i = 0; i < 4; i++) controller.update(game, 0.25);
  assert.equal(bot.inventory[ray.id], 1, "an allied debuff is a cost, even when an enemy is behind them");
  ally.x = 300;
  for (let i = 0; i < 4; i++) controller.update(game, 0.25);
  assert.equal(bot.inventory[ray.id], 0);
});

test("a bot lobs a mortar over cover instead of firing into a wall", () => {
  const { game, bot, target, controller } = arena();
  onlyWeapon(bot, "mortar");
  game.state.platforms.push({ id: "cover", x: 730, y: 900, w: 40, h: 100 });
  advance(game, controller, 20, () => game.state.turn > 1);
  assert.equal(bot.inventory.mortar, 0);
  assert.ok(target.hp < 100);
  assert.equal(bot.hp, 100);
});

test("bots avoid shooting through a teammate and do not target another frog on their team", () => {
  const { game, bot, target, controller } = arena(2);
  onlyWeapon(bot, "rocket");
  const ally = game.state.players[1]!;
  Object.assign(ally, { x: 650, y: bot.y });
  // Think without moving so the blocked line of fire stays fixed.
  for (let i = 0; i < 4; i++) controller.update(game, 0.25);
  assert.equal(bot.inventory.rocket, 1);
  assert.equal(game.state.projectiles.length, 0);
  Object.assign(ally, { x: 300, y: bot.y });
  for (let i = 0; i < 4; i++) controller.update(game, 0.25);
  assert.equal(bot.inventory.rocket, 0);
  assert.ok(bot.lookAt.x > bot.x, "the shot points toward the enemy, away from the teammate");
  advance(game, controller, 20, () => game.state.turn > 1);
  assert.ok(target.hp < 100);
  assert.equal(ally.hp, 100);
});

test("an empty bot collects reachable supplies and uses the ammo it picked up", () => {
  const { game, bot, target, controller } = arena();
  onlyWeapon(bot);
  bot.hasCrate = false;
  bot.weapon = null;
  game.state.crates = [{ id: "supply", x: 610, y: bot.y }];
  advance(game, controller, 20, () => game.state.turn > 1);
  assert.ok(game.state.soundEvents?.some((event) => event.kind === "pickup" && event.playerId === bot.id));
  assert.ok(game.state.soundEvents?.some((event) => event.kind === "shot" && event.weapon === "sniper"));
  assert.ok(target.hp < 100);
});

test("a bot with no useful ammo ends its turn without walking into water", () => {
  const { game, bot, target, controller } = arena();
  onlyWeapon(bot);
  bot.hasCrate = false;
  game.state.platforms = [
    { id: "bot-island", x: 300, y: 1000, w: 400, h: 800 },
    { id: "target-island", x: 900, y: 1000, w: 400, h: 800 },
  ];
  advance(game, controller, 16, () => game.state.turn > 1);
  assert.equal(game.state.activeTeamId, target.teamId);
  assert.equal(bot.hp, 100);
  assert.ok(bot.x > 300 && bot.x < 700);
});

test("a bot balanced over a platform edge can move back onto it and collect supplies", () => {
  const { game, bot, target, controller } = arena();
  onlyWeapon(bot);
  bot.hasCrate = false;
  bot.weapon = null;
  bot.x = 292; // The body overlaps the ledge even though its center does not.
  game.state.platforms = [
    { id: "bot-island", x: 300, y: 1000, w: 400, h: 800 },
    { id: "target-island", x: 900, y: 1000, w: 400, h: 800 },
  ];
  game.state.crates = [{ id: "supply", x: 410, y: bot.y }];
  advance(game, controller, 20, () => game.state.turn > 1);
  assert.ok(game.state.soundEvents?.some((event) => event.kind === "pickup" && event.playerId === bot.id));
  assert.ok(target.hp < 100);
  assert.equal(bot.hp, 100);
});

test("bots damage both distant opposing spawns in the default two-team arena", () => {
  for (const botIndex of [0, 1]) {
    const game = singleFrogGame({ players: [0, 1].map((index) => ({
      id: `team-${index}`, name: `Team ${index}`, bot: index === botIndex,
    })) });
    if (botIndex === 1) {
      game.command(game.state.activePlayerId, { type: "endTurn" });
      game.step(FRAME);
    }
    const turn = game.state.turn;
    const bot = game.state.players[botIndex]!;
    const target = game.state.players[1 - botIndex]!;
    stockWeapons(game);
    const inventory = { ...bot.inventory };
    advance(game, new BotController(), 20, () => game.state.turn > turn || game.state.phase === "finished");
    assert.ok(target.hp < 100, `air support must account for the roofs over spawn ${1 - botIndex}`);
    assert.ok(WEAPON_IDS.some((weapon) => bot.inventory[weapon] < inventory[weapon]), "the bot fired its weapon");
    assert.ok(game.state.phase === "finished" || game.state.activeTeamId === target.teamId);
  }
});

test("all-bot matches on the actual arena make damage and finish deterministically", () => {
  const run = () => {
    const game = singleFrogGame({ seed: 913, players: Array.from({ length: 6 }, (_, index) => ({
      id: `bot-${index}`, name: `Bot ${index + 1}`, bot: true, frogs: 2,
    })) });
    const bots = new BotController();
    advance(game, bots, 1800, () => game.state.phase === "finished");
    assert.equal(game.state.phase, "finished");
    assert.ok(game.state.winnerId);
    assert.ok(game.state.turn > 1);
    assert.ok(game.state.players.some((player) => player.hp < player.maxHp));
    return game.capture();
  };
  assert.deepEqual(run(), run());
});

test("a controller can be reused for a fresh game and reset during play", () => {
  const first = arena();
  onlyWeapon(first.bot, "rocket");
  advance(first.game, first.controller, 1);
  assert.equal(first.bot.inventory.rocket, 0);
  const second = arena();
  onlyWeapon(second.bot, "rocket");
  first.controller.reset();
  advance(second.game, first.controller, 1);
  assert.equal(second.bot.inventory.rocket, 0);
});
