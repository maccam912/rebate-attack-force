import { Client, Room } from "@colyseus/sdk";
import type { GameCommand, GameState, PlayerInput } from "../shared/types";

export type LobbyState = {
  roomId: string;
  hostId: string;
  players: { id: string; name: string; color: string }[];
  started: boolean;
};

type Callbacks = {
  onLobby: (lobby: LobbyState) => void;
  onState: (state: GameState) => void;
  onClose: (reason: string) => void;
  onError: (message: string) => void;
};

export class RoomConnection {
  private room: Room | null = null;
  private readonly client: Client;
  private leaving = false;

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
    this.attach(await this.client.joinById(id, { name: name.slice(0, 20) }));
  }

  input(input: PlayerInput) {
    this.room?.send("input", input);
  }
  command(command: GameCommand) {
    this.room?.send("command", command);
  }
  start() {
    this.room?.send("start");
  }
  restart() {
    this.room?.send("restart");
  }

  async leave(): Promise<void> {
    if (!this.room) return;
    this.leaving = true;
    const room = this.room;
    this.room = null;
    try {
      await room.leave();
    } finally {
      this.leaving = false;
    }
  }

  private attach(room: Room) {
    this.room = room;
    room.reconnection.minUptime = 0;
    room.reconnection.maxRetries = 10;
    room.reconnection.maxEnqueuedMessages = 0;
    room.onMessage<LobbyState>("lobby", this.callbacks.onLobby);
    room.onMessage<GameState>("state", this.callbacks.onState);
    room.onMessage<string>("notice", this.callbacks.onError);
    room.onError((_code, message) =>
      this.callbacks.onError(message || "The room connection failed."),
    );
    room.onDrop(() =>
      this.callbacks.onError("Connection interrupted. Reconnecting…"),
    );
    room.onReconnect(() => room.send("sync"));
    room.onLeave((code, reason) => {
      if (this.room === room) this.room = null;
      if (!this.leaving)
        this.callbacks.onClose(
          reason ||
            (code === 4001
              ? "The server restarted. Create a new room to play again."
              : "You left the room."),
        );
    });
    // Explicit sync also handles the initial onJoin message racing listener registration.
    room.send("sync");
  }
}
