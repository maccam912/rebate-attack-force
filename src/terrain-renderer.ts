import type { GameState, Platform } from "../shared/types";
import { getMap, type ArenaMap } from "../shared/maps";

export type TerrainScene = Pick<GameState, "width" | "height" | "waterY" | "mapId" | "hasWater">;
type Theme = ArenaMap["theme"];

const ink = "#223c34";
function rounded(
  c: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number | number[],
  fill: string,
  stroke?: string,
) {
  c.beginPath();
  c.roundRect(x, y, w, h, r);
  c.fillStyle = fill;
  c.fill();
  if (stroke) {
    c.strokeStyle = stroke;
    c.lineWidth = 2;
    c.stroke();
  }
}
function line(
  c: CanvasRenderingContext2D,
  points: number[],
  color: string,
  width = 2,
) {
  c.beginPath();
  c.moveTo(points[0], points[1]);
  for (let i = 2; i < points.length; i += 2) c.lineTo(points[i], points[i + 1]);
  c.strokeStyle = color;
  c.lineWidth = width;
  c.stroke();
}
function circle(
  c: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  color: string,
) {
  c.beginPath();
  c.arc(x, y, r, 0, Math.PI * 2);
  c.fillStyle = color;
  c.fill();
}
function poly(c: CanvasRenderingContext2D, points: number[], color: string) {
  c.beginPath();
  c.moveTo(points[0], points[1]);
  for (let i = 2; i < points.length; i += 2) c.lineTo(points[i], points[i + 1]);
  c.closePath();
  c.fillStyle = color;
  c.fill();
}
function text(
  c: CanvasRenderingContext2D,
  t: string,
  x: number,
  y: number,
  size: number,
  color: string,
  weight = 600,
) {
  c.fillStyle = color;
  c.font = `${weight} ${size}px 'Trebuchet MS', sans-serif`;
  c.fillText(t, x, y);
}

function scrapyardBackground(c: CanvasRenderingContext2D, s: TerrainScene, t: number) {
  const grad = c.createLinearGradient(0, 0, 0, s.height);
  grad.addColorStop(0, "#d3ddba");
  grad.addColorStop(0.58, "#aebda0");
  grad.addColorStop(1, "#627f73");
  c.fillStyle = grad;
  c.fillRect(0, 0, s.width, s.height);
  // Paper-grain dots, lazy clouds and a hazy afternoon sun.
  circle(c, 1155, 147, 79, "#e9e6b6");
  circle(c, 1155, 147, 62, "#f5e8be");
  for (let i = 0; i < 130; i++) {
    const x = (i * 173.1) % s.width,
      y = (i * 93.7) % s.height;
    c.fillStyle = i % 2 ? "#ffffff08" : "#233e3407";
    c.fillRect(x, y, 2, 2);
  }
  for (let i = 0; i < 6; i++) {
    const x = (i * 283 + t * (i % 2 ? 2 : -1) + 160 + s.width) % s.width,
      y = 95 + ((i * 53) % 220);
    c.globalAlpha = 0.23;
    rounded(c, x, y, 126, 16, 9, "#f7f1d0");
    rounded(c, x + 23, y - 10, 61, 15, 8, "#f7f1d0");
    c.globalAlpha = 1;
  }
  poly(
    c,
    [
      0, 470, 140, 360, 220, 380, 350, 252, 440, 400, 600, 340, 760, 460, 890,
      330, 1020, 365, 1140, 290, 1280, 380, 1440, 300, 1440, 850, 0, 850,
    ],
    "#9aae91",
  );
  poly(
    c,
    [
      0, 530, 175, 440, 300, 510, 470, 400, 620, 535, 790, 430, 890, 495, 1060,
      380, 1200, 510, 1330, 432, 1440, 490, 1440, 850, 0, 850,
    ],
    "#889f86",
  );
  // Far-off industrial remnants.
  c.globalAlpha = 0.32;
  for (const [x, y, w, h] of [
    [80, 375, 68, 250],
    [820, 385, 52, 290],
    [1260, 345, 58, 315],
  ]) {
    rounded(c, x, y, w, h, 2, "#52766a");
    rounded(c, x - 10, y, w + 20, 14, 2, "#52766a");
    line(c, [x - 10, y + 55, x + w + 10, y + 55], "#406859", 4);
    for (let a = 0; a < 4; a++)
      line(
        c,
        [x + 8, y + 25 + a * 55, x + w - 8, y + 66 + a * 55],
        "#a5b79b",
        2,
      );
  }
  line(c, [0, 320, 245, 375, 540, 328, 920, 380, 1440, 296], "#496e5f", 2);
  c.globalAlpha = 1;
  // Cable at the top emphasizes the usable overhead platforms.
  c.beginPath();
  c.moveTo(0, 57);
  c.quadraticCurveTo(720, 155, 1440, 42);
  c.strokeStyle = "#597b63";
  c.lineWidth = 2;
  c.stroke();
  for (let i = 0; i < 11; i++) {
    const x = 90 + i * 125,
      y = 57 + 80 * (x / 1440) * (1 - x / 1440);
    line(c, [x, y, x, y + 18], "#597b63");
    circle(c, x, y + 20, 4, i % 3 === 0 ? "#f4d38b" : "#d9d7ac");
  }
}

