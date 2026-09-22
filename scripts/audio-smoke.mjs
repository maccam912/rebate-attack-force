import { chromium } from "playwright";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";

const base = process.env.BASE_URL || "http://localhost:5173";
const systemChrome = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CHROME_PATH || (existsSync(systemChrome) ? systemChrome : undefined),
});
const errors = [];

async function createPage(options = {}) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, ...options });
  await context.addInitScript(() => {
    const NativeAudioContext = window.AudioContext || window.webkitAudioContext;
    const connect = AudioNode.prototype.connect;
    const probes = window.__audioProbes = [];
    // Tap the actual output graph without replacing its audible destination.
    // AnalyserNode keeps processing with its own output disconnected.
    AudioNode.prototype.connect = function (destination, ...args) {
      const result = connect.call(this, destination, ...args);
      const probe = probes.find((entry) => entry.context === this.context);
      if (probe && destination === this.context.destination) connect.call(this, probe.analyser);
      return result;
    };
    window.AudioContext = class extends NativeAudioContext {
      constructor(...args) {
        super(...args);
        const analyser = this.createAnalyser();
        analyser.fftSize = 1024;
        const probe = { context: this, analyser, resumeAttempts: 0, rejectResumes: 0 };
        const resume = this.resume.bind(this);
        this.resume = () => {
          probe.resumeAttempts++;
          if (probe.rejectResumes > 0) {
            probe.rejectResumes--;
            return Promise.reject(new DOMException("Simulated autoplay refusal", "NotAllowedError"));
          }
          return resume();
        };
        probes.push(probe);
      }
    };
    window.__sampleAudio = async (probe, milliseconds = 130) => {
      const buffer = new Float32Array(probe.analyser.fftSize);
      let peak = 0;
      const until = performance.now() + milliseconds;
      do {
        probe.analyser.getFloatTimeDomainData(buffer);
        for (const value of buffer) {
          if (!Number.isFinite(value)) throw new Error("The audio graph generated a non-finite sample");
          peak = Math.max(peak, Math.abs(value));
        }
        await new Promise((resolve) => setTimeout(resolve, 8));
      } while (performance.now() < until);
      return peak;
    };
  });
  const page = await context.newPage();
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  page.on("response", (response) => {
    if (response.url().startsWith(base) && response.status() >= 400) errors.push(`${response.status()}: ${response.url()}`);
  });
  await page.goto(base);
  await page.waitForFunction(() => typeof window.render_game_to_text === "function");
  return page;
}

const snapshot = (page) => page.evaluate(() => JSON.parse(window.render_game_to_text()));
const diagnostics = (page) => page.evaluate(() => ({ ...window.__audioSmoke.audio.diagnostics }));
const tick = (page, milliseconds = 80) => page.waitForTimeout(milliseconds);
const requireSignal = (peak, label) => assert.ok(peak > 0.00001, `${label} must produce audible samples, received peak ${peak}`);

