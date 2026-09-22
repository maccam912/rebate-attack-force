import type { GameMode, WeaponId } from "./types.js";

export type WeaponCategory = "Launchers" | "Bombs" | "Melee" | "Traps" | "Air support" | "Oddities";
export type BlastKind = "blast" | "push" | "pull" | "spring" | "melee";
export interface WeaponDefinition {
  id: WeaponId;
  name: string;
  icon: string;
  description: string;
  category: WeaponCategory;
  color: string;
  ammo: number;
  attack: "projectile" | "melee" | "mine" | "airstrike" | "blast";
  speed: number;
  gravity: number;
  radius: number;
  damage: number;
  impulse: number;
  lift: number;
  life: number;
  bounce: number;
  contact: "explode" | "bounce" | "stick";
  range: number;
  spread: number;
  pellets: number;
  fragments: number;
  kind: BlastKind;
}

function weapon(definition: Pick<WeaponDefinition, "id" | "name" | "icon" | "description" | "category"> & Partial<WeaponDefinition>): WeaponDefinition {
  return {
    color: "#ffb75e", ammo: 1, attack: "projectile", speed: 630, gravity: 1050,
    radius: 115, damage: 60, impulse: 950, lift: 210, life: 2.5,
    bounce: 0.54, contact: "explode", range: 110, spread: 0, pellets: 1,
    fragments: 0, kind: "blast", ...definition,
  };
}

