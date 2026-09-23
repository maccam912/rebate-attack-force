import { singleFrogGame } from "./fixtures.js";
import test from "node:test";
import assert from "node:assert/strict";
import { GameEngine, FIXED_STEP, PLAYER_RADIUS, WIDTH } from "../shared/game.js";
import { addStatus, hazardTouches, MAX_HAZARDS, ropeIntersectsCircle, ropeIntersectsWire } from "../shared/effects.js";
import { WEAPONS, type WeaponDefinition } from "../shared/weapons.js";
import type { ArenaHazard, HazardKind, PlayerInput, StatusKind } from "../shared/types.js";

const input = (patch: Partial<PlayerInput> = {}): PlayerInput => ({
  left: false, right: false, up: false, down: false, aimX: 1500, aimY: 700, ...patch,
});
function arena() {
  const game = singleFrogGame({ mode: "practice", seed: 456, mineCount: 0 });
  game.state.platforms = [{ id: "floor", x: 0, y: 1000, w: WIDTH, h: 800 }];
  game.state.crates = [];
  const [a, b] = game.state.players;
  Object.assign(a, { x: 500, y: 1000 - PLAYER_RADIUS, hp: 1000, maxHp: 1000 });
  Object.assign(b, { x: 1800, y: 1000 - PLAYER_RADIUS, hp: 1000, maxHp: 1000 });
  return { game, a, b };
}
function advance(game: GameEngine, seconds: number): void {
  for (let frame = 0; frame < Math.round(seconds / FIXED_STEP); frame++) game.step(FIXED_STEP);
}
function byStatus(kind: StatusKind): WeaponDefinition {
  const definition = WEAPONS.find((weapon) => weapon.status?.kind === kind);
  assert.ok(definition, `the arsenal provides ${kind}`);
  return definition;
}
function hazard(kind: HazardKind, x = 500, y = 1000): ArenaHazard {
  const definition = WEAPONS.find((weapon) => weapon.hazard?.kind === kind);
  assert.ok(definition, `the arsenal provides ${kind}`);
  return { id: `test-${kind}`, kind, x, y, radius: definition.hazard!.radius,
    remainingTurns: definition.hazard!.turns, createdTurn: 1, weapon: definition.id, hitPlayerIds: [] };
}
function detonate(game: GameEngine, definition: WeaponDefinition, x: number, y: number): void {
  const player = game.state.players.find((candidate) => candidate.id === game.state.activePlayerId)!;
  game.setInput(player.id, input());
  assert.equal(game.command(player.id, { type: "selectWeapon", weapon: definition.id }), true);
  assert.equal(game.command(player.id, { type: "fire" }), true);
  assert.ok(game.state.projectiles.length > 0);
  Object.assign(game.state.projectiles[0], { x, y, vx: 0, vy: 0, life: FIXED_STEP });
  game.step(FIXED_STEP);
}

test("weapon conditions reach exposed targets but do not pass through solid cover", () => {
  for (const blocked of [false, true]) {
    const { game, b } = arena();
    const definition = byStatus("dazzled");
    if (blocked) game.state.platforms.push({ id: "cover", x: b.x - 35, y: 850, w: 10, h: 150 });
    detonate(game, definition, b.x - 65, b.y);
    assert.equal(b.statuses?.some((status) => status.kind === "dazzled") ?? false, !blocked);
  }
});

test("condition refreshes do not stack or reset the periodic damage clock", () => {
  const { a } = arena();
  addStatus(a, "burning", 3, byStatus("burning").id);
  a.statuses![0].tick = 0.75;
  addStatus(a, "burning", 2, byStatus("burning").id);
  assert.equal(a.statuses!.length, 1);
  assert.equal(a.statuses![0].remaining, 3);
  assert.equal(a.statuses![0].tick, 0.75);
  addStatus(a, "burning", 5, byStatus("burning").id);
  assert.equal(a.statuses![0].remaining, 5);
  assert.equal(a.statuses![0].tick, 0.75);
});

test("condition clocks count only the affected frog's playing or retreat control", () => {
  const { game, a, b } = arena();
  for (const player of [a, b]) addStatus(player, "inverted", 5, byStatus("inverted").id);
  advance(game, 0.5);
  assert.ok(Math.abs(a.statuses![0].remaining - 4.5) < 1e-6);
  assert.equal(b.statuses![0].remaining, 5);
  game.state.phase = "retreat";
  advance(game, 0.5);
  assert.ok(Math.abs(a.statuses![0].remaining - 4) < 1e-6);
  game.state.phase = "settling";
  Object.assign(a, { y: 500, grounded: false });
  advance(game, 0.25);
  assert.ok(Math.abs(a.statuses![0].remaining - 4) < 1e-6);
  game.state.phase = "damage";
  game.state.resolution = { affectedPlayerIds: [b.id], pendingDamage: { [b.id]: 1 }, drownedPlayerIds: [],
    focus: { x: b.x, y: b.y }, slowMotionRemaining: 0, impact: 0,
    reveal: { playerId: b.id, damage: 1, fromHp: 1000, toHp: 999, elapsed: 0, applied: false, drowned: false } };
  advance(game, 0.1);
  assert.ok(Math.abs(a.statuses![0].remaining - 4) < 1e-6);
  assert.equal(b.statuses![0].remaining, 5);
});

