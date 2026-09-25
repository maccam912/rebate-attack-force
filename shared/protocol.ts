import type { GameCommand, GameState, PlayerInput } from "./types.js";
import { getMap, mapPlatforms } from "./maps.js";

/** Everything outside GameState that can affect a subsequent fixed simulation step. */
export interface SimulationCheckpoint {
  inputs: [string, PlayerInput][];
  accumulator: number;
  serial: number;
  randomSeed: number;
  settlingTime: number;
  elapsed: number;
  jump: { id: string; at: number; facing: -1 | 1 } | null;
  lastFrog: [string, string][];
}

export interface GameSnapshot {
  state: GameState;
  simulation: SimulationCheckpoint;
}

/** Additive wire format: existing clients can still consume the ordinary state fields. */
export type ServerState = GameState & {
  net?: {
    epoch: string;
    tick: number;
    ack: number;
    simulation: SimulationCheckpoint;
    /** Content-addressed PNG geometry already shipped with both peers. */
    terrainImage?: string;
  };
};

/** No client pose, damage, clock, or elapsed time is accepted by the server. */
export interface InputFrame {
  seq: number;
  epoch: string;
  turn: number;
  playerId: string;
  input: PlayerInput;
  commands: GameCommand[];
}

export const NETWORK_STEP = 1 / 60;
export const INTERPOLATION_DELAY = 0.12;
export const MAX_PENDING_FRAMES = 120;
export const MAX_SEQUENCE_GAP = 240;

export function stateWithoutNetwork(state: ServerState): GameState {
  const { net: _net, ...game } = state;
  if (_net?.terrainImage && !game.platforms.length) {
    const map = getMap(game.mapId);
    if (map.image !== _net.terrainImage || game.width % map.width || game.width < map.width)
      throw new Error("The room uses a different map image. Reload to get the latest maps.");
    game.platforms = mapPlatforms(map, game.width / map.width);
  }
  return game;
}
