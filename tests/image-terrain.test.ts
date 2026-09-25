import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PNG } from "pngjs";
import { bodyTerrain, imageSurface, imageSurfaceSites, imageSpawnGroups, opaqueRectangles } from "../shared/image-terrain.js";
import { FIXED_STEP, GameEngine, PLAYER_RADIUS } from "../shared/game.js";
import { getMap, MAPS } from "../shared/maps.js";
import { stateWithoutNetwork, type ServerState } from "../shared/protocol.js";
import { ropeSegmentBlocked, updateRopePath } from "../shared/rope.js";
import type { Platform, Rope } from "../shared/types.js";

function pixels(width: number, height: number, alpha: (x: number, y: number) => number): Uint8Array {
  const rgba = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = (y * width + x) * 4;
    rgba[i] = (x * 17) % 256; rgba[i + 1] = (y * 23) % 256; rgba[i + 2] = 255;
    rgba[i + 3] = alpha(x, y);
  }
  return rgba;
}
function solids(width: number, height: number, alpha: (x: number, y: number) => number): Platform[] {
  return opaqueRectangles(width, height, pixels(width, height, alpha))
    .map(([x, y, w, h], i) => ({ id: `pixel-${i}`, x, y, w, h }));
}
function fixture(platforms: Platform[], x: number, y: number) {
  const game = new GameEngine({ mapId: "mossback-grotto", mode: "practice", mineCount: 0,
    players: [{ id: "a", name: "A", frogs: 1 }, { id: "b", name: "B", frogs: 1 }] });
  Object.assign(game.state, { width: 800, height: 600, waterY: 1600, platforms, crates: [], mines: [] });
  Object.assign(game.state.players[0], { x, y, grounded: true, vx: 0, vy: 0 });
  Object.assign(game.state.players[1], { x: 750, y: 482 });
  return game;
}
function walk(game: GameEngine, right = true, frames = 120) {
  const frog = game.state.players[0];
  game.setInput(frog.id, { left: !right, right, up: false, down: false, aimX: 700, aimY: 200 });
  for (let i = 0; i < frames; i++) game.step(FIXED_STEP);
}

test("all 256 alpha values: exactly 255 blocks bodies, rays, and ropes", () => {
  const platforms = solids(256, 4, (x) => x);
  assert.deepEqual(platforms, [{ id: "pixel-0", x: 255, y: 0, w: 1, h: 4 }]);
  assert.equal(ropeSegmentBlocked({ x: 0, y: 2 }, { x: 254.5, y: 2 }, platforms), false);
  assert.equal(ropeSegmentBlocked({ x: 0, y: 2 }, { x: 255.5, y: 2 }, platforms), true);
});

test("holes, thin walls, disconnected pixels and partially transparent artwork survive compilation", () => {
  const width = 75, height = 63;
  const rgba = pixels(width, height, (x, y) => {
    if (x === 0 || x === 74 || y === 0 || y === 62 || x === 27) return 255;
    if (x > 10 && x < 60 && y > 10 && y < 50 && !(x > 20 && x < 50 && y > 20 && y < 40)) return 255;
    return (x * 33 + y * 71) % 255;
  });
  const occupied = new Uint8Array(width * height);
  for (const [x, y, w, h] of opaqueRectangles(width, height, rgba))
    for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) occupied[yy * width + xx]++;
  for (let i = 0; i < occupied.length; i++) assert.equal(occupied[i], Number(rgba[i * 4 + 3] === 255));
});

test("rope cannot slip along internal horizontal or vertical seams between pixel runs", () => {
  const horizontal = [{ id: "a", x: 10, y: 10, w: 20, h: 1 }, { id: "b", x: 9, y: 11, w: 22, h: 2 }];
  assert.equal(ropeSegmentBlocked({ x: 0, y: 11 }, { x: 40, y: 11 }, horizontal), true);
  assert.equal(ropeSegmentBlocked({ x: 0, y: 10 }, { x: 40, y: 10 }, horizontal), false);
  const vertical = [{ id: "a", x: 10, y: 10, w: 1, h: 20 }, { id: "b", x: 11, y: 9, w: 2, h: 22 }];
  assert.equal(ropeSegmentBlocked({ x: 11, y: 0 }, { x: 11, y: 40 }, vertical), true);
  assert.equal(ropeSegmentBlocked({ x: 10, y: 0 }, { x: 10, y: 40 }, vertical), false);
});

