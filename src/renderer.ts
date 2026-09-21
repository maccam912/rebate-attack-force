import type { GameState, Player, WeaponId } from "../shared/types";

export interface RenderOptions {
  time: number;
  aim: { x: number; y: number };
  tool: "grapple" | "weapon";
  power: number;
  menu: boolean;
}
const ink = "#223c34";
const weaponColors: Record<string, string> = {
  rocket: "#ef9b62",
  grenade: "#cee579",
  pulse: "#b9a5e0",
};
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

export function drawFrog(
  c: CanvasRenderingContext2D,
  player: Pick<Player, "x" | "y" | "color" | "vx" | "vy" | "grounded">,
  time: number,
  scale = 1,
  aim?: { x: number; y: number },
) {
  c.save();
  c.translate(player.x, player.y);
  c.scale(scale, scale);
  const tilt = Math.max(-0.3, Math.min(0.3, player.vx / 1000));
  c.rotate(tilt);
  const bounce = player.grounded ? Math.sin(time * 2.5) * 0.8 : 0;
  c.translate(0, bounce);
  // Boots, knapsack and scarf: all drawn for this game.
  rounded(c, -23, -5, 12, 21, 5, "#667b5a", ink);
  rounded(c, -21, 11, 15, 8, 4, player.color, ink);
  rounded(c, 6, 11, 15, 8, 4, player.color, ink);
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
    circle(c, x, -16, 5.5, "#fff6d9");
    const ax = aim ? Math.max(-2, Math.min(2, (aim.x - player.x) / 100)) : 1;
    const ay = aim ? Math.max(-2, Math.min(2, (aim.y - player.y) / 100)) : 0;
    circle(c, x + ax, -16 + ay, 2.3, ink);
  }
  c.beginPath();
  c.arc(1, -1, 7, 0.2, Math.PI - 0.2);
  c.strokeStyle = ink;
  c.lineWidth = 1.7;
  c.stroke();
  circle(c, -15, 0, 2.7, "#e69079");
  circle(c, 16, 0, 2.7, "#e69079");
  poly(c, [-20, 6, -11, 10, -14, 21, -23, 18], "#d97851");
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
  if (y < 600) {
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
  weapon: WeaponId,
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
  rounded(c, -7, -10, 14, 15, 2, weaponColors[weapon], ink);
  text(
    c,
    weapon === "rocket" ? "↗" : weapon === "grenade" ? "●" : "ϟ",
    -4,
    2,
    12,
    ink,
  );
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
    const x = (i * 97 + t * (i % 2 ? 4 : -3) + 1440) % 1440,
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
  c.clearRect(0, 0, s.width, s.height);
  background(c, s, o.time);
  if (s.explosions.some((e) => e.age < 0.2)) {
    const strength = 3;
    c.translate(
      Math.sin(o.time * 77) * strength,
      Math.cos(o.time * 93) * strength,
    );
  }
  s.platforms.forEach((p, i) => platform(c, p, i, o.time));
  // Hand-painted scraps and signposts stay outside the gameplay silhouettes.
  line(c, [98, 650, 98, 600], "#3a5545", 5);
  rounded(c, 63, 585, 80, 29, 3, "#d1cc9b", ink);
  text(c, "NO REFUNDS", 69, 604, 10, ink, 800);
  for (const [x, y] of [
    [465, 650],
    [1190, 650],
  ]) {
    rounded(c, x, y - 21, 37, 21, 4, "#8b9c73", ink);
    line(c, [x + 6, y - 11, x + 30, y - 11], "#4e6c50", 2);
    rounded(c, x + 10, y - 28, 16, 8, 2, "#738661", ink);
  }
  for (const box of s.crates)
    crate(
      c,
      box.x,
      box.y,
      box.weapon,
      o.time,
      Number(String(box.id).replace(/\D/g, "")) || 0,
    );
  const active = s.players.find((p) => p.id === s.activePlayerId);
  for (const p of s.players) {
    if (!p.alive) continue;
    if (p.rope) {
      line(c, [p.x, p.y, p.rope.x, p.rope.y], "#294a3c", 4);
      line(c, [p.x, p.y, p.rope.x, p.rope.y], "#e8d79a", 2);
      circle(c, p.rope.x, p.rope.y, 7, "#eff0b7");
      circle(c, p.rope.x, p.rope.y, 3, "#5b7954");
    }
    if (p.grounded) {
      c.beginPath();
      c.ellipse(p.x, p.y + 18, 24, 4, 0, 0, 7);
      c.fillStyle = "#172f3438";
      c.fill();
    }
    drawFrog(c, p, o.time, 1, p.id === s.activePlayerId ? o.aim : undefined);
    c.textAlign = "center";
    text(c, p.name, p.x, p.y - 49, 13, ink, 800);
    rounded(c, p.x - 25, p.y - 41, 50, 4, 2, "#314c3d44");
    rounded(
      c,
      p.x - 25,
      p.y - 41,
      (Math.max(0, p.hp) / 100) * 50,
      4,
      2,
      p.color,
    );
    if (p.id === s.activePlayerId && !o.menu) {
      const ay = p.y - 65 + Math.sin(o.time * 4) * 3;
      poly(c, [p.x - 5, ay, p.x + 5, ay, p.x, ay + 6], "#fbf7d9");
    }
    c.textAlign = "left";
  }
  if (active && !o.menu && s.phase !== "finished") {
    const dx = o.aim.x - active.x,
      dy = o.aim.y - active.y,
      len = Math.hypot(dx, dy) || 1;
    c.globalAlpha = 0.65;
    if (o.tool === "weapon" && active.hasCrate) {
      if (active.weapon === "pulse") {
        c.beginPath();
        c.arc(
          active.x + (dx / len) * 92,
          active.y + (dy / len) * 92,
          108,
          0,
          Math.PI * 2,
        );
        c.strokeStyle = "#fef6cf";
        c.setLineDash([3, 7]);
        c.lineWidth = 1.5;
        c.stroke();
        c.setLineDash([]);
      } else {
        const speed = (active.weapon === "grenade" ? 630 : 800) * o.power;
        for (let i = 1; i <= 22; i++) {
          const dt = i * 0.045;
          const gravity = active.weapon === "grenade" ? 1050 : 0;
          const x = active.x + ((dx / len) * speed + active.vx * 0.25) * dt,
            y =
              active.y +
              ((dy / len) * speed + active.vy * 0.25) * dt +
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
    c.arc(o.aim.x, o.aim.y, 10, 0, 7);
    c.stroke();
    line(
      c,
      [o.aim.x - 16, o.aim.y, o.aim.x - 7, o.aim.y],
      c.strokeStyle as string,
      1.5,
    );
    line(
      c,
      [o.aim.x + 7, o.aim.y, o.aim.x + 16, o.aim.y],
      c.strokeStyle as string,
      1.5,
    );
    line(
      c,
      [o.aim.x, o.aim.y - 16, o.aim.x, o.aim.y - 7],
      c.strokeStyle as string,
      1.5,
    );
  }
  for (const p of s.projectiles) {
    c.save();
    c.translate(p.x, p.y);
    c.rotate(Math.atan2(p.vy, p.vx));
    if (p.kind === "rocket") {
      poly(c, [-10, -5, 6, -5, 13, 0, 6, 5, -10, 5], "#e27e4b");
      poly(c, [-10, -3, -24 - Math.sin(o.time * 60) * 8, 0, -10, 3], "#fbedb0");
    } else {
      circle(c, 0, 0, 7, weaponColors[p.kind]);
      circle(c, -2, -2, 2, "#fff2b5");
    }
    c.restore();
  }
  for (const e of s.explosions) {
    const progress = e.age / 0.55;
    c.globalAlpha = Math.max(0, 1 - progress);
    circle(c, e.x, e.y, e.radius * (0.4 + progress * 0.6), "#f3cf7d");
    circle(c, e.x, e.y, e.radius * (0.2 + progress * 0.35), "#fff2cb");
    for (let i = 0; i < 14; i++) {
      const a = i * 2.4;
      circle(
        c,
        e.x + Math.cos(a) * e.radius * progress * 1.6,
        e.y + Math.sin(a) * e.radius * progress * 1.6,
        4 * (1 - progress),
        "#eaa264",
      );
    }
    c.globalAlpha = 1;
  }
  water(c, s, o.time);
  // Floating seed motes.
  for (let i = 0; i < 17; i++) {
    const x = (i * 113 + Math.sin(o.time * 0.2 + i) * 15) % 1440,
      y = 245 + ((i * 89 + o.time * 6) % 475);
    circle(c, x, y, 1.5, "#f7f3d680");
  }
  c.restore();
}
