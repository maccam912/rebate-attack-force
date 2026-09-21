import "./style.css";
import { GameEngine } from "../shared/game";
import type {
  GameState,
  PlayerInput,
  GameCommand,
  WeaponId,
} from "../shared/types";
import { renderGame } from "./renderer";
import { followCamera, screenToWorld, type Camera } from "./camera";
import { RoomConnection, type LobbyState } from "./network";

const logo = `<svg viewBox="0 0 64 64" fill="none" aria-hidden="true"><path d="M5 30 17 8l16 5 15-3 11 22-8 22H17Z" fill="#cde47b"/><path d="M17 40c-5-17 5-24 15-18 11-7 22 3 17 18-9 10-24 10-32 0Z" fill="#18372a"/><circle cx="24" cy="27" r="5" fill="#e5ebbd"/><circle cx="41" cy="27" r="5" fill="#e5ebbd"/><circle cx="25" cy="27" r="2" fill="#18372a"/><circle cx="40" cy="27" r="2" fill="#18372a"/><path d="M27 38q6 5 12-1" stroke="#d0e77e" stroke-width="2" stroke-linecap="round"/><path d="m9 47-5 9 15-2M51 50l8 7 3-15" fill="#cde47b"/></svg>`;
const app = document.querySelector<HTMLDivElement>("#app")!;
app.innerHTML = `
<main class="arena" id="arena" aria-label="Rebate Attack Force">
  <canvas id="game" tabindex="0" aria-label="Scrapyard arena. A and D to move, W to jump, mouse and Space to grapple, 2 for weapons. Escape opens the menu."></canvas>
  <div class="arena-top-tools">
    <button class="icon-button" id="menu-button" aria-label="Open game menu" aria-expanded="false">☰</button>
    <button class="icon-button" id="guide-button" aria-label="Field guide" title="Controls">?</button>
    <button class="icon-button" id="sound-button" aria-label="Enable sound"><span id="sound-icon">◌</span><span id="sound-label" class="sr-only">Sound off</span></button>
    <button class="icon-button" id="reset-button" title="Restart local match" aria-label="Restart local match">↻</button>
    <button class="icon-button" id="fullscreen-button" title="Fullscreen (F)" aria-label="Toggle fullscreen">⛶</button>
  </div>
  <div class="hud" id="hud" hidden><div><div class="turn-player" id="turn-player"></div><div class="turn-caption" id="turn-caption"></div></div><div class="timer" id="timer"></div></div>
  <div class="objective-toast" id="objective-toast"></div>
  <div class="charging-indicator" id="charging" hidden>SHOT POWER<div class="power-meter"><div id="power-fill"></div></div></div>
  <div class="arena-bottom"><div class="toolbelt"><button class="tool-button active" id="grapple-tool"><span class="key">1</span> Grapple</button><button class="tool-button" id="weapon-tool"><span class="key">2</span> <span id="weapon-tool-label">Find a crate</span></button><div class="inventory" id="inventory"></div></div><button class="end-turn" id="end-turn">End turn <span class="key">↵</span></button></div>
  <div class="touch-controls" aria-label="Touch controls"><button data-hold="left" aria-label="Move left">←</button><button data-hold="right" aria-label="Move right">→</button><button id="touch-jump">Jump</button><button data-hold="up">Reel ↑</button><button data-hold="down" aria-label="Pay out rope">↓</button><button id="touch-hook">Hook</button></div>
  <div class="menu-backdrop" id="menu-overlay"><section class="panel menu-panel" aria-label="Game menu"><div class="menu-brand">${logo}<h1>REBATE <span>ATTACK FORCE</span></h1></div><button class="secondary-button" id="resume-button" hidden>Resume game <span>Esc</span></button><div id="play-panel"></div><div class="connection-status" id="connection-status">THE SCRAPYARD IS OPEN</div></section></div>
  <div class="match-over" id="match-over" hidden><div><div class="eyebrow">THE SCRAPYARD HAS SPOKEN</div><h2 id="winner-name"></h2><button class="primary-button" id="rematch-button">Run it back <span>↗</span></button></div></div>
</main>
<div class="dialog-backdrop" id="guide" hidden><section class="dialog" role="dialog" aria-modal="true" aria-labelledby="guide-title"><button class="dialog-close" id="close-guide" aria-label="Close guide">×</button><div class="eyebrow">SCRAPYARD SURVIVAL MANUAL</div><h2 id="guide-title">A tongue is all you need.<br>Until it isn’t.</h2><p>Last frog standing wins. You get 45 seconds to move, gather supplies, and fire one weapon. Unused ammo carries over, so a stocked frog can attack without finding another crate. After firing, you have 10 seconds to retreat. Water is a one-way trip.</p><div class="guide-grid"><div class="guide-item"><strong>01 / Get moving</strong>A / D to walk and pump a swing. W or ↑ to jump on the ground. W / S to shorten or extend an attached rope.</div><div class="guide-item"><strong>02 / Find your arc</strong>Aim at any platform and click or press Space. Press again to let go. Hooks reach 680px. Ropes wrap around corners and unwind as you swing back. Keep your speed when you release.</div><div class="guide-item"><strong>03 / Make a delivery</strong>Touch crates to stock up on rockets, grenades, or close-range pulses. Choose a weapon in your stash, press 2, aim, hold to charge, then release.</div><div class="guide-item"><strong>04 / Bring your friends</strong>Frogs are solid: push, jump onto, or stomp them from above to send them rolling. Local mode shares a keyboard. Online mode gives you a private room link for 2–4 players. The host starts once everyone is in.</div></div><p>Practice keeps you in control and respawns your target. These maps and frogs are original. Sound effects are CC0 by Kenney.</p><button class="primary-button" id="guide-done">Got it. Let’s make trouble. <span>↗</span></button></section></div><div class="global-toast" id="global-toast" role="status" aria-live="polite"></div>`;

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
let sound = false;
let playerName = "Sprout";
let busy = false;
let aim = { x: 440, y: 1400 };
let pointer: { x: number; y: number } | null = null;
let camera: Camera | null = null;
let viewport = { width: innerWidth, height: innerHeight, dpr: 1 };
let menuOpen = false;
const keys = new Set<string>();
let chargingAt: number | null = null;
let toastTimer = 0;
let prevTime = performance.now(),
  accumulated = 0,
  lastSend = 0,
  lastHud = 0;
