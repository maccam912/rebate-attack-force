import "./style.css";
import { DOUBLE_JUMP_SECONDS, GRAPPLE_RANGE, GameEngine } from "../shared/game";
import { BotController } from "../shared/bots";
import type {
  GameState,
  PlayerInput,
  GameCommand,
  WeaponId,
  TeamSettings,
} from "../shared/types";
import { renderGame } from "./renderer";
import { HAZARD_PRESENTATION, STATUS_PRESENTATION } from "./effect-renderer";
import { followCamera, screenToWorld, type Camera } from "./camera";
import { RoomConnection, savedSeat, type LobbyState } from "./network";
import { WEAPONS, WEAPON_CATALOG, type WeaponDefinition } from "../shared/weapons";
import type { ServerState } from "../shared/protocol";
import { GameAudio, type SoundName } from "./audio";
import { GameSoundDirector } from "./game-audio";
import { createTouchControls } from "./touch-controls";

import { DEFAULT_MINE_COUNT, DEFAULT_TEAM_SETTINGS, MAX_FROGS, MAX_HP, MAX_MINES, teamColor, validMineCount, validTeamSettings } from "../shared/settings";

const logo = `<svg viewBox="0 0 64 64" fill="none" aria-hidden="true"><path d="M5 30 17 8l16 5 15-3 11 22-8 22H17Z" fill="#cde47b"/><path d="M17 40c-5-17 5-24 15-18 11-7 22 3 17 18-9 10-24 10-32 0Z" fill="#18372a"/><circle cx="24" cy="27" r="5" fill="#e5ebbd"/><circle cx="41" cy="27" r="5" fill="#e5ebbd"/><circle cx="25" cy="27" r="2" fill="#18372a"/><circle cx="40" cy="27" r="2" fill="#18372a"/><path d="M27 38q6 5 12-1" stroke="#d0e77e" stroke-width="2" stroke-linecap="round"/><path d="m9 47-5 9 15-2M51 50l8 7 3-15" fill="#cde47b"/></svg>`;
const app = document.querySelector<HTMLDivElement>("#app")!;
app.innerHTML = `
<main class="arena" id="arena" aria-label="Rebate Attack Force">
  <canvas id="game" tabindex="0" aria-label="Scrapyard arena. A and D to move, Enter to jump, double Enter to jump higher and backward, mouse and Space to grapple, 2 for weapons. Escape opens the menu."></canvas>
  <div class="arena-top-tools">
    <button class="icon-button" id="menu-button" aria-label="Open game menu" aria-expanded="false">☰</button>
    <button class="icon-button" id="guide-button" aria-label="Field guide" title="Controls">?</button>
    <button class="icon-button" id="sound-button" aria-label="Enable sound"><span id="sound-icon">◌</span><span id="sound-label" class="sr-only">Sound off</span></button>
    <button class="icon-button" id="reset-button" title="Restart local match" aria-label="Restart local match">↻</button>
    <button class="icon-button" id="fullscreen-button" title="Fullscreen (F)" aria-label="Toggle fullscreen">⛶</button>
  </div>
  <div class="hud" id="hud" hidden><div><div class="turn-player" id="turn-player"></div><div class="turn-caption" id="turn-caption"></div><div class="active-statuses" id="active-statuses" aria-label="Active frog effects" hidden></div></div><div class="timer" id="timer"></div></div>
  <div class="objective-toast" id="objective-toast"></div>
  <div class="charging-indicator" id="charging" hidden>SHOT POWER<div class="power-meter"><div id="power-fill"></div></div></div>
  <section class="arsenal-panel" id="arsenal-panel" role="dialog" aria-modal="true" aria-label="Weapon arsenal" hidden><div class="arsenal-heading"><div><div class="eyebrow">DEPARTMENT OF BAD IDEAS</div><h2>Pick your trouble.</h2></div><button class="icon-button" id="close-arsenal" aria-label="Close arsenal">×</button></div><p class="arsenal-intro">${WEAPONS.length} ways to cause problems. One attack per turn.</p><div class="arsenal-filters"><label class="arsenal-search"><span class="sr-only">Search weapons and effects</span><input type="search" id="arsenal-search" placeholder="Search weapons or effects…" autocomplete="off" aria-controls="inventory" /></label><label><span class="sr-only">Weapon category</span><select id="arsenal-category" aria-controls="inventory"><option value="all">All categories</option>${[...new Set(WEAPONS.map((w) => w.category))].map((category) => `<option value="${category}">${category}</option>`).join("")}</select></label></div><div class="arsenal-results" id="arsenal-results" role="status" aria-live="polite"></div><div class="inventory" id="inventory"></div><div class="arsenal-footer">Crates resupply your stash · Impacts add up · B to close</div></section>
  <div class="arena-bottom"><div class="toolbelt"><button class="tool-button active" id="grapple-tool"><span class="key">1</span> Grapple</button><button class="tool-button" id="weapon-tool"><span class="key">2</span> <span id="weapon-tool-label">Weapon</span></button><button class="tool-button" id="arsenal-button" aria-expanded="false" aria-controls="arsenal-panel"><span class="key">B</span> Arsenal</button></div><button class="end-turn" id="end-turn">End turn</button></div>
  <div class="touch-controls" id="touch-controls" aria-label="Touch controls" hidden>
    <div class="touch-pad-wrap"><button class="touch-pad" id="touch-move" aria-label="Movement pad: left and right to move, up to reel in, down to pay out rope"><span class="touch-pad-label">MOVE / REEL</span><span class="touch-pad-directions" aria-hidden="true">↔ ↕</span><span class="touch-stick" aria-hidden="true"></span></button></div>
    <div class="touch-actions"><button id="touch-jump" aria-label="Jump; tap twice quickly to backflip">Jump</button><button id="touch-hook">Hook</button><button id="touch-fire" aria-label="Hold to charge weapon, release to fire">Hold fire</button></div>
    <div class="touch-pad-wrap"><button class="touch-pad" id="touch-aim" aria-label="Aim pad: drag in the direction to aim"><span class="touch-pad-label">AIM</span><span class="touch-stick" aria-hidden="true"></span></button></div>
  </div>
  <div class="menu-backdrop" id="menu-overlay"><section class="panel menu-panel" aria-label="Game menu"><div class="menu-brand">${logo}<h1>REBATE <span>ATTACK FORCE</span></h1></div><button class="secondary-button" id="resume-button" hidden>Resume game <span>Esc</span></button><div id="play-panel"></div><div class="connection-status" id="connection-status">THE SCRAPYARD IS OPEN</div></section></div>
  <div class="match-over" id="match-over" hidden><div><div class="eyebrow">THE SCRAPYARD HAS SPOKEN</div><h2 id="winner-name"></h2><button class="primary-button" id="rematch-button">Run it back <span>↗</span></button></div></div>
</main>
<div class="dialog-backdrop" id="guide" hidden><section class="dialog" role="dialog" aria-modal="true" aria-labelledby="guide-title"><button class="dialog-close" id="close-guide" aria-label="Close guide">×</button><div class="eyebrow">SCRAPYARD SURVIVAL MANUAL</div><h2 id="guide-title">A tongue is all you need.<br>Until it isn’t.</h2><p>Last team standing wins. Each team rotates through its living frogs. Every frog starts with a full arsenal. You get 45 seconds to move, gather supplies, and fire one weapon. Unused ammo carries over, so a stocked frog can attack without finding another crate. Retreat while your shot travels or its fuse burns. A melee hit or explosion ends your control, and the camera follows the fallout. Damage adds up through launches, collisions, and wall hits, then appears one frog at a time after everyone settles. Knocked-out frogs burst and can start another chain reaction. Your own movement and landings are safe; water is a one-way trip.</p><p class="touch-help"><strong>On your phone:</strong> use the left pad to walk and pump a swing; drag it up or down to reel the rope. Drag the right pad to aim, or tap the arena to mark a target. Tap Hook to attach and Release to let go. Tap Jump twice quickly to backflip. Choose a weapon in Arsenal, then hold Fire to charge and release to shoot. Landscape gives you a wider view.</p><div class="guide-grid"><div class="guide-item"><strong>01 / Get moving</strong>A / D to walk and pump a swing. Enter to jump. Press Enter twice quickly for a higher backward jump. W, ↑, and Shift also jump on the ground. W / S to shorten or extend an attached rope.</div><div class="guide-item"><strong>02 / Find your arc</strong>Aim at any platform and click or press Space. Press again to let go. Hooks reach 680px. Ropes wrap around corners and unwind as you swing back. Keep your speed when you release.</div><div class="guide-item"><strong>03 / Make a delivery</strong>Press B for ${WEAPONS.length} weapons. Search by name or effect, or filter by category. Rockets, oil slicks, razor wire, gravity wells, glitch bombs: pick your trouble. Choose one, press 2, aim, hold to charge, then release. Mystery crates contain a random weapon revealed only when collected.</div><div class="guide-item"><strong>04 / Bring your friends</strong>Frogs are solid: push, stomp, bounce, and roll. Deployed mines arm on later turns; starting mines are armed from turn one. Approaching one with the active frog starts its warning fuse. Air support drops into the aimed column; roofs offer cover. Local mode shares one device, with humans or AI bots. Online mode gives you a private room link; the server sets its team capacity. The host can add bots, seed the level with mines, and choose each team’s frog count and HP before starting. Disconnected teams skip their turns; reopen the room link in the same browser to rejoin.</div></div><p><strong>Read the effects:</strong> ground patches and force fields show their remaining turn changes. Badges above a frog count down its remaining seconds of control; effects wait through other frogs’ turns. Oil and ice are slippery, glue slows movement, wire severs exposed ropes, and fire and poison keep hurting. Gravity fields pull, repel, or lift. Vision weapons affect the hit frog’s view; the HUD and controls remain readable. Reduced-motion settings soften these effects.</p><p>Practice returns control to you after the fallout and respawns knocked-out frogs. These maps, frogs, and synthesized sound effects are original. Use the ♪ button to mute or enable sound.</p><button class="primary-button" id="guide-done">Got it. Let’s make trouble. <span>↗</span></button></section></div><div class="global-toast" id="global-toast" role="status" aria-live="polite"></div>`;

