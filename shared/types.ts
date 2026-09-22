export type WeaponId =
  | "rocket" | "grenade" | "pulse" | "megaBomb" | "cluster" | "banana"
  | "bouncer" | "sticky" | "mine" | "springMine" | "golf" | "bat" | "boxing"
  | "airstrike" | "meteor" | "shotgun" | "sniper" | "mortar" | "firework"
  | "anvil" | "vacuum" | "gust" | "disco" | "boomerang";
export type GameMode = "practice" | "versus";
export type GamePhase = "playing" | "retreat" | "settling" | "waiting" | "finished";

export interface TeamSettings {
  frogs: number;
  hp: number;
}

export interface Team extends TeamSettings {
  id: string;
  name: string;
  color: string;
  connected: boolean;
}

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
  teamId: string;
  number: number;
  name: string;
  color: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  hp: number;
  maxHp: number;
  facing: -1 | 1;
  alive: boolean;
  grounded: boolean;
  lookAt: Point;
  rope: Rope | null;
  rotation: number;
  angularVelocity: number;
  /** Recent collision intensity for cosmetic squash, flashes and leg reactions. */
  impact: number;
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
  variant?: "fragment" | "strike";
  age?: number;
  stuck?: boolean;
  attachedPlayerId?: string;
  bounces?: number;
}

export interface Mine {
  id: string;
  ownerId: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  kind: "mine" | "springMine";
  placedTurn: number;
  fuse: number | null;
  settled: boolean;
}

export interface Explosion {
  id: string;
  x: number;
  y: number;
  radius: number;
  age: number;
  weapon?: WeaponId;
  kind?: "blast" | "push" | "pull" | "spring" | "melee";
  color?: string;
  direction?: number;
}

export interface GameState {
  width: number;
  height: number;
  waterY: number;
  platforms: Platform[];
  players: Player[];
  teams: Team[];
  crates: Crate[];
  projectiles: Projectile[];
  mines: Mine[];
  explosions: Explosion[];
  activePlayerId: string;
  activeTeamId: string;
  phase: GamePhase;
  turn: number;
  timeLeft: number;
  mode: GameMode;
  winnerId: string | null;
  message: string;
}

export type GameCommand = {
  type: "jump" | "backflip" | "grapple" | "release" | "fire" | "endTurn" | "selectWeapon";
  power?: number;
  weapon?: WeaponId;
};

export interface GameOptions {
  players?: { id: string; name: string; color?: string; frogs?: number; hp?: number; connected?: boolean }[];
  mode?: GameMode;
  seed?: number;
}
