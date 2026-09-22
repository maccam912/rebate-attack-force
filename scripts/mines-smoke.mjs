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

async function rejectInvalidCounts(page, button, screen) {
  for (const value of ["", "-1", "1.5", "51"]) {
    await page.fill("#starting-mines", value);
    await page.click(button);
    assert.equal((await snapshot(page)).screen, screen, `Invalid mine count '${value}' cannot start a match`);
    assert.equal(await page.locator("#starting-mines").evaluate((input) => input.validity.valid), false);
  }
}

function assertStartingMines(state, count) {
  assert.equal(state.turn, 1);
  assert.equal(state.mines.length, count, "The selected mine count is placed before the first attack");
  for (const mine of state.mines) {
    assert.equal(mine.kind, "mine");
    assert.equal(mine.settled, true);
    assert.ok(mine.placedTurn < state.turn, "Starting mines are already armed");
    assert.equal(mine.fuse, null, "Starting positions do not trigger mines");
    assert.equal(mine.vx, 0);
    assert.equal(mine.vy, 0);
    assert.ok(state.platforms.some((platform) =>
      Math.abs(mine.y + 8 - platform.y) < 0.1 && mine.x >= platform.x && mine.x <= platform.x + platform.w),
    "Starting mines rest on terrain");
    assert.ok(state.players.every((player) => Math.hypot(player.x - mine.x, player.y - mine.y) >= 98),
      "Starting mines stay beyond their trigger radius plus the frog radius from every spawn");
  }
}

async function captureSetup(page, name) {
  await page.waitForFunction(() => !document.querySelector("#global-toast").classList.contains("visible"));
  await page.locator("#starting-mines").evaluate((input) => input.scrollIntoView({ block: "nearest" }));
  const layout = await page.evaluate(() => {
    const field = document.querySelector("#starting-mines").getBoundingClientRect();
    return { overflow: document.documentElement.scrollWidth > innerWidth, left: field.left, right: field.right, width: innerWidth };
  });
  assert.equal(layout.overflow, false, "Setup has no horizontal page overflow");
  assert.ok(layout.left >= 0 && layout.right <= layout.width, "Mine input fits inside the viewport");
  await page.screenshot({ path: `test-results/${name}.png`, fullPage: true });
}

try {
  await mkdir("test-results", { recursive: true });
  const local = await openPage();
  await local.click('[data-mode="local"]');
  assert.equal(await local.inputValue("#starting-mines"), "0");
  await local.click("#start-button");
  assertStartingMines(await snapshot(local), 0);
  await leaveLocal(local);
  await rejectInvalidCounts(local, "#start-button", "menu");
  await local.fill("#starting-mines", "10");
  await captureSetup(local, "mines-local-setup");
  await local.click("#start-button");
  assertStartingMines(await snapshot(local), 10);
  await local.click("#reset-button");
  assertStartingMines(await snapshot(local), 10);
  await leaveLocal(local);
  assert.equal(await local.inputValue("#starting-mines"), "10", "Returning to setup preserves the mine setting");
  await local.click("#start-button");
  assertStartingMines(await snapshot(local), 10);
  console.log("PASS: default zero, invalid count validation, armed terrain placement, spawn clearance, local restart and setup persistence");

  const mobile = await openPage(true);
  await mobile.click('[data-mode="local"]');
  await captureSetup(mobile, "mines-local-mobile");

  const host = await openPage();
  await host.click('[data-mode="online"]');
  await host.click("#start-button");
  await host.locator("#starting-mines").waitFor();
  assert.equal(await host.inputValue("#starting-mines"), "0");
  assert.equal(await host.locator("#starting-mines").isDisabled(), false);
  const roomId = (await snapshot(host)).roomId;
  assert.ok(roomId);
  await mobile.goto(`${base}/?room=${roomId}`);
  await mobile.click("#join-button");
  await mobile.locator("#starting-mines").waitFor();
  assert.equal(await mobile.locator("#starting-mines").isDisabled(), true, "Only the host configures mines");
  await host.locator("#launch-room:enabled").waitFor();
  await rejectInvalidCounts(host, "#launch-room", "lobby");
  await host.fill("#starting-mines", "10");
  await host.locator(".panel-title").click();
  await mobile.waitForFunction(() => document.querySelector("#starting-mines")?.value === "10");
  await captureSetup(host, "mines-online-setup");
  await captureSetup(mobile, "mines-online-mobile");
  // Start directly from the edited field: the change must arrive before start,
  // even without an explicit blur or waiting for the lobby to echo it back.
  // Hold the click while the echo arrives to catch a replaced Start button.
  await host.fill("#starting-mines", "12");
  await host.locator("#launch-room").click({ delay: 100 });
  await Promise.all([host, mobile].map((page) => page.waitForFunction(() =>
    JSON.parse(window.render_game_to_text()).screen === "playing")));
  const [hostState, guestState] = await Promise.all([snapshot(host), snapshot(mobile)]);
  assertStartingMines(hostState, 12);
  assertStartingMines(guestState, 12);
  assert.deepEqual(guestState.mines, hostState.mines, "Host and guest receive identical starting mines");
  assert.deepEqual(errors, [], "No browser runtime errors");
  console.log("PASS: host configuration and validation, disabled guest control, identical online mine placement, desktop/mobile setup layout");
} finally {
  await browser.close();
}
