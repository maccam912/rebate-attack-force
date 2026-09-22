import type { GameState, HazardKind, Player, StatusKind } from "../shared/types";
import type { RenderOptions } from "./renderer";

/** Shared labels keep the arena, HUD and arsenal's effect descriptions consistent. */
export const STATUS_PRESENTATION: Record<StatusKind, { label: string; glyph: string; color: string; hint: string }> = {
  slippery: { label: "Slippery", glyph: "≈", color: "#87d9ff", hint: "Very little traction" },
  sticky: { label: "Sticky", glyph: "≋", color: "#f2b0df", hint: "Movement and jumps slowed" },
  burning: { label: "Burning", glyph: "♨", color: "#ffad75", hint: "Ongoing fire damage" },
  poisoned: { label: "Poisoned", glyph: "☠", color: "#c3e97a", hint: "Ongoing poison damage" },
  chilled: { label: "Chilled", glyph: "❄", color: "#a5eafa", hint: "Movement slowed" },
  confused: { label: "Confused", glyph: "?", color: "#e3b1ff", hint: "Disorienting vision" },
  dazzled: { label: "Dazzled", glyph: "✦", color: "#fff0a2", hint: "Bright spots obscure the arena" },
  pixelated: { label: "Pixelated", glyph: "▦", color: "#c4b6ff", hint: "Vision reduced to chunky pixels" },
  inverted: { label: "Reversed", glyph: "⇄", color: "#ffb4d5", hint: "Left and right controls reversed" },
  heavy: { label: "Heavy", glyph: "↓", color: "#c3cddd", hint: "Extra gravity pulls you down" },
  feather: { label: "Floaty", glyph: "↑", color: "#c1f5e3", hint: "Reduced gravity" },
  bouncy: { label: "Bouncy", glyph: "↟", color: "#d5f785", hint: "Springy landings" },
};

export const HAZARD_PRESENTATION: Record<HazardKind, { label: string; color: string }> = {
  oil: { label: "OIL SLICK", color: "#b09bd7" },
  ice: { label: "ICE", color: "#b4efff" },
  glue: { label: "GLUE", color: "#f5b1db" },
  wire: { label: "RAZOR WIRE", color: "#d4e3df" },
  fire: { label: "FIRE", color: "#ffbd77" },
  poison: { label: "POISON", color: "#c5e882" },
  gravity: { label: "GRAVITY WELL", color: "#c4b0ff" },
  repulsor: { label: "REPULSOR", color: "#ffc290" },
  updraft: { label: "UPDRAFT", color: "#b5f2ef" },
  spring: { label: "SPRING PAD", color: "#daf38d" },
};

function stroke(c: CanvasRenderingContext2D, points: number[], color: string, width = 2) {
  c.beginPath();
  c.moveTo(points[0], points[1]);
  for (let i = 2; i < points.length; i += 2) c.lineTo(points[i], points[i + 1]);
  c.strokeStyle = color;
  c.lineWidth = width;
  c.stroke();
}

function ellipse(c: CanvasRenderingContext2D, x: number, y: number, rx: number, ry: number, color: string) {
  c.beginPath();
  c.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
  c.fillStyle = color;
  c.fill();
}

