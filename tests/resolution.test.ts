import test from "node:test";
import assert from "node:assert/strict";
import { FIXED_STEP, GameEngine, PLAYER_RADIUS, WATER_Y, WIDTH } from "../shared/game.js";
import type { PlayerInput, WeaponId } from "../shared/types.js";

const input = (overrides: Partial<PlayerInput> = {}): PlayerInput => ({
  left: false, right: false, up: false, down: false, aimX: 1000, aimY: 982, ...overrides,
});
function advance(game: GameEngine, seconds: number) {
  for (let frame = 0; frame < Math.ceil(seconds / FIXED_STEP); frame++) game.step(FIXED_STEP);
}
function until(game: GameEngine, predicate: () => boolean, description: string, seconds = 30) {
  for (let frame = 0; frame < seconds / FIXED_STEP && !predicate(); frame++) game.step(FIXED_STEP);
  assert.ok(predicate(), description);
}
function arena() {
  const game = new GameEngine({ players: ["a", "b", "c"].map((id) => ({ id, name: id })), seed: 123 });
  game.state.platforms = [{ id: "floor", x: 0, y: 1000, w: WIDTH, h: 800 }];
  game.state.crates = [];
  const [a, b, c] = game.state.players;
  for (const [index, frog] of game.state.players.entries())
    Object.assign(frog, { x: [500, 585, 3500][index], y: 1000 - PLAYER_RADIUS, vx: 0, vy: 0, grounded: true });
  return { game, a, b, c };
}
function fire(game: GameEngine, weapon: WeaponId, aimX: number, aimY: number) {
  const id = game.state.activePlayerId;
  assert.equal(game.command(id, { type: "selectWeapon", weapon }), true);
  game.setInput(id, input({ aimX, aimY }));
  assert.equal(game.command(id, { type: "fire" }), true);
}

test("a lethal melee blow locks control but keeps its victim alive through flight and the camera lead-in", () => {
  const { game, a, b } = arena();
  b.hp = 1;
  fire(game, "bat", b.x, b.y);
  assert.equal(game.state.phase, "settling");
  assert.equal(b.hp, 1);
  assert.equal(b.alive, true);
  assert.ok(game.state.resolution!.pendingDamage[b.id] > b.hp);
  assert.ok(b.vx > 1000 && b.vy < 0);
  for (const frog of game.state.players) {
    assert.equal(game.command(frog.id, { type: "jump" }), false);
    assert.equal(game.command(frog.id, { type: "endTurn" }), false);
  }
  const gaze = { ...a.lookAt };
  game.setInput(a.id, input({ right: true, aimX: -1000 }));
  assert.deepEqual(a.lookAt, gaze);
  advance(game, 0.4);
  assert.equal(b.hp, 1, "lethal damage does not remove a flying body");
  assert.equal(b.alive, true);
  assert.ok(b.x > 650);
  assert.equal(game.state.turn, 1);
  until(game, () => game.state.resolution?.reveal?.playerId === b.id, "the victim receives a damage close-up");
  assert.equal(b.grounded, true, "flight and landing finish before the close-up");
  assert.equal(b.hp, 1);
  advance(game, 0.3);
  assert.equal(b.hp, 1, "the camera arrives before health changes");
  assert.equal(game.state.resolution!.reveal!.applied, false);
  until(game, () => game.state.resolution?.reveal?.applied === true, "the close-up applies health");
  assert.equal(b.hp, 0);
  assert.equal(b.alive, true, "death waits until the outcome has been shown");
  until(game, () => !b.alive, "the shown lethal outcome kills the victim");
  assert.equal(game.state.turn, 1, "death effects belong to the original attack turn");
});

test("grenades preserve retreat until detonation, then remove control while damage is pending", () => {
  const { game, a, b } = arena();
  b.x = 1000;
  fire(game, "grenade", 1300, 500);
  assert.equal(game.state.phase, "retreat");
  const start = a.x;
  game.setInput(a.id, input({ left: true }));
  advance(game, 0.3);
  assert.ok(a.x < start - 30, "the shooter can retreat while the fuse burns");
  assert.equal(game.state.phase, "retreat");
  Object.assign(game.state.projectiles[0], { x: b.x, y: b.y - 35, vx: 0, vy: 0, life: FIXED_STEP });
  game.step(FIXED_STEP);
  assert.equal(game.state.phase, "settling");
  assert.equal(game.command(a.id, { type: "jump" }), false);
  assert.equal(b.hp, 100);
  assert.ok(game.state.resolution!.pendingDamage[b.id] > 0);
  assert.ok(game.state.resolution!.slowMotionRemaining > 0, "the explosion has a brief slow-motion beat");
});