for (const map of MAPS.filter((map) => map.image)) {
  test(`${map.name}: checked-in collision matches every source PNG pixel, with no invisible extra solids`, () => {
    const file = new URL(`../public${map.image!.split("?")[0]}`, import.meta.url);
    const png = PNG.sync.read(readFileSync(file));
    assert.equal(png.width, map.width); assert.equal(png.height, map.height);
    const occupied = new Uint8Array(map.width * map.height);
    for (const p of map.platforms)
      for (let y = p.y; y < p.y + p.h; y++) for (let x = p.x; x < p.x + p.w; x++) occupied[y * map.width + x]++;
    let translucent = 0;
    for (let i = 0; i < occupied.length; i++) {
      const alpha = png.data[i * 4 + 3];
      if (alpha > 0 && alpha < 255) translucent++;
      if (occupied[i] !== Number(alpha === 255)) assert.fail(`Mismatch at pixel ${i % map.width}, ${Math.floor(i / map.width)}`);
    }
    assert.ok(translucent > 1000, "the PNG contains genuine pass-through scenery");
  });

  test(`${map.name}: compact multiplayer geometry restores an expanded arena and deterministic movement`, () => {
    const game = new GameEngine({ mapId: map.id, mode: "practice", mineCount: 0,
      players: Array.from({ length: map.spawnPlatformIds.length + 1 }, (_, i) => ({ id: `t${i}`, name: `${i}`, frogs: 1 })) });
    const snapshot = game.capture();
    const wire: ServerState = { ...snapshot.state, platforms: [], net: { epoch: "test", tick: 0, ack: 0,
      terrainImage: map.image, simulation: snapshot.simulation } };
    const state = stateWithoutNetwork(JSON.parse(JSON.stringify(wire)));
    assert.deepEqual(state.platforms, game.state.platforms);
    assert.ok(JSON.stringify(wire).length < JSON.stringify(snapshot).length / 3);
    const restored = new GameEngine();
    restored.restore({ state, simulation: wire.net!.simulation });
    walk(game); walk(restored);
    assert.deepEqual(restored.capture(), game.capture());
    wire.net!.terrainImage = "/maps/outdated.png";
    assert.throws(() => stateWithoutNetwork(wire), /different map image/);
  });
}

test("frogs walk through alpha 254 scenery but stop at a fully opaque wall", () => {
  const terrain = solids(800, 600, (x, y) => y >= 500 || (x >= 400 && x < 410 && y > 100) ? 255 : x > 180 && x < 300 ? 254 : 0);
  const game = fixture(terrain, 100, 482);
  walk(game, true, 180);
  assert.equal(game.state.players[0].x, 400 - PLAYER_RADIUS);
  assert.equal(game.state.players[0].y, 482);
});

test("frogs climb and descend pixel slopes without snagging or entering the ground", () => {
  const terrain = solids(800, 600, (x, y) => y >= 500 - Math.max(0, Math.min(65, Math.floor((x - 160) / 5))) ? 255 : 0);
  const game = fixture(terrain, 100, 482);
  walk(game, true, 170);
  const frog = game.state.players[0];
  assert.ok(frog.x > 400, `climbed the slope: x=${frog.x}`);
  assert.ok(frog.y < 440 && frog.grounded);
  walk(game, false, 170);
  assert.ok(frog.x < 170 && frog.y > 470 && frog.grounded);
  assert.ok(!bodyTerrain(terrain, frog.x, frog.y, 18).some((p) => frog.x + 18 > p.x && frog.x - 18 < p.x + p.w && frog.y + 18 > p.y && frog.y - 18 < p.y + p.h));
});

test("projectiles, falling mines and grapples ignore translucent pixels and hit the opaque image", () => {
  const terrain = solids(800, 600, (x, y) => y >= 500 || (x >= 400 && x < 410 && y > 100) ? 255 : x > 180 && x < 300 ? 254 : 0);
  const game = fixture(terrain, 100, 350);
  const frog = game.state.players[0];
  game.setInput(frog.id, { left: false, right: false, up: false, down: false, aimX: 700, aimY: 350 });
  assert.ok(game.command(frog.id, { type: "grapple" }));
  assert.equal(frog.rope?.x, 400);
  game.command(frog.id, { type: "release" });
  game.state.projectiles = [{ id: "test", ownerId: frog.id, x: 170, y: 300, vx: 450, vy: 0, kind: "rocket", life: 5, radius: 90, damage: 30 }];
  game.state.mines = [{ id: "mine", ownerId: frog.id, x: 240, y: 400, vx: 0, vy: 0, kind: "mine", placedTurn: 0, fuse: null, settled: false }];
  for (let i = 0; i < 40; i++) game.step(FIXED_STEP);
  assert.ok(game.state.projectiles[0]?.x > 300, "rocket passes through alpha 254");
  assert.ok(game.state.mines[0]?.y > 400, "mine falls through alpha 254");
  for (let i = 0; i < 30; i++) game.step(FIXED_STEP);
  assert.equal(game.state.projectiles.length, 0, "rocket hits opaque wall");
  assert.ok(game.state.explosions.some((e) => e.x >= 390 && e.x <= 405));
  assert.equal(game.state.mines[0]?.y, 492);
});

