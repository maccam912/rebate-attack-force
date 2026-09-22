import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";

// Uses Vite module imports to exercise the real renderer without production debug hooks.
const base = process.env.BASE_URL || "http://localhost:5173";
const chrome = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const browser = await chromium.launch({ headless: true,
  executablePath: process.env.CHROME_PATH || (existsSync(chrome) ? chrome : undefined) });
const errors = [];
await mkdir("test-results", { recursive: true });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(base);
  await page.click("#start-button");
  await page.keyboard.press("b");
  const count = await page.locator("[data-weapon]").count();
  assert.ok(count >= 48);
  await page.locator("#arsenal-search").fill("rope");
  assert.ok(await page.locator('[data-weapon="razorWire"]').isVisible());
  assert.ok(await page.locator('[data-weapon="ropeShears"]').isVisible());
  assert.equal(await page.locator('[data-weapon="rocket"]').count(), 0);
  await page.locator("#arsenal-search").fill("");
  await page.locator("#arsenal-category").selectOption("Gravity");
  assert.equal(await page.locator(".arsenal-group").count(), 1);
  assert.ok(await page.locator('[data-weapon="gravityWell"]').isVisible());
  await page.screenshot({ path: "test-results/effects-arsenal.png" });
  await page.locator("#arsenal-search").fill("no such weapon");
  assert.equal(await page.locator("[data-weapon]").count(), 0);
  assert.ok(await page.locator(".arsenal-empty").isVisible());
  await page.locator("#arsenal-search").fill("");
  await page.locator("#arsenal-category").selectOption("all");
  await page.click('[data-weapon="oilSlick"]');
  assert.equal(JSON.parse(await page.evaluate(() => window.render_game_to_text())).players[0].weapon, "oilSlick");

  const rendering = await page.evaluate(async () => {
    const { GameEngine } = await import("/shared/game.ts");
    const { WEAPONS } = await import("/shared/weapons.ts");
    const { renderGame } = await import("/src/renderer.ts");
    const { drawVisionEffects, STATUS_PRESENTATION } = await import("/src/effect-renderer.ts");
    const state = new GameEngine({ mode: "practice" }).state;
    const canvas = document.createElement("canvas");
    canvas.width = 1440; canvas.height = 1000;
    const c = canvas.getContext("2d");
    const options = { camera: { x: 0, y: 0, zoom: 1, width: 1440, height: 1000 },
      viewport: { width: 1440, height: 1000, dpr: 1 }, tool: "grapple", power: 0,
      time: 3, menu: false, visionEffects: true };
    const paint = (visionEffects, reducedMotion = false, time = 3) => {
      c.fillStyle = "#25362f"; c.fillRect(0, 0, 1440, 1000);
      for (let x = 0; x < 1440; x += 19) {
        c.fillStyle = x % 2 ? "#d7d59c" : "#72aa9f";
        c.fillRect(x, 0, 5, 1000);
      }
      drawVisionEffects(c, state, { ...options, visionEffects, reducedMotion, time });
      return canvas.toDataURL();
    };
    const baseline = paint(false);
    const checks = [];
    for (const kind of ["dazzled", "pixelated", "confused", "inverted"]) {
      state.players[0].statuses = [{ kind, remaining: 8, source: "chaosOrb" }];
      checks.push({ kind, spectatorClean: paint(false) === baseline,
        ownerAffected: paint(true) !== baseline, reducedMotionStable: paint(true, true, 1) === paint(true, true, 8) });
    }
    state.players[0].statuses = [];
    state.players[1].statuses = [{ kind: "pixelated", remaining: 8, source: "pixelBomb" }];
    const inactiveClean = paint(true) === baseline;
    state.phase = "damage";
    state.players[0].statuses = [{ kind: "dazzled", remaining: 8, source: "flashbang" }];
    const revealClean = paint(true) === baseline;
    state.phase = "playing";
    state.crates = []; state.platforms = []; state.players = []; state.hazards = [];
    const hazardWeapons = WEAPONS.filter((weapon) => weapon.hazard && weapon.id !== "chaosOrb");
    hazardWeapons.forEach((weapon, i) => {
      const x = 145 + i % 5 * 285, y = 250 + Math.floor(i / 5) * 330;
      state.platforms.push({ id: `showcase-${i}`, x: x - 124, y, w: 248, h: 30 });
      state.hazards.push({ id: `hazard-${i}`, kind: weapon.hazard.kind, x,
        y: ["gravity", "repulsor", "updraft"].includes(weapon.hazard.kind) ? y - 105 : y,
        radius: 104, remainingTurns: weapon.hazard.turns, createdTurn: 1,
        weapon: weapon.id, hitPlayerIds: [] });
    });
    const prototype = new GameEngine().state.players[0];
    Object.keys(STATUS_PRESENTATION).forEach((kind, i) => {
      state.players.push({ ...prototype, id: `status-${i}`, name: STATUS_PRESENTATION[kind].label,
        x: 120 + i % 6 * 240, y: 760 + Math.floor(i / 6) * 160,
        statuses: [{ kind, remaining: 8, source: "chaosOrb" }] });
    });
    state.activePlayerId = "showcase";
    renderGame(c, state, { ...options, visionEffects: false });
    // An isolated screenshot overlay keeps the actual game/HUD running underneath.
    canvas.id = "effects-showcase";
    canvas.style.cssText = "position:fixed;inset:0;z-index:9999;width:100vw;height:100vh;object-fit:contain;background:#173329";
    document.body.append(canvas);
    return { checks, inactiveClean, revealClean, hazards: hazardWeapons.length };
  });
  for (const result of rendering.checks) {
    assert.ok(result.spectatorClean, `${result.kind}: spectators retain a clean view`);
    assert.ok(result.ownerAffected, `${result.kind}: victim receives interference`);
    assert.ok(result.reducedMotionStable, `${result.kind}: reduced motion is static`);
  }
  assert.ok(rendering.inactiveClean);
  assert.ok(rendering.revealClean);
  assert.equal(rendering.hazards, 10);
  await page.screenshot({ path: "test-results/effects-showcase.png" });
  await page.locator("#effects-showcase").evaluate((canvas) => canvas.remove());
  await page.setViewportSize({ width: 390, height: 844 });
  await page.click("#arsenal-button");
  await page.locator("#arsenal-category").selectOption("Disruption");
  await page.screenshot({ path: "test-results/effects-mobile-arsenal.png" });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  assert.ok(await page.locator("#arsenal-search").isVisible());
  assert.deepEqual(errors, []);
  console.log(`PASS: ${count} weapon cards, effect search/categories, 10 hazard renders, all visual debuffs, spectator isolation, reduced motion, mobile layout`);
} finally {
  await browser.close();
}