function slabPlatform(
  c: CanvasRenderingContext2D,
  p: Platform,
  idx: number,
  t: number,
) {
  const { x, y, w, h } = p;
  // Earth is visible and matches the exact collision rectangle.
  rounded(c, x + 3, y + 8, w, h, 5, "#3a594a");
  rounded(c, x, y, w, h, 5, "#4e6851", ink);
  c.save();
  c.beginPath();
  c.rect(x, y, w, h);
  c.clip();
  for (let row = 0; row < Math.ceil(h / 25); row++)
    for (let col = 0; col < Math.ceil(w / 58) + 1; col++) {
      const bx = x + col * 58 - (row % 2) * 29,
        by = y + row * 25;
      rounded(
        c,
        bx + 3,
        by + 4,
        50,
        18,
        3,
        (col + row + idx) % 3 === 0 ? "#52694f" : "#465e49",
      );
      if ((col + row) % 4 === 0)
        line(
          c,
          [bx + 15, by + 10, bx + 21, by + 12, bx + 27, by + 9],
          "#789070",
          1,
        );
    }
  c.restore();
  rounded(c, x - 2, y - 2, w + 4, 9, 4, "#adc977", ink);
  for (let i = 10; i < w - 9; i += 19) {
    const len = 5 + ((i * 7) % 13);
    line(c, [x + i, y + 4, x + i - 2, y + len], "#94b169", 3);
  }
  for (let i = 15; i < w - 15; i += 46) {
    const shift = Math.sin(t * 1.2 + i) * 2;
    line(
      c,
      [x + i, y - 2, x + i - 2 + shift, y - 12, x + i + 5 + shift, y - 8],
      "#537651",
      2,
    );
    if ((i + idx) % 3 === 0)
      circle(c, x + i - 2 + shift, y - 12, 2.5, "#f0ce81");
  }
  // Roots and climbing vines underneath small islands.
  if (h < 100) {
    for (let i = 25; i < w - 15; i += 74) {
      const sway = Math.sin(t + i) * 3;
      line(
        c,
        [x + i, y + h, x + i + 3, y + h + 12, x + i - 4 + sway, y + h + 32],
        "#567553",
        2,
      );
      c.beginPath();
      c.ellipse(x + i + 3, y + h + 13, 6, 3, 0.6, 0, 7);
      c.fillStyle = "#70925b";
      c.fill();
    }
  }
  if (w > 200) {
    rounded(c, x + w - 47, y + 15, 32, 17, 2, "#8d9870", "#304f3e");
    text(
      c,
      String(idx + 1).padStart(2, "0"),
      x + w - 41,
      y + 28,
      11,
      "#2e503d",
    );
  }
}