const $ = <T extends HTMLElement = HTMLElement>(id: string) =>
  document.getElementById(id) as T;
const canvas = $<HTMLCanvasElement>("game");
const ctx = canvas.getContext("2d")!;
let selectedMode: "practice" | "local" | "online" = "practice";
let screen: "menu" | "playing" | "lobby" = "menu";
let engine: GameEngine | null = new GameEngine({
  mode: "practice",
  players: [
    { id: "p1", name: "Sprout" },
    { id: "p2", name: "Rusty" },
  ],
});
let state: GameState = engine.state;
let network: RoomConnection | null = null;
let lobby: LobbyState | null = null;
let tool: "grapple" | "weapon" = "grapple";
let sound = true;
let playerName = "Sprout";
let busy = false;
let lastEnter = -Infinity;
const localTeams: Record<string, TeamSettings> = {
  p1: { ...DEFAULT_TEAM_SETTINGS }, p2: { ...DEFAULT_TEAM_SETTINGS },
};
const localRoster = [
  { id: "p1", name: "Sprout", bot: false },
  { id: "p2", name: "Rusty", bot: false },
];
let nextLocalId = 3;
let localMineCount = DEFAULT_MINE_COUNT;
let localBots = new BotController();
let aim = { x: 440, y: 1400 };
let pointer: { x: number; y: number } | null = null;
const coarsePointer = matchMedia("(any-pointer: coarse)");
const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
let touchEnabled = coarsePointer.matches || navigator.maxTouchPoints > 0;
let touchAimDirection: { x: number; y: number } | null = null;
let canvasPointer: number | null = null;
let camera: Camera | null = null;
let viewport = { width: innerWidth, height: innerHeight, dpr: 1 };
let menuOpen = false;
let arsenalOpen = false;
let arsenalQuery = "";
let arsenalCategory = "all";
const keys = new Set<string>();
let chargingAt: number | null = null;
let toastTimer = 0;
let prevTime = performance.now(),
  accumulated = 0,
  lastHud = 0;
