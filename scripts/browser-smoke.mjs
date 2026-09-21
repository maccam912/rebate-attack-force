import { chromium } from "playwright";
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
const base = process.env.BASE_URL || "http://localhost:5173";
const systemChrome =
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const browser = await chromium.launch({
  headless: true,
  executablePath:
    process.env.CHROME_PATH ||
    (existsSync(systemChrome) ? systemChrome : undefined),
});
const errors = [];
async function page() {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1050 },
  });
  const p = await context.newPage();
  p.on("pageerror", (e) => errors.push(e.message));
  p.on("console", m => { if(m.type()==="error")errors.push(m.text()); });
  p.on("response", r => { if(r.url().startsWith(base) && r.status()>=400)errors.push(`${r.status()}: ${r.url()}`); });
  await p.goto(base);
  await p.evaluate(()=>document.fonts.ready);
  await p.waitForFunction(
    () => typeof window.render_game_to_text === "function",
  );
  return p;
}
const snapshot = (p) =>
  p.evaluate(() => JSON.parse(window.render_game_to_text()));
const wait = async (p, fn) => p.waitForFunction(fn);
await mkdir("test-results", { recursive: true });
try {
  const local = await page();
  await local.screenshot({ path: "test-results/01-menu.png", fullPage: true });
  await local.click("#start-button");
  let s = await snapshot(local);
  assert.equal(s.screen, "playing");
  const x = s.players[0].x;
  await local.keyboard.down("d");
  await local.waitForTimeout(650);
  await local.keyboard.up("d");
  s = await snapshot(local);
  assert.ok(s.players[0].x > x + 80, "Walk should move frog");
  assert.ok(s.players[0].hasCrate, "Walking into crate should arm frog");
  await local.keyboard.press("2");
  assert.equal((await snapshot(local)).tool, "weapon");
  const rect = await local.locator("#game").boundingBox();
  await local.mouse.move(
    rect.x + rect.width * 0.89,
    rect.y + rect.height * 0.74,
  );
  await local.mouse.down();
  await local.waitForTimeout(700);
  await local.mouse.up();
  await wait(
    local,
    () => JSON.parse(window.render_game_to_text()).phase === "retreat",
  );
  await local.screenshot({
    path: "test-results/02-gameplay.png",
    fullPage: true,
  });
  await local.click("#reset-button");
  s = await snapshot(local);
  assert.equal(s.turn, 1);
  // Connect a hook to the underside of the west shelf, reel in and swing.
  await local.mouse.move(
    rect.x + rect.width * (370 / 1440),
    rect.y + rect.height * (465 / 850),
  );
  await local.keyboard.press("Space");
  await wait(
    local,
    () => !!JSON.parse(window.render_game_to_text()).players[0].rope,
  );
  await local.keyboard.down("w");
  await local.keyboard.down("d");
  await local.waitForTimeout(500);
  await local.keyboard.up("w");
  await local.keyboard.up("d");
  s = await snapshot(local);
  assert.ok(s.players[0].y < 620, "Reeling should lift the frog");
  await local.screenshot({
    path: "test-results/03-grapple.png",
    fullPage: true,
  });
  await local.keyboard.press("Space");
  assert.equal((await snapshot(local)).players[0].rope, null);
  await local.click("#guide-button");
  assert.equal(await local.locator("#guide").isVisible(), true);
  await local.keyboard.press("Escape");
  assert.equal(await local.locator("#guide").isVisible(), false);
  // Local turns actually swap active players.
  await local.click("#leave-button");
  await local.click('[data-mode="local"]');
  await local.click("#start-button");
  await local.click("#end-turn");
  await wait(
    local,
    () => JSON.parse(window.render_game_to_text()).activePlayerId === "p2",
  );
  await local.click("#end-turn");
  await wait(
    local,
    () => JSON.parse(window.render_game_to_text()).activePlayerId === "p1",
  );
  await local.click("#game");
  await local.keyboard.down("d");
  await local.waitForTimeout(600);
  await local.keyboard.up("d");
  await wait(
    local,
    () =>
      JSON.parse(window.render_game_to_text()).players[0].hasCrate,
  );
  const savedWeapon = (await snapshot(local)).players[0].weapon;
  const saved = (await snapshot(local)).players[0].inventory[savedWeapon];
  await local.click("#end-turn");
  await wait(
    local,
    () => JSON.parse(window.render_game_to_text()).activePlayerId === "p2",
  );
  await local.click("#end-turn");
  await wait(
    local,
    () => JSON.parse(window.render_game_to_text()).activePlayerId === "p1",
  );
  assert.equal(
    (await snapshot(local)).players[0].inventory[savedWeapon],
    saved,
    "Unused ammo must survive hot-seat turns",
  );
  await local.click(`[data-weapon="${savedWeapon}"]`);
  assert.equal((await snapshot(local)).tool, "weapon");
  console.log(
    "PASS: saved ammunition carries across turns and can be selected from stash",
  );
  console.log(
    "PASS: local walk, crate pickup, charged shot, retreat, grappling/reeling/release, guide, hot-seat turns",
  );
  // Two actual browser clients create/join/start a private no-account room.
  const host = await page();
  await host.click('[data-mode="online"]');
  await host.fill("#player-name", "Host Frog");
  await host.click("#start-button");
  await wait(
    host,
    () => JSON.parse(window.render_game_to_text()).screen === "lobby",
  );
  const hostState = await snapshot(host);
  const guest = await page();
  await guest.goto(`${base}/?room=${hostState.roomId}`);
  await guest.fill("#player-name", "Guest Frog");
  await guest.click("#join-button");
  await wait(
    guest,
    () => JSON.parse(window.render_game_to_text()).screen === "lobby",
  );
  await host.locator("#launch-room:enabled").waitFor();
  await host.screenshot({ path: "test-results/04-lobby.png", fullPage: true });
  await host.click("#launch-room");
  await wait(
    host,
    () => JSON.parse(window.render_game_to_text()).screen === "playing",
  );
  await wait(
    guest,
    () => JSON.parse(window.render_game_to_text()).screen === "playing",
  );
  await host.click("#game");
  const before = await snapshot(host);
  await host.keyboard.down("d");
  await host.waitForTimeout(550);
  await host.keyboard.up("d");
  await guest.waitForTimeout(100);
  const after = await snapshot(guest);
  assert.ok(
    after.players[0].x > before.players[0].x + 60,
    "Guest must see authoritative host movement",
  );
  assert.ok(after.players[0].hasCrate, "Online pickup must sync");
  // Inactive guest cannot move active frog.
  const guestBefore = after.players[1].x;
  await guest.click("#game");
  await guest.keyboard.down("a");
  await guest.waitForTimeout(200);
  await guest.keyboard.up("a");
  assert.equal((await snapshot(host)).players[1].x, guestBefore);
  await host.click("#end-turn");
  await wait(guest, () => {
    const s = JSON.parse(window.render_game_to_text());
    return s.activePlayerId === s.sessionId;
  });
  await guest.screenshot({
    path: "test-results/05-online.png",
    fullPage: true,
  });
  await host.click("#leave-button");
  await wait(
    guest,
    () => JSON.parse(window.render_game_to_text()).phase === "finished",
  );
  console.log(
    "PASS: two-browser anonymous room, invite join, host start, synchronized movement/pickup, turn authority, turn handoff, disconnect winner",
  );
  const mobile = await browser.newPage({
    viewport: { width: 390, height: 844 },
  });
  await mobile.goto(base);
  await mobile.waitForFunction(
    () => typeof window.render_game_to_text === "function",
  );
  await mobile.screenshot({
    path: "test-results/06-mobile.png",
    fullPage: true,
  });
  assert.equal(
    await mobile.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
    "No mobile horizontal overflow",
  );
  assert.deepEqual(errors, [], "No browser runtime errors");
  console.log("PASS: responsive layout; no browser runtime errors");
} finally {
  await browser.close();
}
