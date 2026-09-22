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
const cursor = (p) => p.locator("#game").evaluate((canvas) => getComputedStyle(canvas).cursor);
async function aimAtWorld(page, x, y) {
  const { camera } = await snapshot(page);
  const rect = await page.locator("#game").boundingBox();
  await page.mouse.move(rect.x + (x - camera.x) * camera.zoom, rect.y + (y - camera.y) * camera.zoom);
}
async function leaveMatch(page) {
  await page.click("#menu-button");
  await page.click("#leave-button");
}
async function assertViewport(page) {
  const result = await page.evaluate(() => {
    const r = document.getElementById("game").getBoundingClientRect();
    const touch = document.getElementById("app").dataset.touch === "true";
    const deck = document.querySelector(".touch-controls").getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: r.height, vw: innerWidth, vh: innerHeight, scroll: document.documentElement.scrollHeight, touch, deckTop: deck.top };
  });
  assert.equal(result.x, 0);
  assert.equal(result.y, 0);
  assert.equal(result.width, result.vw);
  if (result.touch) {
    assert.ok(result.height > 0 && result.height < result.vh, "Phone canvas reserves room for thumb controls");
    assert.ok(result.height <= result.deckTop, "Controls do not cover the canvas");
  } else assert.equal(result.height, result.vh);
  assert.equal(result.scroll, result.vh, "No surrounding page to scroll");
}
const wait = async (p, fn) => p.waitForFunction(fn);
await mkdir("test-results", { recursive: true });
try {
  const local = await page();
  await local.screenshot({ path: "test-results/01-menu.png", fullPage: true });
  await local.click("#start-button");
  let s = await snapshot(local);
  assert.equal(s.screen, "playing");
  await assertViewport(local);
  assert.equal(await local.locator("#menu-overlay").isVisible(), false);
  await local.keyboard.press("b");
  assert.equal(await local.locator("#arsenal-panel").isVisible(), true);
  assert.equal(await local.locator("#inventory [data-weapon]").count(), 24);
  assert.equal(await local.locator(".arsenal-group").count(), 6);
  await local.screenshot({ path: "test-results/09-arsenal.png", fullPage: true });
  await local.click('[data-weapon="golf"]');
  assert.equal((await snapshot(local)).players[0].weapon, "golf");
  assert.equal((await snapshot(local)).tool, "weapon");
  assert.equal(await local.locator("#arsenal-panel").isVisible(), false);
  await local.click("#reset-button");
  await local.keyboard.press("Enter");
  await local.waitForTimeout(90);
  s = await snapshot(local);
  assert.ok(s.players[0].vy < 0, "Enter jumps immediately");
  assert.equal(s.turn, 1, "Enter does not end the turn");
  await local.keyboard.press("Enter");
  await local.waitForTimeout(80);
  s = await snapshot(local);
  assert.ok(s.players[0].vx < -200 && s.players[0].vy < -600, "Double Enter makes a higher backward jump");
  await local.click("#reset-button");
  s = await snapshot(local);
  const x = s.players[0].x;
  await local.keyboard.down("d");
  await local.waitForTimeout(650);
  await local.keyboard.up("d");
  s = await snapshot(local);
  assert.ok(s.players[0].x > x + 80, "Walk should move frog");
  assert.ok(s.players[0].hasCrate, "Walking into crate should arm frog");
  await local.keyboard.press("b");
  await local.click('[data-weapon="grenade"]');
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
  await local.waitForTimeout(100);
  await aimAtWorld(local, 420, 1410);
  await local.keyboard.press("Space");
  await wait(
    local,
    () => !!JSON.parse(window.render_game_to_text()).players[0].rope,
  );
  await local.keyboard.down("w");
  await local.keyboard.down("d");
  await local.waitForTimeout(1000);
  await local.keyboard.up("w");
  await local.keyboard.up("d");
  s = await snapshot(local);
  await local.screenshot({ path: "test-results/03-grapple.png", fullPage: true });
  assert.ok(s.players[0].y < 1550, `Reeling should lift the frog: ${JSON.stringify({ player: s.players[0], camera: s.camera, aim: s.aim })}`);
  await local.keyboard.press("Space");
  assert.equal((await snapshot(local)).players[0].rope, null);
  const cameraBeforeSwing = s.camera.y;
  assert.ok(cameraBeforeSwing < 1800 - s.camera.height - 5, "Camera tracks the rising frog");
  await local.mouse.move(700, 400);
  await local.waitForTimeout(120);
  s = await snapshot(local);
  assert.ok(Math.abs(s.aim.x - (s.camera.x + 700 / s.camera.zoom)) < .1);
  assert.ok(Math.abs(s.aim.y - (s.camera.y + 400 / s.camera.zoom)) < .1);
  await local.click("#guide-button");
  assert.equal(await local.locator("#guide").isVisible(), true);
  await local.keyboard.press("Escape");
  assert.equal(await local.locator("#guide").isVisible(), false);
  await local.click("#fullscreen-button");
  await wait(local, () => document.fullscreenElement?.id === "app");
  await assertViewport(local);
  assert.equal(await local.locator("#end-turn").isVisible(), true);
  await local.keyboard.press("f");
  await wait(local, () => !document.fullscreenElement);
  await local.keyboard.press("Escape");
  assert.equal(await local.locator("#menu-overlay").isVisible(), true);
  const pausedPlayer = (await snapshot(local)).players[0];
  await local.waitForTimeout(120);
  assert.deepEqual((await snapshot(local)).players[0], pausedPlayer, "Local menu pauses the simulation");
  await local.keyboard.press("Escape");
  assert.equal(await local.locator("#menu-overlay").isVisible(), false);
  // Local turns actually swap active players.
  await leaveMatch(local);
  await local.click('[data-mode="local"]');
  await local.click("#start-button");
  await wait(local, () => !!JSON.parse(window.render_game_to_text()).camera);
  const cameraBeforeTurn = (await snapshot(local)).camera.x;
  await local.click("#end-turn");
  await local.waitForFunction((previousX) => {
    const s = JSON.parse(window.render_game_to_text());
    return s.activePlayerId === "p2" && s.camera.targetId === "p2" && s.camera.x > previousX + 2000;
  }, cameraBeforeTurn);
  assert.ok((await snapshot(local)).camera.x > cameraBeforeTurn + 2000, "Camera follows the next player across the large world");
  await local.click("#end-turn");
  await wait(
    local,
    () => JSON.parse(window.render_game_to_text()).activePlayerId === "p1",
  );
  await local.locator("#game").focus();
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
  await local.click("#arsenal-button");
  await local.click(`[data-weapon="${savedWeapon}"]`);
  assert.equal((await snapshot(local)).tool, "weapon");
  console.log(
    "PASS: saved ammunition carries across turns and can be selected from stash",
  );
  console.log(
    "PASS: local walk, crate pickup, charged shot, retreat, grappling/reeling/release, guide, hot-seat turns",
  );
  await leaveMatch(local);
  await local.fill('[data-team="p1"] [data-setting="frogs"]', "3");
  await local.fill('[data-team="p1"] [data-setting="hp"]', "175");
  await local.fill('[data-team="p2"] [data-setting="frogs"]', "2");
  await local.fill('[data-team="p2"] [data-setting="hp"]', "250");
  await local.click("#start-button");
  s = await snapshot(local);
  assert.equal(s.players.length, 5);
  assert.ok(s.players.filter((p) => p.teamId === "p1").every((p) => p.hp === 175));
  assert.ok(s.players.filter((p) => p.teamId === "p2").every((p) => p.hp === 250));
  for (const id of ["p2", "p1:frog-2", "p2:frog-2", "p1:frog-3", "p2", "p1"]) {
    await local.click("#end-turn");
    await local.waitForFunction((id) => {
      const s = JSON.parse(window.render_game_to_text());
      return s.activePlayerId === id && s.camera.targetId === id;
    }, id);
  }
  console.log("PASS: Enter jump, double Enter backward jump, local team settings and frog rotation");
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
  await host.fill('[data-setting="frogs"] >> nth=0', "2");
  await host.locator(".panel-title").click();
  await guest.waitForFunction(() => document.querySelector('[data-setting="frogs"]').value === "2");
  await host.fill('[data-setting="hp"] >> nth=0', "175");
  await host.locator(".panel-title").click();
  await guest.waitForFunction(() => document.querySelector('[data-setting="hp"]').value === "175");
  await host.fill('[data-setting="frogs"] >> nth=1', "3");
  await host.locator(".panel-title").click();
  await guest.waitForFunction(() => document.querySelectorAll('[data-setting="frogs"]')[1].value === "3");
  await host.fill('[data-setting="hp"] >> nth=1', "250");
  await host.locator(".panel-title").click();
  await guest.waitForFunction(() => document.querySelectorAll('[data-setting="hp"]')[1].value === "250");
  assert.equal(await guest.locator('[data-setting="frogs"]').first().isDisabled(), true);
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
  await host.mouse.move(800, 450);
  const hostAim = (await snapshot(host)).aim;
  await guest.waitForFunction((aim) => {
    const state = JSON.parse(window.render_game_to_text());
    const active = state.players.find((player) => player.id === state.activePlayerId);
    return Math.abs(active.lookAt.x - aim.x) < 0.1 && Math.abs(active.lookAt.y - aim.y) < 0.1;
  }, hostAim);
  assert.equal(await cursor(host), "crosshair");
  assert.equal(await cursor(guest), "default", "Waiting players should not appear able to aim");
  await guest.mouse.move(400, 600);
  assert.deepEqual((await snapshot(guest)).players[0].lookAt, hostAim, "The guest's pointer cannot redirect the host's eyes");
  await host.locator("#game").focus();
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
  const guestBefore = after.players.find((p) => p.teamId === after.sessionId).x;
  await guest.locator("#game").focus();
  await guest.keyboard.down("a");
  await guest.waitForTimeout(200);
  await guest.keyboard.up("a");
  assert.equal((await snapshot(host)).players.find((p) => p.teamId === after.sessionId).x, guestBefore);
  await host.click("#end-turn");
  await wait(guest, () => {
    const s = JSON.parse(window.render_game_to_text());
    return s.activeTeamId === s.sessionId;
  });
  await host.waitForFunction(() => getComputedStyle(document.getElementById("game")).cursor === "default");
  await guest.waitForFunction(() => getComputedStyle(document.getElementById("game")).cursor === "crosshair");
  await guest.screenshot({
    path: "test-results/05-online.png",
    fullPage: true,
  });
  const originalHost = (await snapshot(host)).sessionId;
  const originalGuest = (await snapshot(guest)).sessionId;
  // Reload destroys the old SDK object, forcing a manual token-based rejoin.
  await host.reload();
  await host.waitForFunction((id) => {
    const s = JSON.parse(window.render_game_to_text());
    return s.screen === "playing" && s.sessionId === id;
  }, originalHost);
  assert.equal((await snapshot(host)).players.length, 5);
  await guest.click("#end-turn");
  await host.waitForFunction((id) => JSON.parse(window.render_game_to_text()).activePlayerId === `${id}:frog-2`, originalHost);
  await host.locator("#game").focus();
  await host.keyboard.press("Enter");
  await host.waitForFunction((id) => JSON.parse(window.render_game_to_text()).players.find((p) => p.id === `${id}:frog-2`).vy < -100, originalHost);
  // The room and its team stay alive while the tab is gone.
  const hostContext = host.context();
  const roomUrl = host.url();
  await host.close();
  await guest.waitForFunction((id) => {
    const s = JSON.parse(window.render_game_to_text());
    return s.activeTeamId === s.sessionId && s.teams.find((t) => t.id === id).connected === false;
  }, originalHost);
  assert.ok((await snapshot(guest)).players.filter((p) => p.teamId === originalHost).every((p) => p.alive));
  await guest.click("#end-turn");
  await guest.waitForFunction((id) => JSON.parse(window.render_game_to_text()).activePlayerId === `${id}:frog-3`, originalGuest);
  const returnedHost = await hostContext.newPage();
  returnedHost.on("pageerror", (e) => errors.push(e.message));
  await returnedHost.goto(roomUrl);
  await returnedHost.waitForFunction((id) => {
    const s = JSON.parse(window.render_game_to_text());
    return s.screen === "playing" && s.sessionId === id;
  }, originalHost);
  await guest.click("#end-turn");
  await returnedHost.waitForFunction((id) => JSON.parse(window.render_game_to_text()).activePlayerId === id, originalHost);
  assert.equal((await snapshot(returnedHost)).activePlayerId, originalHost);
  await returnedHost.screenshot({ path: "test-results/08-rejoined-team.png", fullPage: true });
  await leaveMatch(returnedHost);
  await wait(
    guest,
    () => JSON.parse(window.render_game_to_text()).phase === "finished",
  );
  console.log(
    "PASS: two-browser anonymous room, invite join, host start, synchronized gaze/movement/pickup, turn authority, aiming cursor handoff, host team settings, reload/closed-tab rejoin, offline turn skipping, explicit forfeit",
  );
  const mobile = await browser.newPage({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    deviceScaleFactor: 2,
  });
  await mobile.goto(base);
  await mobile.waitForFunction(
    () => typeof window.render_game_to_text === "function",
  );
  await mobile.screenshot({
    path: "test-results/06-mobile.png",
    fullPage: true,
  });
  await mobile.click("#start-button");
  await assertViewport(mobile);
  assert.equal(await mobile.locator(".touch-controls").isVisible(), true);
  await mobile.screenshot({ path: "test-results/07-mobile-game.png", fullPage: true });
  await mobile.click("#arsenal-button");
  assert.equal(await mobile.locator("#arsenal-panel").isVisible(), true);
  await mobile.screenshot({ path: "test-results/10-mobile-arsenal.png", fullPage: true });
  await mobile.locator('[data-weapon="mine"]').click();
  assert.equal((await snapshot(mobile)).players[0].weapon, "mine");
  await mobile.setViewportSize({ width: 844, height: 390 });
  await mobile.waitForTimeout(100);
  await assertViewport(mobile);
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
