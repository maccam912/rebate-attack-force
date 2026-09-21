import { Client, Room } from "@colyseus/sdk";
import type { GameCommand, GameState, PlayerInput, Team, TeamSettings } from "../shared/types";

export type LobbyState = {
  roomId: string;
  hostId: string;
  players: Team[];
  started: boolean;
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

  constructor(private readonly callbacks: Callbacks) {
    const endpoint =
      import.meta.env.VITE_ROOM_SERVER ||
      `${location.origin}${import.meta.env.DEV ? "/rooms" : ""}`;
    this.client = new Client(endpoint);
  }

  get sessionId() {
    return this.room?.sessionId ?? "";
  }
  get roomId() {
    return this.room?.roomId ?? "";
  }
  get isConnected() { return this.connected; }

  async create(name: string): Promise<void> {
    await this.leave();
    this.attach(
      await this.client.create("attack", { name: name.slice(0, 20) }),
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
    if (this.connected) this.room?.send("input", input);
  }
  command(command: GameCommand) {
    if (this.connected) this.room?.send("command", command);
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

  async leave(): Promise<void> {
    if (!this.room) return;
    this.leaving = true;
    const room = this.room;
    this.room = null;
    this.connected = false;
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
    const remember = () => {
      try { localStorage.setItem(seatKey(room.roomId), room.reconnectionToken); } catch {}
    };
    remember();
    this.callbacks.onConnection(true);
    room.reconnection.minUptime = 0;
    room.reconnection.maxRetries = 10;
    room.reconnection.maxEnqueuedMessages = 0;
    room.onMessage<LobbyState>("lobby", this.callbacks.onLobby);
    room.onMessage<GameState>("state", this.callbacks.onState);
    room.onMessage<string>("notice", this.callbacks.onError);
    room.onError((_code, message) =>
      this.callbacks.onError(message || "The room connection failed."),
    );
    room.onDrop(() => {
      this.connected = false;
      this.callbacks.onConnection(false);
      this.callbacks.onError("Connection interrupted. Your team’s turns are skipped while you reconnect…");
    });
    room.onReconnect(() => {
      this.connected = true;
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
