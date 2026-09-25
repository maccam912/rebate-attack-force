import { test } from "node:test";
import assert from "node:assert/strict";
import { EXPLOSION_SECONDS, FIXED_STEP, GameEngine } from "../shared/game";
import { ClientPrediction, interpolateStates } from "../src/prediction";
import { MAX_PENDING_FRAMES, NETWORK_STEP, type InputFrame, type ServerState } from "../shared/protocol";
import type { PlayerInput } from "../shared/types";

const createGame = (options: ConstructorParameters<typeof GameEngine>[0] = {}) => new GameEngine({
  players: [{ id: "p1", name: "Moss", frogs: 1 }, { id: "p2", name: "Tangerine", frogs: 1 }],
  ...options,
});

const input: PlayerInput = { left: false, right: false, up: false, down: false, aimX: 600, aimY: 1000 };

function snapshot(game: GameEngine, ack = 0, epoch = "match-1"): ServerState {
  const { state, simulation } = game.capture();
  return { ...state, net: { epoch, ack, tick: Math.round(simulation.elapsed / FIXED_STEP), simulation } };
}

function applyFrame(game: GameEngine, frame: InputFrame): void {
  game.setInput(frame.playerId, frame.input);
  for (const command of frame.commands) game.command(frame.playerId, command);
  game.step(NETWORK_STEP);
}

test("checkpoints restore fixed-step remainder, jump timing, random generator and entity IDs without aliases", () => {
  const original = createGame({ mode: "practice", seed: 991 });
  original.setInput("p1", { ...input, right: true });
  original.command("p1", { type: "jump" });
  original.step(FIXED_STEP * 5.5);
  const saved = original.capture();
  const restored = createGame({ seed: 88 });
  restored.restore(saved);
  saved.state.players[0].hp = 1;
  saved.simulation.inputs[0][1].aimX = -123;
  assert.equal(restored.state.players[0].hp, 100);
  for (const game of [original, restored]) {
    assert.equal(game.command("p1", { type: "backflip" }), true);
    for (let i = 0; i < 150; i++) game.step(NETWORK_STEP);
    game.command(game.state.activePlayerId, { type: "endTurn" });
    for (let i = 0; i < 700; i++) game.step(NETWORK_STEP);
  }
  assert.deepEqual(restored.capture(), original.capture());
});

test("the active frog moves and jumps before server acknowledgement", () => {
  const server = createGame({ mode: "practice" });
  const sent: InputFrame[] = [];
  const client = new ClientPrediction((frame) => sent.push(frame));
  client.receive(snapshot(server), "p1", 0);
  client.input({ ...input, right: true });
  client.command({ type: "jump" });
  const shown = client.advance(NETWORK_STEP, 17)!;
  assert.equal(client.isPredicting, true);
  assert.equal(client.pendingCount, 1);
  assert.ok(shown.players[0].x > server.state.players[0].x);
  assert.ok(shown.players[0].y < server.state.players[0].y);
  assert.equal(server.state.players[0].grounded, true, "prediction cannot mutate authority");
  assert.equal(sent[0].seq, 1);
  assert.deepEqual(sent[0].commands, [{ type: "jump" }]);
  assert.equal("dt" in sent[0], false, "the client never asks the server to advance time");
});

test("active movement stays smooth between network steps on high-refresh displays", () => {
  const server = createGame({ mode: "practice", mineCount: 0 });
  server.state.crates = [];
  const authority = server.capture();
  const sent: InputFrame[] = [];
  const client = new ClientPrediction((frame) => sent.push(frame));
  client.receive(snapshot(server), "p1", 0);
  client.input({ ...input, right: true });
  for (let i = 1; i <= 20; i++) client.advance(NETWORK_STEP, i * 1000 / 60);
  let previous = client.advance(0, 1000 / 3)!.players[0].x;
  const moves: number[] = [];
  for (let i = 1; i <= 24; i++) {
    const shown = client.advance(NETWORK_STEP / 2, 1000 / 3 + i * 1000 / 120)!;
    moves.push(shown.players[0].x - previous);
    previous = shown.players[0].x;
  }
  assert.ok(moves.every((distance) => distance > 0), "120 Hz frames must not alternate between a frozen pose and a jump");
  assert.ok(Math.max(...moves) / Math.min(...moves) < 1.2, "Steady movement has even frame-to-frame travel");
  assert.equal(sent.length, 32, "Presentation does not raise the network or authoritative simulation rate");
  assert.deepEqual(server.capture(), authority, "Intermediate drawing never changes authoritative gameplay");
});

