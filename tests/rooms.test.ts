import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { Client, type Room } from "@colyseus/sdk";
import { matchMaker } from "@colyseus/core";
import { createGameServer } from "../server/index";
import { AttackRoom } from "../server/AttackRoom";
import { serverMaxTeams } from "../server/capacity";
import type { GameEngine } from "../shared/game";
import type { ServerState } from "../shared/protocol";
import { DEFAULT_MINE_COUNT, MAX_MINES } from "../shared/settings";
import { DEFAULT_MAP_ID, MAPS, getMap } from "../shared/maps";
import type { LobbyState } from "../src/network";
import { stockWeapons } from "./fixtures";

const server = createGameServer();
class LimitedAttackRoom extends AttackRoom {
  protected override readonly maxTeams = 3;
}
server.gameServer.define("attack-limited", LimitedAttackRoom);
const connections = new Set<Room>();
let endpoint = "";
type Observed = {
  room: Room;
  lobby?: LobbyState;
  state?: ServerState;
  notices: string[];
  snapshots: number;
};

before(async () => {
  const port = await server.listen(0, "127.0.0.1");
  endpoint = `http://127.0.0.1:${port}`;
});

after(async () => {
  await Promise.allSettled([...connections].map((room) => room.leave()));
  await server.shutdown();
});