test("rope wraps a curved pixel silhouette without crossing any opaque pixels", () => {
  const platforms = solids(800, 600, (x, y) => Math.hypot(x - 300, y - 300) <= 100 ? 255 : 0);
  const rope: Rope = { x: 300, y: 200, length: 680, bends: [] };
  const end = { x: 450, y: 400 };
  assert.equal(updateRopePath(rope, end, platforms), true);
  assert.ok(rope.bends.length > 0);
  const path = [rope, ...rope.bends, end];
  for (let i = 1; i < path.length; i++) assert.equal(ropeSegmentBlocked(path[i - 1], path[i], platforms), false);
});

for (const direction of [-1, 1]) {
  test(`steep slopes slide ${direction < 0 ? "left" : "right"}, even against uphill walking input`, () => {
    const platforms = solids(800, 600, (x, y) => y >= Math.max(170, Math.min(550, 300 + direction * (x - 250) * 1.3)) ? 255 : 0);
    const x = 250;
    const footY = Math.min(...platforms.filter((p) => x + 18 > p.x && x - 18 < p.x + p.w).map((p) => p.y));
    const game = fixture(platforms, x, footY - 18);
    const frog = game.state.players[0];
    assert.ok(imageSurface(platforms, frog.x, footY)?.steep);
    walk(game, direction < 0, 70);
    assert.ok((frog.x - x) * direction > 25, `downhill displacement: ${frog.x - x}`);
    assert.ok(frog.y > footY + 10, "loses elevation while sliding");
    assert.equal(frog.grounded, false, "steep rock cannot be used as a safe standing or jump surface");
  });
}

test("sharp symmetric summits are unstable even though their averaged slope is zero", () => {
  const platforms = solids(800, 600, (x, y) => y >= Math.min(550, 150 + Math.abs(x - 400) * 2) ? 255 : 0);
  const game = fixture(platforms, 400, 132);
  const frog = game.state.players[0];
  assert.ok(imageSurface(platforms, 400, 150)?.sharp);
  game.step(FIXED_STEP);
  assert.equal(frog.grounded, false);
  for (let i = 0; i < 90; i++) game.step(FIXED_STEP);
  assert.ok(Math.abs(frog.x - 400) > 20 && frog.y > 170, "slides off the pointed peak without input");
});

test("real mountain faces slide and opposing slopes catch frogs in a stable valley", () => {
  const map = getMap("amber-arches");
  const game = new GameEngine({ mapId: map.id, mode: "practice", mineCount: 0,
    players: [{ id: "a", name: "A", frogs: 1 }, { id: "b", name: "B", frogs: 1 }] });
  const frog = game.state.players[0];
  const x = 860;
  const foot = Math.min(...map.platforms.filter((p) => x + 18 > p.x && x - 18 < p.x + p.w).map((p) => p.y));
  Object.assign(frog, { x, y: foot - 18, vx: 0, vy: 0, grounded: true });
  game.state.crates = [];
  for (let i = 0; i < 360; i++) game.step(FIXED_STEP);
  assert.ok(frog.x < x - 80 && frog.y > foot + 200, "slides down the actual PNG mountain");
  assert.ok(frog.grounded && Math.abs(frog.vx) < 1 && Math.abs(frog.vy) < 1,
    "rests in the notch rather than oscillating between opposing faces indefinitely");
});

test("team spawning works on rolling terrain without any 280px flat ledges", () => {
  const width = 1400, height = 700;
  const alpha = (x: number, y: number) => y >= 520 + Math.round(Math.sin(x / 180) * 42) ? 255 : 0;
  const rgba = pixels(width, height, alpha);
  const platforms = solids(width, height, alpha);
  const sites = imageSurfaceSites(width, height, rgba, platforms, 18);
  const groups = imageSpawnGroups(sites);
  assert.ok(groups.length >= 2);
  assert.ok(groups.every((g) => g.length === 6 && new Set(g.map((p) => p.y)).size > 1));
  assert.ok(groups.flat().every((p) => imageSurface(platforms, p.x, p.y + 18)?.steep === false));
});

test("a frog falls through leaf scenery and is caught by a real tree branch", () => {
  const map = getMap("mossback-grotto");
  const site = map.supplySites!.find((p) => p.x > 800 && p.x < 1150 && p.y > 700 && p.y < 1150)!;
  assert.ok(site, "tree has an accessible upper branch");
  const game = new GameEngine({ mapId: map.id, mode: "practice", mineCount: 0,
    players: [{ id: "a", name: "A", frogs: 1 }, { id: "b", name: "B", frogs: 1 }] });
  const frog = game.state.players[0];
  Object.assign(frog, { x: site.x, y: site.y - 80, vx: 0, vy: 0, grounded: false });
  game.state.mines = []; game.state.crates = [];
  for (let i = 0; i < 90; i++) game.step(FIXED_STEP);
  assert.equal(frog.y, site.y);
  assert.equal(frog.grounded, true);
  assert.ok(frog.y < 1200, "caught well above the forest floor");
});