function scrapyardWater(c: CanvasRenderingContext2D, s: TerrainScene, t: number) {
  const grad = c.createLinearGradient(0, s.waterY, 0, s.height);
  grad.addColorStop(0, "#82b4a4");
  grad.addColorStop(1, "#4d847d");
  c.fillStyle = grad;
  c.fillRect(0, s.waterY, s.width, s.height - s.waterY);
  c.beginPath();
  c.moveTo(0, s.waterY);
  for (let x = 0; x <= s.width; x += 8)
    c.lineTo(x, s.waterY + Math.sin(x * 0.025 + t * 1.5) * 3);
  c.lineTo(s.width, s.height);
  c.lineTo(0, s.height);
  c.fillStyle = "#669b8dd0";
  c.fill();
  for (let i = 0; i < 48; i++) {
    const x = (i * 97 + t * (i % 2 ? 4 : -3) + s.width) % s.width,
      y = s.waterY + 8 + ((i * 19) % 65);
    line(c, [x, y, x + 12 + (i % 17), y], "#b2d2b550", 2);
  }
  for (const x of [80, 385, 1180, 1340]) {
    const y = s.waterY + 22 + Math.sin(t + x) * 2;
    c.beginPath();
    c.ellipse(x, y, 18, 5, -0.2, 0, Math.PI * 1.8);
    c.lineTo(x, y);
    c.fillStyle = "#345f4d";
    c.fill();
  }
}

