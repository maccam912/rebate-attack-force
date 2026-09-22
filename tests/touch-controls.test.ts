import test from "node:test";
import assert from "node:assert/strict";
import { createTouchControls, type TouchControlState } from "../src/touch-controls.js";

class Control extends EventTarget {
  hidden = false;
  disabled = false;
  textContent = "";
  attributes = new Map<string, string>();
  captures = new Set<number>();
  styles = new Map<string, string>();
  classes = new Set<string>();
  style = { setProperty: (key: string, value: string) => this.styles.set(key, value) };
  classList = {
    add: (name: string) => this.classes.add(name),
    remove: (name: string) => this.classes.delete(name),
    toggle: (name: string, enabled: boolean) => enabled ? this.classes.add(name) : this.classes.delete(name),
  };
  setAttribute(key: string, value: string) { this.attributes.set(key, value); }
  setPointerCapture(id: number) { this.captures.add(id); }
  hasPointerCapture(id: number) { return this.captures.has(id); }
  releasePointerCapture(id: number) {
    this.captures.delete(id);
    this.pointer("lostpointercapture", id);
  }
  getBoundingClientRect() { return { left: 0, top: 0, width: 100, height: 100 }; }
  pointer(type: string, pointerId: number, clientX = 50, clientY = 50) {
    const event = new Event(type, { cancelable: true });
    Object.assign(event, { pointerId, clientX, clientY, button: 0 });
    this.dispatchEvent(event);
  }
}

function setup() {
  const move = new Control(), aim = new Control(), jump = new Control(), hook = new Control(), fire = new Control();
  const controls = { move, aim, jump, hook, fire };
  const root = Object.assign(new Control(), {
    querySelector: (selector: string) => controls[selector.replace("#touch-", "") as keyof typeof controls],
  });
  const calls = { jump: 0, hook: 0, start: 0, end: 0, cancel: 0 };
  const directions: { x: number; y: number }[] = [];
  const controller = createTouchControls(root as unknown as HTMLElement, {
    onAim: (direction) => directions.push(direction),
    onJump: () => calls.jump++,
    onHook: () => calls.hook++,
    onFireStart: () => calls.start++,
    onFireEnd: () => calls.end++,
    onFireCancel: () => calls.cancel++,
  });
  const state: TouchControlState = { visible: true, enabled: true, canFire: true, hooked: false };
  controller.update(state);
  return { ...controls, root, calls, directions, controller, state };
}

test("movement has a center deadzone, supports diagonals, and belongs to one pointer", () => {
  const { move, controller } = setup();
  move.pointer("pointerdown", 1, 52, 51);
  assert.deepEqual(controller.movement, { left: false, right: false, up: false, down: false });
  move.pointer("pointermove", 1, 100, 0);
  assert.deepEqual(controller.movement, { left: false, right: true, up: true, down: false });
  move.pointer("pointerdown", 2, 0, 100);
  move.pointer("pointermove", 2, 0, 100);
  move.pointer("pointerup", 2);
  assert.equal(controller.movement.right, true);
  assert.deepEqual([...move.captures], [1]);
  move.pointer("pointermove", 1, 0, 100);
  assert.deepEqual(controller.movement, { left: true, right: false, up: false, down: true });
  move.pointer("pointerup", 1);
  assert.deepEqual(controller.movement, { left: false, right: false, up: false, down: false });
  assert.equal(move.styles.get("--stick-x"), "0px");
  assert.equal(move.styles.get("--stick-y"), "0px");
  assert.equal(move.captures.size, 0);
});

test("aim, movement, jumping, hooking, and charged fire can use different simultaneous pointers", () => {
  const { move, aim, jump, hook, fire, controller, directions, calls } = setup();
  move.pointer("pointerdown", 1, 100, 50);
  aim.pointer("pointerdown", 2, 80, 10);
  jump.pointer("pointerdown", 3);
  hook.pointer("pointerdown", 4);
  fire.pointer("pointerdown", 5);
  fire.pointer("pointerdown", 6);
  fire.pointer("pointerup", 6);
  assert.deepEqual(calls, { jump: 1, hook: 1, start: 1, end: 0, cancel: 0 });
  assert.deepEqual(directions, [{ x: 0.6, y: -0.8 }]);
  assert.equal(controller.movement.right, true);
  jump.pointer("pointerup", 3);
  jump.pointer("pointerdown", 7);
  assert.equal(calls.jump, 2, "a second tap can trigger the game's double jump");
  aim.pointer("pointerup", 2);
  assert.deepEqual(directions, [{ x: 0.6, y: -0.8 }], "releasing aim retains its last direction");
  fire.pointer("pointerup", 5);
  assert.deepEqual(calls, { jump: 2, hook: 1, start: 1, end: 1, cancel: 0 });
  assert.equal(fire.captures.size, 0);
});

for (const interruption of ["pointercancel", "lostpointercapture", "reset", "hidden", "disabled", "no-ammo"] as const) {
  test(`${interruption} cancels charged fire without firing on a later release`, () => {
    const { fire, controller, state, calls } = setup();
    fire.pointer("pointerdown", 1);
    if (interruption === "reset") controller.reset();
    else if (interruption === "hidden") controller.update({ ...state, visible: false });
    else if (interruption === "disabled") controller.update({ ...state, enabled: false });
    else if (interruption === "no-ammo") controller.update({ ...state, canFire: false });
    else fire.pointer(interruption, 1);
    fire.pointer("pointerup", 1);
    assert.equal(calls.start, 1);
    assert.equal(calls.cancel, 1);
    assert.equal(calls.end, 0);
    assert.equal(fire.captures.size, 0);
    assert.equal(fire.classes.has("is-pressed"), false);
  });
}

test("suspending controls releases every pointer and prevents new input", () => {
  const { move, aim, jump, hook, fire, controller, root, state, calls } = setup();
  move.pointer("pointerdown", 1, 100, 50);
  aim.pointer("pointerdown", 2, 50, 0);
  controller.update({ ...state, enabled: false, hooked: true });
  assert.equal(root.hidden, false);
  assert.deepEqual(controller.movement, { left: false, right: false, up: false, down: false });
  assert.equal(move.captures.size + aim.captures.size, 0);
  assert.equal(aim.styles.get("--stick-y"), "0px");
  assert.equal(jump.disabled, true);
  assert.equal(hook.disabled, true);
  assert.equal(fire.disabled, true);
  assert.equal(hook.textContent, "Release");
  jump.pointer("pointerdown", 3);
  hook.pointer("pointerdown", 4);
  fire.pointer("pointerdown", 5);
  assert.deepEqual(calls, { jump: 0, hook: 0, start: 0, end: 0, cancel: 0 });
  controller.update({ ...state, visible: false });
  assert.equal(root.hidden, true);
});
