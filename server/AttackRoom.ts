import { Room, ServerError, type Client } from "@colyseus/core";
import { GameEngine } from "../shared/game";
import type { GameCommand, PlayerInput, WeaponId } from "../shared/types";

const COLORS = ["#baf27c", "#ffac81", "#acb9ff", "#ffde75"];
const NEUTRAL: PlayerInput = {
  left: false,
  right: false,
  up: false,
  down: false,
  aimX: 800,
  aimY: 300,
};
const COMMANDS = new Set([
  "jump",
  "grapple",
  "release",
  "fire",
  "endTurn",
  "selectWeapon",
]);
const WEAPONS = new Set<WeaponId>(["rocket", "grenade", "pulse"]);
type Guest = { id: string; name: string; color: string };
type Budget = { at: number; tokens: number };

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** A transport adapter: movement, combat and turn rules belong to GameEngine. */
export class AttackRoom extends Room {
  maxClients = 4;
  maxMessagesPerSecond = 120;
  private guests = new Map<string, Guest>();
  private hostId = "";
  private game: GameEngine | null = null;
  private lastInput = new Map<string, number>();
  private budgets = new Map<string, Budget>();

  async onCreate() {
    await this.setPrivate(true);
    this.onMessage("sync", (client) => {
      if (!this.consume(client, "control", 5)) return;
      client.send("lobby", this.lobby());
      if (this.game) client.send("state", this.game.state);
    });
    this.onMessage("input", (client, message: unknown) => {
      if (
        !this.canAct(client) ||
        !this.consume(client, "input", 90) ||
        !record(message)
      )
        return;
      if (
        typeof message.aimX !== "number" ||
        !Number.isFinite(message.aimX) ||
        typeof message.aimY !== "number" ||
        !Number.isFinite(message.aimY)
      )
        return;
      const game = this.game!;
      game.setInput(client.sessionId, {
        left: message.left === true,
        right: message.right === true,
        up: message.up === true,
        down: message.down === true,
        aimX: Math.max(
          -game.state.width,
          Math.min(game.state.width * 2, message.aimX),
        ),
        aimY: Math.max(
          -game.state.height,
          Math.min(game.state.height * 2, message.aimY),
        ),
      });
      this.lastInput.set(client.sessionId, Date.now());
    });
    this.onMessage("command", (client, message: unknown) => {
      if (
        !this.canAct(client) ||
        !this.consume(client, "command", 10) ||
        !record(message)
      )
        return;
      if (typeof message.type !== "string" || !COMMANDS.has(message.type))
        return;
      if (
        message.power !== undefined &&
        (typeof message.power !== "number" || !Number.isFinite(message.power))
      )
        return;
      if (
        message.weapon !== undefined &&
        (typeof message.weapon !== "string" ||
          !WEAPONS.has(message.weapon as WeaponId))
      )
        return;
      if (message.type === "selectWeapon" && message.weapon === undefined)
        return;
      const command: GameCommand = {
        type: message.type as GameCommand["type"],
      };
      if (typeof message.power === "number")
        command.power = Math.max(0, Math.min(1, message.power));
      if (typeof message.weapon === "string")
        command.weapon = message.weapon as WeaponId;
      this.game!.command(client.sessionId, command);
    });
    this.onMessage("start", (client) => {
      if (!this.consume(client, "control", 5) || this.game) return;
      this.startGame(client);
    });
    this.onMessage("restart", (client) => {
      if (!this.consume(client, "control", 5)) return;
      this.startGame(client);
    });
    this.setFixedTimestep(({ dt }) => {
      if (!this.game) return;
      // Losing focus or connectivity must never leave a movement key held forever.
      const id = this.game.state.activePlayerId;
      if (Date.now() - (this.lastInput.get(id) ?? 0) > 1000)
        this.game.setInput(id, NEUTRAL);
      this.game.step(dt);
    }, 60);
    // Disable schema patches after installing the simulation: setting this before
    // it creates a second clock timer in Colyseus and starves fixed-step deltas.
    this.patchRate = null;
    this.clock.setInterval(() => {
      if (this.game) this.broadcast("state", this.game.state);
    }, 50);
  }

  onJoin(client: Client, options: unknown) {
    if (this.game)
      throw new ServerError(4004, "This match has already started.");
    const rawName =
      record(options) && typeof options.name === "string" ? options.name : "";
    const name =
      rawName
        .replace(/[\u0000-\u001f\u007f]/g, "")
        .trim()
        .slice(0, 20) || `Guest ${this.guests.size + 1}`;
    const used = new Set([...this.guests.values()].map((guest) => guest.color));
    const color = COLORS.find((candidate) => !used.has(candidate)) ?? COLORS[0];
    this.guests.set(client.sessionId, { id: client.sessionId, name, color });
    if (!this.hostId) this.hostId = client.sessionId;
    this.broadcast("lobby", this.lobby());
  }

  onDrop(client: Client) {
    this.game?.setInput(client.sessionId, NEUTRAL);
    this.lastInput.delete(client.sessionId);
    // Existing tabs can recover brief network drops without accounts or cookies.
    this.allowReconnection(client, 15);
  }

  onReconnect(client: Client) {
    client.send("lobby", this.lobby());
    if (this.game) client.send("state", this.game.state);
  }

  onLeave(client: Client) {
    this.guests.delete(client.sessionId);
    this.lastInput.delete(client.sessionId);
    for (const key of this.budgets.keys()) {
      if (key.startsWith(`${client.sessionId}:`)) this.budgets.delete(key);
    }
    if (client.sessionId === this.hostId)
      this.hostId = this.guests.keys().next().value ?? "";
    this.game?.removePlayer(client.sessionId);
    this.broadcast("lobby", this.lobby());
    if (this.game) this.broadcast("state", this.game.state);
  }

  private canAct(client: Client) {
    return (
      this.game !== null &&
      this.game.state.phase !== "finished" &&
      this.game.state.activePlayerId === client.sessionId &&
      this.guests.has(client.sessionId)
    );
  }

  private startGame(client: Client) {
    if (client.sessionId !== this.hostId) {
      client.send(
        "notice",
        "Only the room host can start or restart the match.",
      );
      return;
    }
    if (this.guests.size < 2) {
      client.send("notice", "Invite at least one friend before starting.");
      return;
    }
    this.lock();
    this.game = new GameEngine({
      players: [...this.guests.values()],
      mode: "versus",
      seed: Date.now(),
    });
    this.lastInput.clear();
    this.broadcast("lobby", this.lobby());
    this.broadcast("state", this.game.state);
  }

  private lobby() {
    return {
      roomId: this.roomId,
      hostId: this.hostId,
      players: [...this.guests.values()],
      started: this.game !== null,
    };
  }

  private consume(client: Client, lane: string, rate: number) {
    const key = `${client.sessionId}:${lane}`;
    const now = Date.now();
    const budget = this.budgets.get(key) ?? { at: now, tokens: rate };
    budget.tokens = Math.min(
      rate,
      budget.tokens + ((now - budget.at) * rate) / 1000,
    );
    budget.at = now;
    this.budgets.set(key, budget);
    if (budget.tokens < 1) return false;
    budget.tokens -= 1;
    return true;
  }
}