test("placed mines offer five seconds to retreat without blocking the next turn indefinitely", () => {
  const { game, a, b } = arena();
  b.x = 2000;
  fire(game, "mine", a.x + 100, a.y);
  assert.equal(game.state.phase, "retreat");
  assert.equal(game.state.timeLeft, 5);
  game.setInput(a.id, input({ left: true }));
  advance(game, 1);
  assert.equal(game.state.turn, 1);
  game.setInput(a.id, input());
  until(game, () => game.state.turn === 2, "an untriggered mine permits the next turn", 6);
  assert.equal(game.state.mines.length, 1);
  assert.equal(game.state.mines[0].fuse, null);
});

test("damage close-ups are sequential and a death explosion creates another settled outcome", () => {
  const { game, a, b, c } = arena();
  b.hp = 1;
  fire(game, "bat", b.x, b.y);
  until(game, () => game.state.resolution?.reveal?.playerId === b.id, "first outcome begins");
  Object.assign(c, { x: b.x + 55, y: b.y, vx: 0, vy: 0, grounded: true });
  until(game, () => !b.alive, "first victim finishes its death reveal");
  assert.equal(c.hp, 100, "secondary damage is also deferred");
  assert.ok(game.state.resolution!.pendingDamage[c.id] > 0, "a dying frog hurts nearby frogs");
  assert.ok(Math.hypot(c.vx, c.vy) > 0, "death explosion launches the next body");
  assert.equal(game.state.phase, "settling");
  assert.equal(game.state.turn, 1);
  until(game, () => game.state.resolution?.reveal?.playerId === c.id, "secondary victim receives a separate close-up");
  assert.equal(c.hp, 100);
  assert.equal(c.grounded, true);
  assert.equal(a.hp, 100);
  until(game, () => game.state.turn === 2, "handoff follows all the outcomes");
  assert.ok(c.hp < 100 && c.hp > 0);
  assert.equal(game.state.activePlayerId, c.id, "the killed opponent is skipped");
  assert.equal(game.state.resolution?.reveal ?? null, null);
});

test("drowning stays pending until its damage close-up and cannot announce victory early", () => {
  const game = new GameEngine();
  const frog = game.state.players[0];
  Object.assign(frog, { x: 25, y: WATER_Y - PLAYER_RADIUS });
  game.step(FIXED_STEP);
  assert.equal(frog.alive, true);
  assert.equal(frog.hp, 100);
  assert.ok(game.state.resolution!.drownedPlayerIds.includes(frog.id));
  assert.equal(game.state.winnerId, null);
  assert.equal(game.command(frog.id, { type: "jump" }), false);
  until(game, () => game.state.resolution?.reveal?.playerId === frog.id, "the drowned frog is shown");
  assert.equal(game.state.resolution!.reveal!.drowned, true);
  advance(game, 0.3);
  assert.equal(frog.hp, 100);
  until(game, () => game.state.phase === "finished", "victory follows the water outcome");
  assert.equal(frog.hp, 0);
  assert.equal(frog.alive, false);
  assert.equal(game.state.winnerId, "p2");
});

test("high falls and fast walls are safe during traversal while a high stomp queues victim damage", () => {
  for (const contact of ["floor", "wall"] as const) {
    const { game, a, b } = arena();
    b.x = 2500;
    if (contact === "wall") {
      game.state.platforms.push({ id: "wall", x: 700, y: 500, w: 20, h: 500 });
      Object.assign(a, { x: 650, y: 700, vx: 1400, vy: 0, grounded: false });
    } else Object.assign(a, { y: 500, vy: 1400, grounded: false });
    advance(game, 0.4);
    assert.equal(a.hp, 100, contact);
    assert.equal(game.state.resolution?.pendingDamage[a.id] ?? 0, 0, contact);
    assert.equal(game.state.phase, "playing", contact);
  }
  const { game, a, b } = arena();
  Object.assign(a, { x: b.x - 7, y: b.y - 100, vy: 1300, grounded: false });
  until(game, () => (game.state.resolution?.pendingDamage[b.id] ?? 0) > 0, "the high stomp tracks its victim", 1);
  assert.equal(b.hp, 100);
  assert.equal(game.state.phase, "settling");
  assert.ok(b.tumble > 0);
});

test("checkpoints replay impact slow motion and a partly shown damage outcome exactly", () => {
  const { game, b } = arena();
  fire(game, "bat", b.x, b.y);
  advance(game, 0.07);
  assert.ok(game.state.resolution!.slowMotionRemaining > 0);
  const restored = new GameEngine({ seed: 999 });
  restored.restore(game.capture());
  for (let frame = 0; frame < 1500 && !game.state.resolution?.reveal; frame++) {
    game.step(FIXED_STEP);
    restored.step(FIXED_STEP);
  }
  assert.ok(game.state.resolution?.reveal);
  assert.deepEqual(restored.capture(), game.capture());
  advance(game, 0.3);
  const checkpoint = game.capture();
  restored.restore(checkpoint);
  checkpoint.state.resolution!.reveal!.damage = 9999;
  for (let frame = 0; frame < 600; frame++) {
    game.step(FIXED_STEP);
    restored.step(FIXED_STEP);
  }
  assert.deepEqual(restored.capture(), game.capture(), "restored outcomes neither disappear nor apply twice");
});

