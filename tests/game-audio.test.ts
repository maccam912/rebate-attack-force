import test from "node:test";
import assert from "node:assert/strict";
import { GameEngine } from "../shared/game.js";
import type { GameState } from "../shared/types.js";
import { GameSoundDirector } from "../src/game-audio.js";

type SoundSink = ConstructorParameters<typeof GameSoundDirector>[0];
type Motion = Parameters<SoundSink["setMotion"]>[0];
type PlayedSound = { name: Parameters<SoundSink["play"]>[0]; options: Parameters<SoundSink["play"]>[1] };
type SoundEvent = NonNullable<GameState["soundEvents"]>[number];

function setup() {
  const state = new GameEngine({ mode: "practice", seed: 42 }).state;
  const player = state.players[0];
  state.players = [player];
  state.activePlayerId = player.id;
  state.waterY = 1800;
  state.soundSequence = 0;
  state.soundEvents = [];
  Object.assign(player, { x: 500, y: 500, vx: 0, vy: 0, grounded: true, tumble: 0, rope: null });
  const played: PlayedSound[] = [];
  const motion: Motion[] = [];
  const sink: SoundSink = {
    play(name, options) { played.push({ name, options }); },
    setMotion(value) { motion.push({ ...value }); },
    reset() {},
  };
  const director = new GameSoundDirector(sink);
  const listener = { x: 500, y: 500 };
  const frame = (seconds = 1 / 60, audible = true, charge = 0) => {
    director.update(state, seconds, { audible, charge, listener });
  };
  const event = (id: number, kind: SoundEvent["kind"], details: Partial<SoundEvent> = {}) => {
    const entry: SoundEvent = { id, kind, x: player.x, y: player.y, playerId: player.id, ...details };
    state.soundSequence = Math.max(state.soundSequence ?? 0, id);
    state.soundEvents!.push(entry);
    return entry;
  };
  director.reset(state);
  return { state, player, played, motion, director, listener, frame, event };
}

test("reset baselines the existing sound journal without replaying a match's history", () => {
  const scene = setup();
  scene.event(10, "explosion");
  scene.director.reset(scene.state);
  scene.director.observe(scene.state, scene.listener);
  assert.equal(scene.played.length, 0);

  scene.event(11, "jump");
  scene.director.observe(scene.state, scene.listener);
  assert.deepEqual(scene.played.map((sound) => sound.name), ["jump"]);
});

test("one authoritative snapshot can play a splash and respawn even after the frog has recovered", () => {
  const scene = setup();
  scene.event(1, "splash");
  scene.event(2, "respawn");
  assert.equal(scene.player.alive, true);
  assert.equal(scene.player.hp, scene.player.maxHp);

  scene.director.observe(scene.state, scene.listener);
  scene.director.observe(scene.state, scene.listener);
  assert.deepEqual(scene.played.map((sound) => sound.name), ["splash", "respawn"]);
});

test("the event journal carries all action cues and preserves weapon and impact details", () => {
  const scene = setup();
  const kinds: SoundEvent["kind"][] = [
    "jump", "backflip", "grapple", "release", "land", "bounce", "hurt", "death", "splash",
    "respawn", "shot", "explosion", "pickup", "switch", "select", "mineArm", "mineTrigger", "victory",
  ];
  for (const [index, kind] of kinds.entries()) {
    scene.event(index + 1, kind, { weapon: "rocket", intensity: 0.8 });
  }
  scene.director.observe(scene.state, scene.listener);
  assert.deepEqual(scene.played.map((sound) => sound.name), kinds);
  const shot = scene.played.find((sound) => sound.name === "shot")!;
  assert.equal(shot.options?.weapon, "rocket");
  assert.equal(shot.options?.intensity, 0.8);
});

test("duplicate and regressed authoritative snapshots cannot replay effects", () => {
  const scene = setup();
  const first = scene.event(1, "jump");
  scene.state.soundEvents!.push({ ...first });
  scene.event(3, "land");
  scene.director.observe(scene.state, scene.listener);
  scene.director.observe(scene.state, scene.listener);
  scene.state.soundSequence = 2;
  scene.state.soundEvents = [{ ...first }, { ...first, id: 2, kind: "hurt" }];
  scene.director.observe(scene.state, scene.listener);
  scene.event(4, "pickup");
  scene.director.observe(scene.state, scene.listener);
  assert.deepEqual(scene.played.map((sound) => sound.name), ["jump", "land", "pickup"]);
});

test("muted observation consumes sound events so resuming never plays a backlog", () => {
  const scene = setup();
  scene.event(1, "explosion");
  scene.event(2, "death");
  scene.director.observe(scene.state, scene.listener, false);
  scene.director.observe(scene.state, scene.listener, true);
  assert.equal(scene.played.length, 0);

  scene.event(3, "switch");
  scene.director.observe(scene.state, scene.listener, true);
  assert.deepEqual(scene.played.map((sound) => sound.name), ["switch"]);
});

test("a new match reset permits event IDs that were used in the previous match", () => {
  const scene = setup();
  scene.event(1, "jump");
  scene.director.observe(scene.state, scene.listener);
  scene.state.soundSequence = 0;
  scene.state.soundEvents = [];
  scene.director.reset(scene.state);
  scene.event(1, "backflip");
  scene.director.observe(scene.state, scene.listener);
  assert.deepEqual(scene.played.map((sound) => sound.name), ["jump", "backflip"]);
});

