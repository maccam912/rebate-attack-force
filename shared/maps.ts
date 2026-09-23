import type { Platform } from "./types.js";

export interface ArenaMap {
  id: string;
  name: string;
  description: string;
  size: "Small" | "Medium" | "Large";
  terrain: string;
  width: number;
  height: number;
  waterY: number;
  hasWater: boolean;
  theme: "scrapyard" | "cave" | "jungle" | "islands" | "yard";
  platforms: Platform[];
  /** Authored safe team ledges, in starting-team order. */
  spawnPlatformIds: string[];
}

export const DEFAULT_MAP_ID = "scrapyard";

const scrapyardPlatforms: Platform[] = [
    { id: "west-island", x: 60, y: 1600, w: 720, h: 200 },
    { id: "east-island", x: 3540, y: 1600, w: 720, h: 200 },
    { id: "foundry", x: 1060, y: 1480, w: 680, h: 320 },
    { id: "stepping-stone", x: 2050, y: 1600, w: 480, h: 200 },
    { id: "quarry", x: 2750, y: 1460, w: 480, h: 340 },
    { id: "west-shelf", x: 300, y: 1400, w: 280, h: 34 },
    { id: "west-bar", x: 100, y: 1130, w: 300, h: 28 },
    { id: "west-bridge", x: 650, y: 1170, w: 260, h: 34 },
    { id: "west-canopy", x: 480, y: 900, w: 280, h: 34 },
    { id: "west-tower", x: 60, y: 660, w: 320, h: 28 },
    { id: "west-summit", x: 540, y: 390, w: 320, h: 34 },
    { id: "foundry-shelf", x: 1130, y: 1210, w: 280, h: 36 },
    { id: "foundry-bar", x: 990, y: 930, w: 240, h: 34 },
    { id: "lookout", x: 1440, y: 720, w: 260, h: 32 },
    { id: "high-bridge", x: 1060, y: 450, w: 280, h: 32 },
    { id: "summit", x: 1550, y: 210, w: 380, h: 36 },
    { id: "central-shelf", x: 1740, y: 1080, w: 260, h: 38 },
    { id: "central-step", x: 2170, y: 1330, w: 300, h: 34 },
    { id: "central-canopy", x: 2140, y: 800, w: 280, h: 36 },
    { id: "central-tower", x: 1970, y: 480, w: 300, h: 34 },
    { id: "east-summit", x: 2460, y: 280, w: 300, h: 32 },
    { id: "quarry-bar", x: 2700, y: 650, w: 300, h: 34 },
    { id: "quarry-step", x: 2590, y: 1080, w: 260, h: 34 },
    { id: "quarry-shelf", x: 3040, y: 1220, w: 280, h: 34 },
    { id: "east-bridge", x: 3240, y: 930, w: 300, h: 34 },
    { id: "east-tower", x: 3190, y: 440, w: 280, h: 34 },
    { id: "east-canopy", x: 3760, y: 680, w: 300, h: 34 },
    { id: "east-bar", x: 3830, y: 1130, w: 300, h: 28 },
    { id: "east-shelf", x: 3690, y: 1400, w: 280, h: 34 },
  ];

const originalSpawnIds = ["west-island", "east-island", "foundry", "quarry"];

