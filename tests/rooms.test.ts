import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { Client, type Room } from "@colyseus/sdk";
import { matchMaker } from "@colyseus/core";
import { createGameServer } from "../server/index";
import type { GameState } from "../shared/types";
import type { LobbyState } from "../src/network";

const server = createGameServer();
const connections = new Set<Room>();
let endpoint = "";
type Observed = {
  room: Room;
  lobby?: LobbyState;
  state?: GameState;
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
  room.onMessage<GameState>("state", (state) => {
    observed.state = state;
    observed.snapshots++;
  });
  room.onMessage<string>("notice", (message) => observed.notices.push(message));
  room.onLeave(() => connections.delete(room));
  room.send("sync");
  return observed;
}

async function create(name: string) {
  return observe(await new Client(endpoint).create("attack", { name }));
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
    a.room.send("command", { type: "fire", power: 1 });
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
      "cannot fire without collecting a crate",
    );
    assert.equal(
      a.state!.players.find((player) => player.id === b.room.sessionId)!.x,
      originalVisitorX,
    );

    const hostX = a.state!.players[0].x;
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
      () => a.state!.players[0].inventory.rocket > 0,
      "server collects the nearby rocket crate",
    );
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
      a.state!.players[0].inventory.rocket,
      1,
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
    a.room.send("command", { type: "selectWeapon", weapon: "rocket" });
    a.room.send("command", { type: "fire", power: 1 });
    await waitFor(
      () => a.state!.phase === "retreat",
      "carried ammunition can fire without a new crate",
    );
    assert.equal(a.state!.players[0].inventory.rocket, 0);

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
  "four-player capacity and automatic reconnect retain anonymous identity",
  { timeout: 10000 },
  async () => {
    const a = await create("One");
    const b = await join(a.room.roomId, "Two");
    const c = observe(
      await new Client(endpoint).joinById(a.room.roomId, {
        name: { invalid: true },
        color: "red; background:url(evil)",
      }),
    );
    const d = await join(a.room.roomId, "Four");
    await waitFor(() => a.lobby?.players.length === 4, "full room lobby");
    const malformedGuest = a.lobby!.players.find(
      (player) => player.id === c.room.sessionId,
    )!;
    assert.equal(malformedGuest.name, "Guest 3");
    assert.match(
      malformedGuest.color,
      /^#[0-9a-f]{6}$/i,
      "guest color is assigned by the server",
    );
    await assert.rejects(
      () => new Client(endpoint).joinById(a.room.roomId, { name: "Five" }),
      /locked|full|max/i,
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
    assert.equal(a.lobby!.players.length, 4);
    await Promise.all([
      a.room.leave(),
      b.room.leave(),
      c.room.leave(),
      d.room.leave(),
    ]);
  },
);

test("host configures teams; rejoining from a fresh client restores the same team and skips offline turns", { timeout: 15000 }, async () => {
  const a = await create("Captain");
  const b = await join(a.room.roomId, "Visitor");
  await waitFor(() => a.lobby?.players.length === 2, "two team lobby");
  b.room.send("teamSettings", { teamId: a.room.sessionId, frogs: 6, hp: 500 });
  await waitFor(() => b.notices.length === 1, "guest cannot configure teams");
  assert.equal(a.lobby!.players[0].frogs, 1);
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