test("fractional prediction follows slow motion and preserves the shown pose during reconciliation", () => {
  const server = createGame({ mode: "practice", mineCount: 0 });
  Object.assign(server.state.players[0], { vx: 240, vy: -120, angularVelocity: 2 });
  server.state.resolution = {
    affectedPlayerIds: [], pendingDamage: {}, drownedPlayerIds: [], focus: null,
    reveal: null, slowMotionRemaining: 0.2, impact: 0.5,
  };
  server.state.projectiles = [{ id: "shot", ownerId: "p1", kind: "grenade", x: 100, y: 200,
    vx: 360, vy: -120, life: 2, age: 0, radius: 5, damage: 20 }];
  const client = new ClientPrediction(() => assert.fail("A half-step must not send a full input frame"));
  const authority = snapshot(server);
  client.receive(authority, "p1", 0);
  const dt = NETWORK_STEP / 2;
  const shown = client.advance(dt, dt * 1000)!;
  assert.equal(shown.players[0].x, authority.players[0].x + 240 * dt * 0.28);
  assert.equal(shown.players[0].y, authority.players[0].y - 120 * dt * 0.28);
  assert.ok(Math.abs(shown.players[0].rotation - authority.players[0].rotation - 2 * dt * 0.28) < 1e-10);
  assert.equal(shown.projectiles[0].x, 100 + 360 * dt * 0.28);
  assert.deepEqual(snapshot(server), authority);
  server.state.players[0].x += 40;
  server.state.players[0].hp = 80;
  client.receive(snapshot(server), "p1", 9);
  const reconciled = client.advance(0, 9)!;
  assert.equal(reconciled.players[0].x, shown.players[0].x,
    "A mid-frame server correction accounts for the fractional drawing offset");
  assert.equal(reconciled.players[0].hp, 80, "Only the pose is smoothed; health is authoritative immediately");
  assert.equal(client.pendingCount, 0);
});

test("fractional prediction expires explosions without changing authority, including during slow motion", () => {
  for (const slowMotion of [false, true]) {
    const server = createGame({ mode: "practice", mineCount: 0 });
    server.state.phase = "settling";
    server.state.resolution = {
      affectedPlayerIds: [], pendingDamage: {}, drownedPlayerIds: [], focus: null,
      reveal: null, slowMotionRemaining: slowMotion ? 0.2 : 0, impact: 0.5,
    };
    server.state.explosions = [
      { id: "blast", x: 500, y: 500, radius: 96, age: EXPLOSION_SECONDS - 0.001 },
      { id: "death-blast", x: 550, y: 500, radius: 96, age: EXPLOSION_SECONDS - 0.001 },
      { id: "fresh-blast", x: 600, y: 500, radius: 96, age: 0 },
    ];
    const authority = snapshot(server);
    const client = new ClientPrediction(() => assert.fail("A fractional frame must not send input"));
    client.receive(authority, "p1", 0);
    const dt = NETWORK_STEP / 2;
    const shown = client.advance(dt, dt * 1000)!;
    assert.deepEqual(shown.explosions.map((blast) => blast.id), ["fresh-blast"]);
    assert.ok(Math.abs(shown.explosions[0].age - dt * (slowMotion ? 0.28 : 1)) < 1e-10);
    assert.deepEqual(snapshot(server), authority, "Visual expiry must not mutate the server");
    client.receive(authority, "p1", 9);
    assert.deepEqual(client.advance(0, 9)!.explosions, shown.explosions,
      "Reconciliation must not resurrect an expired visual");
  }
});

