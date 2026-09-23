import { GameEngine } from "../shared/game.js";
import type { GameOptions } from "../shared/types.js";
import { WEAPONS } from "../shared/weapons.js";

/** Isolate movement and combat scenarios from the default three-frog roster. */
export function singleFrogGame(options: GameOptions = {}): GameEngine {
  return new GameEngine({ ...options, players: (options.players ?? [
    { id: "p1", name: "Moss" }, { id: "p2", name: "Tangerine" },
  ]).map((team) => ({ frogs: 1, ...team })) });
}

/** Combat-only fixtures explicitly supply equipment; live versus games start empty. */
export function stockWeapons(game: GameEngine): void {
  for (const team of game.state.teams)
    for (const weapon of WEAPONS) team.inventory[weapon.id] = weapon.ammo;
  for (const player of game.state.players) {
    player.weapon = "rocket";
    player.hasCrate = true;
  }
}