let soundsReady = false;
let previousCrates = state.crates.length;
let previousProjectiles = new Set<string>();
let previousExplosions = new Set<string>();
let previousTurn = state.turn;
let previousRope = false;
let previousSignature = "";
const displayedPlayers = new Map<string, { x: number; y: number }>();
const audio = new Map<string, HTMLAudioElement>();
try {
  playerName = localStorage.getItem("raf-name") || "Sprout";
  sound = localStorage.getItem("raf-sound") === "true";
} catch {}
for (const key of ["ui", "grapple", "pickup", "shot", "explosion"]) {
  const a = new Audio(`/audio/${key}.ogg`);
  a.volume = key === "explosion" ? 0.23 : 0.3;
  a.preload = "auto";
  audio.set(key, a);
}
function unlockAudio() {
  soundsReady = true;
}
function playSound(key: string) {
  if (!sound || !soundsReady) return;
  const a = audio.get(key);
  if (a) {
    a.currentTime = 0;
    void a.play().catch(() => {});
  }
}
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
function canControl() {
  return (
    screen === "playing" &&
    !menuOpen && $("guide").hidden &&
    (state.phase === "playing" || state.phase === "retreat") &&
    (!network || network.sessionId === state.activePlayerId)
  );
}
function input(): PlayerInput {
  return {
    left: keys.has("a") || keys.has("arrowleft"),
    right: keys.has("d") || keys.has("arrowright"),
    up: keys.has("w") || keys.has("arrowup"),
    down: keys.has("s") || keys.has("arrowdown"),
    aimX: aim.x,
    aimY: aim.y,
  };
}
function currentId() {
  return network ? network.sessionId : state.activePlayerId;
}
function syncInput() {
  if (!canControl()) return;
  const i = input();
  if (network) network.input(i);
  else engine?.setInput(currentId(), i);
}
function command(c: GameCommand) {
  if (!canControl()) return false;
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
  if (!success && !p.rope)
    announce("Aim at a platform within reach, then hook again.");
}
function setTool(next: "grapple" | "weapon") {
  if (next === "weapon" && !active()?.hasCrate) {
    announce("Your pockets are empty. Pick up a supply crate to get ammo.");
    return;
  }
  tool = next;
  updateHud(true);
}
function clearInputs() {
  keys.clear();
  chargingAt = null;
  $("charging").hidden = true;
  syncInput();
}
function updateSound() {
  $("sound-icon").textContent = sound ? "♪" : "◌";
  $("sound-label").textContent = sound ? "Sound on" : "Sound off";
  $("sound-button").setAttribute(
    "aria-label",
    sound ? "Mute sound" : "Enable sound",
  );
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
      ? "LOCAL HOT-SEAT"
      : "PRIVATE ROOM";
}
function rosterMarkup() {
  return state.players
    .map(
      (p) =>
        `<div class="player-row ${p.id === state.activePlayerId ? "current-player" : ""} ${p.alive ? "" : "dead"}"><div class="avatar" style="color:${p.color}">♟</div><div class="player-info"><strong>${escapeHtml(p.name)}${network && p.id === network.sessionId ? " · you" : ""}</strong><small>${!p.alive ? "Out of the action" : p.id === state.activePlayerId ? "Making trouble" : "Biding their time"}</small></div><span class="player-hp">${Math.ceil(p.hp)}</span></div>`,
    )
    .join("");
}
function renderPanel() {
  const panel = $("play-panel");
  app.dataset.screen = screen;
  menuOpen = false;
  syncMenu();
  if (screen === "menu") {
    panel.innerHTML = `<div class="panel-title"><h2>Pick your trouble.</h2><span class="tiny-tag">LET’S PLAY</span></div><div class="mode-tabs" role="tablist" aria-label="Game mode">${(["practice", "local", "online"] as const).map((m) => `<button class="mode-tab ${m === selectedMode ? "active" : ""}" role="tab" aria-selected="${m === selectedMode}" data-mode="${m}">${m === "practice" ? "Practice" : m === "local" ? "Local" : "Online"}</button>`).join("")}</div><label class="input-label" for="player-name">YOUR CALLSIGN</label><input class="text-input" id="player-name" maxlength="20" value="${escapeHtml(playerName)}" autocomplete="nickname" placeholder="A perfectly normal frog"/><p class="mode-description">${selectedMode === "practice" ? "Find your swing. Try the weapons. Your patient target frog won’t hold a grudge." : selectedMode === "local" ? "Two frogs. One keyboard. Take turns making life difficult for a nearby friend." : "Make a private room, send the link, and bring up to three friends. No sign-up required."}</p><button class="primary-button" id="start-button" ${busy ? "disabled" : ""}>${busy ? "Connecting…" : selectedMode === "practice" ? "Start practice" : selectedMode === "local" ? "Start local match" : "Create a room"} <span>↗</span></button>${selectedMode === "online" ? '<div class="join-fields"><input class="text-input" id="room-code-input" aria-label="Room code or invite link" placeholder="Have a room code?" maxlength="200"/><button id="join-button">Join</button></div>' : ""}<div class="anonymous-note">${selectedMode === "online" ? "↗ Share a link. Skip the sign-up." : "⌁ Keyboard + mouse recommended"}</div>`;
    panel.querySelectorAll<HTMLButtonElement>("[data-mode]").forEach(
      (b) =>
        (b.onclick = () => {
          saveName();
          selectedMode = b.dataset.mode as typeof selectedMode;
          playSound("ui");
          renderPanel();
        }),
    );
    $("start-button").onclick = () => {
      saveName();
      unlockAudio();
      playSound("ui");
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
    panel.innerHTML = `<div class="panel-title"><h2>The gang’s all here?</h2><span class="tiny-tag">${lobby.players.length}/4</span></div><div class="session-title"><i class="live-dot"></i> Private room · no accounts</div><div class="room-code"><code>${escapeHtml(lobby.roomId)}</code><button class="copy-button" id="copy-invite">Copy invite</button></div><div class="roster">${lobby.players.map((p) => `<div class="player-row"><span class="avatar" style="color:${p.color}">♟</span><div class="player-info"><strong>${escapeHtml(p.name)}${p.id === network?.sessionId ? " · you" : ""}</strong><small>${p.id === lobby?.hostId ? "Room host" : "Ready for trouble"}</small></div><i class="live-dot"></i></div>`).join("")}</div><p class="waiting">${lobby.players.length < 2 ? "Send the invite to a friend. At least two frogs make a fight." : host ? "Everyone in? Start the match when you’re ready." : "Waiting for the host to start the match."}</p><button class="primary-button" id="launch-room" ${!host || lobby.players.length < 2 ? "disabled" : ""}>${host ? "Start the match" : "Waiting for host"} <span>↗</span></button><button class="secondary-button" id="leave-button">Leave room</button>`;
    $("copy-invite").onclick = copyInvite;
    $("launch-room").onclick = () => network?.start();
    $("leave-button").onclick = () => void leaveToMenu();
  } else {
    panel.innerHTML = `<div class="panel-title"><h2>The troublemakers.</h2><span class="tiny-tag">${modeLabel()}</span></div><div class="session-title"><i class="live-dot"></i> ${network ? "Connected · server rules" : selectedMode === "practice" ? "Your very own testing ground" : "Pass the keyboard each turn"}</div><div class="roster" id="roster">${rosterMarkup()}</div><div class="weapon-card"><div class="weapon-label" id="weapon-label">YOUR STASH · UNUSED AMMO CARRIES</div><div class="weapon-name" id="weapon-name">Crate required</div><div class="weapon-note" id="weapon-note">Find a crate to get your hands on something irresponsible.</div></div>${network ? '<button class="secondary-button" id="copy-invite">Copy room link</button>' : ""}<button class="secondary-button" id="leave-button">${network ? "Leave match" : "Back to camp"}</button>`;
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
    updateHud(true);
  }
};
function syncMenu() {
  $("menu-overlay").hidden = screen === "playing" && !menuOpen;
  $("resume-button").hidden = screen !== "playing";
  $("menu-button").setAttribute("aria-expanded", String(menuOpen || screen !== "playing"));
}
function toggleMenu() {
  if (screen !== "playing") return;
  clearInputs();
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
    players: [
      { id: "p1", name: playerName },
      {
        id: "p2",
        name: selectedMode === "practice" ? "Target practice" : "Rusty",
      },
    ],
  });
  state = engine.state;
  screen = "playing";
  tool = "grapple";
  resetObserved();
  renderPanel();
  canvas.focus();
}
function resetObserved() {
  camera = null;
  pointer = null;
  aim = { x: (active()?.x ?? 220) + 200, y: (active()?.y ?? 1582) - 220 };
  previousCrates = state.crates.length;
  previousProjectiles = new Set();
  previousExplosions = new Set();
  previousTurn = state.turn;
  previousRope = false;
  previousSignature = "";
}
async function connectOnline(roomId?: string) {
  if (busy) return;
  if (roomId !== undefined && !roomId) {
    announce("Paste a room code or your friend’s invite link.");
    return;
  }
  busy = true;
  renderPanel();
  const connection = new RoomConnection({
    onLobby(next) {
      if (network !== connection) return;
      lobby = next;
      if (!next.started) {
        screen = "lobby";
        renderPanel();
      } else if (screen !== "playing") {
        screen = "playing";
        renderPanel();
      }
    },
    onState(next) {
      if (network !== connection) return;
      const changed = screen !== "playing";
      state = next;
      screen = "playing";
      engine = null;
      if (changed) {
        resetObserved();
        renderPanel();
      }
      updateHud(true);
    },
    onClose(reason) {
      if (network !== connection) return;
      network = null;
      lobby = null;
      screen = "menu";
      engine = new GameEngine({ mode: "practice" });
      state = engine.state;
      history.replaceState(null, "", location.pathname);
      renderPanel();
      announce(reason);
    },
    onError(message) {
      announce(message);
    },
  });
  network = connection;
  try {
    if (roomId) await connection.join(roomId, playerName);
    else await connection.create(playerName);
    engine = null;
    screen = "lobby";
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
  $("hud").hidden = !running;
  $("match-over").hidden = !running || state.phase !== "finished";
  $("grapple-tool").classList.toggle("active", tool === "grapple");
  $("weapon-tool").classList.toggle("active", tool === "weapon");
  $<HTMLButtonElement>("grapple-tool").disabled = !running;
  $<HTMLButtonElement>("weapon-tool").disabled = !running;
  $<HTMLButtonElement>("end-turn").disabled = !canControl();
  $<HTMLButtonElement>("reset-button").disabled = !running || !!network;
  $("weapon-tool-label").textContent = p?.hasCrate
    ? weaponName(p.weapon)
    : "Find a crate";
  if (!running) {
    $("objective-toast").textContent = "";
    return;
  }
  if (!p) return;
  $("turn-player").textContent =
    network && p.id !== network.sessionId
      ? `${p.name}’s turn`
      : selectedMode === "practice"
        ? "Find your swing."
        : `${p.name}’s turn`;
  $("turn-caption").textContent =
    state.phase === "retreat"
      ? "SHOT SENT · RETREAT"
      : selectedMode === "practice"
        ? "PRACTICE · NO PRESSURE"
        : `TURN ${String(state.turn).padStart(2, "0")} · ${p.hasCrate ? "ARMED & DANGEROUS" : "CRATE REQUIRED"}`;
  $("timer").textContent =
    selectedMode === "practice" && state.phase === "playing"
      ? "∞"
      : String(Math.max(0, Math.ceil(state.timeLeft))).padStart(2, "0");
  $("timer").classList.toggle(
    "urgent",
    state.timeLeft < 10 && selectedMode !== "practice",
  );
  $("objective-toast").textContent =
    state.phase === "settling"
      ? "Let the dust settle…"
      : !canControl() && state.phase !== "finished"
        ? `${p.name} is making a move. Your turn is coming.`
        : state.phase === "retreat"
          ? "Delivery made! Swing to safety before your turn ends."
          : "";
  if ($("roster")) {
    const signature =
      state.players
        .map((q) => `${q.id}:${q.name}:${q.hp}:${q.alive}`)
        .join("|") + state.activePlayerId;
    if (signature !== previousSignature) {
      $("roster").innerHTML = rosterMarkup();
      previousSignature = signature;
    }
    $("weapon-name").textContent = p.hasCrate
      ? weaponName(p.weapon)
      : state.phase === "retreat"
        ? "Special delivery."
        : "Crate required";
    $("weapon-note").textContent = p.hasCrate
      ? p.weapon === "rocket"
        ? "A straight-flying classic. Explodes on impact."
        : p.weapon === "grenade"
          ? "A bouncy little present. A short fuse. Mind the blast."
          : "A short-range blast. Get close, then send them flying."
      : state.phase === "retreat"
        ? "You’ve got a few seconds to make yourself scarce."
        : "Find a crate to get your hands on something irresponsible.";
    const inv = p.inventory;
    const invSignature = `${p.id}:${p.weapon}:${inv.rocket}:${inv.grenade}:${inv.pulse}:${canControl()}:${state.phase}`;
    const inventory = $("inventory");
    if (inventory && inventory.dataset.signature !== invSignature) {
      inventory.dataset.signature = invSignature;
      inventory.innerHTML = (["rocket", "grenade", "pulse"] as WeaponId[])
        .map(
          (w) =>
            `<button class="ammo-slot ${p.weapon === w ? "selected" : ""}" data-weapon="${w}" title="${weaponName(w)} · ${inv[w]} saved" aria-label="Select ${weaponName(w)}, ${inv[w]} rounds" ${!canControl() || state.phase !== "playing" || inv[w] === 0 ? "disabled" : ""}><span>${w === "rocket" ? "↗" : w === "grenade" ? "●" : "ϟ"}</span><b>${inv[w]}</b></button>`,
        )
        .join("");
    }
  }
  if (state.phase === "finished") {
    $("winner-name").textContent = state.winnerId
      ? `${state.players.find((q) => q.id === state.winnerId)?.name || "A frog"} wins.`
      : "Everybody splashed.";
    $<HTMLButtonElement>("rematch-button").disabled =
      !!network && lobby?.hostId !== network.sessionId;
  }
}
function weaponName(w: string | null | undefined) {
  return w === "rocket"
    ? "Scrap rocket"
    : w === "grenade"
      ? "Junk grenade"
      : w === "pulse"
        ? "Recoil popper"
        : "Empty pockets";
}
function detectEvents() {
  if (screen !== "playing") return;
  if (state.crates.length < previousCrates) {
    playSound("pickup");
    announce(
      canControl()
        ? "Package acquired. Press 2 to make your delivery."
        : `${active()?.name ?? "A frog"} collected supplies.`,
    );
  }
  previousCrates = state.crates.length;
  for (const p of state.projectiles)
    if (!previousProjectiles.has(p.id)) playSound("shot");
  previousProjectiles = new Set(state.projectiles.map((p) => p.id));
  for (const e of state.explosions)
    if (!previousExplosions.has(e.id)) playSound("explosion");
  previousExplosions = new Set(state.explosions.map((e) => e.id));
  if (active()?.rope && !previousRope) playSound("grapple");
  previousRope = !!active()?.rope;
  if (state.turn !== previousTurn) {
    clearInputs();
    tool = "grapple";
    previousTurn = state.turn;
    playSound("ui");
  }
  if (!active()?.hasCrate) tool = "grapple";
}
function updateAim(event: PointerEvent) {
  const r = canvas.getBoundingClientRect();
  pointer = { x: (event.clientX - r.left) / r.width, y: (event.clientY - r.top) / r.height };
  refreshAim();
}
function refreshAim() {
  if (camera && pointer) aim = screenToWorld(camera, {
    x: pointer.x * viewport.width, y: pointer.y * viewport.height,
  });
}
canvas.addEventListener("pointermove", updateAim);
canvas.addEventListener("contextmenu", (e) => e.preventDefault());
canvas.addEventListener("pointerdown", (e) => {
  e.preventDefault();
  unlockAudio();
  canvas.focus();
  updateAim(e);
  if (!canControl()) return;
  canvas.setPointerCapture(e.pointerId);
  if (e.button === 2 || tool === "grapple") {
    hook();
    return;
  }
  if (active()?.hasCrate) {
    chargingAt = performance.now();
    $("charging").hidden = false;
  }
});
canvas.addEventListener("pointerup", (e) => {
  updateAim(e);
  if (chargingAt !== null) {
    const power = Math.min(1, 0.25 + (performance.now() - chargingAt) / 1100);
    chargingAt = null;
    $("charging").hidden = true;
    command({ type: "fire", power });
    tool = "grapple";
  }
  if (canvas.hasPointerCapture(e.pointerId))
    canvas.releasePointerCapture(e.pointerId);
});
canvas.addEventListener("pointercancel", () => {
  chargingAt = null;
  $("charging").hidden = true;
});
window.addEventListener("keydown", (e) => {
  if (
    e.target instanceof HTMLInputElement ||
    e.target instanceof HTMLTextAreaElement
  )
    return;
  if (!$("guide").hidden) {
    if (e.key === "Escape") closeGuide();
    return;
  }
  const key = e.key.toLowerCase();
  if (
    [" ", "arrowup", "arrowdown", "arrowleft", "arrowright", "enter"].includes(
      key,
    )
  )
    e.preventDefault();
  if (key === "escape") {
    toggleMenu();
    return;
  }
  if (key === "f") {
    void fullscreen();
    return;
  }
  if (e.repeat) return;
  if (!canControl()) return;
  keys.add(key);
  unlockAudio();
  if (key === "1") setTool("grapple");
  else if (key === "2") setTool("weapon");
  else if (key === " ") hook();
  else if (key === "enter") command({ type: "endTurn" });
  else if ((key === "w" || key === "arrowup") && !active()?.rope)
    command({ type: "jump" });
  else if (key === "shift") command({ type: "jump" });
});
window.addEventListener("keyup", (e) => keys.delete(e.key.toLowerCase()));
window.addEventListener("blur", () => {
  clearInputs();
  $("charging").hidden = true;
});
document.addEventListener("visibilitychange", () => {
  if (document.hidden) clearInputs();
});
for (const button of document.querySelectorAll<HTMLButtonElement>(
  "[data-hold]",
)) {
  const key = (
    { left: "a", right: "d", up: "w", down: "s" } as Record<string, string>
  )[button.dataset.hold!];
  button.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    button.setPointerCapture(e.pointerId);
    keys.add(key);
  });
  button.addEventListener("pointerup", () => keys.delete(key));
  button.addEventListener("pointercancel", () => keys.delete(key));
}
$("touch-jump").onclick = () => command({ type: "jump" });
$("touch-hook").onclick = hook;
$("grapple-tool").onclick = () => setTool("grapple");
$("weapon-tool").onclick = () => setTool("weapon");
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
  unlockAudio();
  sound = !sound;
  updateSound();
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
  $("close-guide").focus();
}
function closeGuide() {
  $("guide").hidden = true;
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
function frame(now: number) {
  const dt = Math.min((now - prevTime) / 1000, 0.05);
  prevTime = now;
  accumulated += dt;
  refreshAim();
  if (engine && screen === "playing" && !menuOpen && $("guide").hidden) {
    syncInput();
    engine.step(dt);
    state = engine.state;
  } else if (network && screen === "playing" && now - lastSend >= 50) {
    syncInput();
    lastSend = now;
  }
  const power =
    chargingAt === null ? 0.65 : Math.min(1, 0.25 + (now - chargingAt) / 1100);
  if (chargingAt !== null) $("power-fill").style.width = `${power * 100}%`;
  let renderedState = state;
  if (network && screen === "playing") {
    renderedState = {
      ...state,
      players: state.players.map((p) => {
        const shown = displayedPlayers.get(p.id) || { x: p.x, y: p.y };
        const blend =
          Math.hypot(p.x - shown.x, p.y - shown.y) > 200
            ? 1
            : 1 - Math.exp(-dt * 32);
        shown.x += (p.x - shown.x) * blend;
        shown.y += (p.y - shown.y) * blend;
        displayedPlayers.set(p.id, shown);
        return { ...p, x: shown.x, y: shown.y };
      }),
    };
  } else displayedPlayers.clear();
  camera = followCamera(camera, renderedState, viewport.width, viewport.height, dt);
  refreshAim();
  renderGame(ctx, renderedState, {
    camera,
    viewport,
    time: accumulated,
    aim,
    tool,
    power,
    menu: screen !== "playing",
  });
  detectEvents();
  updateHud();
  requestAnimationFrame(frame);
}
function resizeCanvas() {
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
      ...state,
    }),
});
if (import.meta.env.DEV)
  Object.assign(window, {
    advanceTime: (ms: number) => {
      if (!engine || screen !== "playing") return;
      syncInput();
      for (let i = 0; i < Math.ceil(ms / (1000 / 120)); i++)
        engine.step(1 / 120);
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
  announce("You’ve been invited. Choose a callsign and click Join.");
}
