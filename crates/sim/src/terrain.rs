use crate::math::{v2, Vec2};
use crate::rng::hash2;

/// World size in pixels. Sim coordinates are y-down: y=0 is the sky,
/// y=HEIGHT is below the water line.
pub const WIDTH: f32 = 1920.0;
pub const HEIGHT: f32 = 1080.0;
/// Anything whose center sinks below this drowns.
pub const WATER_Y: f32 = HEIGHT - 70.0;

/// SDF/occupancy grid resolution in pixels per cell.
pub const CELL: f32 = 2.0;
pub const GRID_W: usize = (WIDTH / CELL) as usize;
pub const GRID_H: usize = (HEIGHT / CELL) as usize;

/// Signed-distance-field terrain. `sdf` is distance in pixels to the nearest
/// solid surface: positive in open air, negative inside ground.
pub struct Terrain {
    pub seed: u64,
    pub solid: Vec<bool>,
    pub sdf: Vec<f32>,
}

fn value_noise(x: f32, y: f32, seed: u64) -> f32 {
    let xi = x.floor() as i32;
    let yi = y.floor() as i32;
    let fx = x - xi as f32;
    let fy = y - yi as f32;
    // Smoothstep interpolation.
    let sx = fx * fx * (3.0 - 2.0 * fx);
    let sy = fy * fy * (3.0 - 2.0 * fy);
    let a = hash2(xi, yi, seed);
    let b = hash2(xi + 1, yi, seed);
    let c = hash2(xi, yi + 1, seed);
    let d = hash2(xi + 1, yi + 1, seed);
    let top = a + (b - a) * sx;
    let bot = c + (d - c) * sx;
    top + (bot - top) * sy
}

fn fbm(x: f32, y: f32, seed: u64, octaves: u32) -> f32 {
    let mut sum = 0.0;
    let mut amp = 0.5;
    let mut freq = 1.0;
    for i in 0..octaves {
        sum += amp * value_noise(x * freq, y * freq, seed.wrapping_add(i as u64 * 7919));
        amp *= 0.5;
        freq *= 2.0;
    }
    sum
}

impl Terrain {
    /// Deterministic island-style terrain: a rolling main landmass above the
    /// water line, noise caves inside it, and a few floating chunks.
    pub fn generate(seed: u64) -> Terrain {
        let mut solid = vec![false; GRID_W * GRID_H];
        for gy in 0..GRID_H {
            for gx in 0..GRID_W {
                let x = (gx as f32 + 0.5) * CELL;
                let y = (gy as f32 + 0.5) * CELL;
                if y >= WATER_Y - 4.0 {
                    continue; // open water below
                }
                // Main surface line: rolling hills around 55% height.
                let surf = HEIGHT * 0.52
                    + (fbm(x / 380.0, 7.3, seed, 4) - 0.5) * 420.0
                    + (fbm(x / 90.0, 3.1, seed ^ 0xABCD, 3) - 0.5) * 90.0;
                let mut s = y > surf;
                if s {
                    // Caves: carve where cave noise is high, more likely deeper.
                    let depth = (y - surf) / 240.0;
                    let cave = fbm(x / 150.0, y / 150.0, seed ^ 0x5EED, 4);
                    if cave > 0.62 - (depth.min(1.0) * 0.08) {
                        s = false;
                    }
                }
                // Floating chunks in the sky for rope anchors.
                if !s {
                    let blob = fbm(x / 220.0, y / 130.0, seed ^ 0xF10A7, 4);
                    if blob > 0.72 && y < HEIGHT * 0.45 && y > HEIGHT * 0.08 {
                        s = true;
                    }
                }
                solid[gy * GRID_W + gx] = s;
            }
        }
        let mut t = Terrain {
            seed,
            solid,
            sdf: vec![0.0; GRID_W * GRID_H],
        };
        t.rebuild_sdf();
        t
    }

