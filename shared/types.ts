export type WeaponId = "rocket" | "grenade" | "pulse";
export type GameMode = "practice" | "versus";
export type GamePhase = "playing" | "retreat" | "settling" | "finished";

export interface Platform {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface PlayerInput {
  left: boolean;
  right: boolean;
  up: boolean;
  down: boolean;
  aimX: number;
  aimY: number;
}

export interface Point {
  x: number;
  y: number;
}

export interface Rope extends Point {
  length: number;
  bends: Point[];
}

export interface Player {
  id: string;
  name: string;
  color: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  hp: number;
  alive: boolean;
  grounded: boolean;
  rope: Rope | null;
  rotation: number;
  tumble: number;
  inventory: Record<WeaponId, number>;
  weapon: WeaponId | null;
  hasCrate: boolean;
}

export interface Crate {
  id: string;
  x: number;
  y: number;
  weapon: WeaponId;
}

export interface Projectile {
  id: string;
  ownerId: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  kind: WeaponId;
  life: number;
  radius: number;
  damage: number;
}

export interface Explosion {
  id: string;
  x: number;
  y: number;
  radius: number;
  age: number;
}

export interface GameState {
  width: number;
  height: number;
  waterY: number;
  platforms: Platform[];
  players: Player[];
  crates: Crate[];
  projectiles: Projectile[];
  explosions: Explosion[];
  activePlayerId: string;
  phase: GamePhase;
  turn: number;
  timeLeft: number;
  mode: GameMode;
  winnerId: string | null;
  message: string;
}

export type GameCommand = {
  type: "jump" | "grapple" | "release" | "fire" | "endTurn" | "selectWeapon";
  power?: number;
  weapon?: WeaponId;
};

export interface GameOptions {
  players?: { id: string; name: string; color?: string }[];
  mode?: GameMode;
  seed?: number;
}
