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
const ids = ["scrapyard", "pocket-yard", "crystal-cave", "razor-reef", "wild-canopy", "amber-arches", "mooncap-garden", "mossback-grotto"];
const snapshot = (page) => page.evaluate(() => JSON.parse(window.render_game_to_text()));

async function openPage(hasTouch = false) {
  const page = await browser.newPage({
    viewport: hasTouch ? { width: 390, height: 844 } : { width: 1440, height: 1050 },
    hasTouch,
  });
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  await page.goto(base);
  await page.waitForFunction(() => typeof window.render_game_to_text === "function");
  await page.evaluate(() => document.fonts.ready);
  return page;
}

async function chooseMap(page, mapId) {
  await page.selectOption("#map-select", mapId);
  await page.waitForFunction((id) => document.querySelector(".map-picker")?.dataset.mapId === id, mapId);
  await page.waitForFunction(() => {
    const preview = document.querySelector(".map-preview-canvas");
    return preview.width > 0 && preview.height > 0 && preview.getContext("2d").getImageData(0, 0, 1, 1).data[3] > 0;
  });
}

async function assertPickerFits(page) {
  await page.locator("[data-expand-map]").scrollIntoViewIfNeeded();
  const bounds = await page.evaluate(() => {
    const select = document.querySelector("#map-select").getBoundingClientRect();
    const preview = document.querySelector(".map-preview-canvas").getBoundingClientRect();
    return {
      overflow: document.documentElement.scrollWidth > innerWidth,
      width: innerWidth,
      select: { left: select.left, right: select.right },
      preview: { left: preview.left, right: preview.right, width: preview.width, height: preview.height },
    };
  });
  assert.equal(bounds.overflow, false, "Map setup has no horizontal page overflow");
  for (const element of [bounds.select, bounds.preview])
    assert.ok(element.left >= 0 && element.right <= bounds.width + 1, "Map controls fit within the viewport");
  assert.ok(bounds.preview.width > 100 && bounds.preview.height > 40, "Map preview is visible");
}

async function expandPreview(page, name) {
  const label = await page.locator("#map-select option:checked").textContent();
  await page.click("[data-expand-map]");
  await page.locator("dialog[open]").waitFor();
  assert.equal(await page.locator("#map-dialog-title").textContent(), label);
  assert.equal(await page.locator("dialog[open] .map-full-canvas").isVisible(), true);
  const fits = await page.locator("dialog[open]").evaluate((dialog) => {
    const rect = dialog.getBoundingClientRect();
    return rect.left >= -1 && rect.top >= -1 && rect.right <= innerWidth + 1 && rect.bottom <= innerHeight + 1;
  });
  assert.ok(fits, "Full map dialog fits within the viewport");
  await page.screenshot({ path: `test-results/map-${name}.png`, fullPage: true });
  await page.locator("dialog[open] [data-close-map]").first().click();
  assert.equal(await page.locator("dialog[open]").count(), 0);
  assert.equal(await page.locator("[data-expand-map]").evaluate((button) => document.activeElement === button), true,
    "Closing the preview returns keyboard focus to its opener");
}

function mapShape(state) {
  return { mapId: state.mapId, width: state.width, height: state.height, hasWater: state.hasWater, waterY: state.waterY };
}

async function leaveMatch(page) {
  await page.click("#menu-button");
  await page.click("#leave-button");
  await page.locator("#map-select").waitFor();
}