test("expired conditions are removed and old snapshots without effect arrays still advance", () => {
  const { game, a, b } = arena();
  delete game.state.hazards;
  delete b.statuses;
  addStatus(a, "pixelated", 0.1, byStatus("pixelated").id);
  advance(game, 0.2);
  assert.ok(!a.statuses?.some((status) => status.kind === "pixelated"));
  assert.ok(Number.isFinite(a.x + b.x));
});

test("slippery and chilled surfaces retain momentum while glue slows deliberate movement", () => {
  const normal = arena(), oil = arena(), ice = arena(), glue = arena();
  for (const scenario of [normal, oil, ice]) scenario.a.vx = 200;
  addStatus(oil.a, "slippery", 5, byStatus("slippery").id);
  addStatus(ice.a, "chilled", 5, byStatus("chilled").id);
  addStatus(glue.a, "sticky", 5, byStatus("sticky").id);
  for (const { game } of [normal, oil, ice]) advance(game, 0.3);
  assert.ok(oil.a.vx > normal.a.vx + 30);
  assert.ok(ice.a.vx > normal.a.vx + 30);
  const walking = arena();
  for (const { game, a } of [walking, glue]) {
    game.setInput(a.id, input({ right: true }));
    advance(game, 0.4);
  }
  assert.ok(glue.a.x < walking.a.x - 15);
});

test("inversion reverses steering and heavy and feather conditions alter fall acceleration", () => {
  const inverted = arena();
  addStatus(inverted.a, "inverted", 5, byStatus("inverted").id);
  inverted.game.setInput(inverted.a.id, input({ right: true }));
  advance(inverted.game, 0.2);
  assert.ok(inverted.a.x < 500);
  const normal = arena(), heavy = arena(), feather = arena();
  addStatus(heavy.a, "heavy", 5, byStatus("heavy").id);
  addStatus(feather.a, "feather", 5, byStatus("feather").id);
  for (const { game, a } of [normal, heavy, feather]) {
    Object.assign(a, { y: 400, grounded: false });
    advance(game, 0.2);
  }
  assert.ok(heavy.a.vy > normal.a.vy * 1.2);
  assert.ok(feather.a.vy < normal.a.vy * 0.8);
});

test("rubberized landing bounces during control but cannot keep turn settlement alive", () => {
  const { game, a } = arena();
  addStatus(a, "bouncy", 5, byStatus("bouncy").id);
  Object.assign(a, { y: 1000 - PLAYER_RADIUS - 3, vy: 250, grounded: false });
  advance(game, 0.05);
  assert.ok(a.vy < -100, "a modest landing produces a strong rebound");
  assert.equal(game.command(a.id, { type: "endTurn" }), true);
  advance(game, 5);
  assert.ok(game.state.turn > 1, "a status does not create endless settling");
});

test("slippery launch momentum eventually settles even while its condition clock is paused", () => {
  for (const kind of ["slippery", "chilled", "feather"] as const) {
    const { game, a } = arena();
    addStatus(a, kind, 10, byStatus(kind).id);
    Object.assign(a, { x: 1200, vx: 450 });
    game.command(a.id, { type: "endTurn" });
    advance(game, 8);
    assert.ok(game.state.turn > 1, `${kind} must not prevent turn settlement`);
  }
});

test("burning and poison queue bounded periodic damage only on the victim's control", () => {
  for (const kind of ["burning", "poisoned"] as const) {
    const { game, a, b } = arena();
    for (const player of [a, b]) addStatus(player, kind, 2.4, byStatus(kind).id);
    advance(game, 0.25);
    assert.equal(game.state.resolution?.pendingDamage[a.id] ?? 0, 0, "damage is periodic rather than per frame");
    advance(game, 2.3);
    const damage = game.state.resolution?.pendingDamage[a.id] ?? 0;
    assert.ok(damage > 0 && damage < 100);
    assert.equal(a.hp, 1000, "damage waits for the turn resolution reveal");
    assert.equal(game.state.resolution?.pendingDamage[b.id] ?? 0, 0);
    advance(game, 0.5);
    assert.equal(game.state.resolution!.pendingDamage[a.id], damage, "an expired condition stops ticking");
    game.command(a.id, { type: "endTurn" });
    advance(game, 3);
    assert.ok(a.hp < 1000, "the queued damage is ultimately revealed");
  }
});

