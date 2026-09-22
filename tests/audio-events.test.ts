import test from "node:test";
import assert from "node:assert/strict";
import { FIXED_STEP, GameEngine, MAX_SOUND_EVENTS, PLAYER_RADIUS, WATER_Y, WIDTH } from "../shared/game.js";
import type { GameSoundKind, PlayerInput } from "../shared/types.js";
import { WEAPON_IDS } from "../shared/weapons.js";

const input = (aimX: number, aimY: number): PlayerInput =>
  ({ left: false, right: false, up: false, down: false, aimX, aimY });
const events = (game: GameEngine, kind: GameSoundKind) =>
  game.state.soundEvents!.filter((event) => event.kind === kind);
function advance(game: GameEngine, seconds: number): void {
  for (let frame = 0; frame < Math.ceil(seconds / FIXED_STEP); frame++) game.step(FIXED_STEP);
}
function arena() {
  const game = new GameEngine({ mode: "practice", seed: 123 });
  game.state.platforms = [{ id: "floor", x: 0, y: 1000, w: WIDTH, h: 800 }];
  game.state.crates = [];
  const [a, b] = game.state.players;
  Object.assign(a, { x: 500, y: 1000 - PLAYER_RADIUS });
  Object.assign(b, { x: 1500, y: 1000 - PLAYER_RADIUS });
  return { game, a, b };
}

test("every successful weapon action emits exactly one persistent shot, including melee and mines", () => {
  for (const weapon of WEAPON_IDS) {
    const { game, a } = arena();
    game.setInput(a.id, input(1000, 500));
    assert.equal(game.command(a.id, { type: "selectWeapon", weapon }), true);
    assert.equal(game.command(a.id, { type: "fire" }), true);
    assert.equal(game.command(a.id, { type: "fire" }), false);
    const shots = events(game, "shot");
    assert.equal(shots.length, 1, weapon);
    assert.equal(shots[0].weapon, weapon);
    assert.equal(shots[0].playerId, a.id);
    advance(game, 0.6);
    assert.equal(events(game, "shot").length, 1, `${weapon} survives beyond one network frame`);
    if (["bat", "golf", "boxing"].includes(weapon)) {
      assert.equal(game.state.explosions.length, 0, "the visual swing has expired");
      assert.equal(events(game, "explosion").length, 0, "a melee swing does not pretend to explode");
    }
  }
});

test("invalid actions stay silent and jump, backflip, grapple and release record successful transitions", () => {
  const game = new GameEngine();
  const a = game.state.players[0];
  assert.equal(game.command(a.id, { type: "release" }), false);
  assert.equal(game.command("p2", { type: "jump" }), false);
  game.setInput(a.id, input(a.x, a.y));
  assert.equal(game.command(a.id, { type: "fire" }), false);
  assert.equal(game.state.soundEvents!.length, 0);
  assert.equal(game.command(a.id, { type: "jump" }), true);
  assert.equal(game.command(a.id, { type: "jump" }), false);
  assert.equal(game.command(a.id, { type: "backflip" }), true);
  assert.equal(game.command(a.id, { type: "backflip" }), false);
  game.setInput(a.id, input(420, 1400));
  assert.equal(game.command(a.id, { type: "grapple" }), true);
  assert.equal(game.command(a.id, { type: "release" }), true);
  assert.deepEqual(game.state.soundEvents!.map((event) => event.kind), ["jump", "backflip", "grapple", "release"]);
});

test("practice water death retains splash and death before same-step respawn", () => {
  const game = new GameEngine({ mode: "practice" });
  const a = game.state.players[0];
  a.x = 25;
  a.y = WATER_Y - PLAYER_RADIUS;
  const checkpoint = game.capture();
  game.step(FIXED_STEP);
  const sounds = game.state.soundEvents!;
  assert.deepEqual(sounds.map((event) => event.kind), ["splash", "death", "respawn", "switch"]);
  assert.equal(a.alive, true, "practice has already respawned the frog before a client sees this state");
  assert.equal(sounds[0].x, 25);
  assert.equal(sounds[0].y, WATER_Y);
  assert.notEqual(sounds[2].x, 25, "respawn uses its own location");
  const result = game.capture();
  game.restore(checkpoint);
  game.step(FIXED_STEP);
  assert.deepEqual(game.capture(), result, "replay preserves the event sequence and locations");
});