/** Every layout is hand-authored; previews and simulation use these same solids. */
export const MAPS: ArenaMap[] = [
  {
    id: DEFAULT_MAP_ID, name: "Scrapyard", size: "Medium", theme: "scrapyard",
    description: "The original iron playground: broad islands, straight ledges, and a long climb to the summit.",
    terrain: "Rectangular ledges · Open water", width: 4320, height: 1800, waterY: 1730, hasWater: true,
    platforms: scrapyardPlatforms,
    spawnPlatformIds: [...originalSpawnIds, ...scrapyardPlatforms.filter((p) => !originalSpawnIds.includes(p.id)).map((p) => p.id)],
  },
  {
    id: "pocket-yard", name: "Pocket Yard", size: "Small", theme: "yard",
    description: "A compact, dry training yard. Short sightlines and low, square platforms keep every team close to the action.",
    terrain: "Compact platforms · Solid ground", width: 2200, height: 1200, waterY: 2200, hasWater: false,
    platforms: [
      { id: "yard-floor", x: 0, y: 1090, w: 2200, h: 110, appearance: "slab" },
      { id: "yard-west", x: 90, y: 970, w: 420, h: 120, appearance: "slab" },
      { id: "yard-east", x: 1690, y: 970, w: 420, h: 120, appearance: "slab" },
      { id: "yard-middle", x: 900, y: 930, w: 400, h: 160, appearance: "slab" },
      { id: "yard-west-step", x: 510, y: 800, w: 320, h: 32, appearance: "slab" },
      { id: "yard-east-step", x: 1370, y: 800, w: 320, h: 32, appearance: "slab" },
      { id: "yard-west-tower", x: 120, y: 600, w: 320, h: 40, appearance: "slab" },
      { id: "yard-east-tower", x: 1780, y: 600, w: 300, h: 40, appearance: "slab" },
      { id: "yard-west-bridge", x: 760, y: 570, w: 300, h: 32, appearance: "slab" },
      { id: "yard-east-bridge", x: 1140, y: 570, w: 300, h: 32, appearance: "slab" },
      { id: "yard-west-top", x: 470, y: 340, w: 300, h: 36, appearance: "slab" },
      { id: "yard-east-top", x: 1430, y: 340, w: 300, h: 36, appearance: "slab" },
    ],
    spawnPlatformIds: ["yard-west", "yard-east", "yard-middle", "yard-west-step", "yard-east-step", "yard-west-tower", "yard-east-tower", "yard-west-bridge", "yard-east-bridge", "yard-west-top", "yard-east-top"],
  },
  {
    id: "crystal-cave", name: "Crystal Hollow", size: "Medium", theme: "cave",
    description: "A sealed, water-free cavern of glittering crystals. Bank shots off the ceiling and grapple through stacked stone chambers.",
    terrain: "Enclosed cavern · No water", width: 3400, height: 1700, waterY: 2700, hasWater: false,
    platforms: [
      { id: "cave-floor", x: 0, y: 1560, w: 3400, h: 140, appearance: "rock" },
      { id: "cave-roof", x: 0, y: 0, w: 3400, h: 100, appearance: "rock" },
      { id: "cave-west-wall", x: 0, y: 0, w: 90, h: 1560, appearance: "rock", boundary: "left" },
      { id: "cave-east-wall", x: 3310, y: 0, w: 90, h: 1560, appearance: "rock", boundary: "right" },
      { id: "cave-west-bank", x: 160, y: 1450, w: 560, h: 110, appearance: "rock" },
      { id: "cave-east-bank", x: 2680, y: 1450, w: 560, h: 110, appearance: "rock" },
      { id: "cave-heart", x: 1440, y: 1420, w: 520, h: 140, appearance: "crystal" },
      { id: "cave-west-step", x: 770, y: 1280, w: 320, h: 58, appearance: "rock" },
      { id: "cave-east-step", x: 2250, y: 1280, w: 360, h: 54, appearance: "rock" },
      { id: "cave-west-shelf", x: 320, y: 1130, w: 420, h: 54, appearance: "crystal" },
      { id: "cave-east-shelf", x: 2770, y: 1130, w: 420, h: 54, appearance: "crystal" },
      { id: "cave-west-crossing", x: 1170, y: 1050, w: 340, h: 48, appearance: "rock" },
      { id: "cave-east-crossing", x: 1850, y: 1020, w: 350, h: 48, appearance: "crystal" },
      { id: "cave-west-perch", x: 810, y: 850, w: 300, h: 52, appearance: "crystal" },
      { id: "cave-east-perch", x: 2390, y: 810, w: 340, h: 52, appearance: "rock" },
      { id: "cave-west-high", x: 230, y: 620, w: 360, h: 60, appearance: "rock" },
      { id: "cave-center-high", x: 1580, y: 730, w: 360, h: 52, appearance: "crystal" },
      { id: "cave-east-high", x: 2780, y: 530, w: 350, h: 56, appearance: "rock" },
      { id: "cave-west-crown", x: 1000, y: 500, w: 320, h: 46, appearance: "crystal" },
      { id: "cave-east-crown", x: 1930, y: 430, w: 340, h: 46, appearance: "crystal" },
    ],
    spawnPlatformIds: ["cave-west-bank", "cave-east-bank", "cave-heart", "cave-center-high", "cave-west-step", "cave-east-step", "cave-west-shelf", "cave-east-shelf", "cave-west-crossing", "cave-east-crossing", "cave-west-perch", "cave-east-perch", "cave-west-high", "cave-east-high", "cave-west-crown", "cave-east-crown"],
  },
  {
    id: "razor-reef", name: "Razor Reef", size: "Large", theme: "islands",
    description: "Jagged sea stacks and tiny stepping stones rise above a hungry ocean. Take the high route, or risk the gaps below.",
    terrain: "Narrow rocks · Treacherous water", width: 4000, height: 2050, waterY: 1820, hasWater: true,
    platforms: [
      { id: "reef-west", x: 80, y: 1720, w: 460, h: 330, appearance: "rock" },
      { id: "reef-east", x: 3460, y: 1720, w: 460, h: 330, appearance: "rock" },
      { id: "reef-heart", x: 1760, y: 1650, w: 480, h: 400, appearance: "rock" },
      { id: "reef-west-skerry", x: 790, y: 1740, w: 130, h: 310, appearance: "rock" },
      { id: "reef-west-tooth", x: 1240, y: 1770, w: 110, h: 280, appearance: "rock" },
      { id: "reef-east-tooth", x: 2690, y: 1750, w: 120, h: 300, appearance: "rock" },
      { id: "reef-east-skerry", x: 3090, y: 1770, w: 110, h: 280, appearance: "rock" },
      { id: "reef-west-step", x: 460, y: 1470, w: 280, h: 70, appearance: "rock" },
      { id: "reef-west-spire", x: 1030, y: 1390, w: 290, h: 96, appearance: "rock" },
      { id: "reef-east-step", x: 3240, y: 1470, w: 280, h: 70, appearance: "rock" },
      { id: "reef-east-spire", x: 2720, y: 1260, w: 300, h: 96, appearance: "rock" },
      { id: "reef-west-arch", x: 1530, y: 1190, w: 300, h: 66, appearance: "rock" },
      { id: "reef-east-arch", x: 2190, y: 1390, w: 290, h: 66, appearance: "rock" },
      { id: "reef-west-shelf", x: 100, y: 1090, w: 300, h: 64, appearance: "rock" },
      { id: "reef-west-high", x: 660, y: 930, w: 300, h: 66, appearance: "rock" },
      { id: "reef-west-crown", x: 1210, y: 710, w: 300, h: 70, appearance: "rock" },
      { id: "reef-heart-crown", x: 1770, y: 470, w: 310, h: 70, appearance: "rock" },
      { id: "reef-heart-high", x: 2060, y: 950, w: 290, h: 74, appearance: "rock" },
      { id: "reef-east-crown", x: 2460, y: 690, w: 300, h: 68, appearance: "rock" },
      { id: "reef-east-high", x: 3080, y: 850, w: 280, h: 68, appearance: "rock" },
      { id: "reef-east-shelf", x: 3600, y: 1060, w: 290, h: 64, appearance: "rock" },
    ],
    spawnPlatformIds: ["reef-west", "reef-east", "reef-heart", "reef-east-spire", "reef-west-step", "reef-west-spire", "reef-east-step", "reef-west-arch", "reef-east-arch", "reef-west-shelf", "reef-west-high", "reef-west-crown", "reef-heart-crown", "reef-heart-high", "reef-east-crown", "reef-east-high", "reef-east-shelf"],
  },
  {
    id: "wild-canopy", name: "Wild Canopy", size: "Large", theme: "jungle",
    description: "A sprawling jungle above the river. Leap between leafy crowns, swing from branches, and land on sleepy tortoises and crocodiles.",
    terrain: "Trees & animal platforms · River below", width: 5600, height: 2300, waterY: 2180, hasWater: true,
    platforms: [
      { id: "jungle-west-root", x: 80, y: 2010, w: 700, h: 290, appearance: "rock" },
      { id: "jungle-east-root", x: 4830, y: 2010, w: 690, h: 290, appearance: "rock" },
      { id: "jungle-center-root", x: 1850, y: 2130, w: 410, h: 170, appearance: "rock" },
      { id: "jungle-river-rock", x: 3290, y: 2100, w: 450, h: 200, appearance: "rock" },
      { id: "jungle-west-tortoise", x: 1030, y: 2020, w: 330, h: 130, appearance: "tortoise" },
      { id: "jungle-crocodile", x: 2500, y: 2110, w: 380, h: 90, appearance: "crocodile" },
      { id: "jungle-east-tortoise", x: 4090, y: 2030, w: 340, h: 135, appearance: "tortoise" },
      { id: "jungle-west-crown", x: 320, y: 1660, w: 650, h: 125, appearance: "canopy" },
      { id: "jungle-east-crown", x: 4650, y: 1670, w: 650, h: 125, appearance: "canopy" },
      { id: "jungle-west-tree", x: 1040, y: 1510, w: 500, h: 112, appearance: "canopy" },
      { id: "jungle-east-tree", x: 3960, y: 1580, w: 500, h: 112, appearance: "canopy" },
      { id: "jungle-west-branch", x: 1730, y: 1650, w: 300, h: 30, appearance: "branch" },
      { id: "jungle-center-branch", x: 2990, y: 1730, w: 340, h: 30, appearance: "branch" },
      { id: "jungle-east-branch", x: 3480, y: 1810, w: 290, h: 28, appearance: "branch" },
      { id: "jungle-heart-crown", x: 2140, y: 1120, w: 590, h: 125, appearance: "canopy" },
      { id: "jungle-great-crown", x: 3330, y: 1310, w: 600, h: 125, appearance: "canopy" },
      { id: "jungle-heart-branch", x: 2500, y: 1410, w: 330, h: 28, appearance: "branch" },
      { id: "jungle-west-high", x: 650, y: 1190, w: 520, h: 112, appearance: "canopy" },
      { id: "jungle-east-high", x: 4650, y: 1180, w: 500, h: 112, appearance: "canopy" },
      { id: "jungle-west-lookout", x: 1600, y: 920, w: 480, h: 112, appearance: "canopy" },
      { id: "jungle-center-lookout", x: 2750, y: 710, w: 500, h: 112, appearance: "canopy" },
      { id: "jungle-east-lookout", x: 3860, y: 880, w: 490, h: 112, appearance: "canopy" },
      { id: "jungle-high-branch", x: 3760, y: 1110, w: 300, h: 28, appearance: "branch" },
      { id: "jungle-west-summit", x: 1910, y: 450, w: 450, h: 105, appearance: "canopy" },
      { id: "jungle-east-summit", x: 3420, y: 480, w: 460, h: 105, appearance: "canopy" },
      { id: "jungle-west-crown-top", x: 420, y: 1618, w: 430, h: 42, appearance: "canopy" },
      { id: "jungle-east-crown-top", x: 4760, y: 1632, w: 440, h: 38, appearance: "canopy" },
      { id: "jungle-heart-crown-top", x: 2210, y: 1072, w: 410, h: 48, appearance: "canopy" },
      { id: "jungle-great-crown-top", x: 3430, y: 1270, w: 430, h: 40, appearance: "canopy" },
      { id: "jungle-west-tree-top", x: 1110, y: 1478, w: 360, h: 32, appearance: "canopy" },
      { id: "jungle-east-tree-top", x: 4030, y: 1544, w: 350, h: 36, appearance: "canopy" },
    ],
    spawnPlatformIds: ["jungle-west-crown-top", "jungle-east-crown-top", "jungle-heart-crown-top", "jungle-great-crown-top", "jungle-west-root", "jungle-east-root", "jungle-center-root", "jungle-river-rock", "jungle-west-tortoise", "jungle-crocodile", "jungle-east-tortoise", "jungle-west-tree-top", "jungle-east-tree-top", "jungle-west-branch", "jungle-center-branch", "jungle-east-branch", "jungle-heart-branch", "jungle-west-high", "jungle-east-high", "jungle-west-lookout", "jungle-center-lookout", "jungle-east-lookout", "jungle-high-branch", "jungle-west-summit", "jungle-east-summit"],
  },
];

export function isMapId(value: unknown): value is string {
  return typeof value === "string" && MAPS.some((map) => map.id === value);
}

export function getMap(id?: string): ArenaMap {
  return MAPS.find((map) => map.id === id) ?? MAPS[0]!;
}