test("surface hazards land on terrain and expire after their configured number of handoffs", () => {
  const { game, a } = arena();
  const definition = WEAPONS.find((weapon) => weapon.hazard?.kind === "oil")!;
  detonate(game, definition, 1200, 700);
  const patch = game.state.hazards?.find((item) => item.kind === "oil");
  assert.ok(patch);
  assert.ok(Math.abs(patch.y - 1000) <= 3, "an airborne bottle lays its patch on the platform below");
  const placedTurn = patch.createdTurn;
  for (let handoff = 1; handoff <= definition.hazard!.turns; handoff++) {
    if (game.state.phase === "playing") game.command(game.state.activePlayerId, { type: "endTurn" });
    advance(game, 1);
    assert.equal(game.state.turn, placedTurn + handoff);
    const remaining: ArenaHazard | undefined = game.state.hazards?.find((item) => item.id === patch.id);
    if (handoff < definition.hazard!.turns) {
      assert.ok(remaining, "a patch remains available for every promised turn");
      assert.equal(remaining.remainingTurns, definition.hazard!.turns - handoff);
    } else assert.equal(remaining, undefined, "the last handoff removes the expired patch");
  }
  assert.ok(game.state.turn > placedTurn);
  assert.ok(!game.state.hazards?.some((item) => item.id === patch.id));
  assert.ok(a.hp > 0);
});

test("hazard storage remains bounded and narrow ledges constrain a spill to their own top", () => {
  const { game } = arena();
  game.state.platforms.push({ id: "ledge", x: 1100, y: 700, w: 90, h: 20 });
  game.state.hazards = Array.from({ length: MAX_HAZARDS }, (_, index) => ({ ...hazard("oil", 2500), id: `old-${index}` }));
  const definition = WEAPONS.find((weapon) => weapon.hazard?.kind === "oil")!;
  detonate(game, definition, 1102, 675);
  assert.equal(game.state.hazards.length, MAX_HAZARDS);
  assert.ok(!game.state.hazards.some((patch) => patch.id === "old-0"));
  const latest = game.state.hazards.at(-1)!;
  assert.equal(latest.y, 700);
  assert.equal(latest.x, 1145);
  assert.equal(latest.radius, 45);
});

test("an underside impact cannot teleport a spill through a thin roof", () => {
  const { game } = arena();
  game.state.platforms.push({ id: "roof", x: 1000, y: 650, w: 400, h: 20 });
  const definition = WEAPONS.find((weapon) => weapon.hazard?.kind === "oil")!;
  detonate(game, definition, 1100, 672);
  const patch = game.state.hazards?.find((item) => item.kind === "oil");
  assert.ok(patch);
  assert.equal(patch.y, 1000, "the spill belongs on the floor below the impact, not above the roof");
});

test("wire and spring pads trigger at most once for a frog during each turn", () => {
  for (const kind of ["wire", "spring"] as const) {
    const { game, a } = arena();
    const patch = hazard(kind);
    game.state.hazards = [patch];
    game.step(FIXED_STEP);
    assert.deepEqual(patch.hitPlayerIds, [a.id]);
    const firstDamage = game.state.resolution?.pendingDamage[a.id] ?? 0;
    Object.assign(a, { x: 500, y: 1000 - PLAYER_RADIUS, vx: 0, vy: 0, grounded: true });
    game.step(FIXED_STEP);
    assert.deepEqual(patch.hitPlayerIds, [a.id]);
    assert.equal(game.state.resolution?.pendingDamage[a.id] ?? 0, firstDamage);
    assert.equal(a.vy, 0, "returning to the pad cannot repeatedly launch the frog in one turn");
  }
});

test("a spring pad launch makes its victim eligible for delayed landing damage during their own turn", () => {
  const { game, a } = arena();
  game.state.hazards = [hazard("spring")];
  game.step(FIXED_STEP);
  assert.ok(a.vy < -800);
  assert.ok(game.state.resolution?.affectedPlayerIds.includes(a.id));
  advance(game, 2);
  assert.ok((game.state.resolution?.pendingDamage[a.id] ?? 0) > 0,
    "weapon-launched frogs cannot use the active traversal fall-damage exemption");
  assert.equal(a.hp, 1000, "landing damage remains queued for the normal reveal");
});