/** Backdrop shapes deliberately use muted colors, keeping solid playing surfaces distinct. */
export function drawTerrainBackground(c: CanvasRenderingContext2D, s: TerrainScene, t: number) {
  const theme = getMap(s.mapId).theme;
  if (theme === "scrapyard") {
    c.save();
    c.scale(s.width / 1440, s.height / 850);
    scrapyardBackground(c, { ...s, width: 1440, height: 850 }, t);
    c.restore();
    return;
  }
  const { width: w, height: h } = s;
  const palettes = {
    cave: ["#142b38", "#284254", "#344755"],
    jungle: ["#b9d4a5", "#7bab84", "#38685d"],
    islands: ["#d5e9e2", "#a5d0cc", "#568c9b"],
    yard: ["#f4dec0", "#d1c39f", "#9fa77d"],
  } as const;
  const palette = palettes[theme];
  const gradient = c.createLinearGradient(0, 0, 0, h);
  palette.forEach((color, i) => gradient.addColorStop(i / 2, color));
  c.fillStyle = gradient;
  c.fillRect(0, 0, w, h);
  c.save();
  if (theme === "cave") {
    // Concentric arches make this a closed cavern, with no sky or waterline.
    for (let i = 0; i < 5; i++) {
      c.beginPath();
      c.ellipse(w * .5, h * .77, w * (.48 - i * .068), h * (.88 - i * .118), 0, Math.PI, Math.PI * 2);
      c.lineTo(w * (.98 - i * .068), h);
      c.lineTo(w * (.02 + i * .068), h);
      c.fillStyle = ["#1e3545", "#253e50", "#2a4556", "#2c4a5a", "#315260"][i];
      c.fill();
    }
    for (let i = 0; i < 18; i++) {
      const x = i * w / 17;
      const length = 55 + (i * 63) % 145;
      poly(c, [x - 44, 0, x + 46, 0, x + 10, length, x - 7, length * .72], "#132c3bcc");
    }
    for (let i = 0; i < 13; i++) {
      const x = ((i * 197 + 75) % 1440) / 1440 * w;
      const y = h * (.65 + (i % 4) * .08);
      const r = 35 + i % 3 * 19;
      const glow = c.createRadialGradient(x, y, 1, x, y, r * 3);
      glow.addColorStop(0, "#7fd8cf20");
      glow.addColorStop(1, "#7fd8cf00");
      c.fillStyle = glow;
      c.fillRect(x - r * 3, y - r * 3, r * 6, r * 6);
      poly(c, [x - r * .3, y, x - r * .2, y - r, x + r * .12, y - r * 1.35, x + r * .34, y - r * .8, x + r * .3, y], "#50797c77");
      line(c, [x + r * .12, y - r * 1.35, x + r * .06, y], "#91c7bb33", 2);
    }
    for (let i = 0; i < 25; i++) circle(c, (i * 197 % 1440) / 1440 * w, (i * 113 % 760 + 40) / 850 * h, 1.2, "#b6e2cf50");
  } else if (theme === "jungle") {
    circle(c, w * .72, h * .18, h * .09, "#eff0bb9c");
    // A soft canopy and tall background trunks never masquerade as platforms.
    for (let layer = 0; layer < 3; layer++) {
      c.fillStyle = ["#83af8c", "#6b9d80", "#548674"][layer];
      for (let i = 0; i < 8; i++) {
        const x = (i * 233 + layer * 79) / 1440 * w;
        const top = h * (.20 + layer * .11 + (i % 3) * .08);
        const r = w * (.057 + (i % 3) * .013);
        c.beginPath();
        c.moveTo(x - 11, top); c.lineTo(x + 14, top);
        c.lineTo(x + 30, h); c.lineTo(x - 31, h); c.closePath(); c.fill();
        c.beginPath(); c.ellipse(x, top, r, h * .13, 0, 0, Math.PI * 2); c.fill();
      }
    }
    c.globalAlpha = .25;
    for (let i = 0; i < 13; i++) {
      c.beginPath();
      const x = w * i / 12;
      c.moveTo(x, 0); c.bezierCurveTo(x + 20, h * .13, x - 48, h * .22, x - 8, h * .36);
      c.strokeStyle = "#2a6956"; c.lineWidth = 3; c.stroke();
    }
    c.globalAlpha = .24;
    poly(c, [w * .66, 0, w * .70, 0, w * .30, h, w * .10, h], "#e6e9b1");
    poly(c, [w * .77, 0, w * .79, 0, w * .63, h, w * .46, h], "#e6e9b1");
    c.globalAlpha = 1;
    for (let i = 0; i < 11; i++) circle(c, w * i / 10, -h * .045, w * (.07 + i % 3 * .014), "#3f785fd0");
  } else if (theme === "islands") {
    circle(c, w * .79, h * .19, h * .095, "#fff1c3");
    c.fillStyle = "#91bdb7";
    c.fillRect(0, h * .56, w, h * .44);
    for (let i = 0; i < 7; i++) {
      const x = (i * 287 - 80) / 1440 * w;
      const y = h * (.56 + i % 3 * .08);
      const rise = h * (.14 + i % 4 * .04);
      poly(c, [x, y, x + w * .055, y - rise, x + w * .083, y - rise * .9, x + w * .12, y, x + w * .14, h, x, h], "#729e9f80");
    }
    for (let i = 0; i < 5; i++) {
      const x = w * (.12 + i * .17), y = h * (.17 + i % 3 * .05);
      c.beginPath(); c.moveTo(x - 8, y + 3); c.quadraticCurveTo(x - 4, y - 3, x, y);
      c.quadraticCurveTo(x + 4, y - 3, x + 8, y + 3);
      c.strokeStyle = "#638985"; c.lineWidth = 2; c.stroke();
    }
  } else {
    circle(c, w * .80, h * .19, h * .095, "#f8e7b6");
    poly(c, [0, h * .64, w * .21, h * .48, w * .41, h * .62, w * .67, h * .49, w, h * .64, w, h, 0, h], "#b1b58b");
    // Faded brickwork and a fence give the dry yard a cozy enclosed feel.
    const wallY = h * .72;
    c.fillStyle = "#9fa57c"; c.fillRect(0, wallY, w, h - wallY);
    for (let row = 0; row < 6; row++) {
      line(c, [0, wallY + row * 38, w, wallY + row * 38], "#8b98764f", 2);
      for (let x = -45 + row % 2 * 45; x < w; x += 90) line(c, [x, wallY + row * 38, x, wallY + (row + 1) * 38], "#8b98764f", 2);
    }
    line(c, [0, wallY - 9, w, wallY - 9], "#87956b66", 7);
    for (let x = 16; x < w; x += 45) {
      line(c, [x, wallY - 10, x, wallY - 72], "#84926b55", 6);
      circle(c, x, wallY - 76, 4, "#84926b55");
    }
  }
  // Consistent paper grain across the hand-drawn environments.
  for (let i = 0; i < 160; i++) {
    c.fillStyle = i % 2 ? "#ffffff0b" : "#132f3209";
    c.fillRect((i * 173.1) % w, (i * 93.7) % h, 2, 2);
  }
  c.restore();
}