/** One shared catalogue drives loadouts, server validation, ballistics and the armory UI. */
export const WEAPONS: readonly WeaponDefinition[] = [
  weapon({ id: "rocket", name: "Rebate Rocket", icon: "🚀", category: "Launchers", description: "A straight, dependable rocket. Blast feet, then watch frogs fly.", ammo: 3, speed: 800, gravity: 0, radius: 108, damage: 62, life: 5 }),
  weapon({ id: "grenade", name: "Pocket Grenade", icon: "💣", category: "Bombs", description: "Bounces off ledges before its 2.1 second fuse goes pop.", ammo: 2, radius: 132, damage: 72, life: 2.1, contact: "bounce" }),
  weapon({ id: "pulse", name: "Sonic Burp", icon: "📣", category: "Oddities", description: "A short, directional shockwave. The burper is spared.", ammo: 2, attack: "blast", range: 92, radius: 108, damage: 36, impulse: 1100, kind: "push", color: "#87ecff" }),
  weapon({ id: "megaBomb", name: "Demolition Melon", icon: "🍉", category: "Bombs", description: "A heavy, slow bomb with a 3 second fuse and a gigantic blast.", speed: 410, radius: 245, damage: 96, impulse: 1600, lift: 390, life: 3, bounce: 0.28, contact: "bounce", color: "#ff728a" }),
  weapon({ id: "cluster", name: "Confetti Cluster", icon: "🎊", category: "Bombs", description: "A bouncing shell bursts into seven live confetti bomblets.", radius: 76, damage: 24, impulse: 580, fragments: 7, life: 1.5, contact: "bounce", color: "#eab1ff" }),
  weapon({ id: "banana", name: "Banana Split", icon: "🍌", category: "Bombs", description: "Five big bananas ricochet from a slow, wildly bouncy parent.", speed: 510, radius: 90, damage: 26, fragments: 5, life: 1.7, bounce: 0.76, contact: "bounce", color: "#ffe46a" }),
  weapon({ id: "bouncer", name: "Rubber Ruin", icon: "🏀", category: "Oddities", description: "An almost elastic ball banks around corners for four seconds.", speed: 850, radius: 105, damage: 48, impulse: 1200, life: 4, bounce: 0.94, contact: "bounce", color: "#ff9457" }),
  weapon({ id: "sticky", name: "Chewing Boom", icon: "🍬", category: "Bombs", description: "Sticks to the first wall, floor or frog it hits. Fuse: 2.8 seconds.", radius: 150, damage: 78, life: 2.8, contact: "stick", color: "#ffa5d9" }),
  weapon({ id: "mine", name: "Personal Space Mine", icon: "💥", category: "Traps", description: "Arms next turn. An active frog nearby starts a short warning fuse.", attack: "mine", speed: 220, radius: 145, damage: 62, impulse: 1100, range: 80, color: "#ff7765" }),
  weapon({ id: "springMine", name: "Unwelcome Mat", icon: "🪤", category: "Traps", description: "A reusable-looking trap with one enormous upward spring. Arms next turn.", attack: "mine", speed: 150, radius: 100, damage: 12, impulse: 850, lift: 1250, range: 65, kind: "spring", color: "#b4ff83" }),
  weapon({ id: "golf", name: "Nine-Irony", icon: "⛳", category: "Melee", description: "A steep chip shot that turns a nearby frog into a golf ball.", ammo: 2, attack: "melee", range: 106, damage: 28, impulse: 950, lift: 850, kind: "melee", color: "#e4ffc0" }),
  weapon({ id: "bat", name: "Home Run", icon: "🏏", category: "Melee", description: "A broad swing sends nearby frogs screaming sideways.", ammo: 2, attack: "melee", range: 122, damage: 34, impulse: 1380, lift: 270, kind: "melee", color: "#e7bf91" }),
  weapon({ id: "boxing", name: "Express Delivery", icon: "🥊", category: "Melee", description: "Short reach, a sharp punch, and a little recoil for the sender.", ammo: 3, attack: "melee", range: 74, damage: 48, impulse: 980, lift: 200, kind: "melee", color: "#ff817e" }),
  weapon({ id: "airstrike", name: "Special Delivery", icon: "✈️", category: "Air support", description: "Five impact bombs sweep across the aimed column. Roofs provide cover.", attack: "airstrike", speed: 470, radius: 112, damage: 42, impulse: 870, pellets: 5, spread: 100, life: 8, color: "#ffc68b" }),
  weapon({ id: "meteor", name: "Extinction Event", icon: "☄️", category: "Air support", description: "One enormous meteor drops at your cursor. Mind the roof above you.", attack: "airstrike", speed: 310, radius: 285, damage: 100, impulse: 1700, lift: 450, life: 8, color: "#ff684f" }),
  weapon({ id: "shotgun", name: "Salt Shaker", icon: "🧂", category: "Launchers", description: "Seven fast pellets spread into a close-range spray of tiny impacts.", ammo: 2, speed: 1500, gravity: 90, radius: 28, damage: 10, impulse: 200, lift: 22, pellets: 7, spread: 0.25, life: 0.3, color: "#ffedc2" }),
  weapon({ id: "sniper", name: "Complaint Department", icon: "🎯", category: "Launchers", description: "A precise, very fast shot with a small impact and a hefty shove.", speed: 2600, gravity: 0, radius: 28, damage: 68, impulse: 680, lift: 40, life: 2, color: "#fff4ac" }),
  weapon({ id: "mortar", name: "Lob Goblin", icon: "🏺", category: "Launchers", description: "A heavy impact shell arcs over cover and detonates on contact.", speed: 950, gravity: 1450, radius: 165, damage: 74, impulse: 1150, lift: 340, life: 5, color: "#dbd4a0" }),
  weapon({ id: "firework", name: "Grand Finale", icon: "🎆", category: "Launchers", description: "A rising rocket bursts into nine impact stars after 0.9 seconds.", speed: 550, gravity: -180, radius: 70, damage: 16, fragments: 9, life: 0.9, color: "#c4a2ff" }),
  weapon({ id: "anvil", name: "Gravity's Invoice", icon: "⚒️", category: "Air support", description: "A compact anvil falls at the cursor. Crushing hit, little blast.", attack: "airstrike", speed: 150, gravity: 2200, radius: 56, damage: 92, impulse: 600, lift: 160, life: 8, color: "#c8d3dd" }),
  weapon({ id: "vacuum", name: "Debt Collector", icon: "🌀", category: "Oddities", description: "A bouncing singularity drags frogs toward its center, then lets them drop.", radius: 265, damage: 16, impulse: 1250, lift: 70, life: 1.8, contact: "bounce", kind: "pull", color: "#a79aff" }),
  weapon({ id: "gust", name: "Industrial Hairdryer", icon: "🌪️", category: "Oddities", description: "No direct damage. A huge forward gust makes gravity somebody else's problem.", ammo: 2, attack: "blast", range: 120, radius: 175, damage: 0, impulse: 1500, lift: 280, kind: "push", color: "#9eeeff" }),
  weapon({ id: "disco", name: "Disco Inferno", icon: "🪩", category: "Oddities", description: "Three bouncy dance balls fan out, each flinging frogs upward.", speed: 560, radius: 95, damage: 28, impulse: 740, lift: 560, life: 2.6, bounce: 0.8, contact: "bounce", pellets: 3, spread: 0.34, color: "#f593ff" }),
  weapon({ id: "boomerang", name: "Return to Sender", icon: "🪃", category: "Oddities", description: "A curved throw accelerates back toward its owner. Duck on the return.", ammo: 2, speed: 850, gravity: 0, radius: 68, damage: 46, impulse: 1000, lift: 260, life: 2.4, color: "#9deac9" }),
];

export const WEAPON_IDS: WeaponId[] = WEAPONS.map((definition) => definition.id);
export const WEAPON_CATALOG = Object.fromEntries(WEAPONS.map((definition) => [definition.id, definition])) as Record<WeaponId, WeaponDefinition>;
export const WEAPON_DEFS = WEAPON_CATALOG;
export function createInventory(mode: GameMode = "versus"): Record<WeaponId, number> {
  return Object.fromEntries(WEAPONS.map((definition) => [definition.id, mode === "practice" ? 9 : definition.ammo])) as Record<WeaponId, number>;
}
