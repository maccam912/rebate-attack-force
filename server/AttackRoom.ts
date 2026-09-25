import { Room, ServerError, type Client } from "@colyseus/core";
import { FIXED_STEP, GameEngine } from "../shared/game";
import { BotController } from "../shared/bots";
import type { GameCommand, PlayerInput, Team, WeaponId } from "../shared/types";
import { DEFAULT_MINE_COUNT, DEFAULT_TEAM_SETTINGS, MAX_FROGS, MAX_HP, MAX_MINES, teamColor, validMineCount, validTeamSettings } from "../shared/settings";
import { MAX_SEQUENCE_GAP, type ServerState } from "../shared/protocol";
import { WEAPON_IDS } from "../shared/weapons";
import { DEFAULT_MAP_ID, getMap, isMapId } from "../shared/maps";
import type { AvailableRoom } from "../shared/rooms";

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
  "backflip",
  "grapple",
  "release",
  "fire",
  "endTurn",
  "selectWeapon",
]);
const WEAPONS = new Set<WeaponId>(WEAPON_IDS);
type Guest = Omit<Team, "inventory">;
type Budget = { at: number; tokens: number };

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function validatedCommand(message: unknown): GameCommand | null {
  if (!record(message) || typeof message.type !== "string" || !COMMANDS.has(message.type)) return null;
  if (message.power !== undefined && (typeof message.power !== "number" || !Number.isFinite(message.power))) return null;
  if (message.weapon !== undefined && (typeof message.weapon !== "string" || !WEAPONS.has(message.weapon as WeaponId))) return null;
  if (message.type === "selectWeapon" && message.weapon === undefined) return null;
  const command: GameCommand = { type: message.type as GameCommand["type"] };
  if (typeof message.power === "number") command.power = Math.max(0, Math.min(1, message.power));
  if (typeof message.weapon === "string") command.weapon = message.weapon as WeaponId;
  return command;
}

/** A transport adapter: movement, combat and turn rules belong to GameEngine. */
export class AttackRoom extends Room {
  protected readonly maxTeams: number | null = null;
  maxMessagesPerSecond = 120;
  private guests = new Map<string, Guest>();
  private hostId = "";
  private game: GameEngine | null = null;
  private lastInput = new Map<string, number>();
  private budgets = new Map<string, Budget>();
  private emptySince: number | null = null;
  private epoch = "";
  private matchNumber = 0;
  private sequences = new Map<string, number>();
  private bots = new BotController();
  private botNumber = 0;
  private mineCount = DEFAULT_MINE_COUNT;
  private mapId = DEFAULT_MAP_ID;