/** Vertical trunks are scenery; only the precisely outlined crowns/branches are solid. */
export function drawTerrainScenery(c: CanvasRenderingContext2D, s: TerrainScene, platforms: Platform[], _time: number) {
  if (getMap(s.mapId).theme !== "jungle") return;
  c.save();
  for (const p of platforms) {
    if (p.appearance !== "canopy" || p.h < 60) continue;
    const x = p.x + p.w * .52;
    const bottom = s.hasWater === false ? s.height : s.waterY;
    c.globalAlpha = .34;
    poly(c, [x - 9, p.y + p.h, x + 10, p.y + p.h, x + 27, bottom, x - 24, bottom], "#426a51");
    line(c, [x + 3, p.y + p.h, x + 13, bottom], "#a0b477", 2);
  }
  c.restore();
}

function rockPlatform(c: CanvasRenderingContext2D, p: Platform, i: number, cave: boolean) {
  const { x, y, w, h } = p;
  const colors = cave ? ["#536674", "#405360", "#2f4651", "#93bac0"] : ["#ab9169", "#8c775b", "#71654f", "#ddd6a0"];
  // Angular corners and uneven facets read as stone without shifting the solid top.
  const chip = Math.min(11, h * .13, w * .06);
  c.beginPath(); c.moveTo(x, y); c.lineTo(x + w, y);
  c.lineTo(x + w, y + h * .72); c.lineTo(x + w - chip, y + h);
  c.lineTo(x + w * .39, y + h - chip * .35); c.lineTo(x + chip, y + h);
  c.lineTo(x, y + h * .74); c.closePath();
  c.fillStyle = colors[0]; c.fill(); c.strokeStyle = cave ? "#193542" : "#3e5449"; c.lineWidth = 2; c.stroke();
  c.save(); c.clip();
  for (let j = 0; j < Math.ceil(w / 97); j++) {
    const dx = x + j * 97;
    const split = .25 + ((j * 13 + i * 7) % 37) / 100;
    const shift = (j * 17 + i * 11) % 29;
    poly(c, [dx + 10, y + 7, dx + 66 + shift, y + 5, dx + 41 + shift, y + h * split, dx + 81, y + h, dx + 14, y + h, dx + 26, y + h * .58], colors[1]);
    line(c, [dx + 66 + shift, y + 6, dx + 41 + shift, y + h * split, dx + 81, y + h], colors[2], 2);
    line(c, [dx + 14, y + h * .71, dx + 26, y + h * .58, dx + 18, y + h * .35], colors[0], 2);
    if (h > 90) line(c, [dx + 5, y + h * .36, dx + 37, y + h * .34, dx + 63, y + h * .40], colors[0], 3);
  }
  c.restore();
  line(c, [x + 1, y + 1, x + w - 1, y + 1], colors[3], 4);
  if (cave && p.appearance === "crystal" && h > 30) {
    for (let j = 22; j < w - 14; j += 55) {
      const cy = y + 17 + (j + i) % 12;
      poly(c, [x + j - 8, cy + 12, x + j - 5, cy - 5, x + j + 2, cy - 13, x + j + 10, cy, x + j + 6, cy + 17], "#66bfb0");
      poly(c, [x + j + 2, cy - 13, x + j + 1, cy + 14, x + j + 6, cy + 17, x + j + 10, cy], "#abdcca");
    }
  }
  if (!cave) {
    for (let j = 13; j < w - 8; j += 25) line(c, [x + j, y + 3, x + j + 4, y + 9 + j % 10], "#82a46a", 3);
  }
}