export function drawHazards(c: CanvasRenderingContext2D, s: GameState, o: RenderOptions) {
  const t = o.reducedMotion ? 0 : o.time;
  for (const hazard of s.hazards ?? []) {
    if (hazard.remainingTurns <= 0) continue;
    const { x, y, radius: r, kind } = hazard;
    const { camera } = o;
    if (x + r < camera.x || x - r > camera.x + camera.width ||
        y + r < camera.y || y - r > camera.y + camera.height) continue;
    const { color, label } = HAZARD_PRESENTATION[kind];
    const radial = kind === "gravity" || kind === "repulsor" || kind === "updraft";
    c.save();
    c.lineCap = "round";
    if (radial) {
      const glow = c.createRadialGradient(x, y, 2, x, y, r);
      glow.addColorStop(0, `${color}48`);
      glow.addColorStop(0.65, `${color}12`);
      glow.addColorStop(1, `${color}04`);
      ellipse(c, x, y, r, r, "#1936290d");
      c.fillStyle = glow;
      c.fill();
      c.strokeStyle = `${color}88`;
      c.lineWidth = 1.5;
      c.setLineDash([5, 8]);
      c.stroke();
      c.setLineDash([]);
      if (kind === "updraft") {
        for (let i = -2; i <= 2; i++) {
          const offset = (t * 27 + (i + 2) * 17) % (r * 1.2);
          const ax = x + i * r * 0.27, ay = y + r * 0.6 - offset;
          stroke(c, [ax, ay + 23, ax, ay - 12], `${color}a0`, 2);
          stroke(c, [ax - 6, ay - 6, ax, ay - 12, ax + 6, ay - 6], color);
        }
      } else {
        const pulling = kind === "gravity";
        for (let i = 0; i < 8; i++) {
          const angle = i * Math.PI / 4 + t * 0.15;
          const distance = r * (0.4 + ((t * 0.12 + i * 0.11) % 0.4));
          c.save();
          c.translate(x + Math.cos(angle) * distance, y + Math.sin(angle) * distance);
          c.rotate(angle + (pulling ? Math.PI : 0));
          stroke(c, [-7, -5, 0, 0, -7, 5], `${color}cc`, 2);
          c.restore();
        }
        ellipse(c, x, y, 15, 15, pulling ? "#302443" : "#654027");
        c.strokeStyle = color;
        c.lineWidth = 2;
        c.stroke();
        stroke(c, [x - 6, y, x + 6, y], color);
        if (!pulling) stroke(c, [x, y - 6, x, y + 6], color);
      }
    } else {
      // Surface effects stop at the edge of their supporting ledge.
      const support = s.platforms.find((p) => Math.abs(p.y - y) < 16 && x >= p.x && x <= p.x + p.w);
      const left = Math.max(x - r, support?.x ?? x - r);
      const right = Math.min(x + r, support ? support.x + support.w : x + r);
      c.save();
      c.beginPath();
      c.rect(left - 2, y - 50, right - left + 4, 75);
      c.clip();
      ellipse(c, x, y + 1, r, kind === "wire" ? 5 : 8, kind === "oil" ? "#3e3755dc" : `${color}bb`);
      if (kind === "oil" || kind === "glue" || kind === "ice") {
        for (let i = 0; i < 5; i++) {
          const sx = x - r * 0.8 + i * r * 0.36;
          if (kind === "ice") {
            stroke(c, [sx - 9, y + 1, sx, y - 3, sx + 12, y - 1], "#ffffffba", 2);
          } else {
            ellipse(c, sx, y + Math.sin(i * 2) * 3, r * 0.13, 2,
              kind === "oil" ? ["#85d4c0a0", "#c196e9a0", "#f3bce5a0"][i % 3] : "#fff0e7a0");
          }
        }
      } else if (kind === "wire") {
        stroke(c, [left, y - 8, right, y - 8], "#3b4c46", 4);
        for (let sx = left + 7; sx < right; sx += 18) {
          stroke(c, [sx - 7, y - 3, sx, y - 18, sx + 7, y - 3], color, 2);
          stroke(c, [sx - 5, y - 13, sx + 5, y - 5], "#e7f6eb", 1.5);
        }
      } else if (kind === "spring") {
        for (let sx = left + 10; sx < right - 4; sx += 24)
          stroke(c, [sx, y - 2, sx - 6, y - 6, sx + 6, y - 10, sx - 6, y - 14, sx + 6, y - 18], "#5b7247", 2);
        stroke(c, [left, y - 20, right, y - 20], color, 5);
      } else if (kind === "fire") {
        for (let sx = left + 8, i = 0; sx < right; sx += 19, i++) {
          const h = 19 + Math.sin(t * 2 + i * 1.7) * 5;
          c.beginPath();
          c.moveTo(sx - 8, y);
          c.quadraticCurveTo(sx - 11, y - 10, sx, y - h);
          c.quadraticCurveTo(sx + 2, y - 8, sx + 8, y);
          c.fillStyle = "#f58a51bf";
          c.fill();
          ellipse(c, sx, y - 3, 4, 8, "#ffe5a5d9");
        }
      } else if (kind === "poison") {
        for (let i = 0; i < 7; i++) {
          const rise = (t * 8 + i * 7) % 30;
          ellipse(c, left + (right - left) * (i + 0.5) / 7, y - 4 - rise, 6 + i % 3, 6 + i % 3, `${color}70`);
        }
      }
      c.restore();
    }
    const scale = 1 / Math.max(0.65, camera.zoom);
    c.translate(x, radial ? y + r + 14 * scale : y + 22 * scale);
    c.scale(scale, scale);
    c.font = "800 9px 'Trebuchet MS', sans-serif";
    c.textAlign = "center";
    const caption = `${label} · ${hazard.remainingTurns}T`;
    const width = c.measureText(caption).width + 14;
    c.beginPath();
    c.roundRect(-width / 2, -10, width, 16, 5);
    c.fillStyle = "#173329ed";
    c.fill();
    c.fillStyle = color;
    c.fillText(caption, 0, 1);
    c.restore();
  }
}