test("a predicted end of control locks commands before the server acknowledges it", () => {
  const server = createGame({ mode: "practice" });
  server.state.players[0].vy = -300;
  server.state.players[0].grounded = false;
  const sent: InputFrame[] = [];
  const client = new ClientPrediction((frame) => sent.push(frame));
  client.receive(snapshot(server), "p1", 0);
  client.command({ type: "endTurn" });
  assert.equal(client.advance(NETWORK_STEP, 17)!.phase, "settling");
  assert.equal(server.state.phase, "playing", "authority has not acknowledged the command yet");
  assert.equal(client.canControl, false);
  client.command({ type: "jump" });
  client.advance(NETWORK_STEP, 34);
  assert.deepEqual(sent[1].commands, [], "controls cannot leak into the outcome sequence");
});

test("acknowledged actions are removed and unacknowledged actions replay exactly once", () => {
  const server = createGame({ mode: "practice", seed: 31 });
  const sent: InputFrame[] = [];
  const client = new ClientPrediction((frame) => sent.push(frame));
  client.receive(snapshot(server), "p1", 0);
  client.input({ ...input, right: true });
  for (let i = 0; i < 6; i++) {
    if (i === 3) client.command({ type: "jump" });
    client.advance(NETWORK_STEP, (i + 1) * 1000 / 60);
  }
  sent.slice(0, 3).forEach((frame) => applyFrame(server, frame));
  client.receive(snapshot(server, 3), "p1", 101);
  assert.equal(client.pendingCount, 3);
  sent.slice(3, 6).forEach((frame) => applyFrame(server, frame));
  const shown = client.advance(0, 101)!;
  assert.deepEqual(shown.players, server.state.players);
  client.receive(snapshot(server, 6), "p1", 102);
  assert.equal(client.pendingCount, 0);
  assert.deepEqual(client.advance(0, 102)!.players, server.state.players);
});

test("correction restores server health and inventory immediately while smoothing only the drawing pose", () => {
  const server = createGame({ mode: "practice" });
  const sent: InputFrame[] = [];
  const client = new ClientPrediction((frame) => sent.push(frame));
  client.receive(snapshot(server), "p1", 0);
  client.input({ ...input, right: true });
  const before = client.advance(NETWORK_STEP, 17)!;
  applyFrame(server, sent[0]);
  server.state.players[0].x += 50;
  server.state.players[0].hp = 73;
  server.state.players[0].inventory.rocket = 3;
  client.receive(snapshot(server, 1), "p1", 20);
  const corrected = client.advance(0, 20)!;
  assert.equal(corrected.players[0].hp, 73);
  assert.equal(corrected.players[0].inventory.rocket, 3);
  assert.ok(Math.abs(corrected.players[0].x - before.players[0].x) < 1e-9);
  client.input(input);
  for (let i = 0; i < 20; i++) client.advance(NETWORK_STEP, 40 + i * 17);
  assert.ok(client.advance(0, 400)!.players[0].x > before.players[0].x + 45);
});

test("spectators interpolate trajectories, angular attitude, rope length, mines and projectile fuses", () => {
  const game = createGame();
  const a = structuredClone(game.state);
  a.players[0].rotation = Math.PI - 0.1;
  a.players[0].rope = { x: 200, y: 100, length: 150, bends: [{ x: 201, y: 120 }] };
  a.projectiles = [{ id: "shot", ownerId: "p1", kind: "grenade", x: 100, y: 100, vx: 50, vy: -10, life: 2, age: 1, radius: 5, damage: 20 }];
  a.mines = [{ id: "mine", ownerId: "p1", kind: "mine", x: 100, y: 200, vx: 0, vy: 5, placedTurn: 1, fuse: 0.5, settled: false }];
  const b = structuredClone(a);
  b.players[0].x += 20;
  b.players[0].rotation = -Math.PI + 0.1;
  b.players[0].angularVelocity = 4;
  b.players[0].impact = 0.8;
  b.players[0].rope!.length = 250;
  b.projectiles[0].x = 120;
  b.projectiles[0].life = 1.8;
  b.projectiles[0].age = 1.2;
  b.mines[0].y = 220;
  b.mines[0].fuse = 0.3;
  const halfway = interpolateStates(a, b, 0.5);
  assert.equal(halfway.players[0].x, a.players[0].x + 10);
  assert.ok(Math.abs(halfway.players[0].rotation - Math.PI) < 1e-9);
  assert.equal(halfway.players[0].angularVelocity, 2);
  assert.equal(halfway.players[0].impact, 0.4);
  assert.equal(halfway.players[0].rope!.length, 200);
  assert.equal(halfway.projectiles[0].x, 110);
  assert.equal(halfway.projectiles[0].life, 1.9);
  assert.equal(halfway.projectiles[0].age, 1.1);
  assert.equal(halfway.mines[0].y, 210);
  assert.equal(halfway.mines[0].fuse, 0.4);
  assert.equal(a.players[0].rope!.length, 150, "presentation never edits a buffered state");
});

