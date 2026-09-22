/** Only the operator's environment configures capacity; room options are untrusted. */
export function serverMaxTeams(value: string | undefined): number | null {
  if (value === undefined || value.trim() === "") return null;
  const limit = Number(value);
  if (!Number.isSafeInteger(limit) || limit < 2)
    throw new Error("MAX_TEAMS must be an integer of at least 2, or unset for no team cap.");
  return limit;
}