test("ground strips cannot affect frogs below their platform or across solid cover", () => {
  const patch = hazard("wire", 500, 700);
  assert.equal(hazardTouches(patch, { x: 500, y: 700 - PLAYER_RADIUS }), true);
  assert.equal(hazardTouches(patch, { x: 500, y: 760 }), false);
  const { game, a } = arena();
  game.state.platforms.push({ id: "wall", x: 530, y: 800, w: 20, h: 200 });
  game.state.hazards = [hazard("fire", 580)];
  advance(game, 0.1);
  assert.ok(!a.statuses?.some((status) => status.kind === "burning"));
});

test("wire detects bent rope spans, leaves remote ropes alone, and does not reach below its strip", () => {
  const { a } = arena();
  Object.assign(a, { x: 850, y: 850, rope: { x: 100, y: 400, length: 1100,
    bends: [{ x: 700, y: 400 }, { x: 700, y: 850 }] } });
  const patch = hazard("wire", 700, 650);
  patch.radius = 35;
  assert.equal(ropeIntersectsWire(a, patch), true, "the middle span crosses the wire");
  assert.equal(ropeIntersectsWire(a, { ...patch, x: 450 }), false);
  assert.equal(ropeIntersectsCircle(a, { x: 700, y: 650 }, 10), true);
  assert.equal(ropeIntersectsCircle(a, { x: 450, y: 650 }, 10), false);
  a.rope = { x: 650, y: 700, length: 300, bends: [] };
  assert.equal(ropeIntersectsWire(a, patch), false, "a rope beneath the strip remains intact");
});

test("wire cuts a crossing rope while preserving its momentum and blocks immediate reattachment", () => {
  const wired = arena(), free = arena();
  for (const { game, a } of [wired, free]) {
    game.state.platforms.push({ id: "anchor", x: 490, y: 400, w: 20, h: 20 });
    Object.assign(a, { y: 850, vx: 180, vy: 20, grounded: false,
      rope: { x: 500, y: 420, length: 600, bends: [] } });
  }
  wired.game.state.hazards = [hazard("wire", 500, 650)];
  free.a.rope = null;
  wired.game.step(FIXED_STEP);
  free.game.step(FIXED_STEP);
  assert.equal(wired.a.rope, null);
  assert.ok(Math.abs(wired.a.vx - free.a.vx) < 1e-6);
  assert.ok(Math.abs(wired.a.vy - free.a.vy) < 1e-6);
  wired.game.setInput(wired.a.id, input({ aimX: 500, aimY: 410 }));
  assert.equal(wired.game.command(wired.a.id, { type: "grapple" }), false);
  wired.game.state.hazards = [];
  assert.equal(wired.game.command(wired.a.id, { type: "grapple" }), true);
});

test("gravity fields push and pull during control and stop forcing bodies during settlement", () => {
  for (const kind of ["gravity", "repulsor", "updraft"] as const) {
    const { game, a } = arena();
    Object.assign(a, { x: 550, y: 700, grounded: false });
    game.state.hazards = [hazard(kind, 500, 700)];
    game.step(FIXED_STEP);
    assert.ok(game.state.resolution?.affectedPlayerIds.includes(a.id), `${kind} marks a weapon-affected body`);
    if (kind === "gravity") assert.ok(a.vx < 0);
    if (kind === "repulsor") assert.ok(a.vx > 0);
    if (kind === "updraft") assert.ok(a.vy < 0);
    game.command(a.id, { type: "endTurn" });
    advance(game, 5);
    assert.ok(game.state.turn > 1, `${kind} must not prevent the next turn`);
  }
});

test("effect clocks, periodic damage and fields replay identically across snapshot restore and render rates", () => {
  const original = arena();
  addStatus(original.a, "poisoned", 4, byStatus("poisoned").id);
  addStatus(original.b, "inverted", 5, byStatus("inverted").id);
  original.game.state.hazards = [hazard("gravity", 700, 900), hazard("ice", 500)];
  original.game.setInput(original.a.id, input({ right: true }));
  advance(original.game, 0.7);
  const checkpoint = original.game.capture();
  const savedCheckpoint = structuredClone(checkpoint);
  const replay = arena().game;
  replay.restore(checkpoint);
  for (let frame = 0; frame < 120; frame++) original.game.step(1 / 60);
  for (let frame = 0; frame < 60; frame++) replay.step(1 / 30);
  assert.deepEqual(replay.state, original.game.state);
  const actual = replay.capture().simulation, expected = original.game.capture().simulation;
  assert.ok(Math.abs(actual.accumulator - expected.accumulator) < 1e-9);
  assert.deepEqual({ ...actual, accumulator: 0 }, { ...expected, accumulator: 0 });
  assert.deepEqual(checkpoint, savedCheckpoint, "replay cannot mutate the saved checkpoint");
});
