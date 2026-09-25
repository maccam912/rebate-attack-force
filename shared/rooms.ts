/** Public lobby information; no session identifiers or reconnect tokens. */
export interface AvailableRoom {
  roomId: string;
  hostName: string;
  mapId: string;
  teams: number;
  maxTeams: number | null;
}