function woodPlatform(c: CanvasRenderingContext2D, p: Platform, i: number, canopy: boolean) {
  const { x, y, w, h } = p;
  c.beginPath();
  c.moveTo(x + 3, y); c.lineTo(x + w - 3, y);
  if (canopy) {
    // A level crown has a shaggy, deeply lobed underside, fully inside its solid.
    c.quadraticCurveTo(x + w, y + 2, x + w, y + h * .45);
    const lobes = Math.max(4, Math.round(w / 72));
    const step = w / lobes;
    for (let lobe = 0; lobe < lobes; lobe++) {
      const right = x + w - lobe * step;
      c.bezierCurveTo(right - step * .10, y + h * (.95 - lobe % 2 * .09), right - step * .72, y + h * 1.07, right - step, y + h * .54);
    }
    c.quadraticCurveTo(x, y + 2, x + 3, y);
  } else {
    c.lineTo(x + w, y + h * .50);
    c.bezierCurveTo(x + w * .74, y + h, x + w * .45, y + h * .54, x + w * .22, y + h);
    c.quadraticCurveTo(x + w * .06, y + h, x, y + h * .47);
    c.lineTo(x, y + 2);
  }
  c.closePath();
  c.fillStyle = canopy ? "#3d7950" : "#846443"; c.fill();
  c.strokeStyle = "#244c3b"; c.lineWidth = 2; c.stroke();
  c.save(); c.clip();
  if (canopy) {
    for (let j = 9; j < w; j += 32) {
      c.beginPath(); c.ellipse(x + j, y + h * .39, 29, h * .55, -.30 + j % 5 * .1, 0, 7);
      c.fillStyle = (j + i) % 3 ? "#5b9b56" : "#71a959"; c.fill();
      line(c, [x + j - 5, y + h - 2, x + j + 7, y + 9], "#8abc654d", 1.5);
    }
  } else {
    for (let j = 0; j < 3; j++) line(c, [x + 8, y + 11 + j * 10, x + w * .32, y + 7 + j * 10, x + w * .73, y + 12 + j * 10, x + w - 9, y + 9 + j * 10], j % 2 ? "#b39158" : "#624c37", 2);
    c.beginPath(); c.ellipse(x + w * .64, y + h * .59, 15, 5, 0, 0, 7); c.strokeStyle = "#594c36"; c.lineWidth = 2; c.stroke();
  }
  c.restore();
  // An unbroken pale edge communicates the exact horizontal collision surface.
  line(c, [x + 3, y + 1, x + w - 3, y + 1], canopy ? "#bbd680" : "#c7b477", 4);
  if (canopy) {
    // Sparse leaf tufts soften the crown without creating a second false ledge.
    for (let j = 22; j < w - 18; j += 79) {
      c.beginPath(); c.ellipse(x + j - 3, y - 3, 11, 4, -.48, 0, 7); c.fillStyle = "#74a958"; c.fill();
      c.beginPath(); c.ellipse(x + j + 7, y - 2, 8, 3, .36, 0, 7); c.fillStyle = "#a5c76c"; c.fill();
    }
    for (let j = 28; j < w - 15; j += 90) {
      line(c, [x + j, y + h, x + j - 5, y + h + 15, x + j + 2, y + h + 26], "#436d4c", 2);
      c.beginPath(); c.ellipse(x + j - 4, y + h + 15, 6, 3, -.8, 0, 7); c.fillStyle = "#659353"; c.fill();
    }
  }
}