export function drawStatusAura(c: CanvasRenderingContext2D, p: Player, o: RenderOptions) {
  const statuses = (p.statuses ?? []).filter((s) => s.remaining > 0);
  if (!statuses.length) return;
  c.save();
  for (const [i, status] of statuses.slice(0, 4).entries()) {
    const { color } = STATUS_PRESENTATION[status.kind];
    c.beginPath();
    c.ellipse(p.x, p.y, 29 + i * 3, 27 + i * 3, 0, i * 1.5, i * 1.5 + Math.PI * 1.1);
    c.strokeStyle = `${color}b0`;
    c.lineWidth = 2;
    c.stroke();
    const angle = (o.reducedMotion ? 0 : o.time * 0.7) + i * 1.7;
    ellipse(c, p.x + Math.cos(angle) * 33, p.y + Math.sin(angle) * 29, 2.8, 2.8, color);
  }
  c.restore();
}

export function drawStatusBadges(c: CanvasRenderingContext2D, p: Player, labelY: number, o: RenderOptions) {
  const statuses = (p.statuses ?? []).filter((s) => s.remaining > 0);
  if (!statuses.length) return;
  c.save();
  c.translate(p.x, labelY - 15);
  c.scale(1 / Math.max(0.7, o.camera.zoom), 1 / Math.max(0.7, o.camera.zoom));
  c.textAlign = "center";
  c.font = "800 10px 'Trebuchet MS', sans-serif";
  const visible = statuses.slice(0, 4);
  const total = visible.length + (statuses.length > 4 ? 1 : 0);
  visible.forEach((status, i) => {
    const { glyph, color } = STATUS_PRESENTATION[status.kind];
    const x = (i - (total - 1) / 2) * 38;
    c.beginPath();
    c.roundRect(x - 18, -11, 36, 17, 5);
    c.fillStyle = "#19372fed";
    c.fill();
    c.fillStyle = color;
    c.fillText(`${glyph} ${Math.ceil(status.remaining)}`, x, 1);
  });
  if (statuses.length > 4) {
    c.fillStyle = "#173329";
    c.fillText(`+${statuses.length - 4}`, (total - 1) * 19, 1);
  }
  c.restore();
}

let pixelBuffer: HTMLCanvasElement | null = null;

