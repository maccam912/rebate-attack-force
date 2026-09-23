import { chromium } from "playwright";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";

const base = process.env.BASE_URL || "http://localhost:5173";
const systemChrome = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CHROME_PATH || (existsSync(systemChrome) ? systemChrome : undefined),
});
const errors = [];
const snapshot = (page) => page.evaluate(() => JSON.parse(window.render_game_to_text()));
async function openPage(hasTouch = false) {
  const page = await browser.newPage({
    viewport: hasTouch ? { width: 390, height: 844 } : { width: 1100, height: 900 },
    hasTouch,
  });
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(base);
  await page.waitForFunction(() => typeof window.render_game_to_text === "function");
  return page;
}
async function leaveLocal(page) {
  await page.click("#menu-button");
  await page.click("#leave-button");
}
async function botControlsLocked(page) {
  assert.equal(await page.locator("#end-turn").isDisabled(), true);
  assert.equal(await page.locator("#arsenal-button").isDisabled(), true);
  assert.equal(await page.locator("#game").evaluate((canvas) => getComputedStyle(canvas).cursor), "default");
  await page.keyboard.press("b");
  assert.equal(await page.locator("#arsenal-panel").isVisible(), false);
}

try {
  await mkdir("test-results", { recursive: true });
  const local = await openPage();
  await local.click('[data-mode="local"]');
  await local.selectOption('[data-local-control="p2"]', "bot");
  await local.fill('[data-team="p2"] [data-setting="hp"]', "175");
  await local.click("#start-button");
  let state = await snapshot(local);
  assert.equal(state.teams[1].bot, true);
  assert.ok(state.players.filter((frog) => frog.teamId === "p2").every((frog) => frog.maxHp === 175));
  assert.equal(state.players.length, 6);
  await local.click("#end-turn");
  await local.waitForFunction(() => {
    const state = JSON.parse(window.render_game_to_text());
    return state.activeTeamId === "p2" && !state.controls.enabled;
  });
  await botControlsLocked(local);
  await local.click("#menu-button");
  const paused = await snapshot(local);
  await local.evaluate(() => window.advanceTime(3000));
  const stillPaused = await snapshot(local);
  assert.equal(stillPaused.timeLeft, paused.timeLeft, "Local bots pause with the menu");
  assert.deepEqual(stillPaused.players, paused.players);
  await local.click("#resume-button");
  await local.evaluate(() => window.advanceTime(25000));
  state = await snapshot(local);
  assert.ok(state.turn >= 3 || state.phase === "finished", "Bot completes its turn autonomously");
  assert.equal(state.controls.charging, false);
  await local.click("#reset-button");
  state = await snapshot(local);
  assert.equal(state.turn, 1);
  assert.equal(state.teams[1].bot, true, "Restart keeps the bot roster");
  await leaveLocal(local);
  for (let i = 0; i < 4; i++) await local.click("#add-local-bot");
  assert.equal(await local.locator("[data-team]").count(), 6);
  await local.locator("[data-remove-local]").last().click();
  assert.equal(await local.locator("[data-team]").count(), 5);
  await local.screenshot({ path: "test-results/bots-local-setup.png" });
  await local.click("#start-button");
  state = await snapshot(local);
  assert.equal(state.teams.length, 5, "Local setup supports more than four teams");
  assert.equal(state.teams.filter((team) => team.bot).length, 4);
  await local.screenshot({ path: "test-results/bots-local.png" });
  console.log("PASS: local AI roster, custom HP, locked controls, paused bots, automatic turns, restart and five teams");

  const mobile = await openPage(true);
  await mobile.click('[data-mode="local"]');
  await mobile.selectOption('[data-local-control="p2"]', "bot");
  for (let i = 0; i < 3; i++) await mobile.click("#add-local-bot");
  await mobile.locator("#start-button").scrollIntoViewIfNeeded();
  assert.equal(await mobile.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await mobile.screenshot({ path: "test-results/bots-local-mobile.png" });

  const host = await openPage();
  await host.click('[data-mode="online"]');
  await host.click("#start-button");
  await host.locator("#add-bot").waitFor();
  assert.equal(await host.locator("#launch-room").isDisabled(), true);
  for (let count = 2; count <= 6; count++) {
    await host.click("#add-bot");
    await host.waitForFunction((count) => document.querySelectorAll(".lobby-team").length === count, count);
  }
  assert.equal(await host.locator("[data-remove-bot]").count(), 5);
  assert.match(await host.locator(".tiny-tag").innerText(), /^6(?:\/\d+)? TEAMS$/);
  await host.locator("[data-remove-bot]").last().click();
  await host.waitForFunction(() => document.querySelectorAll(".lobby-team").length === 5);
  assert.match(await host.locator(".tiny-tag").innerText(), /^5(?:\/\d+)? TEAMS$/);
  await host.screenshot({ path: "test-results/bots-lobby.png" });
  // A touch guest can view the larger roster but cannot manage its bots.
  const roomId = (await snapshot(host)).roomId;
  await mobile.goto(`${base}/?room=${roomId}`);
  await mobile.click("#join-button");
  await mobile.locator("#launch-room").waitFor();
  assert.equal(await mobile.locator("#add-bot").count(), 0);
  assert.equal(await mobile.locator("[data-remove-bot]").count(), 0);
  assert.equal(await mobile.locator('[data-setting="hp"]').first().isDisabled(), true);
  await mobile.locator("#launch-room").scrollIntoViewIfNeeded();
  assert.equal(await mobile.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await mobile.screenshot({ path: "test-results/bots-lobby-mobile.png" });
  await mobile.click("#leave-button");
  await host.waitForFunction(() => document.querySelectorAll(".lobby-team").length === 5);
  // Keep one bot so this checks a multiplayer match with only one browser player.
  for (let count = 4; count >= 2; count--) {
    await host.locator("[data-remove-bot]").last().click();
    await host.waitForFunction((count) => document.querySelectorAll(".lobby-team").length === count, count);
  }
  const botSettings = host.locator(".lobby-team").nth(1);
  await botSettings.locator('[data-setting="hp"]').fill("175");
  await host.locator(".panel-title").click();
  await host.click("#launch-room");
  await host.waitForFunction(() => JSON.parse(window.render_game_to_text()).screen === "playing");
  state = await snapshot(host);
  assert.equal(state.teams.filter((team) => team.bot).length, 1);
  const bot = state.teams.find((team) => team.bot);
  const initialBot = state.players.find((player) => player.teamId === bot.id);
  const initialAmmo = initialBot.inventory;
  assert.equal(bot.hp, 175);
  await host.click("#end-turn");
  await host.waitForFunction(() => {
    const state = JSON.parse(window.render_game_to_text());
    return state.teams.find((team) => team.id === state.activeTeamId)?.bot && !state.controls.enabled;
  });
  await botControlsLocked(host);
  await host.waitForFunction(() => {
    const state = JSON.parse(window.render_game_to_text());
    return state.turn >= 3 || state.phase === "finished";
  }, null, { timeout: 40000 });
  state = await snapshot(host);
  const usedAmmo = state.players.find((player) => player.teamId === bot.id).inventory;
  assert.ok(Object.values(initialAmmo).every((ammo) => ammo === 0), "Bots start with the same empty inventory");
  assert.ok(Object.values(usedAmmo).some((ammo) => ammo > 0) ||
    state.soundEvents.some((event) => event.kind === "shot" && event.playerId === initialBot.id),
    "The server bot collects a random weapon and either saves or uses its ammo");
  assert.ok(state.players.filter((frog) => frog.teamId === bot.id).every((frog) =>
    JSON.stringify(frog.inventory) === JSON.stringify(usedAmmo)), "Bot teammates share the stash");
  assert.deepEqual(errors, [], "No browser runtime errors");
  console.log("PASS: host adds/removes bots beyond four teams, configures bots and plays a solo online match with an autonomous bot");
} finally {
  await browser.close();
}