  async onCreate(options: unknown = {}) {
    if (record(options) && options.mapId !== undefined) {
      if (!isMapId(options.mapId)) throw new ServerError(400, "Choose a valid map.");
      this.mapId = options.mapId;
    }
    this.maxClients = this.maxTeams ?? Infinity;
    await this.setPrivate(true);
    this.onMessage("sync", (client) => {
      if (!this.consume(client, "control", 5)) return;
      client.send("lobby", this.lobby());
      this.sendState(client);
    });
    this.onMessage("input", (client, message: unknown) => {
      if (
        !this.canAct(client) ||
        !this.consume(client, "input", 90) ||
        !record(message)
      )
        return;
      const game = this.game!;
      const sequenced = "seq" in message || "input" in message || "epoch" in message;
      let commands: GameCommand[] = [];
      let input = message;
      if (sequenced) {
        const prior = this.sequences.get(client.sessionId) ?? 0;
        if (!Number.isSafeInteger(message.seq) || (message.seq as number) <= prior ||
          (message.seq as number) > prior + MAX_SEQUENCE_GAP || message.epoch !== this.epoch ||
          message.turn !== game.state.turn || message.playerId !== game.state.activePlayerId ||
          !record(message.input) || !Array.isArray(message.commands) || message.commands.length > 6) return;
        const parsed = message.commands.map(validatedCommand);
        if (parsed.some((command) => !command)) return;
        commands = parsed as GameCommand[];
        input = message.input;
      } else if (this.sequences.has(client.sessionId)) return;
      if (typeof input.aimX !== "number" || !Number.isFinite(input.aimX) ||
        typeof input.aimY !== "number" || !Number.isFinite(input.aimY)) return;
      game.setInput(game.state.activePlayerId, {
        left: input.left === true,
        right: input.right === true,
        up: input.up === true,
        down: input.down === true,
        aimX: Math.max(
          -game.state.width,
          Math.min(game.state.width * 2, input.aimX),
        ),
        aimY: Math.max(
          -game.state.height,
          Math.min(game.state.height * 2, input.aimY),
        ),
      });
      this.lastInput.set(game.state.activePlayerId, Date.now());
      if (sequenced) {
        this.sequences.set(client.sessionId, message.seq as number);
        for (const command of commands) {
          if (!this.consume(client, "command", 10)) break;
          game.command(game.state.activePlayerId, command);
        }
      }
    });
    this.onMessage("command", (client, message: unknown) => {
      if (
        !this.canAct(client) ||
        !this.consume(client, "command", 10) ||
        !record(message) || this.sequences.has(client.sessionId)
      )
        return;
      const command = validatedCommand(message);
      if (!command) return;
      this.game!.command(this.game!.state.activePlayerId, command);
    });
    this.onMessage("teamSettings", (client, message: unknown) => {
      if (!this.consume(client, "settings", 20)) return;
      if (client.sessionId !== this.hostId) {
        client.send("notice", "Only the room host can change team settings.");
        return;
      }
      if (this.game) {
        client.send("notice", "Team settings are fixed once the match starts.");
        return;
      }
      if (!record(message) || typeof message.teamId !== "string" ||
        !validTeamSettings(message)) {
        client.send("notice", `Choose 1–${MAX_FROGS} frogs and 1–${MAX_HP} HP per frog.`);
        return;
      }
      const team = this.guests.get(message.teamId);
      if (!team) return;
      team.frogs = message.frogs;
      team.hp = message.hp;
      this.broadcast("lobby", this.lobby());
    });
    this.onMessage("mineSettings", (client, message: unknown) => {
      if (!this.consume(client, "settings", 20)) return;
      if (client.sessionId !== this.hostId) {
        client.send("notice", "Only the room host can change mine settings.");
        return;
      }
      if (this.game) {
        client.send("notice", "Mine settings are fixed once the match starts.");
        return;
      }
      if (!record(message) || !validMineCount(message.mineCount)) {
        client.send("notice", `Choose 0–${MAX_MINES} starting mines.`);
        return;
      }
      this.mineCount = message.mineCount;
      this.broadcast("lobby", this.lobby());
    });
    this.onMessage("mapSettings", (client, message: unknown) => {
      if (!this.consume(client, "settings", 20)) {
        // Send the authoritative choice before the notice lets a client clear
        // its optimistic selection, including when the final browse was dropped.
        client.send("lobby", this.lobby());
        client.send("notice", "Map changes are arriving too quickly. Your last choice was not applied; try again.");
        return;
      }
      if (client.sessionId !== this.hostId) {
        client.send("notice", "Only the room host can change the map.");
        return;
      }
      if (this.game) {
        client.send("notice", "The map is fixed once the match starts.");
        return;
      }
      if (!record(message) || !isMapId(message.mapId)) {
        client.send("notice", "Choose a valid map.");
        return;
      }
      this.mapId = message.mapId;
      this.broadcast("lobby", this.lobby());
    });
    this.onMessage("addBot", (client) => {
      if (!this.canManageBots(client)) return;
      // Colyseus also counts pending joins and reconnect reservations. A bot may
      // only use a seat that has not already been promised to a human.
      if (this.hasReachedMaxClients() || this.atTeamCapacity()) {
        client.send("notice", "This room has reached the server's team limit.");
        return;
      }
      const number = ++this.botNumber;
      const id = `bot:${number}`;
      this.guests.set(id, {
        id, name: `Bot ${number}`, color: this.nextColor(), connected: true,
        bot: true, ...DEFAULT_TEAM_SETTINGS,
      });
      this.updateClientCapacity();
      this.broadcast("lobby", this.lobby());
    });
    this.onMessage("removeBot", (client, message: unknown) => {
      if (!this.canManageBots(client) || !record(message) || typeof message.teamId !== "string") return;
      if (!this.guests.get(message.teamId)?.bot) return;
      this.guests.delete(message.teamId);
      this.updateClientCapacity();
      this.broadcast("lobby", this.lobby());
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
      // Bots are never connections: preserve recoverable matches while every
      // human is offline instead of letting the AI finish the match unattended.
      if (!this.game || !this.hasConnectedHuman()) return;
      // Losing focus or connectivity must never leave a movement key held forever.
      const id = this.game.state.activePlayerId;
      if (!this.guests.get(this.game.state.activeTeamId)?.bot &&
        Date.now() - (this.lastInput.get(id) ?? 0) > 1000) {
        const player = this.game.state.players.find((candidate) => candidate.id === id)!;
        this.game.setInput(id, {
          ...NEUTRAL,
          aimX: player.lookAt.x,
          aimY: player.lookAt.y,
        });
      }
      this.bots.update(this.game, dt);
      this.game.step(dt);
    }, 60);
    // Disable schema patches after installing the simulation: setting this before
    // it creates a second clock timer in Colyseus and starves fixed-step deltas.
    this.patchRate = null;
    this.clock.setInterval(() => {
      this.sendState();
    }, 50);
    // Keep seats through long drops/reloads, but do not retain abandoned rooms forever.
    this.clock.setInterval(() => {
      if (this.emptySince !== null && Date.now() - this.emptySince > 30 * 60 * 1000)
        void this.disconnect();
    }, 10000);
  }

  onJoin(client: Client, options: unknown) {
    if (this.game)
      throw new ServerError(4004, "This match has already started.");
    if (this.atTeamCapacity())
      throw new ServerError(4005, "This room has reached the server's team limit.");
    const rawName =
      record(options) && typeof options.name === "string" ? options.name : "";
    const name =
      rawName
        .replace(/[\u0000-\u001f\u007f]/g, "")
        .trim()
        .slice(0, 20) || `Guest ${this.guests.size + 1}`;
    this.guests.set(client.sessionId, {
      id: client.sessionId, name, color: this.nextColor(), connected: true, ...DEFAULT_TEAM_SETTINGS,
    });
    this.emptySince = null;
    if (!this.hostId) this.hostId = client.sessionId;
    this.broadcast("lobby", this.lobby());
  }