/** Canvas-only postprocessing leaves DOM menus, aim controls and the HUD untouched. */
export function drawVisionEffects(c: CanvasRenderingContext2D, s: GameState, o: RenderOptions) {
  if (!o.visionEffects || o.menu || (s.phase !== "playing" && s.phase !== "retreat")) return;
  const frog = s.players.find((p) => p.id === s.activePlayerId);
  const statuses = new Set((frog?.statuses ?? []).filter((status) => status.remaining > 0).map((status) => status.kind));
  if (!statuses.size) return;
  const { width, height, dpr } = o.viewport;
  const t = o.reducedMotion ? 0 : o.time;
  c.save();
  c.setTransform(dpr, 0, 0, dpr, 0, 0);
  if (statuses.has("pixelated") && !o.reducedMotion) {
    pixelBuffer ??= document.createElement("canvas");
    const pw = Math.max(1, Math.ceil(width / 7)), ph = Math.max(1, Math.ceil(height / 7));
    if (pixelBuffer.width !== pw || pixelBuffer.height !== ph) {
      pixelBuffer.width = pw;
      pixelBuffer.height = ph;
    }
    const buffer = pixelBuffer.getContext("2d")!;
    buffer.drawImage(c.canvas, 0, 0, pw, ph);
    c.imageSmoothingEnabled = false;
    c.globalAlpha = 0.78;
    c.drawImage(pixelBuffer, 0, 0, width, height);
    c.globalAlpha = 1;
  }
  if (statuses.has("inverted")) {
    c.globalCompositeOperation = "soft-light";
    c.fillStyle = "#d06cad";
    c.fillRect(0, 0, width, height);
    c.globalCompositeOperation = "source-over";
  }
  const color = statuses.has("dazzled") ? "#fff2b0" : statuses.has("confused") ? "#c3a0ed" : statuses.has("pixelated") ? "#adbcf6" : "#eeb7d3";
  if (["dazzled", "confused", "pixelated", "inverted"].some((kind) => statuses.has(kind as StatusKind))) {
    const glow = c.createRadialGradient(width / 2, height / 2, Math.min(width, height) * 0.22,
      width / 2, height / 2, Math.max(width, height) * 0.65);
    glow.addColorStop(0, `${color}00`);
    glow.addColorStop(1, `${color}${o.reducedMotion ? "38" : "98"}`);
    c.fillStyle = glow;
    c.fillRect(0, 0, width, height);
  }
  if (statuses.has("dazzled") && !o.reducedMotion) {
    for (let i = 0; i < 6; i++) {
      const x = width * (0.1 + (i * 0.17) % 0.85) + Math.sin(t * 0.4 + i) * 9;
      const y = height * (i % 2 ? 0.76 : 0.23) + Math.cos(t * 0.45 + i) * 12;
      const radius = 20 + i % 3 * 11;
      const spot = c.createRadialGradient(x, y, 0, x, y, radius);
      spot.addColorStop(0, "#fffbe9b0");
      spot.addColorStop(1, "#fff2b000");
      c.fillStyle = spot;
      c.fillRect(x - radius, y - radius, radius * 2, radius * 2);
      stroke(c, [x - 6, y, x + 6, y], "#fffbe9a0", 2);
      stroke(c, [x, y - 6, x, y + 6], "#fffbe9a0", 2);
    }
  }
  if (statuses.has("confused") && !o.reducedMotion) {
    for (let i = 0; i < 4; i++) {
      c.save();
      c.translate(i % 2 ? width - 36 : 36, height * (i < 2 ? 0.35 : 0.7));
      c.rotate(t * 0.3 + i);
      c.beginPath();
      for (let j = 0; j < 65; j++) {
        const angle = j * 0.15, r = j * 0.45;
        if (j === 0) c.moveTo(0, 0);
        else c.lineTo(Math.cos(angle) * r, Math.sin(angle) * r);
      }
      c.strokeStyle = "#ead3ff90";
      c.lineWidth = 4;
      c.stroke();
      c.restore();
    }
  }
  c.restore();
}