let audioFocused = true;
let awaitingSoundState = false;
let previousCrates = state.crates.length;
let previousCrateIds = new Set(state.crates.map((crate) => crate.id));
let revealedCrates = new Set<string>();
let previousTurn = state.turn;
let previousPhase = state.phase;
let previousSignature = "";
const audio = new GameAudio();
const soundDirector = new GameSoundDirector(audio);
const touchControls = createTouchControls($("touch-controls"), {
  onAim(direction) {
    pointer = null;
    touchAimDirection = direction;
    refreshAim();
  },
  onJump: enterJump,
  onHook() { setTool("grapple"); hook(); },
  onFireStart() { setTool("weapon"); beginCharge(); },
  onFireEnd: finishCharge,
  onFireCancel: cancelCharge,
});
app.dataset.touch = String(touchEnabled);
coarsePointer.addEventListener("change", () => setTouchEnabled(coarsePointer.matches || navigator.maxTouchPoints > 0));
document.addEventListener("pointerdown", (event) => {
  if (event.pointerType === "touch" && !touchEnabled) setTouchEnabled(true);
}, { capture: true });
function setTouchEnabled(enabled: boolean) {
  if (touchEnabled === enabled) return;
  clearInputs();
  touchEnabled = enabled;
  app.dataset.touch = String(enabled);
  pointer = null;
  touchAimDirection = enabled ? defaultTouchAim() : null;
  camera = null;
  updateHud(true);
}
function defaultTouchAim() {
  const length = Math.hypot(200, 220);
  return { x: 200 / length, y: -220 / length };
}
try {
  playerName = localStorage.getItem("raf-name") || "Sprout";
  sound = localStorage.getItem("raf-sound") !== "false";
} catch {}
audio.setEnabled(sound);
function unlockAudio() {
  audio.unlock();
}
function playSound(key: SoundName) {
  audio.play(key);
}
function soundAudible() {
  return sound && audioFocused && !document.hidden && screen === "playing" && !menuOpen && $("guide").hidden &&
    (!network || (network.isConnected && !awaitingSoundState));
}
function soundListener() {
  if (camera && (state.phase === "settling" || state.phase === "damage"))
    return { x: camera.x + camera.width / 2, y: camera.y + camera.height / 2 };
  const player = active();
  return player ? { x: player.x, y: player.y } : { x: state.width / 2, y: state.height / 2 };
}
// Capture gestures from mouse, keyboard, and touch controls before their actions run.
document.addEventListener("pointerdown", unlockAudio, { capture: true });
document.addEventListener("keydown", unlockAudio, { capture: true });
document.addEventListener("click", (event) => {
  const button = event.target instanceof Element ? event.target.closest<HTMLButtonElement>("button") : null;
  if (button && !button.disabled && button.id !== "sound-button") playSound("ui");
});
function escapeHtml(s: string) {
  return s.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
}
function announce(message: string) {
  $("global-toast").textContent = message;
  $("global-toast").classList.add("visible");
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(
    () => $("global-toast").classList.remove("visible"),
    3600,
  );
}
function active() {
  return state.players.find((p) => p.id === state.activePlayerId);
}
function botTurn() {
  return !!state.teams.find((team) => team.id === state.activeTeamId)?.bot;
}
function canControl() {
  return (
    screen === "playing" &&
    !menuOpen && $("guide").hidden &&
    (state.phase === "playing" || state.phase === "retreat") &&
    !botTurn() &&
    (!network || network.canControl)
  );
}
function input(): PlayerInput {
  const movement = touchControls.movement;
  return {
    left: !arsenalOpen && (movement.left || keys.has("a") || keys.has("arrowleft")),
    right: !arsenalOpen && (movement.right || keys.has("d") || keys.has("arrowright")),
    up: !arsenalOpen && (movement.up || keys.has("w") || keys.has("arrowup")),
    down: !arsenalOpen && (movement.down || keys.has("s") || keys.has("arrowdown")),
    aimX: aim.x,
    aimY: aim.y,
  };
}
function currentId() {
  return state.activePlayerId;
}
function syncInput() {
  if (!canControl()) return;
  const i = input();
  if (network) network.input(i);
  else engine?.setInput(currentId(), i);
}
function command(c: GameCommand) {
  if (!canControl() || (arsenalOpen && c.type !== "selectWeapon")) return false;
  syncInput();
  if (network) {
    network.command(c);
    return true;
  }
  return engine?.command(currentId(), c) ?? false;
}
function hook() {
  const p = active();
  if (!p || !canControl()) return;
  const success = command({ type: p.rope ? "release" : "grapple" });
  if (!success && !p.rope) {
    playSound("empty");
    announce("Aim at a platform within reach, then hook again.");
  }
}
function setTool(next: "grapple" | "weapon") {
  cancelCharge();
  if (next === "weapon" && !active()?.hasCrate) {
    playSound("empty");
    announce("Your pockets are empty. Pick up a supply crate to get ammo.");
    return;
  }
  if (tool !== next) playSound("select");
  tool = next;
  updateHud(true);
}
function toggleArsenal(open = !arsenalOpen) {
  clearInputs();
  arsenalOpen = open && canControl() && state.phase === "playing";
  $("arsenal-panel").hidden = !arsenalOpen;
  $("arsenal-button").setAttribute("aria-expanded", String(arsenalOpen));
  if (arsenalOpen) $("close-arsenal").focus();
  else canvas.focus();
  updateHud(true);
}
function weaponEffectDetails(weapon: WeaponDefinition): string[] {
  const details: string[] = [];
  if (weapon.hazard) details.push(`${HAZARD_PRESENTATION[weapon.hazard.kind].label.toLowerCase()} · ${weapon.hazard.turns} turns`);
  if (weapon.status) details.push(`${STATUS_PRESENTATION[weapon.status.kind].label} · ${weapon.status.duration}s`);
  if (weapon.cutsRopes) details.push("Cuts ropes");
  return details;
}
function clearInputs() {
  lastEnter = -Infinity;
  keys.clear();
  touchControls.reset();
  cancelCharge();
  if (canvasPointer !== null && canvas.hasPointerCapture(canvasPointer)) canvas.releasePointerCapture(canvasPointer);
  canvasPointer = null;
  syncInput();
}
function updateSound() {
  audio.setEnabled(sound);
  $("sound-icon").textContent = sound ? "♪" : "◌";
  $("sound-label").textContent = sound ? "Sound on" : "Sound off";
  $("sound-button").setAttribute(
    "aria-label",
    sound ? "Mute sound" : "Enable sound",
  );
  $("sound-button").setAttribute("aria-pressed", String(sound));
  $("sound-button").title = sound ? "Mute sound effects" : "Enable sound effects";
}
function saveName() {
  const name = $<HTMLInputElement>("player-name")?.value.trim();
  if (name) playerName = name.slice(0, 20);
  try {
    localStorage.setItem("raf-name", playerName);
  } catch {}
}
function modeLabel() {
  return selectedMode === "practice"
    ? "PRACTICE RUN"
    : selectedMode === "local"
      ? "LOCAL MATCH"
      : "PRIVATE ROOM";
}
function settingsMarkup(id: string, name: string, settings: TeamSettings, editable: boolean) {
  return `<fieldset class="team-settings" data-team="${escapeHtml(id)}"><legend>${escapeHtml(name)} · team setup</legend><label>Frogs<input type="number" data-setting="frogs" aria-label="${escapeHtml(name)} frogs" min="1" max="${MAX_FROGS}" step="1" required value="${settings.frogs}" ${editable ? "" : "disabled"}></label><label>HP per frog<input type="number" data-setting="hp" aria-label="${escapeHtml(name)} HP per frog" min="1" max="${MAX_HP}" step="1" required value="${settings.hp}" ${editable ? "" : "disabled"}></label></fieldset>`;
}
function mineSettingsMarkup(mineCount: number, editable: boolean) {
  return `<fieldset class="team-settings mine-settings"><legend>Level setup</legend><label for="starting-mines">Starting mines<input id="starting-mines" type="number" data-mine-count min="0" max="${MAX_MINES}" step="1" required value="${mineCount}" aria-describedby="starting-mines-help" ${editable ? "" : "disabled"}></label><p id="starting-mines-help">Armed from turn one. 0 means none; ${MAX_MINES} maximum. Crowded levels may fit fewer.</p></fieldset>`;
}
function localSetupMarkup() {
  return `${mineSettingsMarkup(localMineCount, true)}<div class="roster local-roster">${localRoster.map((team, index) => {
    const name = team.id === "p1" ? playerName : team.name;
    return `<div class="lobby-team"><div class="player-row"><span class="avatar" style="color:${teamColor(index)}">♟</span><div class="player-info"><strong>${escapeHtml(name)}</strong>${team.id === "p1" ? "<small>You · Human</small>" : `<label class="controller-label">Controlled by<select data-local-control="${team.id}" aria-label="${escapeHtml(name)} controller"><option value="human" ${team.bot ? "" : "selected"}>Human</option><option value="bot" ${team.bot ? "selected" : ""}>AI bot</option></select></label>`}</div>${team.id !== "p1" && localRoster.length > 2 ? `<button class="remove-team" data-remove-local="${team.id}" aria-label="Remove ${escapeHtml(name)}">Remove</button>` : ""}</div>${settingsMarkup(team.id, name, localTeams[team.id], true)}</div>`;
  }).join("")}</div><div class="team-actions"><button class="secondary-button" id="add-local-player">Add player</button><button class="secondary-button" id="add-local-bot">Add bot</button></div>`;
}
function addLocalTeam(bot: boolean) {
  if (!validSetup()) return;
  saveName();
  const number = nextLocalId++;
  const id = `p${number}`;
  localRoster.push({ id, name: `${bot ? "Bot" : "Player"} ${number}`, bot });
  localTeams[id] = { ...DEFAULT_TEAM_SETTINGS };
  renderPanel();
  $("start-button").scrollIntoView({ block: "nearest" });
}
function validSetup() {
  return Array.from($("play-panel").querySelectorAll<HTMLInputElement>("[data-setting], [data-mine-count]")).every((input) => input.reportValidity());
}
$("play-panel").addEventListener("change", (event) => {
  const field = event.target;
  if (field instanceof HTMLSelectElement && field.dataset.localControl) {
    const team = localRoster.find((candidate) => candidate.id === field.dataset.localControl);
    if (team) team.bot = field.value === "bot";
    return;
  }
  if (!(field instanceof HTMLInputElement)) return;
  if (field.hasAttribute("data-mine-count")) {
    const mineCount = field.valueAsNumber;
    if (!validMineCount(mineCount)) { field.reportValidity(); return; }
    if (network) network.configureMines(mineCount);
    else localMineCount = mineCount;
    return;
  }
  if (!field.dataset.setting) return;
  const group = field.closest<HTMLFieldSetElement>("[data-team]")!;
  const settings = {
    frogs: group.querySelector<HTMLInputElement>('[data-setting="frogs"]')!.valueAsNumber,
    hp: group.querySelector<HTMLInputElement>('[data-setting="hp"]')!.valueAsNumber,
  };
  if (!validTeamSettings(settings)) { field.reportValidity(); return; }
  if (network) network.configureTeam(group.dataset.team!, settings);
  else localTeams[group.dataset.team!] = settings;
});
function rosterMarkup() {
  return state.teams.map((team) => {
    const frogs = state.players.filter((p) => p.teamId === team.id);
    return `<div class="team-roster"><div class="team-heading" style="color:${team.color}">${escapeHtml(team.name)}${team.bot ? " · AI bot" : network?.sessionId === team.id ? " · you" : ""}<small>${frogs.filter((p) => p.alive).length}/${frogs.length} alive${team.connected ? "" : " · Offline · turns skipped"}</small></div>${frogs.map((p) =>
      `<div class="player-row ${p.id === state.activePlayerId ? "current-player" : ""} ${p.alive ? "" : "dead"}"><div class="avatar" style="color:${p.color}">♟</div><div class="player-info"><strong>Frog ${p.number}</strong><small>${!p.alive ? "Out of the action" : !team.connected ? "Waiting to rejoin" : p.id === state.activePlayerId ? "Making trouble" : "Biding their time"}</small></div><span class="player-hp">${Math.ceil(p.hp)}<small> / ${p.maxHp}</small></span></div>`).join("")}</div>`;
  }).join("");
}
function renderPanel() {
  const panel = $("play-panel");
  app.dataset.screen = screen;
  menuOpen = false;
  syncMenu();
  if (screen === "menu") {
    panel.innerHTML = `<div class="panel-title"><h2>Pick your trouble.</h2><span class="tiny-tag">LET’S PLAY</span></div><div class="mode-tabs" role="tablist" aria-label="Game mode">${(["practice", "local", "online"] as const).map((m) => `<button class="mode-tab ${m === selectedMode ? "active" : ""}" role="tab" aria-selected="${m === selectedMode}" data-mode="${m}">${m === "practice" ? "Practice" : m === "local" ? "Local" : "Online"}</button>`).join("")}</div><label class="input-label" for="player-name">YOUR CALLSIGN</label><input class="text-input" id="player-name" maxlength="20" value="${escapeHtml(playerName)}" autocomplete="nickname" placeholder="A perfectly normal frog"/><p class="mode-description">${selectedMode === "practice" ? "Find your swing. Try the weapons. Your patient target frog won’t hold a grudge." : selectedMode === "local" ? "One device, as many teams as you like. Share turns with friends or choose AI bots to play solo." : "Make a private room for friends and AI bots. The server sets the team capacity. No sign-up required."}</p>${selectedMode === "local" ? localSetupMarkup() : ""}<button class="primary-button" id="start-button" ${busy ? "disabled" : ""}>${busy ? "Connecting…" : selectedMode === "practice" ? "Start practice" : selectedMode === "local" ? "Start local match" : "Create a room"} <span>↗</span></button>${selectedMode === "online" ? '<div class="join-fields"><input class="text-input" id="room-code-input" aria-label="Room code or invite link" placeholder="Have a room code?" maxlength="200"/><button id="join-button">Join</button></div>' : ""}<div class="anonymous-note">${selectedMode === "online" ? "↗ Share a link. Skip the sign-up." : touchEnabled ? "⌁ Thumb controls ready · Try landscape for a wider view" : "⌁ Keyboard + mouse controls"}</div>`;
    panel.querySelectorAll<HTMLButtonElement>("[data-mode]").forEach(
      (b) =>
        (b.onclick = () => {
          saveName();
          selectedMode = b.dataset.mode as typeof selectedMode;
          renderPanel();
        }),
    );
    if (selectedMode === "local") {
      $("add-local-player").onclick = () => addLocalTeam(false);
      $("add-local-bot").onclick = () => addLocalTeam(true);
      panel.querySelectorAll<HTMLButtonElement>("[data-remove-local]").forEach((button) => {
        button.onclick = () => {
          if (!validSetup()) return;
          saveName();
          const index = localRoster.findIndex((team) => team.id === button.dataset.removeLocal);
          if (index > 0 && localRoster.length > 2) {
            delete localTeams[localRoster[index].id];
            localRoster.splice(index, 1);
            renderPanel();
          }
        };
      });
    }
    const savedRoom = new URL(location.href).searchParams.get("room");
    if (selectedMode === "online" && savedRoom && savedSeat(savedRoom)) {
      panel.insertAdjacentHTML("beforeend", `<button class="secondary-button" id="rejoin-button" ${busy ? "disabled" : ""}>Rejoin your team</button>`);
      $("rejoin-button").onclick = () => void connectOnline(savedRoom, true);
    }
    $("start-button").onclick = () => {
      if (!validSetup()) return;
      saveName();
      unlockAudio();
      if (selectedMode === "online") void connectOnline();
      else startLocal();
    };
    if (selectedMode === "online")
      $("join-button").onclick = () => {
        saveName();
        let value = $<HTMLInputElement>("room-code-input").value.trim();
        try {
          value = new URL(value).searchParams.get("room") || value;
        } catch {}
        void connectOnline(value);
      };
  } else if (screen === "lobby" && lobby) {
    const host = lobby.hostId === network?.sessionId;
    const ready = lobby.players.filter((p) => p.connected).length;
    const full = typeof lobby.maxTeams === "number" && lobby.players.length >= lobby.maxTeams;
    const teamCount = `${lobby.players.length}${typeof lobby.maxTeams === "number" ? `/${lobby.maxTeams}` : ""} TEAMS`;
    panel.innerHTML = `<div class="panel-title"><h2>Build your teams.</h2><span class="tiny-tag">${teamCount}</span></div><div class="session-title"><i class="live-dot"></i> Private room · no accounts</div><div class="room-code"><code>${escapeHtml(lobby.roomId)}</code><button class="copy-button" id="copy-invite">Copy invite</button></div>${mineSettingsMarkup(lobby.mineCount ?? DEFAULT_MINE_COUNT, host)}<div class="roster">${lobby.players.map((p) => `<div class="lobby-team"><div class="player-row"><span class="avatar" style="color:${p.color}">♟</span><div class="player-info"><strong>${escapeHtml(p.name)}${p.id === network?.sessionId ? " · you" : ""}</strong><small>${p.bot ? "AI bot · ready" : !p.connected ? "Offline · seat saved" : p.id === lobby?.hostId ? "Room host" : "Ready for trouble"}</small></div>${host && p.bot ? `<button class="remove-team" data-remove-bot="${escapeHtml(p.id)}" aria-label="Remove ${escapeHtml(p.name)}">Remove bot</button>` : ""}</div>${settingsMarkup(p.id, p.name, p, host)}</div>`).join("")}</div>${host ? `<button class="secondary-button" id="add-bot" ${full ? "disabled" : ""}>${full ? "Server team capacity reached" : "Add bot"}</button>` : ""}<p class="waiting">${ready < 2 ? host ? "Add a bot or invite a friend. Two ready teams are needed to start." : "The host can add a bot or invite another player to start." : host ? "Choose starting mines, each team’s frogs and HP, then start when ready." : "The host chooses starting mines, each team’s frogs and HP."} Living frogs take turns in order.</p><button class="primary-button" id="launch-room" ${!host || ready < 2 ? "disabled" : ""}>${host ? "Start the match" : "Waiting for host"} <span>↗</span></button><button class="secondary-button" id="leave-button">Leave room</button>`;
    $("copy-invite").onclick = copyInvite;
    if (host) {
      $("add-bot").onclick = () => { if (validSetup()) network?.addBot(); };
      panel.querySelectorAll<HTMLButtonElement>("[data-remove-bot]").forEach((button) => {
        button.onclick = () => network?.removeBot(button.dataset.removeBot!);
      });
    }
    $("launch-room").onclick = () => { if (validSetup()) network?.start(); };
    $("leave-button").onclick = () => void leaveToMenu();
  } else {
    panel.innerHTML = `<div class="panel-title"><h2>The troublemakers.</h2><span class="tiny-tag">${modeLabel()}</span></div><div class="session-title"><i class="live-dot"></i> ${network ? "Connected · server rules" : selectedMode === "practice" ? "Your very own testing ground" : state.teams.some((team) => team.bot) ? "Local match · AI bots play their own turns" : "Pass the device each turn"}</div><div class="roster" id="roster">${rosterMarkup()}</div><div class="weapon-card"><div class="weapon-label" id="weapon-label">YOUR STASH · UNUSED AMMO CARRIES</div><div class="weapon-name" id="weapon-name">Crate required</div><div class="weapon-note" id="weapon-note">Find a crate to get your hands on something irresponsible.</div></div>${network ? '<button class="secondary-button" id="copy-invite">Copy room link</button>' : ""}<button class="secondary-button" id="leave-button">${network ? "Leave match · forfeit team" : "Back to camp"}</button>`;
    $("leave-button").onclick = () => void leaveToMenu();
    if (network) $("copy-invite").onclick = copyInvite;

  }
  updateHud(true);
}
$("inventory").onclick = (event) => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-weapon]");
  if (button && !button.disabled) {
    command({ type: "selectWeapon", weapon: button.dataset.weapon as WeaponId });
    tool = "weapon";
    toggleArsenal(false);
    updateHud(true);
  }
};
$("arsenal-search").addEventListener("input", (event) => {
  arsenalQuery = (event.target as HTMLInputElement).value.trim().toLowerCase();
  updateHud(true);
});
$("arsenal-category").addEventListener("change", (event) => {
  arsenalCategory = (event.target as HTMLSelectElement).value;
  updateHud(true);
});
$("arsenal-panel").addEventListener("keydown", (event) => {
  // Native Enter/Space activation and typing must not trigger arena shortcuts.
  event.stopPropagation();
  if (event.key === "Escape") {
    event.preventDefault();
    event.stopPropagation();
    toggleArsenal(false);
  } else if (event.key.toLowerCase() === "b" && !(event.target instanceof HTMLInputElement) &&
      !(event.target instanceof HTMLSelectElement)) {
    event.preventDefault();
    toggleArsenal(false);
  } else if (event.key === "Tab") {
    const focusable = [...$("arsenal-panel").querySelectorAll<HTMLElement>("button:not(:disabled), input, select")];
    const first = focusable[0], last = focusable.at(-1);
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last?.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first?.focus();
    }
  }
});
function syncMenu() {
  $("menu-overlay").hidden = screen === "playing" && !menuOpen;
  $("resume-button").hidden = screen !== "playing";
  $("menu-button").setAttribute("aria-expanded", String(menuOpen || screen !== "playing"));
}
function toggleMenu() {
  if (screen !== "playing") return;
  clearInputs();
  toggleArsenal(false);
  menuOpen = !menuOpen;
  syncMenu();
  updateHud(true);
  if (menuOpen) $("resume-button").focus();
  else canvas.focus();
}
$("menu-button").onclick = toggleMenu;
$("resume-button").onclick = toggleMenu;