test("spectators smooth the damage reveal but debit HP and change recipients together", () => {
  const a = structuredClone(createGame().state);
  a.phase = "damage";
  a.resolution = {
    affectedPlayerIds: ["p1", "p2"], pendingDamage: { p1: 25, p2: 40 },
    drownedPlayerIds: [], focus: { x: 100, y: 200 },
    slowMotionRemaining: 0.2, impact: 0.8,
    reveal: { playerId: "p1", damage: 25, fromHp: 100, toHp: 75,
      elapsed: 0.2, applied: false, drowned: false },
  };
  const b = structuredClone(a);
  b.resolution!.focus = { x: 120, y: 220 };
  b.resolution!.reveal!.elapsed = 0.4;
  b.resolution!.slowMotionRemaining = 0.1;
  b.resolution!.impact = 0.4;
  const halfway = interpolateStates(a, b, 0.5);
  assert.ok(Math.abs(halfway.resolution!.reveal!.elapsed - 0.3) < 1e-9);
  assert.deepEqual(halfway.resolution!.focus, { x: 110, y: 210 });
  assert.ok(Math.abs(halfway.resolution!.impact - 0.6) < 1e-9);
  assert.equal(halfway.players[0].hp, 100);
  assert.equal(a.resolution.reveal!.elapsed, 0.2, "buffered reveal clocks are immutable");

  b.resolution!.reveal!.applied = true;
  b.players[0].hp = 75;
  assert.equal(interpolateStates(a, b, 0.99).resolution!.reveal!.applied, false);
  assert.equal(interpolateStates(a, b, 0.99).players[0].hp, 100);
  assert.equal(interpolateStates(a, b, 1).resolution!.reveal!.applied, true);
  assert.equal(interpolateStates(a, b, 1).players[0].hp, 75);

  b.resolution!.reveal = { playerId: "p2", damage: 40, fromHp: 100, toHp: 60,
    elapsed: 0.05, applied: false, drowned: false };
  assert.equal(interpolateStates(a, b, 0.99).resolution!.reveal!.playerId, "p1");
  assert.deepEqual(interpolateStates(a, b, 0.99).resolution!.focus, a.resolution.focus);
  assert.equal(interpolateStates(a, b, 1).resolution!.reveal!.playerId, "p2");
});

test("spectators do not anticipate a new explosion's camera impact", () => {
  const a = structuredClone(createGame().state);
  a.resolution = { affectedPlayerIds: [], pendingDamage: {}, drownedPlayerIds: [],
    focus: null, reveal: null, slowMotionRemaining: 0, impact: 0 };
  const b = structuredClone(a);
  b.resolution!.slowMotionRemaining = 0.3;
  b.resolution!.impact = 1;
  assert.equal(interpolateStates(a, b, 0.5).resolution!.slowMotionRemaining, 0);
  assert.equal(interpolateStates(a, b, 0.5).resolution!.impact, 0);
  assert.equal(interpolateStates(a, b, 1).resolution!.impact, 1);
});