    /// Two-pass chamfer distance transform on both sides, signed.
    pub fn rebuild_sdf(&mut self) {
        const BIG: f32 = 1e9;
        let (w, h) = (GRID_W, GRID_H);
        // dist to solid (for air cells) and dist to air (for solid cells)
        let mut d_out = vec![BIG; w * h];
        let mut d_in = vec![BIG; w * h];
        for i in 0..w * h {
            if self.solid[i] {
                d_out[i] = 0.0;
            } else {
                d_in[i] = 0.0;
            }
        }
        let chamfer = |d: &mut Vec<f32>| {
            const ORTH: f32 = 1.0;
            const DIAG: f32 = std::f32::consts::SQRT_2;
            // forward
            for y in 0..h {
                for x in 0..w {
                    let i = y * w + x;
                    let mut v = d[i];
                    if x > 0 {
                        v = v.min(d[i - 1] + ORTH);
                    }
                    if y > 0 {
                        v = v.min(d[i - w] + ORTH);
                        if x > 0 {
                            v = v.min(d[i - w - 1] + DIAG);
                        }
                        if x + 1 < w {
                            v = v.min(d[i - w + 1] + DIAG);
                        }
                    }
                    d[i] = v;
                }
            }
            // backward
            for y in (0..h).rev() {
                for x in (0..w).rev() {
                    let i = y * w + x;
                    let mut v = d[i];
                    if x + 1 < w {
                        v = v.min(d[i + 1] + ORTH);
                    }
                    if y + 1 < h {
                        v = v.min(d[i + w] + ORTH);
                        if x + 1 < w {
                            v = v.min(d[i + w + 1] + DIAG);
                        }
                        if x > 0 {
                            v = v.min(d[i + w - 1] + DIAG);
                        }
                    }
                    d[i] = v;
                }
            }
        };
        chamfer(&mut d_out);
        chamfer(&mut d_in);
        for i in 0..w * h {
            self.sdf[i] = (d_out[i] - d_in[i]) * CELL;
        }
    }

    fn cell(&self, gx: i32, gy: i32) -> f32 {
        // Outside the grid horizontally/above: open air. Below: open water.
        let gx = gx.clamp(0, GRID_W as i32 - 1);
        let gy = gy.clamp(0, GRID_H as i32 - 1);
        self.sdf[gy as usize * GRID_W + gx as usize]
    }

    /// Bilinear-interpolated signed distance at a world point.
    pub fn sample(&self, p: Vec2) -> f32 {
        let x = p.x / CELL - 0.5;
        let y = p.y / CELL - 0.5;
        let xi = x.floor();
        let yi = y.floor();
        let fx = x - xi;
        let fy = y - yi;
        let (xi, yi) = (xi as i32, yi as i32);
        let a = self.cell(xi, yi);
        let b = self.cell(xi + 1, yi);
        let c = self.cell(xi, yi + 1);
        let d = self.cell(xi + 1, yi + 1);
        let top = a + (b - a) * fx;
        let bot = c + (d - c) * fx;
        top + (bot - top) * fy
    }

    /// Surface normal (points out of the terrain) via central differences.
    pub fn normal(&self, p: Vec2) -> Vec2 {
        const E: f32 = 1.5;
        let dx = self.sample(p + v2(E, 0.0)) - self.sample(p - v2(E, 0.0));
        let dy = self.sample(p + v2(0.0, E)) - self.sample(p - v2(0.0, E));
        let n = v2(dx, dy).normalized();
        if n == Vec2::ZERO {
            v2(0.0, -1.0)
        } else {
            n
        }
    }

    pub fn is_solid_at(&self, p: Vec2) -> bool {
        self.sample(p) < 0.0
    }

    /// Sphere-trace a ray; returns hit point if terrain is hit within max_len.
    pub fn raycast(&self, from: Vec2, dir: Vec2, max_len: f32) -> Option<Vec2> {
        let dir = dir.normalized();
        if dir == Vec2::ZERO {
            return None;
        }
        let mut t = 0.0;
        for _ in 0..256 {
            let p = from + dir * t;
            let d = self.sample(p);
            if d < 0.5 {
                return Some(p);
            }
            t += d.max(0.75);
            if t >= max_len {
                return None;
            }
        }
        None
    }