test("landings and hard terrain or frog collisions are audible without resting contact spam", () => {
  const { game, a, b } = arena();
  advance(game, 1);
  assert.equal(game.state.soundEvents!.length, 0, "gravity resting on a floor is silent");
  Object.assign(a, { y: 1000 - PLAYER_RADIUS - 1, vy: 300, grounded: false });
  game.step(FIXED_STEP);
  assert.equal(events(game, "land").length, 1);
  advance(game, 1);
  assert.equal(events(game, "land").length, 1, "one landing is not replayed each tick");
  Object.assign(a, { y: 1000 - PLAYER_RADIUS - 1, vy: 1000, grounded: false });
  game.step(FIXED_STEP);
  assert.equal(events(game, "bounce").length, 1);
  assert.equal(events(game, "hurt").length, 1);
  assert.ok(a.vy < 0);
  Object.assign(a, { x: 700, y: 700, vx: 1100, vy: 0, grounded: false });
  Object.assign(b, { x: 733, y: 700, vx: 0, vy: 0, grounded: false });
  game.step(FIXED_STEP);
  assert.equal(events(game, "bounce").length, 2, "iterative body separation emits one impact for the pair");
  assert.equal(events(game, "hurt").length, 3, "both bodies register actual collision damage");
});

test("projectile impacts persist after the visual explosion disappears", () => {
  const { game, a } = arena();
  game.setInput(a.id, input(800, 400));
  game.command(a.id, { type: "fire" });
  const projectile = game.state.projectiles[0];
  Object.assign(projectile, { x: 2100, y: 500, vx: 0, vy: 0, life: FIXED_STEP });
  game.step(FIXED_STEP);
  assert.equal(game.state.projectiles.length, 0);
  assert.equal(events(game, "explosion").length, 1);
  assert.equal(events(game, "explosion")[0].weapon, "rocket");
  advance(game, 0.6);
  assert.equal(game.state.explosions.length, 0);
  assert.equal(events(game, "explosion").length, 1);
});

test("mine arming, triggering and detonation each emit one cue", () => {
  const { game, a } = arena();
  game.setInput(a.id, input(a.x, a.y + 100));
  game.command(a.id, { type: "selectWeapon", weapon: "mine" });
  game.command(a.id, { type: "fire" });
  const mine = game.state.mines[0];
  Object.assign(mine, { x: a.x + 30, y: a.y + 10, vx: 0, vy: 0, settled: true });
  advance(game, 0.1);
  assert.equal(events(game, "mineArm").length, 0);
  assert.equal(events(game, "mineTrigger").length, 0);
  game.command(a.id, { type: "endTurn" });
  game.step(FIXED_STEP);
  assert.equal(events(game, "mineArm").length, 1);
  advance(game, 0.1);
  assert.equal(events(game, "mineTrigger").length, 1);
  advance(game, 0.5);
  assert.equal(events(game, "explosion").filter((event) => event.weapon === "mine").length, 1);
  assert.equal(events(game, "mineArm").length, 1);
  assert.equal(events(game, "mineTrigger").length, 1);
});

test("sound history is bounded, replayable and independent of gameplay IDs and random choices", () => {
  const noisy = new GameEngine({ seed: 456 });
  const quiet = new GameEngine({ seed: 456 });
  for (let i = 0; i < MAX_SOUND_EVENTS + 40; i++)
    noisy.command("p1", { type: "selectWeapon", weapon: i % 2 ? "rocket" : "bat" });
  assert.equal(noisy.state.soundEvents!.length, MAX_SOUND_EVENTS);
  assert.equal(noisy.state.soundSequence, MAX_SOUND_EVENTS + 40);
  assert.equal(noisy.state.soundEvents![0].id, 41);
  const checkpoint = noisy.capture();
  const run = (game: GameEngine) => {
    game.setInput("p1", input(900, 900));
    game.command("p1", { type: "fire" });
    advance(game, 0.1);
    return game.capture();
  };
  const first = run(noisy);
  noisy.restore(checkpoint);
  assert.deepEqual(run(noisy), first);
  const second = run(quiet);
  delete first.state.soundEvents;
  delete first.state.soundSequence;
  delete second.state.soundEvents;
  delete second.state.soundSequence;
  assert.deepEqual(first, second, "cosmetic event volume cannot change simulation IDs or PRNG state");
});

test("older snapshots acquire sound fields and match completion plays victory only once", () => {
  const game = new GameEngine();
  delete game.state.soundEvents;
  delete game.state.soundSequence;
  const a = game.state.players[0];
  a.x = 25;
  a.y = WATER_Y - PLAYER_RADIUS;
  game.step(FIXED_STEP);
  assert.equal(game.state.phase, "finished");
  assert.equal(events(game, "victory").length, 1);
  advance(game, 1);
  assert.equal(events(game, "victory").length, 1);
  assert.ok(game.state.soundSequence! > 0);
});
