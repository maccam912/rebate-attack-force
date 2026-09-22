export type WeaponId =
  | "rocket" | "grenade" | "pulse" | "megaBomb" | "cluster" | "banana"
  | "bouncer" | "sticky" | "mine" | "springMine" | "golf" | "bat" | "boxing"
  | "airstrike" | "meteor" | "shotgun" | "sniper" | "mortar" | "firework"
  | "anvil" | "vacuum" | "gust" | "disco" | "boomerang";
export type GameMode = "practice" | "versus";
export type GamePhase = "playing" | "retreat" | "settling" | "damage" | "waiting" | "finished";

export type GameSoundKind =
  | "jump" | "backflip" | "grapple" | "release" | "land" | "bounce"
  | "hurt" | "death" | "splash" | "respawn" | "shot" | "explosion"
  | "pickup" | "switch" | "select" | "mineArm" | "mineTrigger" | "victory";

/** A bounded history lets network snapshots retain even very short-lived actions. */
export interface GameSoundEvent {
  id: number;
  kind: GameSoundKind;
  x: number;
  y: number;
  playerId?: string;
  weapon?: WeaponId;
  intensity?: number;
}

export interface TeamSettings {
  frogs: number;
  hp: number;
}

export interface Team extends TeamSettings {
  id: string;
  name: string;
  color: string;
  connected: boolean;
  /** Bot teams use the same turn and combat rules, without a client connection. */
  bot?: boolean;
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
  /** Empty for neutral mines placed in the arena before the match. */
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

/** Authoritative presentation clocks also survive network prediction and replay. */
export interface DamageReveal {
  playerId: string;
  damage: number;
  fromHp: number;
  toHp: number;
  elapsed: number;
  applied: boolean;
  drowned: boolean;
}

export interface TurnResolution {
  affectedPlayerIds: string[];
  pendingDamage: Record<string, number>;
  drownedPlayerIds: string[];
  focus: Point | null;
  reveal: DamageReveal | null;
  slowMotionRemaining: number;
  impact: number;
  weapon?: WeaponId;
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
  /** Optional when reading older saved states or servers. */
  soundEvents?: GameSoundEvent[];
  soundSequence?: number;
  /** Absent in older snapshots; HP remains unchanged until each damage reveal. */
  resolution?: TurnResolution | null;
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
  players?: { id: string; name: string; color?: string; frogs?: number; hp?: number; connected?: boolean; bot?: boolean }[];
  mode?: GameMode;
  seed?: number;
  /** Maximum starting mines; crowded arenas use only safely available positions. */
  mineCount?: number;
}