try {
  await mkdir("test-results", { recursive: true });
  const local = await openPage();
  assert.deepEqual(await local.locator("#map-select option").evaluateAll((options) => options.map((option) => option.value)), ids);
  const previews = new Set();
  const layouts = new Map();
  for (const id of ids) {
    await chooseMap(local, id);
    await assertPickerFits(local);
    await local.screenshot({ path: `test-results/map-${id}-setup.png`, fullPage: true });
    previews.add(await local.locator(".map-preview-canvas").evaluate((canvas) => canvas.toDataURL()));
    await expandPreview(local, `${id}-full`);
    await local.click("#start-button");
    await local.waitForFunction((id) => {
      const state = JSON.parse(window.render_game_to_text());
      return state.screen === "playing" && state.mapId === id;
    }, id);
    const first = await snapshot(local);
    assert.ok(first.players.every((frog) => frog.alive), "Each map has safe starting positions");
    assert.ok(first.platforms.length > 0, "Each map has playable terrain");
    assert.equal(first.hasWater, !["pocket-yard", "crystal-cave", "mossback-grotto"].includes(id));
    if (!first.hasWater) assert.ok(first.waterY > first.height, "Dry maps have no water inside the arena");
    else assert.ok(first.waterY < first.height, "Wet maps have water inside the arena");
    layouts.set(id, mapShape(first));
    await local.screenshot({ path: `test-results/map-${id}-game.png`, fullPage: true });
    await local.click("#reset-button");
    assert.deepEqual(mapShape(await snapshot(local)), mapShape(first), "Restart preserves map dimensions and hazards");
    await leaveMatch(local);
    assert.equal(await local.inputValue("#map-select"), id, "Returning to setup preserves the selected map");
  }
  assert.equal(previews.size, ids.length, "Every authored map has a distinct preview");
  assert.ok(layouts.get("pocket-yard").width < layouts.get("scrapyard").width, "The compact map is smaller than the original");
  assert.ok(layouts.get("wild-canopy").width > layouts.get("scrapyard").width, "The large map is bigger than the original");
  await local.click('[data-map-step="1"]');
  assert.equal(await local.inputValue("#map-select"), ids[0], "Next map wraps around the catalog");
  await local.click('[data-map-step="-1"]');
  assert.equal(await local.inputValue("#map-select"), ids.at(-1), "Previous map wraps around the catalog");
  console.log("PASS: eight distinct previews, full map dialogs, authored terrain, wet/dry layouts, practice startup, restart and setup persistence");

  const mobile = await openPage(true);
  await chooseMap(mobile, "wild-canopy");
  await assertPickerFits(mobile);
  await expandPreview(mobile, "mobile-portrait");
  await mobile.setViewportSize({ width: 844, height: 390 });
  await assertPickerFits(mobile);
  await expandPreview(mobile, "mobile-landscape");

  const host = await openPage();
  await host.click('[data-mode="online"]');
  await chooseMap(host, "crystal-cave");
  await host.click("#start-button");
  await host.waitForFunction(() => JSON.parse(window.render_game_to_text()).screen === "lobby");
  assert.equal(await host.inputValue("#map-select"), "crystal-cave", "Creating an online room keeps the selected map");
  const roomId = (await snapshot(host)).roomId;
  await mobile.goto(`${base}/?room=${roomId}`);
  await mobile.click("#join-button");
  await mobile.waitForFunction(() => JSON.parse(window.render_game_to_text()).screen === "lobby");
  assert.equal(await mobile.inputValue("#map-select"), "crystal-cave");
  assert.equal(await mobile.locator("#map-select").isDisabled(), true, "Guests can inspect previews but cannot change the map");
  assert.equal(await mobile.locator('[data-map-step="1"]').isDisabled(), true);
  await mobile.click("[data-expand-map]");
  await host.evaluate(() => {
    const select = document.querySelector("#map-select");
    for (const id of ["wild-canopy", "pocket-yard", "razor-reef"]) {
      select.value = id;
      select.dispatchEvent(new Event("change", { bubbles: true }));
    }
  });
  await mobile.waitForFunction(() => document.querySelector("#map-dialog-title")?.textContent === "Razor Reef");
  assert.equal(await mobile.locator(".map-dialog").evaluate((dialog) => dialog.open), true, "A host map change updates the guest's open preview without closing it");
  await mobile.locator("[data-close-map]").first().click();
  await chooseMap(host, "razor-reef");
  await mobile.waitForFunction(() => document.querySelector("#map-select")?.value === "razor-reef");
  await expandPreview(mobile, "online-guest");
  // A rejected final browse must reconcile the optimistic preview with the
  // actual room choice before the host starts the match.
  await host.evaluate(() => {
    const select = document.querySelector("#map-select");
    for (let index = 0; index < 31; index++) {
      select.value = index === 30 ? "wild-canopy" : index % 2 ? "crystal-cave" : "pocket-yard";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    }
  });
  await host.waitForFunction(() => document.querySelector("#global-toast")?.textContent.includes("too quickly"));
  const acceptedMapId = await host.inputValue("#map-select");
  assert.notEqual(acceptedMapId, "wild-canopy", "The rejected final map is removed from the host preview");
  await mobile.waitForFunction((id) => document.querySelector("#map-select")?.value === id, acceptedMapId);
  assert.equal(await mobile.inputValue("#map-select"), acceptedMapId, "Host and guest previews agree after throttling");
  await host.waitForTimeout(1200);
  await chooseMap(host, "mossback-grotto");
  await mobile.waitForFunction(() => document.querySelector("#map-select")?.value === "mossback-grotto");
  await host.locator("#launch-room:enabled").click();
  await Promise.all([host, mobile].map((page) => page.waitForFunction(() => JSON.parse(window.render_game_to_text()).screen === "playing")));
  assert.deepEqual(mapShape(await snapshot(host)), layouts.get("mossback-grotto"));
  assert.deepEqual(mapShape(await snapshot(mobile)), layouts.get("mossback-grotto"));
  assert.ok((await snapshot(mobile)).platforms.length > 100, "Guest reconstructs the PNG collision geometry");
  await host.click("#menu-button");
  await host.click("#leave-button");
  await mobile.click("#menu-button");
  await mobile.click("#leave-button");
  assert.deepEqual(errors, [], "No browser runtime errors");
  console.log("PASS: host-selected online map, synchronized guest preview, throttled choices reconcile before starting, authoritative match map, desktop and mobile dialog bounds");
} finally {
  await browser.close();
}