function startLocal() {
  clearInputs();
  engine = new GameEngine({
    mode: selectedMode === "practice" ? "practice" : "versus",
    seed: crypto.getRandomValues(new Uint32Array(1))[0],
    mineCount: selectedMode === "local" ? localMineCount : DEFAULT_MINE_COUNT,
    players: selectedMode === "local"
      ? localRoster.map((team) => ({ ...team, name: team.id === "p1" ? playerName : team.name, ...localTeams[team.id] }))
      : [{ id: "p1", name: playerName }, { id: "p2", name: "Target practice" }],
  });
  state = engine.state;
  screen = "playing";
  tool = "grapple";
  resetObserved();
  renderPanel();
  canvas.focus();
}
function resetObserved() {
  localBots = new BotController();
  clearInputs();
  arsenalOpen = false;
  $("arsenal-panel").hidden = true;
  $("arsenal-button").setAttribute("aria-expanded", "false");
  camera = null;
  pointer = null;
  touchAimDirection = touchEnabled ? defaultTouchAim() : null;
  aim = { x: (active()?.x ?? 220) + 200, y: (active()?.y ?? 1582) - 220 };
  previousCrates = state.crates.length;
  previousCrateIds = new Set(state.crates.map((crate) => crate.id));
  revealedCrates = new Set();
  previousTurn = state.turn;
  previousPhase = state.phase;
  previousSignature = "";
  soundDirector.reset(state);
}
async function connectOnline(roomId?: string, rejoin = false) {
  if (busy) return;
  if (roomId !== undefined && !roomId) {
    announce("Paste a room code or your friend’s invite link.");
    return;
  }
  busy = true;
  renderPanel();
  let matchEpoch: string | undefined;
  let resetAudioOnState = false;
  const connection = new RoomConnection({
    onLobby(next) {
      if (network !== connection) return;
      const mineOnlyUpdate = screen === "lobby" && lobby !== null &&
        JSON.stringify({ ...lobby, mineCount: next.mineCount }) === JSON.stringify(next);
      lobby = next;
      if (!next.started) {
        // Keep buttons mounted when a mine-setting echo arrives between mouse down and up.
        const mineField = $<HTMLInputElement>("starting-mines");
        if (mineOnlyUpdate && mineField) {
          if (document.activeElement !== mineField)
            mineField.value = String(next.mineCount ?? DEFAULT_MINE_COUNT);
          return;
        }
        screen = "lobby";
        renderPanel();
      }
    },
    onState(next) {
      if (network !== connection) return;
      const epoch = (next as ServerState).net?.epoch;
      const changed = screen !== "playing" || (epoch !== undefined && epoch !== matchEpoch);
      matchEpoch = epoch;
      awaitingSoundState = false;
      screen = "playing";
      engine = null;
      if (changed) {
        state = next;
        resetObserved();
        renderPanel();
      }
      if (resetAudioOnState) { soundDirector.reset(next); resetAudioOnState = false; }
      soundDirector.observe(next, soundListener(), soundAudible());
      // The camera, HP and outcome HUD all use the same presented network frame.
      if (changed) updateHud(true);
    },
    onClose(reason) {
      if (network !== connection) return;
      network = null;
      lobby = null;
      screen = "menu";
      engine = new GameEngine({ mode: "practice" });
      state = engine.state;
      soundDirector.reset(state);
      renderPanel();
      announce(reason);
    },
    onConnection(connected) {
      if (network !== connection) return;
      clearInputs();
      awaitingSoundState = true;
      if (!connected) { audio.reset(); resetAudioOnState = true; }
      $("connection-status").textContent = connected ? "CONNECTED TO THE SCRAPYARD" : "RECONNECTING · YOUR TEAM’S TURNS ARE SKIPPED";
      updateHud(true);
    },
    onError(message) {
      announce(message);
    },
  });
  network = connection;
  try {
    if (roomId && rejoin) await connection.rejoin(roomId);
    else if (roomId) await connection.join(roomId, playerName);
    else await connection.create(playerName);
    engine = null;
    if (screen !== "playing") screen = "lobby";
    const url = new URL(location.href);
    url.searchParams.set("room", connection.roomId);
    history.replaceState(null, "", url);
    $("connection-status").textContent = "CONNECTED TO THE SCRAPYARD";
    if (lobby) renderPanel();
  } catch (error) {
    network = null;
    lobby = null;
    screen = "menu";
    announce(
      error instanceof Error
        ? error.message
        : "Could not connect. Check that the room server is running.",
    );
  } finally {
    busy = false;
    renderPanel();
  }
}
async function copyInvite() {
  const url = new URL(location.href);
  url.searchParams.set("room", network?.roomId || lobby?.roomId || "");
  try {
    await navigator.clipboard.writeText(url.href);
    announce("Invite copied. Send it to your fellow troublemakers.");
  } catch {
    announce(`Room code: ${network?.roomId || lobby?.roomId}`);
  }
}
async function leaveToMenu() {
  clearInputs();
  if (network) {
    const old = network;
    network = null;
    await old.leave();
  }
  lobby = null;
  screen = "menu";
  engine = new GameEngine({
    mode: "practice",
    players: [
      { id: "p1", name: playerName },
      { id: "p2", name: "Rusty" },
    ],
  });
  state = engine.state;
  history.replaceState(null, "", location.pathname);
  resetObserved();
  renderPanel();
  $("connection-status").textContent = "THE SCRAPYARD IS OPEN";
}
function restart() {
  if (screen !== "playing") return;
  if (network) {
    if (lobby?.hostId === network.sessionId) network.restart();
    else announce("Your room host can start a rematch.");
  } else startLocal();
}
function updateHud(force = false) {
  const now = performance.now();
  if (!force && now - lastHud < 90) return;
  lastHud = now;
  const running = screen === "playing",
    p = active();
  touchControls.update({
    visible: touchEnabled && running && !menuOpen && !arsenalOpen && $("guide").hidden && state.phase !== "finished",
    enabled: canControl() && !arsenalOpen,
    canFire: state.phase === "playing" && !!p?.hasCrate,
    hooked: !!p?.rope,
  });
  $("hud").hidden = !running;
  $("match-over").hidden = !running || state.phase !== "finished";
  $("grapple-tool").classList.toggle("active", tool === "grapple");
  $("weapon-tool").classList.toggle("active", tool === "weapon");
  $<HTMLButtonElement>("grapple-tool").disabled = !canControl();
  $<HTMLButtonElement>("weapon-tool").disabled = !canControl() || state.phase !== "playing";
  $<HTMLButtonElement>("arsenal-button").disabled = !canControl() || state.phase !== "playing";
  $<HTMLButtonElement>("end-turn").disabled = !canControl();
  $<HTMLButtonElement>("reset-button").disabled = !running || !!network;
  $("weapon-tool-label").textContent = p?.hasCrate
    ? weaponName(p.weapon)
    : "Find a crate";
  $("arsenal-panel").hidden = !running || !arsenalOpen || menuOpen;
  if (!running) {
    $("objective-toast").textContent = "";
    return;
  }
  if (!p) return;
  const statuses = (p.statuses ?? []).filter((status) => status.remaining > 0);
  const statusSignature = statuses.map((status) => `${status.kind}:${Math.ceil(status.remaining)}`).join("|");
  const statusList = $("active-statuses");
  statusList.hidden = !statuses.length;
  if (statusList.dataset.signature !== statusSignature) {
    statusList.dataset.signature = statusSignature;
    statusList.innerHTML = statuses.map((status) => {
      const effect = STATUS_PRESENTATION[status.kind];
      return `<span class="status-chip" style="--effect-color:${effect.color}" title="${escapeHtml(effect.hint)} · ${Math.ceil(status.remaining)} seconds of this frog’s control"><span aria-hidden="true">${effect.glyph}</span> ${effect.label} <b>${Math.ceil(status.remaining)}s</b></span>`;
    }).join("");
  }
  const reveal = state.phase === "damage" ? state.resolution?.reveal : null;
  const outcomePlayer = reveal && state.players.find((frog) => frog.id === reveal.playerId);
  const resolving = state.phase === "settling" || state.phase === "damage";
  $("turn-player").textContent =
    outcomePlayer ? outcomePlayer.name
    : resolving ? "Watch the fallout."
    : network && p.teamId !== network.sessionId
      ? `${p.name}’s turn`
      : selectedMode === "practice"
        ? "Find your swing."
        : `${p.name}’s turn`;
  $("turn-caption").textContent =
    state.phase === "damage" ? "TURN OUTCOMES · DAMAGE REVEAL"
    : state.phase === "settling" ? "IMPACT · CONTROLS LOCKED"
    : state.phase === "retreat"
      ? `${botTurn() ? "AI BOT · " : ""}SHOT SENT · RETREAT`
      : botTurn()
        ? `AI BOT · TURN ${String(state.turn).padStart(2, "0")}`
      : selectedMode === "practice"
        ? "PRACTICE · NO PRESSURE"
        : `TURN ${String(state.turn).padStart(2, "0")} · ${p.hasCrate ? "ARMED & DANGEROUS" : "CRATE REQUIRED"}`;
  $("timer").textContent =
    resolving ? "···"
    : selectedMode === "practice" && state.phase === "playing"
      ? "∞"
      : String(Math.max(0, Math.ceil(state.timeLeft))).padStart(2, "0");
  $("timer").classList.toggle(
    "urgent",
    !resolving && state.timeLeft < 10 && selectedMode !== "practice",
  );
  $("objective-toast").textContent =
    network && !network.isConnected
      ? "Reconnecting… Your team’s turns are skipped."
      : state.phase === "waiting"
        ? "Waiting for a team to reconnect…"
      : state.phase === "damage"
        ? "Turn outcomes · Each frog takes its damage in turn."
      : state.phase === "settling"
        ? "Let them fly. Damage is counted when the mayhem stops."
      : !canControl() && state.phase !== "finished"
        ? `${p.name} is making a move. Your turn is coming.`
        : state.phase === "retreat"
          ? "Delivery made! Retreat before the impact."
          : "";
  if ($("roster")) {
    const signature =
      state.players
        .map((q) => `${q.id}:${q.name}:${q.hp}:${q.alive}`)
        .join("|") + state.activePlayerId + state.teams.map((team) => `${team.id}:${team.connected}`).join("|");
    if (signature !== previousSignature) {
      $("roster").innerHTML = rosterMarkup();
      previousSignature = signature;
    }
    $("weapon-name").textContent = p.hasCrate
      ? weaponName(p.weapon)
      : state.phase === "retreat"
        ? "Special delivery."
        : "Crate required";
    $("weapon-note").textContent = p.hasCrate && p.weapon
      ? WEAPON_CATALOG[p.weapon].description
      : state.phase === "retreat"
        ? "You’ve got a few seconds to make yourself scarce."
        : "Find a crate to get your hands on something irresponsible.";
    const inv = p.inventory;
    const invSignature = `${p.id}:${p.weapon}:${WEAPONS.map((w) => inv[w.id]).join(":")}:${canControl()}:${state.phase}:${arsenalQuery}:${arsenalCategory}`;
    const inventory = $("inventory");
    if (inventory && inventory.dataset.signature !== invSignature) {
      inventory.dataset.signature = invSignature;
      const matches = WEAPONS.filter((w) => (arsenalCategory === "all" || w.category === arsenalCategory) &&
        `${w.name} ${w.description} ${w.category} ${weaponEffectDetails(w).join(" ")}`.toLowerCase().includes(arsenalQuery));
      $("arsenal-results").textContent = `${matches.length} of ${WEAPONS.length} weapons · effects count down on the victim’s turn`;
      inventory.innerHTML = matches.length ? [...new Set(matches.map((w) => w.category))].map((category) =>
        `<section class="arsenal-group"><h3>${category} <span>${matches.filter((w) => w.category === category).length}</span></h3><div class="arsenal-grid">${matches.filter((w) => w.category === category).map((w) => {
          const effects = weaponEffectDetails(w);
          return `<button class="ammo-slot ${p.weapon === w.id ? "selected" : ""}" data-weapon="${w.id}" aria-pressed="${p.weapon === w.id}" title="${escapeHtml(w.description)}" aria-label="Select ${escapeHtml(w.name)}, ${inv[w.id] ?? 0} rounds${effects.length ? `, ${escapeHtml(effects.join(", "))}` : ""}" ${!canControl() || state.phase !== "playing" || !(inv[w.id] > 0) ? "disabled" : ""}><span class="weapon-icon" style="color:${w.color}" aria-hidden="true">${w.icon}</span><span class="ammo-copy"><strong>${escapeHtml(w.name)}</strong><small>${escapeHtml(w.description)}</small>${effects.length ? `<span class="weapon-effects">${effects.map((effect) => `<span>${escapeHtml(effect)}</span>`).join("")}</span>` : ""}</span><b class="ammo-count">${inv[w.id] ?? 0}</b></button>`;
        }).join("")}</div></section>`).join("") : '<p class="arsenal-empty">No weapons match. Try an effect like “gravity”, “rope”, or “poison”.</p>';
    }
  }
  if (state.phase === "finished") {
    $("winner-name").textContent = state.winnerId
      ? `${state.teams.find((q) => q.id === state.winnerId)?.name || "A team"} wins.`
      : "Everybody splashed.";
    $<HTMLButtonElement>("rematch-button").disabled =
      !!network && lobby?.hostId !== network.sessionId;
  }
}
function weaponName(w: WeaponId | null | undefined) {
  return w ? WEAPON_CATALOG[w].name : "Empty pockets";
}
function detectEvents() {
  if (screen !== "playing") return;
  if (state.phase !== previousPhase) {
    if (state.phase !== "playing" && state.phase !== "retreat") {
      toggleArsenal(false);
      clearInputs();
    }
    if (state.phase !== "playing") cancelCharge();
    previousPhase = state.phase;
  }
  const crateIds = new Set(state.crates.map((crate) => crate.id));
  const pickups = [...previousCrateIds].filter((id) => !crateIds.has(id) && !revealedCrates.has(id));
  if (state.turn === previousTurn && state.crates.length < previousCrates && pickups.length) {
    pickups.forEach((id) => revealedCrates.add(id));
    announce(
      canControl()
        ? state.message
        : `${active()?.name ?? "A frog"} collected supplies.`,
    );
  }
  previousCrates = state.crates.length;
  previousCrateIds = crateIds;
  // Predicted states can rewind; only the server callback plays online one-shots.
  if (!network) soundDirector.observe(state, soundListener(), soundAudible());
  if (state.turn !== previousTurn) {
    toggleArsenal(false);
    clearInputs();
    tool = "grapple";
    previousTurn = state.turn;
  }
  if (!active()?.hasCrate) tool = "grapple";
}
function updateAim(event: PointerEvent) {
  const r = canvas.getBoundingClientRect();
  touchAimDirection = null;
  pointer = { x: (event.clientX - r.left) / r.width, y: (event.clientY - r.top) / r.height };
  refreshAim();
  // A tap marks a world position; a released finger is not a mouse cursor.
  if (event.pointerType === "touch") pointer = null;
}
function refreshAim() {
  const player = active();
  if (touchAimDirection && player) {
    aim = { x: player.x + touchAimDirection.x * GRAPPLE_RANGE, y: player.y + touchAimDirection.y * GRAPPLE_RANGE };
  } else if (camera && pointer) aim = screenToWorld(camera, {
    x: pointer.x * viewport.width, y: pointer.y * viewport.height,
  });
}
function beginCharge() {
  if (!canControl() || arsenalOpen || state.phase !== "playing" || !active()?.hasCrate) return;
  chargingAt = performance.now();
  $("charging").hidden = false;
}
function cancelCharge() {
  chargingAt = null;
  $("charging").hidden = true;
}
function finishCharge() {
  if (chargingAt === null) return;
  const power = Math.min(1, 0.25 + (performance.now() - chargingAt) / 1100);
  cancelCharge();
  refreshAim();
  if (command({ type: "fire", power })) tool = "grapple";
}
canvas.addEventListener("pointermove", (event) => {
  if (!canControl() || arsenalOpen) return;
  if (event.pointerType === "touch" && event.pointerId !== canvasPointer) return;
  updateAim(event);
});
canvas.addEventListener("contextmenu", (e) => e.preventDefault());
canvas.addEventListener("pointerdown", (e) => {
  e.preventDefault();
  unlockAudio();
  canvas.focus();
  if (!canControl() || arsenalOpen || canvasPointer !== null) return;
  canvasPointer = e.pointerId;
  updateAim(e);
  canvas.setPointerCapture(e.pointerId);
  // Touch players aim independently of their dedicated attack buttons.
  if (e.pointerType === "touch") return;
  if (e.button === 2 || tool === "grapple") {
    hook();
    return;
  }
  beginCharge();
});
canvas.addEventListener("pointerup", (e) => {
  if (e.pointerId !== canvasPointer) return;
  updateAim(e);
  canvasPointer = null;
  if (e.pointerType !== "touch") finishCharge();
  if (canvas.hasPointerCapture(e.pointerId))
    canvas.releasePointerCapture(e.pointerId);
});
function cancelCanvasPointer(event: PointerEvent) {
  if (event.pointerId !== canvasPointer) return;
  canvasPointer = null;
  cancelCharge();
}
canvas.addEventListener("pointercancel", cancelCanvasPointer);
canvas.addEventListener("lostpointercapture", cancelCanvasPointer);
window.addEventListener("keydown", (e) => {
  if (
    e.target instanceof HTMLInputElement ||
    e.target instanceof HTMLTextAreaElement ||
    e.target instanceof HTMLSelectElement
  )
    return;
  if (!$("guide").hidden) {
    if (e.key === "Escape") closeGuide();
    return;
  }
  const key = e.key.toLowerCase();
  if (screen === "playing" && !menuOpen &&
    [" ", "arrowup", "arrowdown", "arrowleft", "arrowright", "enter"].includes(
      key,
    )
  )
    e.preventDefault();
  if (key === "escape") {
    if (arsenalOpen) { toggleArsenal(false); return; }
    toggleMenu();
    return;
  }
  if (key === "f") {
    void fullscreen();
    return;
  }
  if (key === "b" && screen === "playing" && !menuOpen && !e.repeat) {
    toggleArsenal();
    return;
  }
  if (e.repeat) return;
  if (!canControl() || arsenalOpen) return;
  keys.add(key);
  unlockAudio();
  if (key === "1") setTool("grapple");
  else if (key === "2") setTool("weapon");
  else if (key === " ") hook();
  else if (key === "enter") enterJump();
  else if ((key === "w" || key === "arrowup") && !active()?.rope)
    command({ type: "jump" });
  else if (key === "shift") command({ type: "jump" });
});
window.addEventListener("keyup", (e) => keys.delete(e.key.toLowerCase()));
window.addEventListener("blur", () => {
  audioFocused = false;
  audio.setSuspended(true);
  clearInputs();
  $("charging").hidden = true;
});
window.addEventListener("focus", () => {
  audioFocused = true;
  audio.setSuspended(document.hidden);
});
document.addEventListener("visibilitychange", () => {
  audio.setSuspended(document.hidden || !audioFocused);
  if (document.hidden) clearInputs();
});
function enterJump() {
  const now = performance.now();
  const double = now - lastEnter <= DOUBLE_JUMP_SECONDS * 1000;
  const accepted = command({ type: double ? "backflip" : "jump" });
  lastEnter = !double && accepted ? now : -Infinity;
}
$("grapple-tool").onclick = () => setTool("grapple");
$("weapon-tool").onclick = () => setTool("weapon");
$("arsenal-button").onclick = () => toggleArsenal();
$("close-arsenal").onclick = () => toggleArsenal(false);
$("end-turn").onclick = () => command({ type: "endTurn" });
$("reset-button").onclick = restart;
$("rematch-button").onclick = restart;
async function fullscreen() {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await app.requestFullscreen();
  } catch {
    announce("Fullscreen isn’t available in this browser.");
  }
}
$("fullscreen-button").onclick = () => void fullscreen();
$("sound-button").onclick = () => {
  sound = !sound;
  updateSound();
  unlockAudio();
  try {
    localStorage.setItem("raf-sound", String(sound));
  } catch {}
  playSound("ui");
};
let guideReturnFocus: HTMLElement | null = null;
function openGuide() {
  guideReturnFocus = document.activeElement as HTMLElement;
  clearInputs();
  $("guide").hidden = false;
  updateHud(true);
  $("close-guide").focus();
}
function closeGuide() {
  $("guide").hidden = true;
  updateHud(true);
  guideReturnFocus?.focus();
}
$("guide-button").onclick = openGuide;
$("close-guide").onclick = closeGuide;
$("guide-done").onclick = closeGuide;
$("guide").onclick = (e) => {
  if (e.target === $("guide")) closeGuide();
};
$("guide").addEventListener("keydown", (e) => {
  if (e.key !== "Tab") return;
  const els = Array.from($("guide").querySelectorAll<HTMLElement>("button"));
  const i = els.indexOf(document.activeElement as HTMLElement);
  if (e.shiftKey && i === 0) {
    e.preventDefault();
    els.at(-1)?.focus();
  } else if (!e.shiftKey && i === els.length - 1) {
    e.preventDefault();
    els[0]?.focus();
  }
});
// Browsers may omit a click for a second finger while the movement thumb is held.
// Activate ordinary UI buttons on that finger's press; the pads own their events.
const secondaryPresses = new WeakMap<HTMLButtonElement, { pointerId: number; until: number }>();
document.addEventListener("pointerdown", (event) => {
  if (event.pointerType !== "touch" || event.isPrimary) return;
  const button = event.target instanceof Element ? event.target.closest<HTMLButtonElement>("button") : null;
  if (!button || button.disabled || button.closest(".touch-controls")) return;
  event.preventDefault();
  secondaryPresses.set(button, { pointerId: event.pointerId, until: performance.now() + 800 });
  button.click();
}, { capture: true });
document.addEventListener("click", (event) => {
  if (!event.isTrusted) return;
  const button = event.target instanceof Element ? event.target.closest<HTMLButtonElement>("button") : null;
  const press = button && secondaryPresses.get(button);
  if (!press || performance.now() > press.until) return;
  if (event instanceof PointerEvent && event.pointerId !== press.pointerId) return;
  event.preventDefault();
  event.stopImmediatePropagation();
}, { capture: true });
function frame(now: number) {
  const dt = Math.min((now - prevTime) / 1000, 0.05);
  prevTime = now;
  accumulated += dt;
  refreshAim();
  if (engine && screen === "playing" && !menuOpen && $("guide").hidden) {
    syncInput();
    localBots.update(engine, dt);
    engine.step(dt);
    state = engine.state;
  } else if (network && screen === "playing") {
    syncInput();
    state = network.frame(dt, now) ?? state;
  }
  detectEvents();
  const power =
    chargingAt === null ? 0.65 : Math.min(1, 0.25 + (now - chargingAt) / 1100);
  if (chargingAt !== null) $("power-fill").style.width = `${power * 100}%`;
  const renderedState = state;
  camera = followCamera(camera, renderedState, viewport.width, viewport.height, dt, touchEnabled);
  refreshAim();
  const canAim = canControl();
  canvas.classList.toggle("can-aim", canAim);
  renderGame(ctx, renderedState, {
    camera,
    viewport,
    time: accumulated,
    aim: canAim ? aim : undefined,
    tool,
    power,
    menu: screen !== "playing",
    reducedMotion: reducedMotion.matches,
    visionEffects: canAim && !arsenalOpen,
  });
  soundDirector.update(renderedState, dt, {
    audible: soundAudible(), listener: soundListener(),
    charge: chargingAt === null ? 0 : power,
  });
  updateHud();
  requestAnimationFrame(frame);
}
function resizeCanvas() {
  clearInputs();
  pointer = null;
  camera = null;
  const rect = canvas.getBoundingClientRect();
  viewport = { width: rect.width, height: rect.height, dpr: Math.min(devicePixelRatio || 1, 2) };
  canvas.width = Math.round(rect.width * viewport.dpr);
  canvas.height = Math.round(rect.height * viewport.dpr);
}
new ResizeObserver(resizeCanvas).observe(canvas);
resizeCanvas();
updateSound();
renderPanel();
requestAnimationFrame(frame);
// Read-only, compact snapshot for browser verification and accessibility tooling.
Object.assign(window, {
  render_game_to_text: () =>
    JSON.stringify({
      screen,
      playMode: selectedMode,
      roomId: network?.roomId || null,
      sessionId: network?.sessionId || null,
      tool,
      coordinateSystem: `x right, y down; ${state.width} × ${state.height}`,
      camera,
      aim,
      viewport,
      sound: { ...audio.diagnostics },
      controls: { touch: touchEnabled, enabled: canControl(), charging: chargingAt !== null, input: input() },
      ...state,
    }),
});
if (import.meta.env.DEV)
  Object.assign(window, {
    advanceTime: (ms: number) => {
      if (!engine || screen !== "playing" || menuOpen || !$("guide").hidden) return;
      syncInput();
      for (let i = 0; i < Math.ceil(ms / (1000 / 120)); i++) {
        localBots.update(engine, 1 / 120);
        engine.step(1 / 120);
      }
      state = engine.state;
      detectEvents();
      updateHud(true);
    },
  });
const invite = new URL(location.href).searchParams.get("room");
if (invite) {
  selectedMode = "online";
  renderPanel();
  $<HTMLInputElement>("room-code-input").value = invite;
  if (savedSeat(invite)) void connectOnline(invite, true);
  else announce("You’ve been invited. Choose a callsign and click Join.");
}