test("watchers never run prediction or extrapolate across an interrupted snapshot stream", () => {
  const server = createGame({ mode: "practice" });
  const sent: InputFrame[] = [];
  const client = new ClientPrediction((frame) => sent.push(frame));
  client.receive(snapshot(server), "p2", 0);
  server.setInput("p1", { ...input, right: true });
  for (let i = 1; i <= 6; i++) {
    server.step(0.05);
    client.receive(snapshot(server), "p2", i * 50);
    client.advance(0.05, i * 50);
  }
  const bufferedX = client.advance(0, 300)!.players[0].x;
  assert.ok(bufferedX < server.state.players[0].x);
  client.input({ ...input, right: true });
  client.command({ type: "jump" });
  for (let i = 1; i <= 100; i++) client.advance(0.05, 300 + i * 50);
  assert.equal(client.isPredicting, false);
  assert.equal(client.canControl, false);
  assert.equal(sent.length, 0);
  assert.equal(client.advance(0, 5300)!.players[0].x, server.state.players[0].x);
});

test("watching a bot stays continuous at 120 Hz despite uneven snapshot arrival", () => {
  const server = createGame();
  const client = new ClientPrediction(() => assert.fail("Watching a bot cannot send predicted input"));
  const initial = snapshot(server);
  initial.players[0].x = 1000;
  client.receive(initial, "p2", 0);
  const packets = Array.from({ length: 30 }, (_, index) => {
    const time = (index + 1) * 0.05;
    const state = structuredClone(initial);
    state.net!.simulation.elapsed = time;
    state.net!.tick = Math.round(time / FIXED_STEP);
    state.players[0].x = 1000 + time * 240;
    return { at: time + [0, 0.035, 0.015][index % 3], state };
  });
  let previous = initial.players[0].x;
  for (let frame = 1; frame <= 168; frame++) {
    const time = frame / 120;
    while (packets[0]?.at <= time) {
      const packet = packets.shift()!;
      client.receive(packet.state, "p2", packet.at * 1000);
    }
    const shown = client.advance(1 / 120, time * 1000)!;
    if (time > 0.3) {
      const distance = shown.players[0].x - previous;
      assert.ok(distance > 1.5 && distance < 2.5, "Buffered movement does not freeze or jump with packets");
    }
    previous = shown.players[0].x;
  }
  assert.equal(client.isPredicting, false);
});

test("out-of-order states, turn switches, reconnects and restarts cannot replay stale commands", () => {
  const server = createGame({ mode: "practice" });
  const sent: InputFrame[] = [];
  const client = new ClientPrediction((frame) => sent.push(frame));
  const old = snapshot(server);
  client.receive(old, "p1", 0);
  client.command({ type: "jump" });
  client.advance(NETWORK_STEP, 17);
  server.step(0.1);
  server.state.players[0].hp = 60;
  client.receive(snapshot(server, 1), "p1", 100);
  client.receive(old, "p1", 110);
  assert.equal(client.advance(0, 110)!.players[0].hp, 60);
  client.command({ type: "endTurn" });
  server.state.turn++;
  server.state.activeTeamId = server.state.activePlayerId = "p2";
  client.receive(snapshot(server), "p1", 120);
  assert.equal(client.pendingCount, 0);
  assert.equal(client.canControl, false);
  assert.equal(client.isPredicting, false);
  client.advance(NETWORK_STEP, 140);
  assert.equal(sent.length, 1);
  client.reset();
  client.receive(snapshot(createGame({ mode: "practice" }), 42, "new-match"), "p1", 200);
  client.advance(NETWORK_STEP, 220);
  assert.equal(sent.at(-1)!.seq, 43);
  assert.equal(sent.at(-1)!.commands.length, 0);
  assert.equal(sent.at(-1)!.input.right, false);
  assert.equal(sent.at(-1)!.epoch, "new-match");
});

test("input history stays bounded when acknowledgements stop", () => {
  const sent: InputFrame[] = [];
  const client = new ClientPrediction((frame) => sent.push(frame));
  client.receive(snapshot(createGame({ mode: "practice" })), "p1", 0);
  for (let i = 0; i < 500; i++) client.advance(NETWORK_STEP, i * 17);
  assert.equal(client.pendingCount, MAX_PENDING_FRAMES);
  assert.equal(sent.length, MAX_PENDING_FRAMES);
});

