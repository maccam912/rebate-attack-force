import type { TeamSettings } from "./types.js";

export const MAX_FROGS = 6;
export const MAX_HP = 500;
export const DEFAULT_TEAM_SETTINGS: TeamSettings = { frogs: 1, hp: 100 };

const TEAM_COLORS = ["#9fe870", "#ffb86b", "#b9a2ff", "#71dce4"];

/** Keep the original colors, then distribute additional teams around the hue wheel. */
export function teamColor(index: number): string {
  if (index < TEAM_COLORS.length) return TEAM_COLORS[index]!;
  const hue = ((index - TEAM_COLORS.length) * 137.508 + 15) % 360 / 60;
  const chroma = 0.48;
  const secondary = chroma * (1 - Math.abs(hue % 2 - 1));
  const rgb = hue < 1 ? [chroma, secondary, 0] : hue < 2 ? [secondary, chroma, 0] :
    hue < 3 ? [0, chroma, secondary] : hue < 4 ? [0, secondary, chroma] :
    hue < 5 ? [secondary, 0, chroma] : [chroma, 0, secondary];
  return `#${rgb.map((channel) => Math.round((channel + 0.48) * 255).toString(16).padStart(2, "0")).join("")}`;
}

export function validTeamSettings(value: unknown): value is TeamSettings {
  if (!value || typeof value !== "object") return false;
  const { frogs, hp } = value as TeamSettings;
  return Number.isInteger(frogs) && frogs >= 1 && frogs <= MAX_FROGS &&
    Number.isInteger(hp) && hp >= 1 && hp <= MAX_HP;
}

export function teamSettings(value: Partial<TeamSettings>): TeamSettings {
  const settings = { ...DEFAULT_TEAM_SETTINGS, ...value };
  return validTeamSettings(settings) ? settings : { ...DEFAULT_TEAM_SETTINGS };
}