test("footsteps follow distance traveled on the ground rather than velocity alone", () => {
  const scene = setup();
  scene.player.vx = 240;
  for (let i = 0; i < 90; i++) scene.frame();
  assert.equal(scene.played.filter((sound) => sound.name === "step").length, 0, "pressing into a wall stays quiet");

  for (let i = 0; i < 20; i++) {
    scene.player.x += 8;
    scene.frame(1 / 30);
  }
  const footsteps = scene.played.filter((sound) => sound.name === "step").length;
  assert.ok(footsteps >= 2 && footsteps <= 4, "walking produces a natural cadence based on accumulated displacement");

  scene.player.vx = 0;
  for (let i = 0; i < 90; i++) scene.frame();
  assert.equal(scene.played.filter((sound) => sound.name === "step").length, footsteps, "standing still adds no footsteps");
});

test("slow drift, airborne travel, tumbling, and respawn teleports do not produce footsteps", () => {
  for (const movement of ["slow", "airborne", "tumbling", "teleport"] as const) {
    const scene = setup();
    scene.player.vx = movement === "slow" ? 20 : 240;
    scene.player.grounded = movement !== "airborne";
    scene.player.tumble = movement === "tumbling" ? 1 : 0;
    for (let i = 0; i < 20; i++) {
      scene.player.x += movement === "teleport" ? 300 : 8;
      scene.frame(1 / 30);
    }
    assert.equal(scene.played.filter((sound) => sound.name === "step").length, 0, movement);
  }
});

test("motion audio grows with flight speed and rope motion, and follows charging", () => {
  const scene = setup();
  scene.player.grounded = false;
  scene.player.vx = 200;
  scene.frame();
  const slow = scene.motion.at(-1)!;
  assert.equal(slow.wind, 0);
  assert.equal(slow.swing, 0);

  scene.player.vx = 800;
  scene.frame();
  const fast = scene.motion.at(-1)!;
  assert.ok(fast.wind > slow.wind);
  scene.player.vx = 1600;
  scene.frame();
  assert.ok(scene.motion.at(-1)!.wind >= fast.wind, "faster flight does not reduce rushing air");

  scene.player.vx = 240;
  scene.player.rope = { x: 500, y: 100, length: 400, bends: [] };
  scene.frame(1 / 60, true, 0.75);
  const swinging = scene.motion.at(-1)!;
  assert.ok(swinging.swing > 0);
  assert.ok(swinging.charge > 0);
  assert.ok(Number.isFinite(swinging.pan));
  scene.player.rope = null;
  scene.frame();
  assert.equal(scene.motion.at(-1)!.swing, 0);
  assert.equal(scene.motion.at(-1)!.charge, 0);
});

test("muting immediately silences continuous flight, swing, and charging audio", () => {
  const scene = setup();
  scene.player.grounded = false;
  scene.player.vx = 1400;
  scene.player.rope = { x: 500, y: 100, length: 400, bends: [] };
  scene.frame(1 / 60, true, 0.9);
  assert.ok(scene.motion.at(-1)!.wind > 0);
  assert.ok(scene.motion.at(-1)!.swing > 0);
  scene.frame(1 / 60, false, 0.9);
  const muted = scene.motion.at(-1)!;
  assert.equal(muted.wind, 0);
  assert.equal(muted.swing, 0);
  assert.equal(muted.charge, 0);
});

test("a dangerous flight produces one panic cry, with a cooldown before a later flight", () => {
  const scene = setup();
  scene.player.grounded = false;
  scene.player.vx = 1100;
  scene.player.tumble = 1;
  for (let i = 0; i < 180; i++) scene.frame();
  assert.equal(scene.played.filter((sound) => sound.name === "panic").length, 1);

  scene.player.grounded = true;
  scene.player.vx = 0;
  scene.player.tumble = 0;
  scene.frame();
  scene.player.grounded = false;
  scene.player.vx = 1100;
  scene.player.tumble = 1;
  scene.frame();
  assert.equal(scene.played.filter((sound) => sound.name === "panic").length, 1, "another flight within the cooldown stays quiet");

  scene.player.grounded = true;
  scene.player.vx = 0;
  scene.player.tumble = 0;
  for (let i = 0; i < 300; i++) scene.frame();
  scene.player.grounded = false;
  scene.player.vx = 1100;
  scene.player.tumble = 1;
  scene.frame();
  assert.equal(scene.played.filter((sound) => sound.name === "panic").length, 2);
  for (let i = 0; i < 360; i++) scene.frame();
  assert.equal(scene.played.filter((sound) => sound.name === "panic").length, 2, "one long flight stays quiet even after the cooldown expires");
});

test("falling toward nearby water can trigger panic without tumbling", () => {
  const scene = setup();
  scene.player.grounded = false;
  scene.player.vy = 750;
  scene.player.y = scene.state.waterY - 500;
  scene.frame();
  assert.equal(scene.played.filter((sound) => sound.name === "panic").length, 0);
  scene.player.y = scene.state.waterY - 200;
  for (let i = 0; i < 60; i++) scene.frame();
  assert.equal(scene.played.filter((sound) => sound.name === "panic").length, 1);
});