function animalPlatform(c: CanvasRenderingContext2D, p: Platform, tortoise: boolean) {
  const { x, y, w, h } = p;
  if (tortoise) {
    // Broad, level shell doubles as the actual platform. Head and feet hang below it.
    for (const at of [.17, .76]) {
      rounded(c, x + w * at, y + h * .65, w * .11, h * .53, 9, "#92985e", "#294c37");
      line(c, [x + w * at + 4, y + h * 1.12, x + w * at + 9, y + h * 1.12], "#d7cf91", 2);
    }
    c.beginPath(); c.ellipse(x + w + 3, y + h * .68, 31, 23, -.15, 0, 7); c.fillStyle = "#a9b171"; c.fill(); c.strokeStyle = "#294c37"; c.lineWidth = 2; c.stroke();
    circle(c, x + w + 13, y + h * .58, 4, "#223c34");
    line(c, [x + w + 14, y + h * .78, x + w + 29, y + h * .73], "#465d3b", 2);
    rounded(c, x, y, w, h, [Math.min(30, h / 3), Math.min(30, h / 3), Math.min(38, h / 2), Math.min(38, h / 2)], "#6d8051", "#254b38");
    c.save(); c.clip();
    for (let j = 0; j < 5; j++) {
      const cx = x + (j + .5) * w / 5;
      poly(c, [cx - w / 10, y + 8, cx, y + 5, cx + w / 10, y + 8, cx + w / 12, y + h * .66, cx, y + h - 5, cx - w / 12, y + h * .66], j % 2 ? "#91a260" : "#829653");
      line(c, [cx - w / 10, y + 8, cx - w / 12, y + h * .66, cx, y + h - 5, cx + w / 12, y + h * .66, cx + w / 10, y + 8], "#4a6740", 2);
    }
    c.restore();
    line(c, [x + 25, y + 1, x + w - 25, y + 1], "#ced58d", 4);
  } else {
    // Flat back and long snout keep the crocodile's usable surface unambiguous.
    for (const at of [.26, .62]) {
      poly(c, [x + w * at, y + h * .6, x + w * at - 9, y + h + 12, x + w * at + 21, y + h + 9, x + w * at + 28, y + h * .7], "#59794a");
      line(c, [x + w * at - 5, y + h + 9, x + w * at + 14, y + h + 8], "#c1c88b", 2);
    }
    rounded(c, x, y, w, h, Math.min(9, h / 3), "#5d804b", "#254c3c");
    rounded(c, x + w * .72, y + h * .45, w * .28, h * .48, 5, "#a4ae6a");
    line(c, [x + w * .73, y + h * .66, x + w - 2, y + h * .66], "#294c37", 2);
    for (let j = 9; j < w * .7; j += 25) poly(c, [x + j, y + 7, x + j + 9, y + h * .45, x + j + 18, y + 7], "#8ca75b");
    for (let j = w * .77; j < w - 8; j += 19) poly(c, [x + j, y + h * .65, x + j + 4, y + h * .83, x + j + 8, y + h * .65], "#e3dda6");
    circle(c, x + w * .77, y + 15, 13, "#a4b16d");
    circle(c, x + w * .78, y + 14, 4, "#233f32");
    circle(c, x + w - 9, y + h * .27, 2, "#294c37");
    line(c, [x + 4, y + 1, x + w - 4, y + 1], "#bdd380", 4);
  }
}

export function drawTerrainPlatform(c: CanvasRenderingContext2D, p: Platform, i: number, t: number, theme: Theme) {
  c.save();
  c.lineJoin = "round";
  if (p.appearance === "tortoise" || p.appearance === "crocodile") animalPlatform(c, p, p.appearance === "tortoise");
  else if (p.appearance === "branch" || p.appearance === "canopy") woodPlatform(c, p, i, p.appearance === "canopy");
  else if (p.appearance === "rock" || p.appearance === "crystal" || theme === "cave" || theme === "islands") rockPlatform(c, p, i, theme === "cave");
  else slabPlatform(c, p, i, t);
  c.restore();
}

export function drawTerrainWater(c: CanvasRenderingContext2D, s: TerrainScene, t: number) {
  if (s.hasWater === false) return;
  const theme = getMap(s.mapId).theme;
  if (theme === "scrapyard") return scrapyardWater(c, s, t);
  c.save();
  const gradient = c.createLinearGradient(0, s.waterY, 0, s.height);
  gradient.addColorStop(0, theme === "jungle" ? "#527e65" : "#4eaaa9");
  gradient.addColorStop(1, theme === "jungle" ? "#244f49" : "#265c77");
  c.fillStyle = gradient;
  c.fillRect(0, s.waterY, s.width, Math.max(0, s.height - s.waterY));
  c.beginPath(); c.moveTo(0, s.waterY);
  for (let x = 0; x <= s.width; x += 8) c.lineTo(x, s.waterY + Math.sin(x * .028 + t * 1.4) * 2);
  c.strokeStyle = theme === "jungle" ? "#bdd6a4" : "#d0ece0"; c.lineWidth = 2; c.stroke();
  for (let i = 0; i < s.width / 33; i++) {
    const x = (i * 113 + t * (i % 2 ? 4 : -3) + s.width) % s.width;
    const y = s.waterY + 13 + (i * 29) % Math.max(1, s.height - s.waterY - 14);
    line(c, [x, y, x + 12 + i % 17, y], "#b4ddc955", 2);
  }
  c.restore();
}
