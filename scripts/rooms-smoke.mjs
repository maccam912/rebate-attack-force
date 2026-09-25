import { chromium } from "playwright";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";

const base = process.env.BASE_URL || "http://localhost:5173";
const chrome = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CHROME_PATH || (existsSync(chrome) ? chrome : undefined),
});
const errors = [];
async function open(viewport = { width: 1280, height: 900 }) {
  const page = await browser.newPage({ viewport });
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(base);
  await page.click('[data-mode="online"]');
  return page;
}
const screen = (page, value) => page.waitForFunction(
  (expected) => JSON.parse(window.render_game_to_text()).screen === expected, value,
);
try {
  await mkdir("test-results", { recursive: true });
  const host = await open();
  const kid = await open({ width: 390, height: 844 });
  await kid.locator("#room-browser-status").filter({ hasText: "No games waiting" }).waitFor();
  await host.fill("#player-name", "Dad <&>");
  await host.click("#start-button");
  await screen(host, "lobby");
  const id = await host.evaluate(() => JSON.parse(window.render_game_to_text()).roomId);
  const entry = kid.locator(`[data-join-room="${id}"]`);
  await entry.waitFor();
  assert.match(await entry.innerText(), /Dad <&>’s game/);
  assert.match(await entry.innerText(), /1 team/);
  await kid.fill("#player-name", "Kid typing");
  await kid.fill("#room-code-input", "keep-this-code");
  await kid.locator("#player-name").focus();
  await kid.bringToFront();
  await kid.waitForResponse((response) => response.url().endsWith("/api/rooms"));
  assert.equal(await kid.locator("#player-name").inputValue(), "Kid typing");
  assert.equal(await kid.locator("#room-code-input").inputValue(), "keep-this-code");
  assert.equal(await kid.locator("#player-name").evaluate((input) => input === document.activeElement), true);
  assert.equal(await kid.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await entry.scrollIntoViewIfNeeded();
  await kid.screenshot({ path: "test-results/room-browser-mobile.png" });
  await entry.click();
  await screen(kid, "lobby");
  assert.equal(await kid.evaluate(() => JSON.parse(window.render_game_to_text()).roomId), id);
  assert.match(await host.locator(".roster").innerText(), /Kid typing/);

  const watcher = await open();
  await watcher.locator(`[data-join-room="${id}"]`).waitFor();
  await watcher.route("**/api/rooms", (route) => route.fulfill({ status: 503, body: "Unavailable" }));
  await watcher.click("#refresh-rooms");
  await watcher.locator("#room-browser-status").filter({ hasText: "Couldn’t load games" }).waitFor();
  assert.equal(await watcher.locator("[data-join-room]").count(), 0);
  await watcher.unroute("**/api/rooms");
  await watcher.click("#refresh-rooms");
  await watcher.locator(`[data-join-room="${id}"]`).waitFor();
  await host.click("#launch-room");
  await screen(kid, "playing");
  await watcher.bringToFront();
  await watcher.locator(`[data-join-room="${id}"]`).waitFor({ state: "detached" });
  await watcher.locator("#room-browser-status").filter({ hasText: "No games waiting" }).waitFor();
  await host.click("#menu-button");
  await host.click("#leave-button");
  await kid.click("#menu-button");
  await kid.click("#leave-button");
  assert.deepEqual(errors, []);
  console.log("PASS: automatic discovery, safe host names, mobile layout, preserved typing/focus, one-click join, refresh failure/recovery, started rooms disappear");
} finally {
  await browser.close();
}