test("latency and ordered jitter preserve one shot, authoritative damage and eventual acknowledgement", () => {
  const server = createGame({ mode: "practice", seed: 431 });
  // Keep the practice arsenal, but do not refill it after the outcome sequence.
  server.state.mode = "versus";
  server.state.platforms = [{ id: "floor", x: 0, y: 1600, w: 4320, h: 200 }];
  server.state.crates = [];
  server.state.players[0].x = 500;
  server.state.players[1].x = 640;
  const up: { due: number; frame: InputFrame }[] = [];
  const down: { due: number; state: ServerState }[] = [];
  let tick = 0, lastUp = 0, lastDown = 0, ack = 0, shots = 0;
  const client = new ClientPrediction((frame) => {
    // WebSockets preserve ordering; delivery can still bunch after jitter.
    lastUp = Math.max(lastUp, tick + 4 + frame.seq % 4);
    up.push({ due: lastUp, frame });
  });
  client.receive(snapshot(server), "p1", 0);
  let immediateX = 0;
  for (tick = 1; tick <= 480; tick++) {
    client.input({ ...input, right: tick <= 10, aimX: 1000, aimY: 1582 });
    if (tick === 20) {
      client.command({ type: "selectWeapon", weapon: "pulse" });
      client.command({ type: "fire", power: 1 });
    }
    if (tick === 120) client.command({ type: "jump" });
    const shown = client.advance(NETWORK_STEP, tick * 1000 / 60)!;
    if (tick === 1) immediateX = shown.players[0].x;
    while (up[0]?.due <= tick) {
      const frame = up.shift()!.frame;
      server.setInput(frame.playerId, frame.input);
      for (const command of frame.commands) {
        if (command.type === "fire") shots++;
        server.command(frame.playerId, command);
      }
      ack = frame.seq;
    }
    server.step(NETWORK_STEP);
    if (tick % 3 === 0) {
      lastDown = Math.max(lastDown, tick + 3 + tick % 5);
      down.push({ due: lastDown, state: snapshot(server, ack) });
    }
    while (down[0]?.due <= tick) client.receive(down.shift()!.state, "p1", tick * 1000 / 60);
    assert.ok(shown.players.every((player) => Number.isFinite(player.x) && Number.isFinite(player.rotation)));
  }
  assert.ok(immediateX > 500, "response occurs before the 66–116ms uplink");
  assert.equal(shots, 1, "correction replay never resends a firing command");
  assert.equal(server.state.players[0].inventory.pulse, 8);
  assert.ok(server.state.players[1].hp < 100, "the server adjudicates the impact");
  for (const { frame } of up) {
    server.setInput(frame.playerId, frame.input);
    for (const command of frame.commands) server.command(frame.playerId, command);
    ack = frame.seq;
  }
  client.receive(snapshot(server, ack), "p1", 8100);
  const final = client.advance(0, 8100)!;
  assert.equal(client.pendingCount, 0);
  assert.deepEqual(final.players.map((player) => [player.hp, player.inventory, player.alive]),
    server.state.players.map((player) => [player.hp, player.inventory, player.alive]));
  assert.deepEqual(final.projectiles, server.state.projectiles);
});

test("mid-flight checkpoint replay reproduces seeded cluster bomblets and explosion damage", () => {
  const first = createGame({ mode: "practice", seed: 911 });
  first.setInput("p1", { ...input, aimX: 1000, aimY: 1000 });
  first.command("p1", { type: "selectWeapon", weapon: "cluster" });
  first.command("p1", { type: "fire", power: 0.8 });
  for (let i = 0; i < 60; i++) first.step(NETWORK_STEP);
  assert.ok(first.state.projectiles.length > 0);
  const resumed = createGame();
  resumed.restore(first.capture());
  let sawBomblets = false;
  for (let i = 0; i < 300; i++) {
    first.step(NETWORK_STEP);
    resumed.step(NETWORK_STEP);
    sawBomblets ||= first.state.projectiles.some((shot) => shot.variant === "fragment");
    assert.deepEqual(resumed.state, first.state);
  }
  assert.equal(sawBomblets, true);
  assert.deepEqual(resumed.capture(), first.capture());
});