test("one blast reveals each damaged frog separately and only subtracts the focused frog's health", () => {
  const { game, b, c } = arena();
  c.x = 680;
  b.hp = b.maxHp = c.hp = c.maxHp = 500;
  fire(game, "pulse", 1000, b.y);
  assert.ok(game.state.resolution!.pendingDamage[b.id] > 0);
  assert.ok(game.state.resolution!.pendingDamage[c.id] > 0);
  assert.equal(b.hp, 500);
  assert.equal(c.hp, 500);
  until(game, () => game.state.resolution?.reveal?.playerId === b.id, "first damaged frog is framed");
  const firstDamage = game.state.resolution!.reveal!.damage;
  assert.equal(b.grounded, true);
  assert.equal(c.grounded, true);
  until(game, () => game.state.resolution?.reveal?.applied === true, "first damage is subtracted");
  assert.equal(b.hp, 500 - firstDamage);
  assert.equal(c.hp, 500, "a waiting frog keeps its displayed health");
  assert.equal(game.state.turn, 1);
  until(game, () => game.state.resolution?.reveal?.playerId === c.id, "second damaged frog is framed");
  assert.equal(c.hp, 500);
  advance(game, 0.3);
  assert.equal(c.hp, 500, "every frog receives its own camera lead-in");
  until(game, () => game.state.turn === 2, "the whole review completes before handoff");
  assert.ok(c.hp < 500);
});

test("a bat launch into a wall adds impact damage to the eventual weapon outcome", () => {
  const { game, b } = arena();
  game.state.platforms.push({ id: "wall", x: 720, y: 500, w: 24, h: 500 });
  fire(game, "bat", b.x, b.y);
  const weaponDamage = game.state.resolution!.pendingDamage[b.id];
  until(game, () => (game.state.resolution?.pendingDamage[b.id] ?? 0) > weaponDamage,
    "the launched frog's wall impact adds pending damage", 1);
  const accumulated = game.state.resolution!.pendingDamage[b.id];
  assert.equal(b.hp, 100);
  assert.ok(b.vx < 0, "the hit rebounds the body instead of killing it at the wall");
  until(game, () => game.state.resolution?.reveal?.playerId === b.id, "combined outcome is shown");
  const reveal = game.state.resolution!.reveal!;
  assert.ok(reveal.damage >= accumulated);
  until(game, () => reveal.applied, "combined damage is finally subtracted");
  assert.equal(b.hp, Math.max(0, 100 - reveal.damage));
});

test("an indirect launch marks the active frog for camera tracking and queues its later fall damage", () => {
  const { game, a, b, c } = arena();
  game.state.platforms = [
    { id: "ledge", x: 0, y: 600, w: 620, h: 30 },
    { id: "floor", x: 0, y: 1600, w: WIDTH, h: 200 },
  ];
  Object.assign(a, { x: 600, y: 600 - PLAYER_RADIUS });
  Object.assign(b, { x: 560, y: 600 - PLAYER_RADIUS, vx: 700, tumble: 1 });
  c.y = 1600 - PLAYER_RADIUS;
  game.state.phase = "settling";
  game.state.timeLeft = 0;
  game.state.resolution = {
    affectedPlayerIds: [b.id], pendingDamage: {}, drownedPlayerIds: [],
    focus: { x: b.x, y: b.y }, reveal: null, slowMotionRemaining: 0, impact: 0,
  };
  until(game, () => game.state.resolution!.affectedPlayerIds.includes(a.id),
    "body-to-body launch adds the active frog to the camera's affected bodies", 0.2);
  assert.equal(game.state.resolution!.pendingDamage[a.id] ?? 0, 0,
    "the initial shove is below the threshold for direct collision damage");
  assert.ok(a.y < 700, "tracking starts before the long fall");
  assert.ok(a.vx > 200);
  until(game, () => (game.state.resolution!.pendingDamage[a.id] ?? 0) > 0,
    "an indirect launch removes traversal immunity for the eventual terrain impact", 5);
  assert.equal(a.hp, 100, "the indirect fall damage is still deferred");
  assert.equal(a.alive, true);
  until(game, () => game.state.resolution?.reveal?.playerId === a.id,
    "the indirect launch gets its own damage outcome");
  const reveal = game.state.resolution!.reveal!;
  assert.ok(reveal.damage > 0);
  until(game, () => reveal.applied, "the recorded indirect fall damage is subtracted");
  assert.equal(a.hp, Math.max(0, 100 - reveal.damage));
});
