export interface TouchControlCallbacks {
  onAim: (direction: { x: number; y: number }) => void;
  onJump: () => void;
  onHook: () => void;
  onFireStart: () => void;
  onFireEnd: () => void;
  onFireCancel: () => void;
}

export interface TouchControlState {
  visible: boolean;
  enabled: boolean;
  canFire: boolean;
  hooked: boolean;
}

/** Independent pointer ownership lets both thumbs and action buttons work together. */
export function createTouchControls(root: HTMLElement, callbacks: TouchControlCallbacks) {
  const element = <T extends HTMLElement>(selector: string) => {
    const control = root.querySelector<T>(selector);
    if (!control) throw new Error(`Missing touch control: ${selector}`);
    return control;
  };
  const move = element<HTMLElement>("#touch-move");
  const aim = element<HTMLElement>("#touch-aim");
  const jump = element<HTMLButtonElement>("#touch-jump");
  const hook = element<HTMLButtonElement>("#touch-hook");
  const fire = element<HTMLButtonElement>("#touch-fire");
  const movement = { left: false, right: false, up: false, down: false };
  const owners = new Map<HTMLElement, number>();
  let state: TouchControlState = { visible: false, enabled: false, canFire: false, hooked: false };
  const deadzone = 0.25;

  function clearMovement() {
    movement.left = movement.right = movement.up = movement.down = false;
  }

  function positionStick(pad: HTMLElement, x: number, y: number) {
    pad.style.setProperty("--stick-x", `${x}px`);
    pad.style.setProperty("--stick-y", `${y}px`);
  }

  function updateStick(pad: HTMLElement, event: PointerEvent) {
    const bounds = pad.getBoundingClientRect();
    const radius = Math.max(1, Math.min(bounds.width, bounds.height) * 0.34);
    const dx = event.clientX - bounds.left - bounds.width / 2;
    const dy = event.clientY - bounds.top - bounds.height / 2;
    const distance = Math.hypot(dx, dy);
    const scale = distance > radius ? radius / distance : 1;
    const x = dx * scale;
    const y = dy * scale;
    positionStick(pad, x, y);
    if (pad === move) {
      movement.left = x / radius <= -deadzone;
      movement.right = x / radius >= deadzone;
      movement.up = y / radius <= -deadzone;
      movement.down = y / radius >= deadzone;
    } else if (distance >= radius * deadzone) {
      callbacks.onAim({ x: dx / distance, y: dy / distance });
    }
  }

  function finish(control: HTMLElement, cancelled: boolean) {
    const pointerId = owners.get(control);
    if (pointerId === undefined) return;
    // Remove ownership before releasing capture: lostpointercapture can fire immediately.
    owners.delete(control);
    control.classList.remove("is-pressed");
    if (control === move) clearMovement();
    if (control === move || control === aim) positionStick(control, 0, 0);
    if (control.hasPointerCapture(pointerId)) control.releasePointerCapture(pointerId);
    if (control === fire) {
      if (cancelled) callbacks.onFireCancel();
      else callbacks.onFireEnd();
    }
  }

  function reset() {
    for (const control of [...owners.keys()]) finish(control, true);
    clearMovement();
    positionStick(move, 0, 0);
    positionStick(aim, 0, 0);
  }

  for (const control of [move, aim, jump, hook, fire]) {
    control.addEventListener("pointerdown", (event) => {
      if (!state.visible || !state.enabled || (control === fire && !state.canFire) || event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();
      if (owners.has(control)) return;
      owners.set(control, event.pointerId);
      control.setPointerCapture(event.pointerId);
      control.classList.add("is-pressed");
      if (control === move || control === aim) updateStick(control, event);
      else if (control === jump) callbacks.onJump();
      else if (control === hook) callbacks.onHook();
      else callbacks.onFireStart();
    });
    control.addEventListener("pointermove", (event) => {
      if (owners.get(control) !== event.pointerId) return;
      event.preventDefault();
      event.stopPropagation();
      if (control === move || control === aim) updateStick(control, event);
    });
    control.addEventListener("pointerup", (event) => {
      if (owners.get(control) !== event.pointerId) return;
      event.preventDefault();
      event.stopPropagation();
      finish(control, false);
    });
    for (const name of ["pointercancel", "lostpointercapture"] as const) {
      control.addEventListener(name, (event) => {
        if (owners.get(control) === event.pointerId) finish(control, true);
      });
    }
    control.addEventListener("contextmenu", (event) => event.preventDefault());
  }

  function update(next: TouchControlState) {
    state = next;
    if (!state.visible || !state.enabled) reset();
    else if (!state.canFire) finish(fire, true);
    root.hidden = !state.visible;
    root.classList.toggle("is-disabled", !state.enabled);
    for (const pad of [move, aim]) pad.setAttribute("aria-disabled", String(!state.enabled));
    jump.disabled = hook.disabled = !state.enabled;
    fire.disabled = !state.enabled || !state.canFire;
    hook.textContent = state.hooked ? "Release" : "Hook";
  }

  update(state);
  return { movement, reset, update };
}
