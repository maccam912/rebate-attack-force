import { Client, Room } from "@colyseus/sdk";
import type { GameCommand, GameState, PlayerInput, Team, TeamSettings } from "../shared/types";
import { stateWithoutNetwork, type ServerState } from "../shared/protocol";
import { ClientPrediction } from "./prediction";
import type { AvailableRoom } from "../shared/rooms";

function roomClient() {
  return new Client(import.meta.env.VITE_ROOM_SERVER ||
    `${location.origin}${import.meta.env.DEV ? "/rooms" : ""}`);
}

export async function availableRooms(signal: AbortSignal): Promise<AvailableRoom[]> {
  const response = await roomClient().http.get("/api/rooms", { signal, cache: "no-store" });
  return response.data.rooms;
}

export type LobbyState = {
  roomId: string;
  hostId: string;
  players: Omit<Team, "inventory">[];
  started: boolean;
  maxTeams: number | null;
  mineCount: number;
  mapId: string;
};

type Callbacks = {
  onLobby: (lobby: LobbyState) => void;
  onState: (state: GameState) => void;
  onClose: (reason: string) => void;
  onError: (message: string) => void;
  onConnection: (connected: boolean) => void;
};

const seatKey = (roomId: string) => `raf-seat:${roomId}`;
export function savedSeat(roomId: string): string | null {
  try { return localStorage.getItem(seatKey(roomId)); } catch { return null; }
}

export class RoomConnection {
  private room: Room | null = null;
  private readonly client: Client;
  private leaving = false;
  private connected = false;
  private supportsPrediction = false;
  private readonly prediction = new ClientPrediction((frame) => {
    if (this.connected) this.room?.send("input", frame);
  });

  constructor(private readonly callbacks: Callbacks) {
    this.client = roomClient();
  }

  get sessionId() {
    return this.room?.sessionId ?? "";
  }
  get roomId() {
    return this.room?.roomId ?? "";
  }
  get isConnected() { return this.connected; }
  get canControl() { return this.connected && this.prediction.canControl; }

  /** Call once per animation frame after updating input, for local prediction or remote interpolation. */
  frame(dtSeconds: number, nowMs = performance.now()): GameState | null {
    return this.prediction.advance(dtSeconds, nowMs);
  }

  async create(name: string, mapId?: string): Promise<void> {
    await this.leave();
    this.attach(
      await this.client.create("attack", { name: name.slice(0, 20), mapId }),
    );
  }

  async join(roomId: string, name: string): Promise<void> {
    const id = roomId.trim();
    if (!/^[a-zA-Z0-9_-]{4,32}$/.test(id))
      throw new Error(
        "Enter a valid room code or use your friend’s invite link.",
      );
    await this.leave();
    const token = savedSeat(id);
    if (token) this.attach(await this.client.reconnect(token));
    else this.attach(await this.client.joinById(id, { name: name.slice(0, 20) }));
  }

  async rejoin(roomId: string): Promise<void> {
    const token = savedSeat(roomId);
    if (!token) throw new Error("No saved team for this room in this browser.");
    this.attach(await this.client.reconnect(token));
  }

  input(input: PlayerInput) {
    this.prediction.input(input);
    if (this.connected && !this.supportsPrediction) this.room?.send("input", input);
  }
  command(command: GameCommand) {
    if (!this.connected) return;
    if (this.supportsPrediction) this.prediction.command(command);
    else this.room?.send("command", command);
  }
  start() {
    this.room?.send("start");
  }
  restart() {
    this.room?.send("restart");
  }
  configureTeam(teamId: string, settings: TeamSettings) {
    if (this.connected) this.room?.send("teamSettings", { teamId, ...settings });
  }
  configureMines(mineCount: number) {
    if (this.connected) this.room?.send("mineSettings", { mineCount });
  }
  configureMap(mapId: string): boolean {
    if (!this.connected || !this.room) return false;
    this.room.send("mapSettings", { mapId });
    return true;
  }
  addBot() {
    if (this.connected) this.room?.send("addBot");
  }
  removeBot(teamId: string) {
    if (this.connected) this.room?.send("removeBot", { teamId });
  }

  async leave(): Promise<void> {
    if (!this.room) return;
    this.leaving = true;
    const room = this.room;
    this.room = null;
    this.connected = false;
    this.prediction.reset();
    this.supportsPrediction = false;
    try { localStorage.removeItem(seatKey(room.roomId)); } catch {}
    try {
      await room.leave();
    } finally {
      this.leaving = false;
    }
  }

  private attach(room: Room) {
    this.room = room;
    this.connected = true;
    this.prediction.reset();
    this.supportsPrediction = false;
    const remember = () => {
      try { localStorage.setItem(seatKey(room.roomId), room.reconnectionToken); } catch {}
    };
    remember();
    this.callbacks.onConnection(true);
    room.reconnection.minUptime = 0;
    room.reconnection.maxRetries = 10;
    room.reconnection.maxEnqueuedMessages = 0;
    room.onMessage<LobbyState>("lobby", this.callbacks.onLobby);
    room.onMessage<ServerState>("state", (state) => {
      if (this.room !== room) return;
      try { state = { ...state, ...stateWithoutNetwork(state) }; }
      catch (error) {
        this.callbacks.onError(error instanceof Error ? error.message : "Unable to load the room's map.");
        return;
      }
      this.supportsPrediction = !!state.net;
      this.prediction.receive(state, room.sessionId);
      this.callbacks.onState(state);
    });
    room.onMessage<string>("notice", this.callbacks.onError);
    room.onError((_code, message) =>
      this.callbacks.onError(message || "The room connection failed."),
    );
    room.onDrop(() => {
      this.connected = false;
      this.prediction.reset();
      this.callbacks.onConnection(false);
      this.callbacks.onError("Connection interrupted. Your team’s turns are skipped while you reconnect…");
    });
    room.onReconnect(() => {
      this.connected = true;
      this.prediction.reset();
      remember();
      this.callbacks.onConnection(true);
      room.send("sync");
    });
    room.onLeave((code, reason) => {
      if (this.room === room) this.room = null;
      this.connected = false;
      if (!this.leaving)
        this.callbacks.onClose(
          reason ||
            (code === 4001
              ? "The server restarted. Create a new room to play again."
              : "Connection lost. Rejoin your team using the saved room link in this browser."),
        );
    });
    // Explicit sync also handles the initial onJoin message racing listener registration.
    room.send("sync");
  }
}
