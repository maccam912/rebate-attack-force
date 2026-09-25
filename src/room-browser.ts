import { getMap } from "../shared/maps";
import { availableRooms } from "./network";

export const roomBrowserMarkup = `<section class="room-browser" aria-labelledby="room-browser-title">
  <div class="room-browser-heading"><h3 id="room-browser-title">Games waiting to start</h3><button class="copy-button" id="refresh-rooms" type="button">Refresh</button></div>
  <p class="room-browser-status" id="room-browser-status" role="status">Looking for games…</p>
  <div class="room-browser-list" id="room-browser-list"></div>
</section>`;

/** Only the list updates during polling, so typing a name or code is uninterrupted. */
export function mountRoomBrowser(root: HTMLElement, join: (roomId: string) => void): () => void {
  const list = root.querySelector<HTMLElement>("#room-browser-list")!;
  const status = root.querySelector<HTMLElement>("#room-browser-status")!;
  const refresh = root.querySelector<HTMLButtonElement>("#refresh-rooms")!;
  let disposed = false;
  let request: AbortController | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let previous = "";

  async function update() {
    if (disposed || request) return;
    clearTimeout(timer);
    request = new AbortController();
    const timeout = setTimeout(() => request?.abort(), 8000);
    refresh.disabled = true;
    try {
      const rooms = await availableRooms(request.signal);
      if (disposed) return;
      const signature = JSON.stringify(rooms);
      if (signature !== previous) {
        const focusedRoom = (document.activeElement as HTMLElement | null)?.dataset.joinRoom;
        list.replaceChildren(...rooms.map((room) => {
          const button = document.createElement("button");
          button.type = "button";
          button.className = "room-browser-game";
          button.dataset.joinRoom = room.roomId;
          const info = document.createElement("span");
          const name = document.createElement("strong");
          name.textContent = `${room.hostName}’s game`;
          const detail = document.createElement("small");
          detail.textContent = `${getMap(room.mapId).name} · ${room.teams}${room.maxTeams === null ? "" : `/${room.maxTeams}`} ${room.teams === 1 ? "team" : "teams"}`;
          info.append(name, detail);
          const action = document.createElement("span");
          action.className = "room-browser-join";
          action.textContent = "Join →";
          button.append(info, action);
          button.onclick = () => join(room.roomId);
          return button;
        }));
        if (focusedRoom) {
          const replacement = [...list.querySelectorAll<HTMLButtonElement>("button")]
            .find((button) => button.dataset.joinRoom === focusedRoom);
          (replacement ?? refresh).focus();
        }
        previous = signature;
      }
      status.textContent = rooms.length ? "Click a game to join. Updates automatically." : "No games waiting yet. Create a room and it will appear here.";
    } catch {
      if (disposed) return;
      list.replaceChildren();
      previous = "";
      status.textContent = "Couldn’t load games. Retrying… You can also tap Refresh.";
    } finally {
      clearTimeout(timeout);
      request = null;
      if (!disposed) {
        refresh.disabled = false;
        schedule();
      }
    }
  }
  function schedule() {
    timer = setTimeout(() => { if (!document.hidden) void update(); else schedule(); }, 3000);
  }
  refresh.onclick = () => void update();
  const onVisible = () => { if (!document.hidden) void update(); };
  document.addEventListener("visibilitychange", onVisible);
  void update();
  return () => {
    disposed = true;
    clearTimeout(timer);
    request?.abort();
    document.removeEventListener("visibilitychange", onVisible);
  };
}
