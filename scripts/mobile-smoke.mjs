import { chromium } from "playwright";
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";

const base = process.env.BASE_URL || "http://localhost:5173";
const systemChrome = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CHROME_PATH || (existsSync(systemChrome) ? systemChrome : undefined),
});
const errors = [];
const snapshot = (page) => page.evaluate(() => JSON.parse(window.render_game_to_text()));
const active = (state) => state.players.find((player) => player.id === state.activePlayerId);
const directionalInput = (state) => Object.fromEntries(["left", "right", "up", "down"].map((key) => [key, state.controls.input[key]]));
const idleInput = { left: false, right: false, up: false, down: false };

// CDP delivers browser-generated PointerEvents, capture, compatibility clicks, and
// cancellation. Keep all live contacts in each event to exercise real multi-touch.
class Fingers {
  constructor(session, page) {
    this.session = session;
    this.page = page;
    this.contacts = new Map();
    this.nextId = 1;
  }
  async send(type) {
    await this.session.send("Input.dispatchTouchEvent", { type, touchPoints: [...this.contacts.values()] });
  }
  async down(point) {
    const id = this.nextId++;
    this.contacts.set(id, { id, x: point.x, y: point.y, radiusX: 6, radiusY: 6, force: 1 });
    await this.send("touchStart");
    return id;
  }
  async move(id, point) {
    assert.ok(this.contacts.has(id), "Cannot move an absent finger");
    Object.assign(this.contacts.get(id), point);
    await this.send("touchMove");
  }
  async up(id) {
    this.contacts.delete(id);
    await this.send("touchEnd");
  }
  async cancel() {
    if (!this.contacts.size) return;
    this.contacts.clear();
    await this.send("touchCancel");
  }
  async tap(selector) {
    const id = await this.down(await center(this.page, selector));
    await this.up(id);
  }
  async pad(selector, dx, dy) {
    const rect = await this.page.locator(selector).boundingBox();
    assert.ok(rect, `${selector} must be visible`);
    const origin = { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
    const radius = Math.min(rect.width, rect.height) * 0.38;
    const length = Math.hypot(dx, dy) || 1;
    const id = await this.down(origin);
    await this.move(id, { x: origin.x + dx / length * radius, y: origin.y + dy / length * radius });
    return id;
  }
}

async function center(page, selector) {
  const locator = page.locator(selector);
  await locator.scrollIntoViewIfNeeded();
  const rect = await locator.boundingBox();
  assert.ok(rect, `${selector} must be visible`);
  return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
}
async function phone(viewport) {
  // Leave the desktop user agent unchanged: detection must use input capabilities.
  const context = await browser.newContext({ viewport, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  const page = await context.newPage();
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  page.on("response", (response) => { if (response.url().startsWith(base) && response.status() >= 400) errors.push(`${response.status()}: ${response.url()}`); });
  await page.goto(base);
  await page.waitForFunction(() => typeof window.render_game_to_text === "function");
  await page.evaluate(() => document.fonts.ready);
  const fingers = new Fingers(await context.newCDPSession(page), page);
  assert.equal(await page.locator("#app").getAttribute("data-touch"), "true", "Touch capability enables phone controls without a mobile user agent");
  await fingers.tap("#start-button");
  await page.waitForFunction(() => JSON.parse(window.render_game_to_text()).screen === "playing");
  await page.waitForTimeout(120);
  return { context, page, fingers };
}
async function assertLayout(page, name) {
  const layout = await page.evaluate(() => {
    const canvas = document.getElementById("game").getBoundingClientRect();
    const deck = document.getElementById("touch-controls").getBoundingClientRect();
    return {
      width: innerWidth, height: innerHeight,
      scrollWidth: document.documentElement.scrollWidth,
      scrollHeight: document.documentElement.scrollHeight,
      canvas: { x: canvas.x, y: canvas.y, width: canvas.width, height: canvas.height, bottom: canvas.bottom },
      deck: { top: deck.top, bottom: deck.bottom },
      targets: ["touch-move", "touch-aim", "touch-jump", "touch-hook", "touch-fire", "arsenal-button", "end-turn", "menu-button"].map((id) => {
        const button = document.getElementById(id);
        const rect = button.getBoundingClientRect();
        const topElement = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
        return { id, width: rect.width, height: rect.height, left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, reachable: button === topElement || button.contains(topElement) };
      }),
    };
  });
  assert.equal(layout.scrollWidth, layout.width, `${name}: no horizontal overflow`);
  assert.equal(layout.scrollHeight, layout.height, `${name}: no surrounding page scrolling`);
  assert.equal(layout.canvas.x, 0);
  assert.equal(layout.canvas.y, 0);
  assert.equal(layout.canvas.width, layout.width);
  assert.ok(layout.canvas.height > 120 && layout.canvas.height < layout.height, `${name}: arena leaves space for touch controls`);
  assert.ok(layout.canvas.bottom <= layout.deck.top + 1, `${name}: control deck does not cover the arena`);
  for (const target of layout.targets) {
    assert.ok(target.width >= 44 && target.height >= 44, `${name}: ${target.id} is at least 44×44: ${JSON.stringify(target)}`);
    assert.ok(target.left >= -1 && target.top >= -1 && target.right <= layout.width + 1 && target.bottom <= layout.height + 1, `${name}: ${target.id} stays within the screen`);
    assert.ok(target.reachable, `${name}: ${target.id} is not covered by another element`);
  }
}
async function restart(page, fingers) {
  await fingers.cancel();
  await fingers.tap("#reset-button");
  await page.waitForFunction(() => JSON.parse(window.render_game_to_text()).turn === 1);
  await page.waitForTimeout(100);
}
async function waitIdle(page, message) {
  await page.waitForFunction(() => {
    const input = JSON.parse(window.render_game_to_text()).controls.input;
    return !input.left && !input.right && !input.up && !input.down;
  });
  assert.deepEqual(directionalInput(await snapshot(page)), idleInput, message);
}

await mkdir("test-results", { recursive: true });
try {
  const { page, fingers } = await phone({ width: 390, height: 844 });
  await assertLayout(page, "portrait");
  await page.screenshot({ path: "test-results/mobile-portrait.png", fullPage: true });

  let state = await snapshot(page);
  const startX = active(state).x;
  const move = await fingers.pad("#touch-move", 1, 0);
  const aim = await fingers.pad("#touch-aim", 1, -1);
  await page.waitForTimeout(420);
  state = await snapshot(page);
  assert.ok(active(state).x > startX + 35, "A held movement pad moves the frog while a second finger aims");
  assert.equal(state.controls.input.right, true);
  let aimVector = { x: state.aim.x - active(state).x, y: state.aim.y - active(state).y };
  assert.ok(aimVector.x > 250 && aimVector.y < -250 && Math.abs(aimVector.x + aimVector.y) < 5, "The aim pad sets a diagonal direction from the moving frog");
  await fingers.up(aim);
  await page.waitForTimeout(180);
  state = await snapshot(page);
  assert.ok(Math.abs((state.aim.x - active(state).x) - aimVector.x) < 5 && Math.abs((state.aim.y - active(state).y) - aimVector.y) < 5, "The aim stays relative to the frog after lifting the aim thumb");
  await fingers.up(move);
  await waitIdle(page, "Lifting the movement thumb clears its input");

  await restart(page, fingers);
  const jump = await fingers.down(await center(page, "#touch-jump"));
  await page.waitForTimeout(50);
  assert.ok(active(await snapshot(page)).vy < 0, "Jump acts on touch down, before the finger is lifted");
  await fingers.up(jump);
  await fingers.tap("#touch-jump");
  await page.waitForTimeout(50);
  state = await snapshot(page);
  assert.ok(active(state).vx < -200 && active(state).vy < -600, "A quick second Jump touch makes a higher backward jump");

  await restart(page, fingers);
  state = await snapshot(page);
  const frog = active(state);
  const hookAim = await fingers.pad("#touch-aim", 420 - frog.x, 1410 - frog.y);
  await fingers.tap("#touch-hook");
  await page.waitForFunction(() => {
    const state = JSON.parse(window.render_game_to_text());
    return !!state.players.find((player) => player.id === state.activePlayerId).rope;
  });
  await fingers.up(hookAim);
  const ropeLength = active(await snapshot(page)).rope.length;
  const reel = await fingers.pad("#touch-move", 1, -1);
  await page.waitForTimeout(900);
  state = await snapshot(page);
  assert.ok(active(state).rope.length < ropeLength - 30, "Dragging the movement pad up reels in the rope");
  assert.ok(active(state).y < 1550, "Reeling and pumping lift the frog");
  await fingers.up(reel);
  await fingers.tap("#touch-hook");
  assert.equal(active(await snapshot(page)).rope, null, "Hook releases an attached rope");

  await restart(page, fingers);
  const original = await snapshot(page);
  const gameRect = await page.locator("#game").boundingBox();
  const worldTouch = { x: gameRect.width * 0.65, y: gameRect.height * 0.55 };
  const canvasFinger = await fingers.down(worldTouch);
  await page.waitForTimeout(100);
  await fingers.up(canvasFinger);
  state = await snapshot(page);
  assert.equal(state.phase, "playing", "Touching the arena only aims");
  assert.equal(active(state).rope, null, "Touching the arena does not attach a grapple");
  assert.deepEqual(active(state).inventory, active(original).inventory, "Touch aiming does not consume ammunition");
  assert.ok(Math.abs(state.aim.x - (state.camera.x + worldTouch.x / state.camera.zoom)) < 2, "Arena touch maps into world aim coordinates");

  const cancelFire = await fingers.down(await center(page, "#touch-fire"));
  await page.waitForTimeout(180);
  assert.equal((await snapshot(page)).controls.charging, true, "Holding Fire starts charging and selects a weapon");
  assert.ok(fingers.contacts.has(cancelFire));
  await fingers.cancel();
  await page.waitForTimeout(100);
  state = await snapshot(page);
  assert.equal(state.controls.charging, false, "Browser touch cancellation stops charging");
  assert.equal(state.phase, "playing", "An interrupted charge never fires");
  assert.deepEqual(active(state).inventory, active(original).inventory, "Canceled charging preserves ammunition");

  const beforeShot = await snapshot(page);
  const fire = await fingers.down(await center(page, "#touch-fire"));
  await page.waitForTimeout(450);
  assert.equal((await snapshot(page)).controls.charging, true);
  await fingers.up(fire);
  await page.waitForFunction(() => JSON.parse(window.render_game_to_text()).phase === "retreat");
  state = await snapshot(page);
  const weapon = active(state).weapon;
  assert.equal(active(state).inventory[weapon], active(beforeShot).inventory[weapon] - 1, "Releasing Fire consumes one shot and starts retreat");
  assert.equal(state.controls.charging, false);

  await restart(page, fingers);
  const menuMove = await fingers.pad("#touch-move", 1, 0);
  await page.waitForTimeout(60);
  await fingers.tap("#menu-button");
  await page.locator("#resume-button").waitFor({ state: "visible" });
  await waitIdle(page, "Opening the menu clears a held movement thumb");
  await fingers.up(menuMove);
  await fingers.tap("#resume-button");
  await waitIdle(page, "Resuming does not restore a stale touch");

  const arsenalMove = await fingers.pad("#touch-move", 1, 0);
  await page.waitForTimeout(60);
  await fingers.tap("#arsenal-button");
  await page.locator("#arsenal-panel").waitFor({ state: "visible" });
  await waitIdle(page, "Opening the arsenal clears a held movement thumb");
  await fingers.up(arsenalMove);
  await page.screenshot({ path: "test-results/mobile-arsenal.png", fullPage: true });
  await fingers.tap('[data-weapon="mine"]');
  assert.equal(active(await snapshot(page)).weapon, "mine", "The mobile arsenal selects a stocked weapon");
  await page.locator("#arsenal-panel").waitFor({ state: "hidden" });

  const turnMove = await fingers.pad("#touch-move", 1, 0);
  await page.waitForTimeout(60);
  const turn = (await snapshot(page)).turn;
  await fingers.tap("#end-turn");
  await page.waitForFunction((oldTurn) => JSON.parse(window.render_game_to_text()).turn > oldTurn, turn);
  await waitIdle(page, "A turn transition clears a held movement thumb");
  await fingers.up(turnMove);

  await page.setViewportSize({ width: 844, height: 390 });
  await page.waitForTimeout(150);
  await assertLayout(page, "landscape after rotation");
  await page.screenshot({ path: "test-results/mobile-landscape.png", fullPage: true });
  const landscapeStart = active(await snapshot(page)).x;
  const landscapeMove = await fingers.pad("#touch-move", 1, 0);
  await page.waitForTimeout(250);
  await fingers.up(landscapeMove);
  assert.ok(active(await snapshot(page)).x > landscapeStart + 10, "Controls remain usable after orientation changes");

  const small = await phone({ width: 320, height: 568 });
  await assertLayout(small.page, "small portrait");
  await small.page.screenshot({ path: "test-results/mobile-small-portrait.png", fullPage: true });
  await small.fingers.tap("#arsenal-button");
  await small.page.locator("#arsenal-panel").waitFor({ state: "visible" });
  await small.fingers.tap('[data-weapon="boomerang"]');
  assert.equal(active(await snapshot(small.page)).weapon, "boomerang", "The last arsenal entry stays reachable on a small phone");
  await small.page.setViewportSize({ width: 568, height: 320 });
  await small.page.waitForTimeout(150);
  await assertLayout(small.page, "small landscape");
  await small.page.screenshot({ path: "test-results/mobile-small-landscape.png", fullPage: true });

  assert.deepEqual(errors, [], "No mobile browser runtime errors");
  console.log("PASS: portrait, small-phone and landscape layouts; reachable 44px targets; simultaneous touch movement/aim; immediate jump/backflip; grapple/reel/release; arena aiming; charged fire and cancellation; menu/arsenal/turn input cleanup; orientation changes");
} finally {
  await browser.close();
}
