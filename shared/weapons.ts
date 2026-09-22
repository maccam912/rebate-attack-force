import type { GameMode, HazardKind, StatusKind, WeaponId } from "./types.js";

export type WeaponCategory = "Launchers" | "Bombs" | "Melee" | "Traps" | "Air support" | "Oddities" | "Hazards" | "Gravity" | "Disruption";
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
  /** Status duration counts only during the affected frog's control. */
  status?: { kind: StatusKind; duration: number };
  hazard?: { kind: HazardKind; radius: number; turns: number };
  cutsRopes?: boolean;
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
  weapon({ id: "oilSlick", name: "Liquid Liability", icon: "🛢️", category: "Hazards", description: "Spills a low-friction oil slick onto a platform. Lasts 4 turn changes; mind your stopping distance.", ammo: 2, speed: 620, radius: 70, damage: 8, impulse: 250, lift: 60, life: 3, color: "#9ca5c5", hazard: { kind: "oil", radius: 160, turns: 4 } }),
  weapon({ id: "iceBomb", name: "Black Ice Special", icon: "🧊", category: "Hazards", description: "Glazes a platform with slippery, chilling ice for 4 turn changes. A chilled frog loses speed and jump height.", ammo: 2, speed: 580, radius: 90, damage: 12, impulse: 320, lift: 100, life: 1.8, contact: "bounce", color: "#a3edff", hazard: { kind: "ice", radius: 150, turns: 4 } }),
  weapon({ id: "glueGlob", name: "Industrial Adhesive", icon: "🫧", category: "Hazards", description: "A sticky glob leaves a patch of glue for 4 turn changes, dragging down movement and jumps.", ammo: 2, speed: 540, radius: 70, damage: 6, impulse: 140, lift: 35, life: 1.3, contact: "stick", color: "#ffc2ef", hazard: { kind: "glue", radius: 130, turns: 4 } }),
  weapon({ id: "razorWire", name: "Red Tape", icon: "🪢", category: "Hazards", description: "Drops barbed wire onto a platform for 5 turn changes. Cuts any exposed rope segment crossing it and hurts trespassers.", attack: "airstrike", speed: 270, radius: 70, damage: 8, impulse: 170, lift: 40, life: 8, cutsRopes: true, color: "#e2abb0", hazard: { kind: "wire", radius: 135, turns: 5 } }),
  weapon({ id: "molotov", name: "Hotline Complaint", icon: "🔥", category: "Hazards", description: "Shatters into a burning platform patch for 3 turn changes. Fire keeps burning during the victim's control.", ammo: 2, speed: 640, radius: 85, damage: 18, impulse: 300, lift: 95, life: 3, color: "#ff9354", hazard: { kind: "fire", radius: 135, turns: 3 } }),
  weapon({ id: "poisonCloud", name: "Toxic Workplace", icon: "☣️", category: "Hazards", description: "Fumigates a platform for 4 turn changes. Poison damage ticks only while the affected frog has control.", speed: 530, radius: 90, damage: 6, impulse: 120, lift: 45, life: 1.5, contact: "bounce", color: "#b8ec70", hazard: { kind: "poison", radius: 165, turns: 4 } }),
  weapon({ id: "gravityWell", name: "Hostile Takeover", icon: "🕳️", category: "Gravity", description: "Leaves a floating gravity well for 3 turn changes, pulling the active frog toward its center through open air.", speed: 590, gravity: 120, radius: 105, damage: 10, impulse: 250, lift: 25, life: 1.3, kind: "pull", color: "#b699ff", hazard: { kind: "gravity", radius: 235, turns: 3 } }),
  weapon({ id: "repulsor", name: "Personal Space Bubble", icon: "🛑", category: "Gravity", description: "A floating repulsor lasts 3 turn changes. It continuously pushes the active frog away from its center.", speed: 640, gravity: 80, radius: 90, damage: 0, impulse: 470, lift: 85, life: 1.15, kind: "push", color: "#ff95ce", hazard: { kind: "repulsor", radius: 215, turns: 3 } }),
  weapon({ id: "updraft", name: "Corporate Uplift", icon: "🌬️", category: "Gravity", description: "Deploys a floating updraft for 3 turn changes. The active frog can ride its rising air around cover.", ammo: 2, speed: 570, gravity: 130, radius: 85, damage: 0, impulse: 130, lift: 350, life: 1.3, kind: "spring", color: "#95efff", hazard: { kind: "updraft", radius: 175, turns: 3 } }),
  weapon({ id: "springPad", name: "Bounce Check", icon: "🛝", category: "Hazards", description: "Plants a reusable trampoline for 5 turn changes. Launches a visiting active frog once each turn.", ammo: 2, speed: 540, radius: 65, damage: 0, impulse: 140, lift: 250, life: 2.7, kind: "spring", color: "#d1ff88", hazard: { kind: "spring", radius: 105, turns: 5 } }),
  weapon({ id: "cryoRay", name: "Cold Shoulder", icon: "❄️", category: "Disruption", description: "A fast freezing ray chills a frog for its next 9 seconds of control, slowing movement and weakening jumps.", ammo: 2, speed: 1500, gravity: 0, radius: 62, damage: 18, impulse: 270, lift: 60, life: 2, color: "#9edfff", status: { kind: "chilled", duration: 9 } }),
  weapon({ id: "invertRay", name: "Reverse Psychology", icon: "↔️", category: "Disruption", description: "Flips left/right movement and rope reeling for the victim's next 8 seconds of control.", speed: 1150, gravity: 0, radius: 85, damage: 12, impulse: 320, lift: 100, life: 2.5, color: "#d0a0ff", status: { kind: "inverted", duration: 8 } }),
  weapon({ id: "flashbang", name: "Mandatory Brightness", icon: "💡", category: "Disruption", description: "A short-fuse flash leaves a dazzling glare over the victim's view for its next 6 seconds of control.", ammo: 2, speed: 680, radius: 175, damage: 8, impulse: 210, lift: 80, life: 1.15, contact: "bounce", color: "#fff4c4", status: { kind: "dazzled", duration: 6 } }),
  weapon({ id: "pixelBomb", name: "Compression Artifact", icon: "👾", category: "Disruption", description: "A bouncing glitch bomb pixelates the victim's view for its next 8 seconds of control.", speed: 600, radius: 150, damage: 16, impulse: 420, lift: 140, life: 1.7, contact: "bounce", color: "#94ffc5", status: { kind: "pixelated", duration: 8 } }),
  weapon({ id: "confusionBomb", name: "Meeting That Could Be Email", icon: "😵‍💫", category: "Disruption", description: "A rainbow blast distorts the victim's view for its next 8 seconds of control. Solid cover blocks the effect.", speed: 550, radius: 155, damage: 10, impulse: 370, lift: 170, life: 1.6, contact: "bounce", color: "#ed9eff", status: { kind: "confused", duration: 8 } }),
  weapon({ id: "heavyRay", name: "Crushing Responsibility", icon: "⚓", category: "Gravity", description: "Makes a frog heavy for its next 9 seconds of control: stronger gravity, slower movement and weaker jumps.", speed: 1280, gravity: 0, radius: 75, damage: 22, impulse: 240, lift: 40, life: 2.2, color: "#b2b8dd", status: { kind: "heavy", duration: 9 } }),
  weapon({ id: "featherRay", name: "Light Duty", icon: "🪶", category: "Gravity", description: "Reduces a frog's gravity for its next 10 seconds of control. Low gravity makes every launch linger.", ammo: 2, speed: 1120, gravity: -45, radius: 95, damage: 8, impulse: 420, lift: 370, life: 2.3, color: "#fff1bb", status: { kind: "feather", duration: 10 } }),
  weapon({ id: "fireDart", name: "Spicy Feedback", icon: "🌶️", category: "Launchers", description: "A pinpoint incendiary dart burns its target over its next 8 seconds of control.", ammo: 2, speed: 1700, gravity: 50, radius: 45, damage: 20, impulse: 310, lift: 60, life: 2, color: "#ff8063", status: { kind: "burning", duration: 8 } }),
  weapon({ id: "venomDart", name: "Poisoned Pen", icon: "🖋️", category: "Launchers", description: "A precise venom dart poisons its target over its next 10 seconds of control.", ammo: 2, speed: 1600, gravity: 90, radius: 45, damage: 15, impulse: 230, lift: 50, life: 2.2, color: "#c4ed83", status: { kind: "poisoned", duration: 10 } }),
  weapon({ id: "slipperyEel", name: "Eel Deal", icon: "🪱", category: "Oddities", description: "A springy eel coats its victim in slippery slime for its next 10 seconds of control.", ammo: 2, speed: 780, gravity: 700, radius: 90, damage: 18, impulse: 550, lift: 150, life: 1.7, bounce: 0.84, contact: "bounce", color: "#84edd0", status: { kind: "slippery", duration: 10 } }),
  weapon({ id: "glueSlap", name: "Sticky Handshake", icon: "🤝", category: "Melee", description: "A close-range adhesive slap hinders movement and jumps for the victim's next 9 seconds of control.", ammo: 2, attack: "melee", range: 112, radius: 65, damage: 25, impulse: 260, lift: 85, kind: "melee", color: "#ffaee0", status: { kind: "sticky", duration: 9 } }),
  weapon({ id: "rubberizer", name: "Elastic Clause", icon: "🟣", category: "Oddities", description: "A rubber capsule makes terrain collisions extra bouncy for the victim's next 10 seconds of control.", speed: 720, gravity: 450, radius: 120, damage: 10, impulse: 620, lift: 440, life: 1.5, bounce: 0.86, contact: "bounce", color: "#dca0ff", status: { kind: "bouncy", duration: 10 } }),
  weapon({ id: "ropeShears", name: "Severance Package", icon: "✂️", category: "Melee", description: "A long scissor swipe severs exposed rope segments within reach and knocks nearby frogs away.", ammo: 2, attack: "melee", range: 155, radius: 155, damage: 28, impulse: 780, lift: 190, kind: "melee", cutsRopes: true, color: "#e8d9cf" }),
  weapon({ id: "chaosOrb", name: "Unscheduled Everything", icon: "🔮", category: "Oddities", description: "Cuts exposed ropes, distorts hit frogs' next 7 seconds of control, and leaves a gravity well for 2 turn changes.", speed: 580, gravity: 300, radius: 165, damage: 22, impulse: 550, lift: 190, life: 1.8, bounce: 0.72, contact: "bounce", kind: "pull", cutsRopes: true, color: "#ed8cff", status: { kind: "confused", duration: 7 }, hazard: { kind: "gravity", radius: 190, turns: 2 } }),
];

export const WEAPON_IDS: WeaponId[] = WEAPONS.map((definition) => definition.id);
export const WEAPON_CATALOG = Object.fromEntries(WEAPONS.map((definition) => [definition.id, definition])) as Record<WeaponId, WeaponDefinition>;
export const WEAPON_DEFS = WEAPON_CATALOG;
export function createInventory(mode: GameMode = "versus"): Record<WeaponId, number> {
  return Object.fromEntries(WEAPONS.map((definition) => [definition.id, mode === "practice" ? 9 : definition.ammo])) as Record<WeaponId, number>;
}