    /// Sweep a circle from `pos` along `delta`; stops before penetrating.
    /// Bodies already resting in contact can still slide tangentially:
    /// candidate steps are validated before being taken, never after.
    pub fn march_circle(&self, pos: Vec2, delta: Vec2, r: f32) -> (Vec2, Option<Vec2>) {
        let len = delta.length();
        if len < 1e-6 {
            return (pos, None);
        }
        let dir = delta * (1.0 / len);
        let mut p = pos;
        let d0 = self.sample(p) - r;
        if d0 < 0.0 {
            p += self.normal(p) * (-d0).min(2.0);
        }
        let mut traveled = 0.0;
        let mut hit = None;
        for _ in 0..64 {
            if traveled >= len - 1e-4 {
                break;
            }
            let d = self.sample(p) - r;
            let step = (d - 0.2).max(0.3).min(len - traveled);
            let cand = p + dir * step;
            let d_cand = self.sample(cand) - r;
            if d_cand < 0.1 {
                // Blocked. Slide: push the candidate out along the surface
                // normal; accept only if that still makes forward progress
                // (climbs micro-bumps while walking, stops at real walls).
                let n = self.normal(cand);
                let lifted = cand + n * (0.1 - d_cand + 0.2).min(1.5);
                if self.sample(lifted) - r >= 0.1 && (lifted - p).dot(dir) > step * 0.4 {
                    p = lifted;
                    traveled += step;
                    hit = Some(n);
                    continue;
                }
                hit = Some(n);
                break;
            }
            p = cand;
            traveled += step;
        }
        (p, hit)
    }

    /// Remove a disc of terrain (explosions). Returns true if anything changed.
    pub fn carve(&mut self, c: Vec2, r: f32) -> bool {
        let mut changed = false;
        let gx0 = (((c.x - r) / CELL).floor() as i32).max(0);
        let gx1 = (((c.x + r) / CELL).ceil() as i32).min(GRID_W as i32 - 1);
        let gy0 = (((c.y - r) / CELL).floor() as i32).max(0);
        let gy1 = (((c.y + r) / CELL).ceil() as i32).min(GRID_H as i32 - 1);
        for gy in gy0..=gy1 {
            for gx in gx0..=gx1 {
                let p = v2((gx as f32 + 0.5) * CELL, (gy as f32 + 0.5) * CELL);
                let dist_to_edge = r - p.distance(c); // >0 inside the carved disc
                let i = gy as usize * GRID_W + gx as usize;
                if dist_to_edge > 0.0 {
                    if self.solid[i] {
                        self.solid[i] = false;
                        changed = true;
                    }
                }
                // The carved disc is now open: distance can only grow.
                if self.sdf[i] < dist_to_edge {
                    self.sdf[i] = dist_to_edge;
                }
            }
        }
        changed
    }

    /// Deterministic spawn points: walkable surface spots above water,
    /// spread across the island.
    pub fn spawn_points(&self) -> Vec<Vec2> {
        let mut pts = Vec::new();
        let cols = 16;
        for c in 0..cols {
            let x = WIDTH * (c as f32 + 0.5) / cols as f32;
            // descend from the sky to the first surface with headroom
            let mut y = 40.0;
            while y < WATER_Y - 40.0 {
                let p = v2(x, y);
                if self.sample(p) < 16.0 {
                    let stand = v2(x, y - 18.0);
                    if self.sample(stand) > 15.0 && self.normal(p).y < -0.4 {
                        pts.push(stand);
                    }
                    break;
                }
                y += 8.0;
            }
        }
        if pts.is_empty() {
            pts.push(v2(WIDTH / 2.0, HEIGHT * 0.3));
        }
        pts
    }
}