  onDrop(client: Client) {
    const guest = this.guests.get(client.sessionId);
    if (!guest) return;
    this.allowReconnection(client, "manual");
    guest.connected = false;
    this.game?.setTeamConnected(client.sessionId, false);
    this.updateHost();
    this.broadcast("lobby", this.lobby());
    this.sendState();
  }

  onReconnect(client: Client) {
    const guest = this.guests.get(client.sessionId);
    if (guest) guest.connected = true;
    this.game?.setTeamConnected(client.sessionId, true);
    this.emptySince = null;
    this.updateHost();
    this.broadcast("lobby", this.lobby());
    client.send("lobby", this.lobby());
    this.sendState(client);
  }

  onLeave(client: Client) {
    this.guests.delete(client.sessionId);
    this.lastInput.delete(client.sessionId);
    this.sequences.delete(client.sessionId);
    for (const key of this.budgets.keys()) {
      if (key.startsWith(`${client.sessionId}:`)) this.budgets.delete(key);
    }
    this.updateHost();
    this.game?.removePlayer(client.sessionId);
    this.broadcast("lobby", this.lobby());
    this.sendState();
  }

  private canAct(client: Client) {
    return (
      this.game !== null &&
      this.game.state.phase !== "finished" &&
      this.game.state.activeTeamId === client.sessionId &&
      this.guests.get(client.sessionId)?.connected === true
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
    if ([...this.guests.values()].filter((guest) => guest.connected).length < 2) {
      client.send("notice", "Invite at least one friend or add a bot before starting.");
      return;
    }
    this.lock();
    this.game = new GameEngine({
      players: [...this.guests.values()],
      mode: "versus",
      seed: Date.now(),
      mineCount: this.mineCount,
      mapId: this.mapId,
    });
    this.bots = new BotController();
    this.lastInput.clear();
    this.sequences.clear();
    this.epoch = `${Date.now().toString(36)}-${++this.matchNumber}`;
    this.broadcast("lobby", this.lobby());
    this.sendState();
  }

  private sendState(client?: Client): void {
    if (!this.game) return;
    const snapshot = this.game.capture();
    const terrainImage = getMap(snapshot.state.mapId).image;
    const state: ServerState = {
      ...snapshot.state,
      platforms: terrainImage ? [] : snapshot.state.platforms,
      net: {
        epoch: this.epoch,
        tick: Math.round(snapshot.simulation.elapsed / FIXED_STEP),
        ack: this.sequences.get(snapshot.state.activeTeamId) ?? 0,
        simulation: snapshot.simulation,
        ...(terrainImage ? { terrainImage } : {}),
      },
    };
    if (client) client.send("state", state);
    else this.broadcast("state", state);
  }

  private updateHost() {
    const connected = [...this.guests.values()].filter((guest) => guest.connected && !guest.bot);
    if (!connected.some((guest) => guest.id === this.hostId)) this.hostId = connected[0]?.id ?? "";
    if (connected.length === 0) this.emptySince ??= Date.now();
    else this.emptySince = null;
  }

  private lobby() {
    return {
      roomId: this.roomId,
      hostId: this.hostId,
      players: [...this.guests.values()],
      started: this.game !== null,
      maxTeams: this.maxTeams,
      mineCount: this.mineCount,
      mapId: this.mapId,
    };
  }

  availableRoom(): AvailableRoom | null {
    const host = this.guests.get(this.hostId);
    if (this.game || this.locked || this.hasReachedMaxClients() ||
        this.atTeamCapacity() || !host?.connected || host.bot) return null;
    return {
      roomId: this.roomId,
      hostName: host.name,
      mapId: this.mapId,
      teams: this.guests.size,
      maxTeams: this.maxTeams,
    };
  }

  private hasConnectedHuman() {
    return [...this.guests.values()].some((guest) => guest.connected && !guest.bot);
  }

  private atTeamCapacity() {
    return this.maxTeams !== null && this.guests.size >= this.maxTeams;
  }

  private updateClientCapacity() {
    const botCount = [...this.guests.values()].filter((guest) => guest.bot).length;
    this.maxClients = this.maxTeams === null ? Infinity : this.maxTeams - botCount;
  }

  private canManageBots(client: Client) {
    if (!this.consume(client, "bots", 10)) return false;
    if (client.sessionId !== this.hostId) {
      client.send("notice", "Only the room host can add or remove bots.");
      return false;
    }
    if (this.game) {
      client.send("notice", "Bots can only be added or removed before the match starts.");
      return false;
    }
    return true;
  }

  private nextColor() {
    const used = new Set([...this.guests.values()].map((guest) => guest.color));
    let index = 0;
    while (index < this.guests.size + 4 && used.has(teamColor(index))) index++;
    return teamColor(index);
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