try {
  const page = await createPage();
  assert.equal((await snapshot(page)).sound.enabled, true, "Sound starts enabled for a new player");
  await page.click("#start-button");
  await page.waitForFunction(() => JSON.parse(window.render_game_to_text()).sound.unlocked);
  assert.equal((await snapshot(page)).screen, "playing");
  await page.locator("#game").focus();
  await page.keyboard.press("Enter");
  const jumpPeak = await page.evaluate(() => window.__sampleAudio(window.__audioProbes[0]));
  requireSignal(jumpPeak, "The real game's jump");
  await page.click("#sound-button");
  assert.equal((await snapshot(page)).sound.enabled, false);
  assert.equal(await page.locator("#sound-button").getAttribute("aria-pressed"), "false");
  await page.reload();
  await page.waitForFunction(() => typeof window.render_game_to_text === "function");
  assert.equal((await snapshot(page)).sound.enabled, false, "Mute survives reload");
  assert.equal(await page.locator("#sound-button").getAttribute("aria-pressed"), "false");
  await page.click("#start-button");
  await page.click("#sound-button");
  await page.waitForFunction(() => {
    const { sound } = JSON.parse(window.render_game_to_text());
    return sound.enabled && sound.unlocked;
  });
  assert.equal(await page.locator("#sound-button").getAttribute("aria-pressed"), "true");
  await page.click("#sound-button");
  assert.equal((await snapshot(page)).sound.enabled, false, "The controlled mixer runs with game audio muted");

  await page.evaluate(async () => {
    const { GameAudio } = await import("/src/audio.ts");
    const { WEAPONS } = await import("/shared/weapons.ts");
    const audio = new GameAudio();
    audio.setEnabled(true);
    await audio.unlock();
    window.__audioSmoke = { audio, probe: window.__audioProbes.at(-1), weapons: WEAPONS.map((weapon) => weapon.id) };
  });
  await page.waitForFunction(() => window.__audioSmoke.probe.context.state === "running");
  const cues = [
    "ui", "step", "jump", "backflip", "grapple", "release", "reel", "land", "bounce", "hurt",
    "death", "splash", "respawn", "shot", "explosion", "pickup", "switch", "select", "mineArm",
    "mineTrigger", "victory", "panic", "empty", "tick",
  ];
  const generated = await page.evaluate(async (names) => {
    const { audio, probe, weapons } = window.__audioSmoke;
    const results = [];
    const cases = [
      ...names.map((name) => ({ name, options: { intensity: 0.8 } })),
      ...weapons.flatMap((weapon) => ["shot", "explosion"].map((name) => ({ name, options: { weapon, intensity: 0.8 } }))),
    ];
    for (const { name, options } of cases) {
      audio.reset();
      await new Promise((resolve) => setTimeout(resolve, 80));
      audio.play(name, options);
      const peak = await window.__sampleAudio(probe);
      results.push({ name: options.weapon ? `${name}:${options.weapon}` : name, peak });
    }
    audio.reset();
    return results;
  }, cues);
  for (const result of generated) requireSignal(result.peak, result.name);
  const weaponCount = await page.evaluate(() => window.__audioSmoke.weapons.length);
  assert.equal(generated.length, cues.length + weaponCount * 2, "Every weapon has both a firing and impact cue");
  console.log(`PASS: nonzero audio samples for ${generated.length} cues and weapon variants (peak ${Math.max(...generated.map((result) => result.peak)).toFixed(3)})`);

  const burst = await page.evaluate(async () => {
    const { audio, probe } = window.__audioSmoke;
    for (let i = 0; i < 200; i++) audio.play("explosion", { weapon: "megaBomb", intensity: 1 });
    return { ...audio.diagnostics, peak: await window.__sampleAudio(probe) };
  });
  assert.ok(burst.activeVoices > 0, "A busy burst still plays sounds");
  assert.ok(burst.activeVoices <= 28, `The voice limit bounds overlapping explosions: ${burst.activeVoices}`);
  requireSignal(burst.peak, "A simultaneous explosion burst");
  assert.ok(burst.peak <= 1, `The compressed burst stays within the output range: ${burst.peak}`);
  await page.evaluate(() => window.__audioSmoke.audio.reset());
  await tick(page);

  const motionPeaks = await page.evaluate(async () => {
    const { audio, probe } = window.__audioSmoke;
    const results = [];
    for (const kind of ["wind", "swing", "charge"]) {
      audio.reset();
      await new Promise((resolve) => setTimeout(resolve, 80));
      audio.setMotion({ wind: 0, swing: 0, charge: 0, pan: 0.4, [kind]: 0.8 });
      results.push({ kind, peak: await window.__sampleAudio(probe, 180) });
    }
    audio.setMotion({ wind: 0.8, swing: 0.9, charge: 1, pan: -0.4 });
    return results;
  });
  for (const result of motionPeaks) requireSignal(result.peak, result.kind);
  assert.equal((await diagnostics(page)).activeLoops, 3, "All three continuous sound layers can coexist");
  await page.evaluate(() => window.__audioSmoke.audio.setMotion({ wind: 0, swing: 0, charge: 0, pan: 0 }));
  await tick(page, 250);
  assert.equal((await diagnostics(page)).activeLoops, 0, "Quiet motion releases its loops");
  assert.equal((await diagnostics(page)).activeVoices, 0, "Released motion also frees its audio sources");

  for (const action of ["mute", "suspend"]) {
    const result = await page.evaluate(async (action) => {
      const { audio, probe } = window.__audioSmoke;
      audio.setEnabled(true);
      audio.setSuspended(false);
      await audio.unlock();
      audio.setMotion({ wind: 1, swing: 1, charge: 1, pan: 0 });
      audio.play("explosion", { weapon: "meteor" });
      const before = { ...audio.diagnostics };
      if (action === "mute") audio.setEnabled(false);
      else audio.setSuspended(true);
      await new Promise((resolve) => setTimeout(resolve, 180));
      audio.play("explosion");
      audio.setMotion({ wind: 1, swing: 1, charge: 1, pan: 0 });
      return { before, after: { ...audio.diagnostics }, peak: await window.__sampleAudio(probe) };
    }, action);
    assert.ok(result.before.activeVoices > 0 && result.before.activeLoops > 0, `${action}: sounds were active before cleanup`);
    assert.equal(result.after.activeVoices, 0, `${action}: one-shot sources stop`);
    assert.equal(result.after.activeLoops, 0, `${action}: continuous sources stop`);
    assert.ok(result.peak < 0.00001, `${action}: the actual output becomes silent, received ${result.peak}`);
  }

  const retry = await page.evaluate(async () => {
    const { audio, probe } = window.__audioSmoke;
    audio.setEnabled(true);
    audio.setSuspended(false);
    await audio.unlock();
    await new Promise((resolve) => setTimeout(resolve, 60));
    await probe.context.suspend();
    const attempts = probe.resumeAttempts;
    probe.rejectResumes = 1;
    await audio.unlock();
    await new Promise((resolve) => setTimeout(resolve, 60));
    const refusedState = probe.context.state;
    await audio.unlock();
    await new Promise((resolve) => setTimeout(resolve, 60));
    audio.play("jump");
    return { refusedState, resumedState: probe.context.state, attempts: probe.resumeAttempts - attempts, peak: await window.__sampleAudio(probe) };
  });
  assert.equal(retry.refusedState, "suspended", "A rejected browser resume remains recoverable");
  assert.equal(retry.resumedState, "running", "A later unlock retries browser resume");
  assert.ok(retry.attempts >= 2);
  requireSignal(retry.peak, "Audio after retrying a refused resume");

  const disposed = await page.evaluate(async () => {
    const { audio, probe } = window.__audioSmoke;
    audio.setMotion({ wind: 1, swing: 1, charge: 1, pan: 0 });
    audio.play("explosion");
    audio.dispose();
    await new Promise((resolve) => setTimeout(resolve, 100));
    return { state: probe.context.state, ...audio.diagnostics };
  });
  assert.equal(disposed.activeVoices, 0);
  assert.equal(disposed.activeLoops, 0);
  assert.equal(disposed.state, "closed", "Disposal closes the AudioContext");
  console.log(`PASS: bounded burst voices (peak ${burst.peak.toFixed(3)}), generated wind/swing/charge, loop release, silent mute/suspension, resume retry, and disposal`);

  const keyboard = await createPage();
  await keyboard.locator("#start-button").focus();
  await keyboard.keyboard.press("Enter");
  await keyboard.waitForFunction(() => {
    const state = JSON.parse(window.render_game_to_text());
    return state.screen === "playing" && state.sound.unlocked;
  });
  const touch = await createPage({ viewport: { width: 390, height: 844 }, hasTouch: true });
  await touch.locator("#start-button").tap();
  await touch.waitForFunction(() => JSON.parse(window.render_game_to_text()).sound.unlocked);
  await touch.locator("#touch-jump").tap();
  const touchPeak = await touch.evaluate(() => window.__sampleAudio(window.__audioProbes[0]));
  requireSignal(touchPeak, "Touch jump");
  assert.deepEqual(errors, [], "No browser runtime, console, or asset errors");
  console.log("PASS: default-on gameplay audio, persisted mute, keyboard/touch unlock, and no browser errors");
} finally {
  await browser.close();
}
