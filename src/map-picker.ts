import { MAPS, getMap, isMapId } from "../shared/maps";
import { drawMapPreview } from "./map-preview";
import "./map-picker.css";

/** The catalog is authored locally; no player-controlled strings enter this markup. */
export function mapPickerMarkup(mapId: string, editable: boolean): string {
  const map = getMap(mapId);
  return `<section class="map-picker" aria-label="Map selection" data-map-id="${map.id}">
    <div class="map-picker-heading"><label for="map-select">CHOOSE YOUR BATTLEGROUND</label><span data-map-counter></span></div>
    <div class="map-picker-controls">
      <button type="button" data-map-step="-1" aria-label="Previous map" ${editable ? "" : "disabled"}>‹</button>
      <select id="map-select" aria-describedby="map-description" ${editable ? "" : "disabled"}>${MAPS.map((entry) => `<option value="${entry.id}" ${entry.id === map.id ? "selected" : ""}>${entry.name}</option>`).join("")}</select>
      <button type="button" data-map-step="1" aria-label="Next map" ${editable ? "" : "disabled"}>›</button>
    </div>
    <button type="button" class="map-preview-button" data-expand-map aria-label="Enlarge map preview">
      <canvas class="map-preview-canvas" role="img"></canvas><span class="map-expand-label">View full map ↗</span>
    </button>
    <div class="map-details" aria-live="polite"><div class="map-tags" data-map-tags></div><p id="map-description"></p></div>
    ${editable ? "" : '<p class="map-host-note">The room host chooses the map.</p>'}
    <dialog class="map-dialog" aria-labelledby="map-dialog-title">
      <div class="map-dialog-heading"><div><span class="eyebrow">BATTLEGROUND PREVIEW</span><h2 id="map-dialog-title"></h2></div><button type="button" class="icon-button" data-close-map aria-label="Close map preview">×</button></div>
      <canvas class="map-full-canvas" role="img"></canvas>
      <p data-map-full-description></p><p class="map-preview-note">The complete playable layout. Very large groups of teams extend the arena.</p>
      <button type="button" class="primary-button" data-close-map>Back to setup <span>↙</span></button>
    </dialog>
  </section>`;
}

/** Update a guest's open preview without replacing the setup fields or closing the dialog. */
export function syncMapPicker(container: HTMLElement, mapId: string): void {
  container.querySelector(".map-picker")?.dispatchEvent(new CustomEvent("mapselection", { detail: mapId }));
}

/** Returns a disposer because the surrounding setup panel can be replaced by lobby updates. */
export function mountMapPicker(container: HTMLElement, onSelect: (mapId: string) => void): () => void {
  const picker = container.querySelector<HTMLElement>(".map-picker");
  if (!picker) return () => {};
  const select = picker.querySelector<HTMLSelectElement>("#map-select")!;
  const preview = picker.querySelector<HTMLCanvasElement>(".map-preview-canvas")!;
  const fullPreview = picker.querySelector<HTMLCanvasElement>(".map-full-canvas")!;
  const dialog = picker.querySelector<HTMLDialogElement>("dialog")!;
  const expand = picker.querySelector<HTMLButtonElement>("[data-expand-map]")!;
  const draw = () => {
    drawMapPreview(preview, select.value);
    if (dialog.open) drawMapPreview(fullPreview, select.value);
  };
  const update = () => {
    const map = getMap(select.value);
    picker.dataset.mapId = map.id;
    picker.querySelector("[data-map-counter]")!.textContent = `${String(MAPS.indexOf(map) + 1).padStart(2, "0")} / ${String(MAPS.length).padStart(2, "0")}`;
    picker.querySelector("[data-map-tags]")!.innerHTML = `<span>${map.size}</span><span>${map.hasWater ? "Water hazard" : "No water"}</span><span>${map.terrain}</span>`;
    picker.querySelector("#map-description")!.textContent = map.description;
    picker.querySelector("#map-dialog-title")!.textContent = map.name;
    picker.querySelector("[data-map-full-description]")!.textContent = map.description;
    fullPreview.style.aspectRatio = `${map.width} / ${map.height}`;
    expand.setAttribute("aria-label", `Enlarge ${map.name} map preview`);
    for (const canvas of [preview, fullPreview]) canvas.setAttribute("aria-label", `${map.name}: ${map.size.toLowerCase()} map, ${map.hasWater ? "with water hazards" : "no water"}. ${map.description}`);
    draw();
  };
  const choose = () => {
    if (select.disabled || !isMapId(select.value)) return;
    update();
    onSelect(select.value);
  };
  select.addEventListener("change", choose);
  picker.addEventListener("mapselection", (event) => {
    const mapId: unknown = (event as CustomEvent).detail;
    if (!isMapId(mapId)) return;
    select.value = mapId;
    update();
  });
  picker.querySelectorAll<HTMLButtonElement>("[data-map-step]").forEach((button) => {
    button.onclick = () => {
      if (select.disabled) return;
      select.selectedIndex = (select.selectedIndex + Number(button.dataset.mapStep) + MAPS.length) % MAPS.length;
      choose();
    };
  });
  expand.onclick = () => { dialog.showModal(); draw(); };
  picker.querySelectorAll<HTMLButtonElement>("[data-close-map]").forEach((button) => {
    button.onclick = () => dialog.close();
  });
  dialog.addEventListener("close", () => expand.focus());
  dialog.addEventListener("click", (event) => { if (event.target === dialog) {
    const rect = dialog.getBoundingClientRect();
    if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) dialog.close();
  } });
  // Let the native dialog handle Escape and focus, without triggering game shortcuts.
  dialog.addEventListener("keydown", (event) => event.stopPropagation());
  const resize = new ResizeObserver(draw);
  resize.observe(preview);
  resize.observe(fullPreview);
  update();
  return () => { resize.disconnect(); if (dialog.open) dialog.close(); };
}