async function waitFor(
  predicate: () => boolean,
  description: string,
  timeout = 3500,
) {
  const deadline = Date.now() + timeout;
  while (!predicate()) {
    assert.ok(Date.now() < deadline, `Timed out: ${description}`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

function observe(room: Room): Observed {
  connections.add(room);
  const observed: Observed = { room, notices: [], snapshots: 0 };
  room.reconnection.minUptime = 0;
  room.onMessage<LobbyState>("lobby", (lobby) => {
    observed.lobby = lobby;
  });
  room.onMessage<ServerState>("state", (state) => {
    observed.state = state;
    observed.snapshots++;
  });
  room.onMessage<string>("notice", (message) => observed.notices.push(message));
  room.onLeave(() => connections.delete(room));
  room.send("sync");
  return observed;
}

async function create(name: string, mapId?: string) {
  return observe(await new Client(endpoint).create("attack", { name, mapId }));
}
async function join(id: string, name: string) {
  return observe(await new Client(endpoint).joinById(id, { name }));
}

test(
  "anonymous room: host controls, authoritative turns, movement, leaving and restart",
  { timeout: 15000 },
  async () => {
    assert.equal((await fetch(`${endpoint}/healthz`)).status, 200);
    assert.equal((await fetch(`${endpoint}/readyz`)).status, 200);
    const a = await create("Host\n");
    await waitFor(() => a.lobby?.players.length === 1, "host lobby");
    assert.equal(a.lobby!.hostId, a.room.sessionId);
    assert.equal(a.lobby!.players[0].name, "Host");
    a.room.send("start");
    await waitFor(() => a.notices.length === 1, "minimum player guard");
    assert.match(a.notices[0], /at least one friend/);
    const b = await join(a.room.roomId, "Visitor");
    const c = await join(a.room.roomId, "Third");
    await waitFor(
      () => a.lobby?.players.length === 3 && c.lobby?.players.length === 3,
      "three anonymous guests",
    );
    assert.equal(
      new Set(a.lobby!.players.map((player) => player.color)).size,
      3,
    );
    const listings = await matchMaker.query({ roomId: a.room.roomId });
    assert.equal(listings[0].private, true);

    b.room.send("start");
    await waitFor(() => b.notices.length === 1, "non-host start rejection");
    assert.match(b.notices[0], /Only the room host/);
    assert.equal(b.state, undefined);
    for (const client of [a, b, c]) a.room.send("teamSettings", { teamId: client.room.sessionId, frogs: 1, hp: 100 });
    await waitFor(() => a.lobby!.players.every((team) => team.frogs === 1), "single-frog lifecycle fixture");
    a.room.send("start");
    await waitFor(
      () => Boolean(a.state && b.state && c.state),
      "all clients receive authoritative state",
    );
    assert.equal(a.state!.activePlayerId, a.room.sessionId);
    assert.equal(b.state!.activePlayerId, a.room.sessionId);
    a.room.send("input", {
      left: false, right: false, up: false, down: false,
      aimX: 600, aimY: 1200,
    });
    await waitFor(
      () => [a, b, c].every((client) => client.state!.players[0].lookAt.x === 600 && client.state!.players[0].lookAt.y === 1200),
      "the active player's gaze reaches every client",
    );
    const gazeSnapshot = a.snapshots;
    await waitFor(() => a.snapshots >= gazeSnapshot + 25, "input timeout leaves gaze intact");
    assert.deepEqual(b.state!.players[0].lookAt, { x: 600, y: 1200 });
    await assert.rejects(
      () => new Client(endpoint).joinById(a.room.roomId, { name: "Late" }),
      /locked|already started/i,
    );

    const originalVisitorX = a.state!.players.find(
      (player) => player.id === b.room.sessionId,
    )!.x;
    b.room.send("input", {
      left: true,
      right: false,
      up: false,
      down: false,
      aimX: 0,
      aimY: 0,
      sessionId: a.room.sessionId,
    });
    b.room.send("command", { type: "endTurn", sessionId: a.room.sessionId });
    a.room.send("command", { type: "fire", power: NaN });
    const snapshots = a.snapshots;
    await waitFor(
      () => a.snapshots >= snapshots + 3,
      "server advances snapshots",
    );
    assert.equal(a.state!.activePlayerId, a.room.sessionId);
    assert.deepEqual(a.state!.players[0].lookAt, { x: 600, y: 1200 }, "inactive input cannot redirect the active frog's eyes");
    assert.equal(
      a.state!.projectiles.length,
      0,
      "malformed fire commands cannot launch projectiles",
    );
    assert.equal(
      a.state!.players.find((player) => player.id === b.room.sessionId)!.x,
      originalVisitorX,
    );

    const hostX = a.state!.players[0].x;
    const nearbyCrateId = a.state!.crates[0].id;
    a.room.send("input", {
      left: false,
      right: true,
      up: false,
      down: false,
      aimX: 1000,
      aimY: 400,
    });
    await waitFor(
      () => a.state!.players[0].x > hostX + 5,
      "server simulates active movement",
    );
    await waitFor(
      () => !a.state!.crates.some((crate) => crate.id === nearbyCrateId),
      "server collects the nearby supply crate",
    );
    const carriedWeapon = a.state!.players[0].weapon!;
    const carriedAmmo = a.state!.teams[0].inventory[carriedWeapon];
    assert.ok(carriedAmmo > 0);
    a.room.send("input", {
      left: false,
      right: false,
      up: false,
      down: false,
      aimX: 1000,
      aimY: 400,
    });
    a.room.send("input", { right: true, aimX: NaN, aimY: Infinity });
    a.room.send("command", { type: "teleport", x: 800 });
    a.room.send("command", { type: "fire", power: NaN });
    a.room.send("command", { type: "selectWeapon", weapon: "not-a-weapon" });
    a.room.send("command", { type: "endTurn" });
    await waitFor(
      () => a.state!.activePlayerId === b.room.sessionId,
      "active player ends turn",
    );
    assert.ok(
      a.state!.players.every(
        (player) => Number.isFinite(player.x) && Number.isFinite(player.y),
      ),
    );

    await b.room.leave();
    await waitFor(
      () =>
        a.state!.activePlayerId === c.room.sessionId &&
        a.lobby!.players.length === 2,
      "departed active player is eliminated and skipped",
    );
    assert.equal(
      a.state!.players.find((player) => player.id === b.room.sessionId)!.alive,
      false,
    );

    c.room.send("command", { type: "endTurn" });
    await waitFor(
      () => a.state!.activePlayerId === a.room.sessionId,
      "return to the crate collector",
    );
    assert.equal(
      a.state!.teams[0].inventory[carriedWeapon],
      carriedAmmo,
      "unused ammunition carries into the next turn",
    );
    a.room.send("input", {
      left: false,
      right: false,
      up: false,
      down: false,
      aimX: 1280,
      aimY: 620,
    });
    a.room.send("command", { type: "selectWeapon", weapon: carriedWeapon });
    a.room.send("command", { type: "fire", power: 1 });
    await waitFor(
      () => a.state!.soundEvents!.some((event) => event.kind === "shot" && event.playerId === a.room.sessionId),
      "carried ammunition can fire without a new crate",
    );
    assert.equal(a.state!.teams[0].inventory[carriedWeapon], carriedAmmo - 1);

    c.room.send("restart");
    await waitFor(() => c.notices.length === 1, "non-host restart rejection");
    a.room.send("restart");
    await waitFor(
      () => a.state!.players.length === 2 && a.state!.turn === 1,
      "host restarts with current guests",
    );
    assert.ok(
      a.state!.players.every((player) => player.hp === 100 && player.alive),
    );
    await a.room.leave();
    await waitFor(
      () =>
        c.lobby!.hostId === c.room.sessionId && c.state!.phase === "finished",
      "host migrates and remaining guest wins",
    );
    assert.equal(c.state!.winnerId, c.room.sessionId);
    await c.room.leave();
  },
);

test(
  "more than four teams and automatic reconnect retain anonymous identity",
  { timeout: 10000 },
  async () => {
    const a = await create("One");
    const b = await join(a.room.roomId, "Two");
    const c = observe(
      await new Client(endpoint).joinById(a.room.roomId, {
        name: { invalid: true },
        color: "red; background:url(evil)",
        bot: true,
      }),
    );
    const d = await join(a.room.roomId, "Four");
    const e = await join(a.room.roomId, "Five");
    const f = await join(a.room.roomId, "Six");
    await waitFor(() => a.lobby?.players.length === 6, "six team lobby");
    assert.equal(a.lobby!.maxTeams, null);
    assert.equal(new Set(a.lobby!.players.map((team) => team.color)).size, 6);
    const malformedGuest = a.lobby!.players.find(
      (player) => player.id === c.room.sessionId,
    )!;
    assert.equal(malformedGuest.name, "Guest 3");
    assert.notEqual(malformedGuest.bot, true, "clients cannot grant themselves bot control");
    assert.match(
      malformedGuest.color,
      /^#[0-9a-f]{6}$/i,
      "guest color is assigned by the server",
    );
    const originalSession = b.room.sessionId;
    let reconnected = false;
    b.room.onReconnect(() => {
      reconnected = true;
      b.room.send("sync");
    });
    b.room.connection.close();
    await waitFor(() => reconnected, "automatic transient reconnect", 5000);
    assert.equal(b.room.sessionId, originalSession);
    assert.equal(a.lobby!.players.length, 6);
    a.room.send("start");
    await waitFor(() => a.state?.teams.length === 6, "six teams start");
    for (const active of [a, b, c, d, e]) {
      await waitFor(() => a.state!.activeTeamId === active.room.sessionId, "every team receives a turn");
      active.room.send("command", { type: "endTurn" });
    }
    await waitFor(() => a.state!.activeTeamId === f.room.sessionId, "sixth team receives a turn");
    await Promise.all([
      a.room.leave(),
      b.room.leave(),
      c.room.leave(),
      d.room.leave(),
      e.room.leave(),
      f.room.leave(),
    ]);
  },
);

test("host configures teams; rejoining from a fresh client restores the same team and skips offline turns", { timeout: 15000 }, async () => {
  const a = await create("Captain");
  const b = await join(a.room.roomId, "Visitor");
  await waitFor(() => a.lobby?.players.length === 2, "two team lobby");
  b.room.send("teamSettings", { teamId: a.room.sessionId, frogs: 6, hp: 500 });
  await waitFor(() => b.notices.length === 1, "guest cannot configure teams");
  assert.equal(a.lobby!.players[0].frogs, 3);
  for (const settings of [{ frogs: -1, hp: 100 }, { frogs: 7, hp: 100 },
    { frogs: 2, hp: Infinity }, { frogs: 2, hp: 0 }, { frogs: 2.5, hp: 100 }]) {
    a.room.send("teamSettings", { teamId: a.room.sessionId, ...settings });
  }
  await waitFor(() => a.notices.length === 5, "invalid settings rejected");
  a.room.send("teamSettings", { teamId: a.room.sessionId, frogs: 3, hp: 175 });
  a.room.send("teamSettings", { teamId: b.room.sessionId, frogs: 2, hp: 250 });
  await waitFor(() => b.lobby?.players[0].frogs === 3 && b.lobby?.players[1].hp === 250, "settings broadcast to both clients");
  a.room.send("start");
  await waitFor(() => !!a.state && !!b.state, "configured match");
  assert.equal(a.state!.players.length, 5);
  assert.ok(a.state!.players.filter((p) => p.teamId === a.room.sessionId).every((p) => p.hp === 175));
  assert.ok(a.state!.players.filter((p) => p.teamId === b.room.sessionId).every((p) => p.hp === 250));
  a.room.send("teamSettings", { teamId: a.room.sessionId, frogs: 1, hp: 1 });
  await waitFor(() => a.notices.length === 6, "settings frozen after start");

  const hostId = a.room.sessionId;
  const visitorId = b.room.sessionId;
  const firstToken = a.room.reconnectionToken;
  a.room.reconnection.enabled = false;
  a.room.connection.close();
  await waitFor(() => b.state!.activeTeamId === visitorId && b.lobby!.hostId === visitorId, "offline host skipped and host migrates");
  assert.equal(b.lobby!.players.find((p) => p.id === hostId)!.connected, false);
  assert.ok(b.state!.players.every((p) => p.alive));
  assert.equal(b.state!.phase, "playing", "disconnect is not a win");
  b.room.send("command", { type: "endTurn" });
  await waitFor(() => b.state!.activePlayerId === `${visitorId}:frog-2`, "connected team rotates while host is offline");
  await assert.rejects(() => new Client(endpoint).reconnect(`${a.room.roomId}:invalid-token`));
  const restored = observe(await new Client(endpoint).reconnect(firstToken));
  await waitFor(() => restored.state?.teams.find((t) => t.id === hostId)?.connected === true, "saved seat restored by fresh client");
  assert.equal(restored.room.sessionId, hostId);
  assert.notEqual(restored.room.reconnectionToken, firstToken);
  assert.equal(restored.state!.activePlayerId, `${visitorId}:frog-2`);
  assert.equal(restored.state!.players.length, 5);
  b.room.send("command", { type: "endTurn" });
  await waitFor(() => restored.state!.activePlayerId === `${hostId}:frog-2`, "rejoined team controls its next living frog");
  const secondFrog = restored.state!.players.find((p) => p.id === `${hostId}:frog-2`)!;
  const originalX = secondFrog.x;
  restored.room.send("input", { left: true, right: false, up: false, down: false, aimX: 20, aimY: 400 });
  await waitFor(() => restored.state!.players.find((p) => p.id === secondFrog.id)!.x < originalX - 4, "seat authorizes movement of a different frog");
  restored.room.send("input", { left: false, right: false, up: false, down: false, aimX: 20, aimY: 400 });
  restored.room.send("command", { type: "jump" });
  restored.room.send("command", { type: "backflip" });
  await waitFor(() => restored.state!.players.find((p) => p.id === secondFrog.id)!.vy < -600, "authoritative backward jump");

  const secondToken = restored.room.reconnectionToken;
  const visitorToken = b.room.reconnectionToken;
  restored.room.reconnection.enabled = false;
  b.room.reconnection.enabled = false;
  restored.room.connection.close();
  b.room.connection.close();
  await new Promise((resolve) => setTimeout(resolve, 300));
  const bothBack = observe(await new Client(endpoint).reconnect(secondToken));
  await waitFor(() => !!bothBack.state, "empty room retains recoverable seats");
  assert.equal(bothBack.room.sessionId, hostId);
  assert.ok(bothBack.state!.players.every((p) => p.alive));
  assert.equal(bothBack.state!.winnerId, null);
  const visitorBack = observe(await new Client(endpoint).reconnect(visitorToken));
  await waitFor(() => bothBack.lobby!.players.every((p) => p.connected), "both seats recovered");
  await bothBack.room.leave();
  await waitFor(() => visitorBack.state!.phase === "finished", "explicit leave forfeits the entire team");
  assert.equal(visitorBack.state!.winnerId, visitorId);
  assert.equal(visitorBack.state!.players.filter((p) => p.teamId === hostId && p.alive).length, 0);
  await visitorBack.room.leave();
});

test("room creation validates map choices and defaults to the original map", { timeout: 10000 }, async () => {
  const original = await create("Captain");
  await waitFor(() => !!original.lobby, "default map lobby");
  assert.equal(original.lobby!.mapId, DEFAULT_MAP_ID);
  await original.room.leave();

  for (const mapId of ["unknown-map", "", "toString", "__proto__", 12, null, {}, []]) {
    await assert.rejects(() => new Client(endpoint).create("attack", { name: "Invalid", mapId }), /valid map/);
  }
});

test("only the host selects maps; all clients retain the choice through joining, reconnecting and restarting", { timeout: 10000 }, async () => {
  const choices = MAPS.filter((map) => map.id !== DEFAULT_MAP_ID);
  assert.ok(choices.length >= 2, "at least two additional authored maps are available");
  const host = await create("Captain", choices[0].id);
  await waitFor(() => !!host.lobby, "selected map lobby");
  assert.equal(host.lobby!.mapId, choices[0].id);
  const guest = await join(host.room.roomId, "Friend");
  await waitFor(() => host.lobby?.players.length === 2 && !!guest.lobby, "map settings lobby");
  assert.equal(guest.lobby!.mapId, choices[0].id, "late join sees the host's map");

  guest.room.send("mapSettings", { mapId: choices[1].id });
  await waitFor(() => guest.notices.length === 1, "guest map change rejected");
  assert.match(guest.notices[0], /Only the room host/);
  assert.equal(host.lobby!.mapId, choices[0].id);

  const invalidSettings = [null, [], {}, { mapId: "unknown-map" }, { mapId: "toString" },
    { mapId: "__proto__" }, { mapId: "" }, { mapId: 1 }, { mapId: null }, { mapId: [] }];
  for (const message of invalidSettings) host.room.send("mapSettings", message);
  await waitFor(() => host.notices.length === invalidSettings.length, "malformed map choices rejected");
  assert.ok(host.notices.every((notice) => /valid map/.test(notice)));
  assert.equal(host.lobby!.mapId, choices[0].id);

  const selected = choices[1];
  host.room.send("mapSettings", { mapId: selected.id });
  await waitFor(() => host.lobby?.mapId === selected.id && guest.lobby?.mapId === selected.id,
    "selected map broadcasts to everyone");
  const token = host.room.reconnectionToken;
  host.room.reconnection.enabled = false;
  host.room.connection.close();
  await waitFor(() => guest.lobby?.hostId === guest.room.sessionId, "map settings host migration");
  assert.equal(guest.lobby!.mapId, selected.id);
  const restored = observe(await new Client(endpoint).reconnect(token));
  await waitFor(() => restored.lobby?.mapId === selected.id, "reconnection restores selected map");
  restored.room.send("mapSettings", { mapId: DEFAULT_MAP_ID });
  await waitFor(() => restored.notices.length === 1, "former host map change rejected");
  assert.match(restored.notices[0], /Only the room host/);

  guest.room.send("start");
  await waitFor(() => !!guest.state && !!restored.state, "match starts on selected map");
  for (const client of [guest, restored]) {
    assert.equal(client.state!.mapId, selected.id);
    assert.equal(client.state!.width, getMap(selected.id).width);
    assert.equal(client.state!.height, getMap(selected.id).height);
  }
  guest.room.send("mapSettings", { mapId: DEFAULT_MAP_ID });
  await waitFor(() => guest.notices.length === 2, "map freezes after start");
  assert.match(guest.notices[1], /fixed once the match starts/);
  assert.equal(guest.lobby!.mapId, selected.id);
  const epoch = guest.state!.net!.epoch;
  guest.room.send("restart");
  await waitFor(() => guest.state!.net!.epoch !== epoch && restored.state!.net!.epoch !== epoch,
    "restarted match retains selected map");
  assert.equal(guest.state!.mapId, selected.id);
  assert.equal(restored.state!.mapId, selected.id);
  assert.equal(guest.lobby!.mapId, selected.id);
  await Promise.all([guest.room.leave(), restored.room.leave()]);
});

test("host configures starting mines; settings survive host migration, reconnect and restart", { timeout: 10000 }, async () => {
  const host = await create("Captain");
  const guest = await join(host.room.roomId, "Friend");
  await waitFor(() => host.lobby?.players.length === 2 && !!guest.lobby, "mine settings lobby");
  assert.equal(host.lobby!.mineCount, DEFAULT_MINE_COUNT);
  assert.equal(guest.lobby!.mineCount, DEFAULT_MINE_COUNT);
  guest.room.send("mineSettings", { mineCount: 6 });
  await waitFor(() => guest.notices.length === 1, "guest cannot configure mines");
  assert.match(guest.notices[0], /Only the room host/);
  assert.equal(host.lobby!.mineCount, DEFAULT_MINE_COUNT);

  const invalidSettings = [null, [], {}, { mineCount: "6" }, { mineCount: -1 },
    { mineCount: MAX_MINES + 1 }, { mineCount: 1.5 }, { mineCount: NaN }, { mineCount: Infinity }];
  for (const message of invalidSettings) host.room.send("mineSettings", message);
  await waitFor(() => host.notices.length === invalidSettings.length, "invalid mine settings rejected");
  assert.equal(host.lobby!.mineCount, DEFAULT_MINE_COUNT);
  for (const mineCount of [MAX_MINES, 0, 6]) {
    host.room.send("mineSettings", { mineCount });
    await waitFor(() => host.lobby?.mineCount === mineCount && guest.lobby?.mineCount === mineCount,
      "mine settings shared with all clients");
  }

  const token = host.room.reconnectionToken;
  host.room.reconnection.enabled = false;
  host.room.connection.close();
  await waitFor(() => guest.lobby?.hostId === guest.room.sessionId, "mine settings host migration");
  assert.equal(guest.lobby!.mineCount, 6);
  const restored = observe(await new Client(endpoint).reconnect(token));
  await waitFor(() => restored.lobby?.mineCount === 6, "reconnection restores mine settings");
  assert.equal(restored.room.sessionId, host.room.sessionId);
  assert.equal(restored.lobby!.hostId, guest.room.sessionId);
  restored.room.send("mineSettings", { mineCount: 0 });
  await waitFor(() => restored.notices.length === 1, "former host cannot change mines");
  assert.equal(guest.lobby!.mineCount, 6);

  guest.room.send("start");
  await waitFor(() => !!guest.state && !!restored.state, "match starts with configured mines");
  assert.equal(guest.state!.mines.length, 6);
  assert.deepEqual(restored.state!.mines, guest.state!.mines);
  guest.room.send("mineSettings", { mineCount: 0 });
  await waitFor(() => guest.notices.length === 2, "mine settings frozen after start");
  assert.match(guest.notices[1], /fixed once the match starts/);
  assert.equal(guest.lobby!.mineCount, 6);
  const epoch = guest.state!.net!.epoch;
  guest.room.send("restart");
  await waitFor(() => guest.state!.net!.epoch !== epoch && restored.state!.net!.epoch !== epoch,
    "restarted match retains mine settings");
  assert.equal(guest.state!.mines.length, 6);
  assert.equal(restored.state!.mines.length, 6);
  assert.equal(guest.lobby!.mineCount, 6);
  await Promise.all([guest.room.leave(), restored.room.leave()]);
});

test("sequenced prediction frames acknowledge once and reject stale, forged and accelerated actions", { timeout: 10000 }, async () => {
  const a = await create("Predictor");
  const b = await join(a.room.roomId, "Observer");
  await waitFor(() => a.lobby?.players.length === 2, "prediction lobby");
  a.room.send("start");
  await waitFor(() => !!a.state?.net && !!b.state?.net, "checkpoint snapshots");
  const initial = a.state!;
  const frame = {
    seq: 1, epoch: initial.net!.epoch, turn: initial.turn,
    playerId: initial.activePlayerId,
    input: { left: false, right: false, up: false, down: false, aimX: 700, aimY: 1100 },
    commands: [],
  };
  a.room.send("input", frame);
  await waitFor(() => a.state!.net!.ack === 1 && b.state!.net!.ack === 1, "accepted sequence acknowledged to both views");
  assert.equal(a.state!.players[0].lookAt.x, 700);
  const checkpoint = a.state!.net!.simulation;
  assert.ok(checkpoint.inputs.length >= 2);
  assert.ok(Number.isFinite(checkpoint.randomSeed));

  b.room.send("input", { ...frame, seq: 2, commands: [{ type: "endTurn" }] });
  for (const invalid of [
    { ...frame, commands: [{ type: "endTurn" }] },
    { ...frame, seq: 2, epoch: "old-match", commands: [{ type: "endTurn" }] },
    { ...frame, seq: 2, turn: initial.turn + 1, commands: [{ type: "endTurn" }] },
    { ...frame, seq: 2, playerId: b.room.sessionId },
    { ...frame, seq: Number.MAX_SAFE_INTEGER },
    { ...frame, seq: 2.5 },
    { ...frame, seq: 2, input: { ...frame.input, aimX: NaN } },
    { ...frame, seq: 2, commands: [{ type: "selectWeapon", weapon: "fake" }] },
    { ...frame, seq: 2, commands: Array.from({ length: 7 }, () => ({ type: "jump" })) },
  ]) a.room.send("input", invalid);
  a.room.send("command", { type: "endTurn" });
  const afterInvalid = a.snapshots;
  await waitFor(() => a.snapshots >= afterInvalid + 3, "invalid input rejection");
  assert.equal(a.state!.net!.ack, 1);
  assert.equal(a.state!.turn, initial.turn);
  assert.equal(a.state!.phase, "playing");

  a.room.send("input", { ...frame, seq: 2, commands: [{ type: "selectWeapon", weapon: "golf" }, { type: "jump" }] });
  await waitFor(() => a.state!.net!.ack === 2, "new arsenal command and jump accepted");
  assert.equal(a.state!.players[0].weapon, null, "a valid frame cannot select equipment the team has not collected");
  assert.ok(a.state!.players[0].vy < 0);
  const elapsedBefore = a.state!.net!.simulation.elapsed;
  for (let seq = 3; seq <= 32; seq++) a.room.send("input", {
    ...frame, seq, dt: 1000000, tick: 99999999,
    x: -1000, y: -1000, hp: 9999999, damage: 999999,
  });
  await waitFor(() => a.state!.net!.ack === 32, "input burst processed without stepping the world");
  assert.ok(a.state!.net!.simulation.elapsed - elapsedBefore < 0.6, "server time comes from its fixed clock");
  assert.ok(a.state!.players[0].x > 0 && a.state!.players[0].y > 0);
  assert.equal(a.state!.players[0].hp, initial.players[0].hp);
  a.room.send("input", { ...frame, seq: 33, commands: [{ type: "endTurn" }] });
  await waitFor(() => a.state!.activeTeamId === b.room.sessionId, "authoritative handoff");
  a.room.send("input", { ...frame, seq: 34, commands: [{ type: "endTurn" }] });
  const otherTurn = a.state!.turn;
  const afterHandoff = a.snapshots;
  await waitFor(() => a.snapshots >= afterHandoff + 2, "late prior-turn command rejected");
  assert.equal(a.state!.turn, otherTurn);
  assert.equal(a.state!.activeTeamId, b.room.sessionId);

  a.room.send("restart");
  await waitFor(() => a.state!.net!.epoch !== frame.epoch, "restart changes prediction epoch");
  assert.equal(a.state!.net!.ack, 0);
  a.room.send("input", { ...frame, seq: 35, commands: [{ type: "endTurn" }] });
  a.room.send("input", { ...frame, epoch: a.state!.net!.epoch, turn: a.state!.turn });
  await waitFor(() => a.state!.net!.ack === 1, "new match starts a fresh input sequence");
  assert.equal(a.state!.turn, 1);
  await a.room.leave();
  await b.room.leave();
});

test("only the host manages bots; bots share team settings and survive restart", { timeout: 10000 }, async () => {
  const host = await create("Captain");
  const guest = await join(host.room.roomId, "Friend");
  await waitFor(() => host.lobby?.players.length === 2, "bot management lobby");
  guest.room.send("addBot");
  await waitFor(() => guest.notices.length === 1, "guest cannot add bots");
  assert.match(guest.notices[0], /Only the room host/);
  host.room.send("addBot", { id: guest.room.sessionId, name: "Forged", frogs: 6 });
  await waitFor(() => host.lobby?.players.length === 3, "host adds bot");
  const firstBot = host.lobby!.players.find((team) => team.bot)!;
  assert.equal(firstBot.name, "Bot 1");
  assert.equal(firstBot.connected, true);
  assert.equal(firstBot.frogs, 3);
  assert.notEqual(firstBot.id, guest.room.sessionId);
  assert.match(firstBot.color, /^#[0-9a-f]{6}$/i);
  guest.room.send("removeBot", { teamId: firstBot.id });
  await waitFor(() => guest.notices.length === 2, "guest cannot remove bots");
  host.room.send("removeBot", { teamId: guest.room.sessionId });
  host.room.send("sync");
  await waitFor(() => host.lobby!.players.length === 3 && guest.notices.length === 2, "humans cannot be removed as bots");
  host.room.send("removeBot", { teamId: firstBot.id });
  await waitFor(() => host.lobby?.players.length === 2, "host removes bot");
  host.room.send("addBot");
  await waitFor(() => host.lobby?.players.length === 3, "replacement bot");
  const bot = host.lobby!.players.find((team) => team.bot)!;
  assert.notEqual(bot.id, firstBot.id, "removed bot identities are not recycled");
  assert.equal(new Set(host.lobby!.players.map((team) => team.color)).size, 3);
  host.room.send("teamSettings", { teamId: bot.id, frogs: 2, hp: 350 });
  await waitFor(() => host.lobby!.players.find((team) => team.id === bot.id)?.hp === 350, "host configures bot");
  host.room.send("start");
  await waitFor(() => !!host.state, "match starts with bot");
  assert.equal(host.state!.teams.find((team) => team.id === bot.id)?.bot, true);
  assert.equal(host.state!.players.filter((frog) => frog.teamId === bot.id).length, 2);
  assert.ok(host.state!.players.filter((frog) => frog.teamId === bot.id).every((frog) => frog.hp === 350));
  host.room.send("addBot");
  host.room.send("removeBot", { teamId: bot.id });
  await waitFor(() => host.notices.length === 2, "bot roster freezes after starting");
  assert.ok(host.notices.every((notice) => /before the match starts/.test(notice)));
  const epoch = host.state!.net!.epoch;
  host.room.send("restart");
  await waitFor(() => host.state!.net!.epoch !== epoch, "bot match restarts");
  assert.equal(host.state!.teams.find((team) => team.id === bot.id)?.name, bot.name);
  assert.equal(host.state!.players.filter((frog) => frog.teamId === bot.id).length, 2);
  await host.room.leave();
  await waitFor(() => guest.lobby!.hostId === guest.room.sessionId, "host migrates to human, never bot");
  const roomId = guest.room.roomId;
  await guest.room.leave();
  await waitFor(() => !matchMaker.getLocalRoomById(roomId), "bot-only room disposes after explicit human departures");
});

test("server capacity includes bots, pending joins and disconnected humans", { timeout: 10000 }, async () => {
  assert.equal(serverMaxTeams(undefined), null);
  assert.equal(serverMaxTeams(""), null);
  assert.equal(serverMaxTeams("12"), 12);
  for (const invalid of ["1", "0", "-4", "2.5", "nonsense", "Infinity"])
    assert.throws(() => serverMaxTeams(invalid), /MAX_TEAMS/);
  const host = observe(await new Client(endpoint).create("attack-limited", { name: "Captain", maxTeams: 999, maxClients: 999 }));
  await waitFor(() => !!host.lobby, "configured lobby");
  assert.equal(host.lobby!.maxTeams, 3, "client cannot override operator limit");
  const friend = await join(host.room.roomId, "Friend");
  host.room.send("addBot");
  await waitFor(() => host.lobby?.players.length === 3, "human and bot capacity reached");
  const botId = host.lobby!.players.find((team) => team.bot)!.id;
  host.room.send("addBot");
  await waitFor(() => host.notices.length === 1, "bot capacity rejection");
  assert.match(host.notices[0], /team limit/);
  await assert.rejects(() => new Client(endpoint).joinById(host.room.roomId, { name: "Full" }), /locked|full|limit|max/i);
  const token = friend.room.reconnectionToken;
  friend.room.reconnection.enabled = false;
  friend.room.connection.close();
  await waitFor(() => host.lobby!.players.find((team) => team.id === friend.room.sessionId)?.connected === false, "friend retains disconnected seat");
  host.room.send("addBot");
  await waitFor(() => host.notices.length === 2, "offline human still consumes capacity");
  host.room.send("removeBot", { teamId: botId });
  await waitFor(() => host.lobby!.players.length === 2, "remove bot frees capacity");
  const pending = await new Client(endpoint).joinById(host.room.roomId, { name: "Third" });
  const third = observe(pending);
  await waitFor(() => host.lobby!.players.length === 3, "transport unlocks after bot removal");
  assert.equal(host.lobby!.players.filter((team) => team.connected).length, 2);
  host.room.send("addBot");
  await waitFor(() => host.notices.length === 3, "retained human seats count together");
  const restored = observe(await new Client(endpoint).reconnect(token));
  await waitFor(() => host.lobby!.players.every((team) => team.connected), "reconnect succeeds at full capacity");
  assert.equal(restored.room.sessionId, friend.room.sessionId);
  await third.room.leave();
  await waitFor(() => host.lobby!.players.length === 2, "third leaves");

  // Reserve a transport seat without opening its socket yet. Adding a bot must
  // not steal a human's in-flight reservation, even though no team exists yet.
  const reservation = await matchMaker.joinById(host.room.roomId, { name: "Reserved" });
  host.room.send("addBot");
  await waitFor(() => host.notices.length === 4, "pending human reservation blocks bot");
  const reserved = observe(await new Client(endpoint).consumeSeatReservation(reservation));
  await waitFor(() => host.lobby!.players.length === 3, "reserved human finishes joining");
  await Promise.all([host.room.leave(), restored.room.leave(), reserved.room.leave()]);
});

test("solo human can play bots; offline matches pause and abandoned bot rooms expire", { timeout: 50000 }, async () => {
  const host = await create("Solo");
  await waitFor(() => !!host.lobby, "solo lobby");
  host.room.send("addBot");
  await waitFor(() => host.lobby!.players.length === 2, "solo bot opponent");
  const botId = host.lobby!.players.find((team) => team.bot)!.id;
  host.room.send("teamSettings", { teamId: host.room.sessionId, frogs: 1, hp: 500 });
  host.room.send("teamSettings", { teamId: botId, frogs: 1, hp: 500 });
  host.room.send("start");
  await waitFor(() => !!host.state, "one human plus one bot starts");
  host.room.send("command", { type: "endTurn" });
  await waitFor(() => host.state!.activeTeamId === botId, "bot turn starts");
  const token = host.room.reconnectionToken;
  host.room.reconnection.enabled = false;
  host.room.connection.close();
  const room = matchMaker.getLocalRoomById(host.room.roomId)!;
  const internals = room as unknown as { game: GameEngine; emptySince: number | null; hostId: string };
  await waitFor(() => internals.emptySince !== null, "bot is not counted as an online human");
  assert.equal(internals.hostId, "", "bot cannot inherit host");
  const elapsed = internals.game.capture().simulation.elapsed;
  await new Promise((resolve) => setTimeout(resolve, 300));
  assert.equal(internals.game.capture().simulation.elapsed, elapsed, "no simulation progress while every human is offline");
  // Reconnection timing and combat are the subjects here; random loot can
  // legitimately give this distant bot a melee weapon and no useful shot.
  stockWeapons(internals.game);
  const restored = observe(await new Client(endpoint).reconnect(token));
  await waitFor(() => restored.lobby?.hostId === restored.room.sessionId, "human resumes hosting");
  const initialTurn = internals.game.state.turn;
  const botShot = () => restored.state?.soundEvents?.find((event) => event.kind === "shot" && event.playerId === botId);
  // The persistent shot journal proves the server issued a real attack, even
  // when the short-lived projectile disappears between network snapshots.
  await waitFor(() => !!botShot(), "bot fires an ordinary weapon after reconnection", 14000);
  assert.ok(botShot()!.weapon);
  assert.ok(internals.game.capture().simulation.elapsed > elapsed, "reconnection resumes simulation");
  await waitFor(() => restored.state!.turn > initialTurn || restored.state!.phase === "finished", "bot completes its turn", 12000);
  assert.ok(restored.state!.players.find((frog) => frog.teamId === restored.room.sessionId)!.hp < 500,
    "the bot's attack damages the human opponent through normal combat");
  const epoch = restored.state!.net!.epoch;
  restored.room.send("restart");
  await waitFor(() => restored.state!.net!.epoch !== epoch, "solo bot match restarts");
  assert.equal(botShot(), undefined, "restart clears the prior match's shot journal");
  stockWeapons(internals.game);
  restored.room.send("command", { type: "endTurn" });
  await waitFor(() => restored.state!.activeTeamId === botId, "bot plays after restart");
  await waitFor(() => !!botShot(), "restarted bot controller fires a weapon", 14000);
  restored.room.reconnection.enabled = false;
  restored.room.connection.close();
  await waitFor(() => internals.emptySince !== null, "abandoned match is tracked despite bots");
  internals.emptySince = Date.now() - 31 * 60 * 1000;
  const cleanup = room.clock.delayed.find((timer) => timer.time === 10000)!;
  assert.ok(cleanup, "abandoned room timer exists");
  cleanup.execute();
  await waitFor(() => !matchMaker.getLocalRoomById(host.room.roomId), "abandoned bot room cleaned up");
});

test("room browser lists joinable lobbies and tracks their lifecycle", { timeout: 15000 }, async () => {
  const directory = async () => {
    const response = await fetch(`${endpoint}/api/rooms`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "no-store");
    return (await response.json()).rooms as import("../shared/rooms").AvailableRoom[];
  };
  const host = await create("Parent <&>");
  const id = host.room.roomId;
  await waitFor(() => !!host.lobby, "directory host joined");
  assert.deepEqual((await directory()).find((room) => room.roomId === id), {
    roomId: id, hostName: "Parent <&>", mapId: DEFAULT_MAP_ID, teams: 1, maxTeams: null,
  });
  host.room.send("mapSettings", { mapId: MAPS[1].id });
  host.room.send("addBot");
  await waitFor(() => host.lobby?.players.length === 2 && host.lobby.mapId === MAPS[1].id, "directory settings");
  assert.equal((await directory()).find((room) => room.roomId === id)!.teams, 2);
  assert.equal((await directory()).find((room) => room.roomId === id)!.mapId, MAPS[1].id);
  const child = await join(id, "Kid");
  await waitFor(() => host.lobby?.players.length === 3, "directory click joins exact room");
  const liveRoom = matchMaker.getLocalRoomById(id)!;
  liveRoom.maxClients = 2;
  assert.equal((await directory()).some((room) => room.roomId === id), false, "full rooms hidden");
  liveRoom.maxClients = Infinity;
  assert.ok((await directory()).some((room) => room.roomId === id), "seat availability restores listing");
  await host.room.leave();
  await waitFor(() => child.lobby?.hostId === child.room.sessionId, "directory host migration");
  assert.equal((await directory()).find((room) => room.roomId === id)!.hostName, "Kid");

  const token = child.room.reconnectionToken;
  child.room.reconnection.enabled = false;
  child.room.connection.close();
  await waitFor(() => (liveRoom as AttackRoom).availableRoom() === null, "unattended room hidden despite bot");
  assert.equal((await directory()).some((room) => room.roomId === id), false);
  const restored = observe(await new Client(endpoint).reconnect(token));
  await waitFor(() => !!restored.lobby, "directory reconnected");
  assert.ok((await directory()).some((room) => room.roomId === id));
  restored.room.send("start");
  await waitFor(() => !!restored.state, "directory match started");
  assert.equal((await directory()).some((room) => room.roomId === id), false, "started match hidden");
  await restored.room.leave();

  const abandoned = await create("Leaving");
  await waitFor(() => !!abandoned.lobby, "leaving lobby");
  await abandoned.room.leave();
  assert.equal((await directory()).some((room) => room.roomId === abandoned.room.roomId), false, "closed lobby removed");

  const limited = observe(await new Client(endpoint).create("attack-limited", { name: "Limited" }));
  await waitFor(() => !!limited.lobby, "limited directory lobby");
  const limitedRoom = matchMaker.getLocalRoomById(limited.room.roomId) as AttackRoom;
  assert.equal(limitedRoom.availableRoom()?.maxTeams, 3);
  limited.room.send("addBot");
  limited.room.send("addBot");
  await waitFor(() => limited.lobby?.players.length === 3, "bots fill limited room");
  assert.equal(limitedRoom.availableRoom(), null, "bots consume directory capacity");
  limited.room.send("removeBot", { teamId: limited.lobby!.players.find((team) => team.bot)!.id });
  await waitFor(() => limited.lobby?.players.length === 2, "bot removal frees seat");
  assert.equal(limitedRoom.availableRoom()?.teams, 2);
  await limited.room.leave();
});
