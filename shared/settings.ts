import type { TeamSettings } from "./types.js";

export const MAX_FROGS = 6;
export const MAX_HP = 500;
export const DEFAULT_TEAM_SETTINGS: TeamSettings = { frogs: 1, hp: 100 };

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
