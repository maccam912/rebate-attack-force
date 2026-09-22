import type { GameState, Player } from "../shared/types";
import { WEAPON_CATALOG } from "../shared/weapons";
import { DAMAGE_APPLY_SECONDS } from "../shared/game";

import type { Camera } from "./camera";
import { FrogAnimator } from "./frog";
import { drawHazards, drawStatusAura, drawStatusBadges, drawVisionEffects, STATUS_PRESENTATION } from "./effect-renderer";

export interface RenderOptions {
  camera: Camera;
  viewport: { width: number; height: number; dpr: number };
  time: number;
  aim?: { x: number; y: number };
  tool: "grapple" | "weapon";
  power: number;
  menu: boolean;
  reducedMotion?: boolean;
  /** Only the client controlling the active frog receives disruptive vision effects. */
  visionEffects?: boolean;
}
const ink = "#223c34";
const animator = new FrogAnimator();
function rounded(
  c: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
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

function displayedHealth(s: GameState, player: Player): number {
  const reveal = s.phase === "damage" ? s.resolution?.reveal : null;
  if (!reveal || reveal.playerId !== player.id) return player.hp;
  if (!reveal.applied) return reveal.fromHp;
  const progress = Math.max(0, Math.min(1, (reveal.elapsed - DAMAGE_APPLY_SECONDS) / 0.45));
  return reveal.fromHp + (reveal.toHp - reveal.fromHp) * (1 - (1 - progress) ** 3);
}

/** Screen-size text stays readable even when a chain reaction has widened the camera. */
function drawDamageOutcome(c: CanvasRenderingContext2D, s: GameState, o: RenderOptions) {
  const reveal = s.phase === "damage" ? s.resolution?.reveal : null;
  const frog = reveal && s.players.find((player) => player.id === reveal.playerId);
  if (!reveal || !frog || o.menu) return;
  const { camera, viewport } = o;
  const x = (frog.x - camera.x) * camera.zoom;
  const y = ((reveal.drowned ? s.waterY - 28 : frog.y) - camera.y) * camera.zoom;
  // Wait for the camera to reach distant victims before displaying their outcome.
  if (x < -40 || x > viewport.width + 40 || y < -40 || y > viewport.height + 40) return;
  const cardWidth = Math.min(214, viewport.width - 28);
  const cardX = Math.max(14, Math.min(viewport.width - cardWidth - 14, x - cardWidth / 2));
  const cardY = Math.max(Math.min(88, viewport.height * 0.25), Math.min(viewport.height - 112, y - 150));
  const hp = Math.round(displayedHealth(s, frog));
  c.save();
  c.setTransform(viewport.dpr, 0, 0, viewport.dpr, 0, 0);
  c.globalAlpha = Math.min(1, reveal.elapsed / 0.16);
  rounded(c, cardX, cardY, cardWidth, 98, 13, "#173329ee", "#eaf0c241");
  c.textAlign = "center";
  const center = cardX + cardWidth / 2;
  text(c, frog.name, center, cardY + 22, 13, frog.color, 800);
  if (reveal.applied) {
    const pop = o.reducedMotion ? 0 : Math.max(0, 1 - (reveal.elapsed - DAMAGE_APPLY_SECONDS) / 0.2) * 3;
    text(c, `−${Math.round(reveal.damage)}`, center, cardY + 53, 28 + pop, "#ffd69a", 900);
    const result = `${hp} HP${hp === 0 ? reveal.drowned ? " · SPLASH" : " · K.O." : ""}`;
    text(c, `${reveal.fromHp} → ${result}`, center, cardY + 74, 12, "#f5f1d3", 700);
  } else {
    text(c, "TURN OUTCOME", center, cardY + 48, 13, "#f5f1d3", 800);
    text(c, `${reveal.fromHp} HP`, center, cardY + 72, 12, "#eaf0c2", 700);
  }
  rounded(c, cardX + 16, cardY + 83, cardWidth - 32, 5, 2.5, "#eaf0c230");
  const barWidth = (cardWidth - 32) * Math.max(0, hp) / frog.maxHp;
  if (barWidth > 0) rounded(c, cardX + 16, cardY + 83, barWidth, 5, 2.5, frog.color);
  c.restore();
}

export function drawFrog(
  c: CanvasRenderingContext2D,
  player: Player,
  time: number,
  scale = 1,
  aim?: { x: number; y: number },
  players: Player[] = [],
) {
  const pose = animator.pose(player, players, aim, time);
  const speed = Math.hypot(player.vx, player.vy);
  if (speed > 570 && !player.grounded) {
    const ux = player.vx / speed, uy = player.vy / speed;
    const trail = Math.min(56, speed * 0.044);
    for (const side of [-1, 0, 1]) line(c, [
      player.x - ux * 29 - uy * side * 14, player.y - uy * 29 + ux * side * 14,
      player.x - ux * (29 + trail) - uy * side * 14, player.y - uy * (29 + trail) + ux * side * 14,
    ], "#fff5d77a", side === 0 ? 2.4 : 1.3);
  }
  c.save();
  c.translate(player.x, player.y);
  c.scale(scale, scale);
  c.rotate(pose.rotation);
  // Jointed hind legs and webbed toes, drawn behind the body.
  c.lineCap = "round";
  c.lineJoin = "round";
  for (const { hip, knee, foot } of pose.legs) {
    line(c, [hip.x, hip.y, knee.x, knee.y], ink, 11);
    line(c, [hip.x, hip.y, knee.x, knee.y], player.color, 7.5);
    line(c, [knee.x, knee.y, foot.x, foot.y], ink, 7);
    line(c, [knee.x, knee.y, foot.x, foot.y], player.color, 4);
    poly(c, [
      foot.x - 4, foot.y - 2,
      foot.x - 8, foot.y + 2,
      foot.x - 2, foot.y + 1,
      foot.x, foot.y + 3,
      foot.x + 3, foot.y + 1,
      foot.x + 8, foot.y + 2,
      foot.x + 4, foot.y - 3,
    ], player.color);
    c.strokeStyle = ink;
    c.lineWidth = 1.5;
    c.stroke();
  }
  const bounce = player.grounded ? Math.sin(time * 2.5) * 0.8 : 0;
  c.translate(0, bounce);
  const squash = Math.max(0, player.impact || 0) * 0.22;
  c.scale(1 + squash, 1 - squash);
  // Knapsack.
  rounded(c, -23, -5, 12, 21, 5, "#667b5a", ink);
  c.beginPath();
  c.ellipse(0, 0, 22, 18, 0, 0, Math.PI * 2);
  c.fillStyle = player.color;
  c.fill();
  c.strokeStyle = ink;
  c.lineWidth = 2.5;
  c.stroke();
  c.beginPath();
  c.ellipse(2, 5, 13, 10, 0, 0, Math.PI * 2);
  c.fillStyle = "#edf1c8";
  c.fill();
  for (const x of [-11, 11]) {
    circle(c, x, -15, 10, ink);
    circle(c, x, -15, 8, player.color);
    circle(c, x, -16, pose.alarmed ? 6.8 : 5.5, "#fff6d9");
    circle(c, x + pose.eyes.x, -16 + pose.eyes.y, pose.alarmed ? 1.9 : 2.3, ink);
    if (pose.alarmed)
      line(c, [x - 6, x < 0 ? -27 : -29, x + 6, x < 0 ? -29 : -27], ink, 2);
  }
  if (pose.alarmed) {
    c.beginPath();
    c.ellipse(1, 5, 5.5, 7, 0, 0, Math.PI * 2);
    c.fillStyle = ink;
    c.fill();
    c.beginPath();
    c.ellipse(1, 9, 3, 2, 0, 0, Math.PI * 2);
    c.fillStyle = "#e69079";
    c.fill();
  } else {
    c.beginPath();
    c.arc(1, -1, 7, 0.2, Math.PI - 0.2);
    c.strokeStyle = ink;
    c.lineWidth = 1.7;
    c.stroke();
  }
  circle(c, -15, 0, 2.7, "#e69079");
  circle(c, 16, 0, 2.7, "#e69079");
  c.restore();
}

function background(c: CanvasRenderingContext2D, s: GameState, t: number) {
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

function platform(
  c: CanvasRenderingContext2D,
  p: GameState["platforms"][number],
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

function crate(
  c: CanvasRenderingContext2D,
  x: number,
  y: number,
  t: number,
  id: number,
) {
  c.save();
  c.translate(x, y + Math.sin(t * 2 + id) * 2);
  const glow = c.createRadialGradient(0, 0, 5, 0, 0, 50);
  glow.addColorStop(0, "#f8d78032");
  glow.addColorStop(1, "#f8d78000");
  c.fillStyle = glow;
  c.fillRect(-50, -50, 100, 100);
  rounded(c, -17, -18, 34, 33, 3, "#d99650", ink);
  rounded(c, -12, -13, 24, 23, 1, "#edbc73");
  line(c, [-13, -13, 13, 10], "#ae733f", 4);
  line(c, [13, -13, -13, 10], "#ae733f", 4);
  rounded(c, -20, -18, 40, 6, 1, "#f3d591", ink);
  rounded(c, -19, 10, 38, 6, 1, "#c39153", ink);
  // Every supply box looks identical. Reveal the seeded random weapon on pickup.
  rounded(c, -7, -10, 14, 15, 2, "#f6df9e", ink);
  text(c, "?", -4, 2, 13, ink, 800);
  if (Math.sin(t * 2 + id) > 0.6) {
    line(c, [26, -30, 26, -20], "#fff1bd", 2);
    line(c, [21, -25, 31, -25], "#fff1bd", 2);
  }
  c.restore();
}

function water(c: CanvasRenderingContext2D, s: GameState, t: number) {
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

export function renderGame(
  c: CanvasRenderingContext2D,
  s: GameState,
  o: RenderOptions,
) {
  c.save();
  const { camera, viewport, aim } = o;
  c.setTransform(viewport.dpr, 0, 0, viewport.dpr, 0, 0);
  c.clearRect(0, 0, viewport.width, viewport.height);
  // Background fills the screen independently from the world camera.
  c.save();
  const backgroundScale = Math.max(viewport.width / 1440, viewport.height / 850);
  c.translate((viewport.width - 1440 * backgroundScale) / 2, (viewport.height - 850 * backgroundScale) / 2);
  c.scale(backgroundScale, backgroundScale);
  background(c, { ...s, width: 1440, height: 850 }, o.time);
  c.restore();
  c.scale(camera.zoom, camera.zoom);
  c.translate(-camera.x, -camera.y);
  if (!o.reducedMotion && !o.menu && (s.resolution?.impact ?? 0) > 0.01) {
    // A few screen pixels of kick sell the contact without obscuring its outcome.
    const strength = Math.min(1, s.resolution!.impact) * 2.4 / camera.zoom;
    c.translate(
      Math.sin(o.time * 77) * strength,
      Math.cos(o.time * 93) * strength,
    );
  }
  s.platforms.forEach((p, i) => {
    if (p.x + p.w >= camera.x - 40 && p.x <= camera.x + camera.width + 40 &&
        p.y + p.h >= camera.y - 40 && p.y <= camera.y + camera.height + 40)
      platform(c, p, i, o.time);
  });
  drawHazards(c, s, o);
  for (const box of s.crates)
    crate(
      c,
      box.x,
      box.y,
      o.time,
      Number(String(box.id).replace(/\D/g, "")) || 0,
    );
  const active = s.players.find((p) => p.id === s.activePlayerId);
  for (const mine of s.mines ?? []) {
    const def = WEAPON_CATALOG[mine.kind];
    const armed = s.turn > mine.placedTurn;
    const triggered = mine.fuse !== null;
    c.save();
    c.translate(mine.x, mine.y);
    if (armed) {
      c.beginPath();
      c.arc(0, 0, def.range, 0, Math.PI * 2);
      c.strokeStyle = triggered ? "#ff7955a0" : "#f4df9435";
      c.lineWidth = 1.5;
      c.setLineDash([3, 8]);
      c.stroke();
      c.setLineDash([]);
    }
    rounded(c, -13, -5, 26, 12, 5, "#314c3d", ink);
    rounded(c, -9, -9, 18, 7, 3, def.color, ink);
    circle(c, 0, -7, 3, !armed ? "#819575" : Math.sin(o.time * (triggered ? 35 : 5)) > 0 ? "#ff603e" : "#fff3b1");
    if (mine.kind === "springMine") line(c, [-7, -1, -3, -5, 0, -1, 4, -5, 8, -1], ink, 2);
    if (triggered) {
      c.textAlign = "center";
      text(c, "!", 0, -21, 22, "#fff0b0", 900);
    }
    c.restore();
  }
  const labels: { x: number; y: number; width: number; height: number }[] = [];
  const drowned = new Set(s.resolution?.drownedPlayerIds ?? []);
  const controlling = s.phase === "playing" || s.phase === "retreat";
  for (const p of s.players) {
    if (!p.alive || drowned.has(p.id)) continue;
    if (p.rope) {
      const points = [p.rope, ...p.rope.bends, p].flatMap((point) => [point.x, point.y]);
      line(c, points, "#294a3c", 4);
      line(c, points, "#e8d79a", 2);
      for (const bend of p.rope.bends) circle(c, bend.x, bend.y, 3, "#fff2b5");
      circle(c, p.rope.x, p.rope.y, 7, "#eff0b7");
      circle(c, p.rope.x, p.rope.y, 3, "#5b7954");
    }
    if (p.grounded) {
      c.beginPath();
      c.ellipse(p.x, p.y + 18, 24, 4, 0, 0, 7);
      c.fillStyle = "#172f3438";
      c.fill();
    }
    drawStatusAura(c, p, o);
    drawFrog(
      c, p, o.time, 1,
      controlling && p.id === s.activePlayerId ? aim : undefined,
      o.menu ? [] : s.players.filter((frog) => !drowned.has(frog.id)),
    );
    c.textAlign = "center";
    c.font = "800 13px 'Trebuchet MS', sans-serif";
    const statusCount = (p.statuses ?? []).filter((status) => status.remaining > 0).length;
    const labelWidth = Math.max(50, c.measureText(p.name).width, Math.min(5, statusCount) * 38 / Math.max(0.7, camera.zoom)) + 10;
    const labelHeight = statusCount ? 58 : 30;
    let labelY = p.y - 49;
    while (labels.some((label) => Math.abs(label.x - p.x) < (label.width + labelWidth) / 2 &&
      Math.abs(label.y - labelY) < Math.max(label.height, labelHeight))) labelY -= labelHeight + 2;
    labels.push({ x: p.x, y: labelY, width: labelWidth, height: labelHeight });
    if (labelY < p.y - 49)
      line(c, [p.x, labelY + 15, p.x, p.y - 32], "#314c3d55", 1);
    text(c, p.name, p.x, labelY, 13, ink, 800);
    rounded(c, p.x - 25, labelY + 8, 50, 4, 2, "#314c3d44");
    rounded(
      c,
      p.x - 25,
      labelY + 8,
      (Math.max(0, displayedHealth(s, p)) / p.maxHp) * 50,
      4,
      2,
      p.color,
    );
    drawStatusBadges(c, p, labelY, o);
    if (p.id === s.activePlayerId && !o.menu && controlling) {
      const ay = labelY - (p.statuses?.length ? 37 : 16) + (o.reducedMotion ? 0 : Math.sin(o.time * 4) * 3);
      poly(c, [p.x - 5, ay, p.x + 5, ay, p.x, ay + 6], "#fbf7d9");
    }
    c.textAlign = "left";
  }
  if (active && aim && !o.menu && controlling) {
    const dx = aim.x - active.x,
      dy = aim.y - active.y,
      len = Math.hypot(dx, dy) || 1;
    c.globalAlpha = 0.65;
    if (o.tool === "weapon" && active.hasCrate && active.weapon) {
      const def = WEAPON_CATALOG[active.weapon];
      if (def.attack === "airstrike") {
        c.setLineDash([5, 10]);
        line(c, [aim.x, camera.y, aim.x, aim.y], "#fff1c3", 2);
        c.setLineDash([]);
        c.textAlign = "center";
        text(c, "INCOMING", aim.x, aim.y - 28, 12, "#fff1c3", 800);
        c.textAlign = "left";
      } else if (def.attack === "blast" || def.attack === "melee") {
        c.beginPath();
        if (def.attack === "melee") {
          const angle = Math.atan2(dy, dx);
          c.arc(active.x, active.y, def.range, angle - 0.9, angle + 0.9);
        } else c.arc(active.x + (dx / len) * def.range, active.y + (dy / len) * def.range, def.radius, 0, Math.PI * 2);
        c.strokeStyle = "#fef6cf";
        c.setLineDash([3, 7]);
        c.lineWidth = 1.5;
        c.stroke();
        c.setLineDash([]);
      } else {
        const speed = def.speed * o.power;
        for (let i = 1; i <= 22; i++) {
          const dt = i * 0.045;
          if (dt > def.life || (def.id === "boomerang" && dt > 0.4)) break;
          const gravity = def.gravity;
          const inheritance = def.attack === "mine" ? 0.3 : 0.35;
          const x = active.x + ((dx / len) * speed + active.vx * inheritance) * dt,
            y =
              active.y +
              ((dy / len) * speed + (def.attack === "mine" ? -65 : active.vy * inheritance)) * dt +
              0.5 * gravity * dt * dt;
          if (
            s.platforms.some(
              (p) => x >= p.x && x <= p.x + p.w && y >= p.y && y <= p.y + p.h,
            ) ||
            y >= s.waterY
          )
            break;
          circle(c, x, y, 2.5, "#fef6cf");
        }
      }
    } else {
      c.setLineDash([3, 9]);
      line(
        c,
        [
          active.x + (dx / len) * 33,
          active.y + (dy / len) * 33,
          active.x + (dx / len) * 96,
          active.y + (dy / len) * 96,
        ],
        "#f9f5cc",
        2,
      );
      c.setLineDash([]);
    }
    c.globalAlpha = 1;
    c.strokeStyle = o.tool === "weapon" ? "#fff1c3" : "#315b49";
    c.lineWidth = 1.5;
    c.beginPath();
    c.arc(aim.x, aim.y, 10, 0, 7);
    c.stroke();
    line(
      c,
      [aim.x - 16, aim.y, aim.x - 7, aim.y],
      c.strokeStyle as string,
      1.5,
    );
    line(
      c,
      [aim.x + 7, aim.y, aim.x + 16, aim.y],
      c.strokeStyle as string,
      1.5,
    );
    line(
      c,
      [aim.x, aim.y - 16, aim.x, aim.y - 7],
      c.strokeStyle as string,
      1.5,
    );
  }
  for (const p of s.projectiles) {
    const def = WEAPON_CATALOG[p.kind];
    const speed = Math.hypot(p.vx, p.vy);
    if (speed > 300) line(c, [p.x, p.y, p.x - p.vx * 0.035, p.y - p.vy * 0.035], `${def.color}88`, p.kind === "meteor" ? 18 : 3);
    c.save();
    c.translate(p.x, p.y);
    c.rotate(Math.atan2(p.vy, p.vx));
    if (p.kind === "rocket" || p.kind === "firework") {
      poly(c, [-10, -5, 6, -5, 13, 0, 6, 5, -10, 5], "#e27e4b");
      poly(c, [-10, -3, -24 - Math.sin(o.time * 60) * 8, 0, -10, 3], "#fbedb0");
    } else if (p.kind === "sniper" || p.kind === "shotgun") {
      rounded(c, -6, -2, 12, 4, 2, def.color);
    } else if (p.kind === "anvil") {
      c.rotate(-Math.atan2(p.vy, p.vx));
      poly(c, [-20, -10, 20, -10, 12, -1, 5, -1, 5, 8, 14, 12, -14, 12, -5, 8, -5, -1, -13, -1], def.color);
      line(c, [-18, -10, 18, -10], "#f4f6e4", 3);
    } else if (p.kind === "banana" || p.kind === "boomerang") {
      c.rotate((p.age ?? 0) * 10);
      c.beginPath();
      c.arc(0, 0, 12, -1, 1.8);
      c.strokeStyle = def.color;
      c.lineWidth = 6;
      c.stroke();
    } else if (def.hazard) {
      const kind = def.hazard.kind;
      if (kind === "gravity" || kind === "repulsor" || kind === "updraft") {
        circle(c, 0, 0, 13, `${def.color}55`);
        circle(c, 0, 0, 8, "#293b3d");
        c.strokeStyle = def.color;
        c.lineWidth = 2;
        c.stroke();
        c.beginPath();
        c.ellipse(0, 0, 16, 5, Math.PI / 4, 0, Math.PI * 2);
        c.stroke();
        line(c, [-4, 0, 4, 0], def.color, 2);
        if (kind !== "gravity") line(c, [0, -4, 0, 4], def.color, 2);
      } else {
        // Contraband canisters, with recognizable wire/flame/cold contents.
        rounded(c, -11, -7, 20, 14, 4, def.color, ink);
        rounded(c, 7, -5, 5, 10, 1, "#e5e4c4", ink);
        line(c, [-7, -5, -3, 5, 2, -5], "#203c3977", 2);
        if (kind === "wire") {
          line(c, [-12, -11, 11, 11, 11, -11, -12, 11], "#edf6e6", 1.5);
        } else if (kind === "fire") {
          poly(c, [-14, -3, -20, -11, -18, 1, -24, 4, -13, 5], "#ffd58f");
        }
      }
    } else if (def.status) {
      if (def.speed >= 1100) {
        line(c, [-22, 0, 10, 0], `${def.color}66`, 9);
        line(c, [-18, 0, 11, 0], "#fff9df", 2);
        poly(c, [0, -5, 13, 0, 0, 5, 3, 0], def.color);
      } else {
        const effect = STATUS_PRESENTATION[def.status.kind];
        circle(c, 0, 0, 12, ink);
        circle(c, 0, 0, 10, def.color);
        c.rotate(-Math.atan2(p.vy, p.vx));
        c.textAlign = "center";
        text(c, effect.glyph, 0, 4, 14, ink, 900);
      }
    } else {
      const size = p.variant === "fragment" ? 5 : p.kind === "meteor" ? 23 : p.kind === "megaBomb" ? 15 : 8;
      circle(c, 0, 0, size + 1.5, ink);
      circle(c, 0, 0, size, def.color);
      circle(c, -size * 0.25, -size * 0.3, size * 0.28, "#fff2b5");
      if (p.kind === "megaBomb" || p.kind === "disco") {
        line(c, [-size * 0.6, -size * 0.5, size * 0.6, size * 0.5], ink, 2);
        line(c, [-size * 0.6, size * 0.5, size * 0.6, -size * 0.5], ink, 2);
      }
      if (def.contact !== "explode" && !p.variant) {
        line(c, [0, -size, 4, -size - 5, 7, -size - 3], ink, 2);
        circle(c, 7, -size - 3, 2.5, Math.sin(o.time * 30) > 0 ? "#fff3ae" : "#ff714a");
      }
    }
    c.restore();
  }
  for (const e of s.explosions) {
    const progress = e.age / 0.55;
    const color = e.color ?? "#f3cf7d";
    c.globalAlpha = Math.max(0, 1 - progress);
    if (e.kind === "melee") {
      c.beginPath();
      c.arc(e.x, e.y, e.radius * (0.5 + progress * 0.4), (e.direction ?? 0) - 1.2, (e.direction ?? 0) + 1.2);
      c.strokeStyle = color;
      c.lineWidth = 14 * (1 - progress);
      c.stroke();
      c.save();
      c.translate(e.x, e.y);
      c.rotate((e.direction ?? 0) - 0.8 + progress * 2.1);
      if (e.weapon === "golf") {
        line(c, [-30, 16, 21, -13], "#d7e4d2", 4);
        line(c, [-30, 16, -16, 8], ink, 6);
        rounded(c, 18, -19, 18, 9, 3, "#dae2df", ink);
      } else if (e.weapon === "bat") {
        rounded(c, -30, -4, 60, 8, 4, "#ae784c", ink);
        rounded(c, -2, -8, 40, 16, 7, "#e0b875", ink);
      } else if (e.weapon === "ropeShears") {
        const open = 0.25 + Math.sin(progress * Math.PI) * 0.35;
        for (const side of [-1, 1]) {
          c.save();
          c.rotate(open * side);
          line(c, [-20, side * 4, 30, side * 3], "#e6efdf", 5);
          circle(c, -23, side * 5, 8, "#d09d66");
          circle(c, -23, side * 5, 4, ink);
          c.restore();
        }
        circle(c, 0, 0, 3, ink);
      } else if (e.weapon === "glueSlap") {
        rounded(c, -20, -7, 28, 14, 4, "#e9bf9b", ink);
        rounded(c, 1, -15, 22, 29, 6, "#ffb3df", ink);
        for (let finger = 0; finger < 4; finger++)
          line(c, [12 + finger * 5, -6, 15 + finger * 5, -20 + Math.abs(1 - finger) * 4], "#ffb3df", 5);
        circle(c, 29, 12, 3, "#ffb3df");
      } else {
        rounded(c, -21, -9, 22, 18, 4, "#f3c99b", ink);
        rounded(c, -4, -17, 30, 31, 10, "#ed7067", ink);
        circle(c, 0, 13, 8, "#ed7067");
      }
      c.restore();
      c.textAlign = "center";
      text(c, e.weapon === "ropeShears" ? "SNIP!" : e.weapon === "glueSlap" ? "SPLAT!" : "WHACK!", e.x, e.y - 32 - progress * 20, 18, "#fff5cd", 900);
      c.textAlign = "left";
    } else if (e.kind === "pull" || e.kind === "push" || e.kind === "spring") {
      for (let ring = 0; ring < 3; ring++) {
        const wave = (progress + ring / 3) % 1;
        c.beginPath();
        c.arc(e.x, e.y, e.radius * (e.kind === "pull" ? 1 - wave : wave), 0, Math.PI * 2);
        c.strokeStyle = color;
        c.lineWidth = 4 * (1 - wave);
        c.stroke();
      }
    } else {
      circle(c, e.x, e.y, e.radius * (0.4 + progress * 0.6), color);
      circle(c, e.x, e.y, e.radius * (0.2 + progress * 0.35), "#fff2cb");
      c.beginPath();
      c.arc(e.x, e.y, e.radius * (0.3 + progress * 1.5), 0, Math.PI * 2);
      c.strokeStyle = "#fff1bd";
      c.lineWidth = 3 * (1 - progress);
      c.stroke();
    }
    for (let i = 0; i < 14; i++) {
      const a = i * 2.4;
      circle(
        c,
        e.x + Math.cos(a) * e.radius * progress * 1.6,
        e.y + Math.sin(a) * e.radius * progress * 1.6,
        4 * (1 - progress),
        color,
      );
    }
    c.globalAlpha = 1;
  }
  water(c, s, o.time);
  for (const id of drowned) {
    const frog = s.players.find((player) => player.id === id);
    if (!frog?.alive) continue;
    c.beginPath();
    c.ellipse(frog.x, s.waterY + 3, 24 + Math.sin(o.time * 3) * 4, 5, 0, 0, Math.PI * 2);
    c.strokeStyle = "#f5f1d3aa";
    c.lineWidth = 1.5;
    c.stroke();
  }
  // Floating seed motes.
  for (let i = 0; i < 17; i++) {
    const x = (i * 113 + Math.sin(o.time * 0.2 + i) * 15) % s.width,
      y = 245 + ((i * 89 + o.time * 6) % 475);
    circle(c, x, y, 1.5, "#f7f3d680");
  }
  if (!o.menu) {
    for (const p of s.players) {
      if (!p.alive || drowned.has(p.id) || p.id === s.activePlayerId) continue;
      const inset = 65 / camera.zoom;
      const x = Math.max(camera.x + inset, Math.min(camera.x + camera.width - inset, p.x));
      const y = Math.max(camera.y + inset, Math.min(camera.y + camera.height - 100 / camera.zoom, p.y));
      if (Math.hypot(x - p.x, y - p.y) < 30) continue;
      circle(c, x, y, 14 / camera.zoom, "#173329dd");
      const angle = Math.atan2(p.y - y, p.x - x);
      c.save();
      c.translate(x, y);
      c.scale(1 / camera.zoom, 1 / camera.zoom);
      c.rotate(angle);
      poly(c, [8, 0, -5, -6, -5, 6], p.color);
      c.restore();
      c.textAlign = "center";
      text(c, p.name, x, y + 29 / camera.zoom, 12 / camera.zoom, ink, 800);
      c.textAlign = "left";
    }
  }
  c.restore();
  drawVisionEffects(c, s, o);
  drawDamageOutcome(c, s, o);
}
