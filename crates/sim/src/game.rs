use crate::math::{v2, Vec2};
use crate::rng::Pcg32;
use crate::terrain::{Terrain, WATER_Y, WIDTH};
use serde::{Deserialize, Serialize};

pub const DT: f32 = 1.0 / 120.0;
pub const GRAVITY: f32 = 1200.0;
pub const MAX_SPEED: f32 = 4000.0;

pub const FROG_R: f32 = 13.0;
pub const CRATE_R: f32 = 12.0;

pub const WALK_SPEED: f32 = 170.0;
pub const WALK_ACC: f32 = 1600.0;
pub const AIR_ACC: f32 = 330.0;
pub const JUMP_UP: f32 = 290.0;
pub const JUMP_FWD: f32 = 240.0;
pub const BACKFLIP_UP: f32 = 430.0;
pub const BACKFLIP_BACK: f32 = 90.0;
/// Second jump tap within this window converts the hop into a backflip.
pub const BACKFLIP_WINDOW: f32 = 0.25;

pub const ROPE_RANGE: f32 = 480.0;
pub const ROPE_MIN: f32 = 26.0;
pub const REEL_SPEED: f32 = 150.0;
pub const SWING_ACC: f32 = 780.0;
pub const PUMP_BONUS: f32 = 1.9;
pub const PUMP_MAX_VT: f32 = 280.0;

pub const BOUNCE_THRESHOLD: f32 = 200.0;
pub const CONTACT_DMG_SPEED: f32 = 680.0;

pub const PRE_TIME: f32 = 3.0;
pub const ROUND_TIME: f32 = 45.0;
pub const BREAK_TIME: f32 = 5.0;
pub const ENDED_TIME: f32 = 10.0;
pub const KILLS_TO_WIN: u8 = 10;
pub const CHARGE_TIME: f32 = 1.2;
pub const OWNER_GRACE: f32 = 0.35;

pub const NUM_WEAPONS: usize = 3;

// Input button bits.
pub const BTN_LEFT: u8 = 1;
pub const BTN_RIGHT: u8 = 2;
pub const BTN_UP: u8 = 4;
pub const BTN_DOWN: u8 = 8;
pub const BTN_JUMP: u8 = 16;
pub const BTN_TONGUE: u8 = 32;
pub const BTN_FIRE: u8 = 64;

#[derive(Clone, Copy, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct Input {
    pub buttons: u8,
    pub aim: Vec2,
    pub sel: u8,
}

impl Input {
    pub fn held(&self, bit: u8) -> bool {
        self.buttons & bit != 0
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[repr(u8)]
pub enum Weapon {
    Bazooka = 0,
    Grenade = 1,
    Mine = 2,
}

impl Weapon {
    pub fn from_index(i: u8) -> Weapon {
        match i {
            0 => Weapon::Bazooka,
            1 => Weapon::Grenade,
            _ => Weapon::Mine,
        }
    }
    pub fn explosion_radius(self) -> f32 {
        match self {
            Weapon::Bazooka => 55.0,
            Weapon::Grenade => 62.0,
            Weapon::Mine => 50.0,
        }
    }
    pub fn max_damage(self) -> f32 {
        match self {
            Weapon::Bazooka => 70.0,
            Weapon::Grenade => 78.0,
            Weapon::Mine => 65.0,
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Rope {
    /// anchors[0] is the original attachment; later entries are terrain folds.
    /// The last entry is the active pivot.
    pub anchors: Vec<Vec2>,
    /// Bend sign at each fold, parallel to anchors[1..]: which side of the
    /// prev→fold line the frog was on when the fold formed. The fold only
    /// unwinds when the frog crosses back over that line.
    pub winds: Vec<f32>,
    pub length: f32,
}

impl Rope {
    pub fn pivot(&self) -> Vec2 {
        *self.anchors.last().unwrap()
    }
    pub fn fixed_length(&self) -> f32 {
        self.anchors
            .windows(2)
            .map(|w| w[0].distance(w[1]))
            .sum::<f32>()
    }
    pub fn free_length(&self) -> f32 {
        (self.length - self.fixed_length()).max(ROPE_MIN * 0.5)
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum DeathCause {
    Explosion,
    Impact,
    Drown,
}

#[derive(Clone, Debug)]
pub struct Frog {
    pub id: u8,
    pub team: u8,
    pub pos: Vec2,
    pub vel: Vec2,
    pub hp: f32,
    pub alive: bool,
    pub aim: Vec2,
    pub facing: f32,
    pub grounded: bool,
    pub ground_normal: Vec2,
    pub rope: Option<Rope>,
    /// Collected a crate this round → may fire once.
    pub armed: bool,
    /// Weapon charge while the fire button is held, 0..1.
    pub charge: Option<f32>,
    pub input: Input,
    pub prev_input: Input,
    pub hurt_t: f32,
    /// Time left to double-tap jump into a backflip, plus the hop impulse
    /// the backflip replaces.
    pub jump_t: f32,
    pub jump_impulse: Vec2,
    pub contact_dmg_cd: f32,
    pub bounce_sound_cd: f32,
    pub last_hit_by: Option<(u8, u64)>,
}

impl Frog {
    fn new(id: u8, team: u8, pos: Vec2) -> Frog {
        Frog {
            id,
            team,
            pos,
            vel: Vec2::ZERO,
            hp: 100.0,
            alive: true,
            aim: v2(1.0, 0.0),
            facing: 1.0,
            grounded: false,
            ground_normal: v2(0.0, -1.0),
            rope: None,
            armed: false,
            charge: None,
            input: Input::default(),
            prev_input: Input::default(),
            hurt_t: 0.0,
            jump_t: 0.0,
            jump_impulse: Vec2::ZERO,
            contact_dmg_cd: 0.0,
            bounce_sound_cd: 0.0,
            last_hit_by: None,
        }
    }

    fn pressed(&self, bit: u8) -> bool {
        self.input.held(bit) && !self.prev_input.held(bit)
    }
}

#[derive(Clone, Debug)]
pub struct CrateBox {
    pub id: u16,
    pub pos: Vec2,
    pub vel: Vec2,
    pub weapon: Weapon,
}

#[derive(Clone, Debug)]
pub struct Projectile {
    pub id: u16,
    pub kind: Weapon,
    pub owner: u8,
    pub owner_team: u8,
    pub pos: Vec2,
    pub vel: Vec2,
    pub age: f32,
    /// Mine: time until it goes off once triggered; Grenade: fuse from birth.
    pub fuse: f32,
    pub triggered: bool,
}

/// Game mode, chosen in the lobby.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum Mode {
    /// Two teams (green vs pink) with a shared weapon stash.
    Teams,
    /// Every player is their own team: own color, own stash.
    Ffa,
}

#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
pub enum Phase {
    /// Pre-game: pick a mode, ready up. No controls, no rounds.
    Lobby,
    Pre,
    Round,
    Break,
    Ended { winner: u8 },
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub enum Event {
    RoundStart { round: u32 },
    RoundEnd,
    MatchEnd { winner: u8 },
    MatchReset,
    CrateSpawn { id: u16, pos: Vec2 },
    CratePickup { frog: u8, weapon: Weapon },
    Fire { frog: u8, weapon: Weapon },
    TongueAttach { pos: Vec2 },
    TongueMiss,
    Jump { frog: u8 },
    Bounce { pos: Vec2, impulse: f32 },
    Explosion { pos: Vec2, radius: f32 },
    MineArmed { id: u16 },
    MineTriggered { id: u16 },
    Damage { frog: u8, amount: f32 },
    Death { frog: u8, cause: DeathCause },
    Splash { pos: Vec2 },
    Score { team: u8, kills: u8 },
}

pub struct Sim {
    pub terrain: Terrain,
    pub rng: Pcg32,
    pub tick: u64,
    pub phase: Phase,
    pub phase_t: f32,
    pub round: u32,
    pub mode: Mode,
    /// Indexed by team. Teams mode has exactly 2; FFA one per player.
    pub scores: Vec<u8>,
    /// Per-team shared weapon stock, persists across rounds.
    pub inventory: Vec<[u8; NUM_WEAPONS]>,
    pub frogs: Vec<Frog>,
    pub crates: Vec<CrateBox>,
    pub projectiles: Vec<Projectile>,
    pub events: Vec<Event>,
    spawns: Vec<Vec2>,
    next_crate_id: u16,
    next_proj_id: u16,
    crate_timer: f32,
    next_frog_id: u8,
}

impl Sim {
    pub fn new(seed: u64) -> Sim {
        let terrain = Terrain::generate(seed);
        let spawns = terrain.spawn_points();
        Sim {
            terrain,
            rng: Pcg32::new(seed ^ 0xC0FFEE),
            tick: 0,
            phase: Phase::Lobby,
            phase_t: 0.0,
            round: 1,
            mode: Mode::Teams,
            scores: vec![0; 2],
            inventory: vec![[0; NUM_WEAPONS]; 2],
            frogs: Vec::new(),
            crates: Vec::new(),
            projectiles: Vec::new(),
            events: Vec::new(),
            spawns,
            next_crate_id: 0,
            next_proj_id: 0,
            crate_timer: 0.0,
            next_frog_id: 0,
        }
    }

    pub fn add_player(&mut self) -> u8 {
        let id = self.next_frog_id;
        self.next_frog_id = self.next_frog_id.wrapping_add(1);
        let team = match self.mode {
            Mode::Teams => {
                let t0 = self.frogs.iter().filter(|f| f.team == 0).count();
                let t1 = self.frogs.len() - t0;
                if t0 <= t1 {
                    0
                } else {
                    1
                }
            }
            Mode::Ffa => {
                // Smallest team index not in use; zero the slot in case a
                // departed player left a stale score/stash behind.
                let team = (0..=u8::MAX)
                    .find(|t| self.frogs.iter().all(|f| f.team != *t))
                    .unwrap_or(0);
                if let Some(s) = self.scores.get_mut(team as usize) {
                    *s = 0;
                    self.inventory[team as usize] = [0; NUM_WEAPONS];
                }
                team
            }
        };
        self.ensure_team(team);
        let pos = self.pick_spawn();
        self.frogs.push(Frog::new(id, team, pos));
        id
    }

    fn ensure_team(&mut self, team: u8) {
        let n = team as usize + 1;
        if self.scores.len() < n {
            self.scores.resize(n, 0);
            self.inventory.resize(n, [0; NUM_WEAPONS]);
        }
    }

    pub fn remove_player(&mut self, id: u8) {
        self.frogs.retain(|f| f.id != id);
    }

    /// Lobby only: switch mode and reassign every frog's team to match.
    pub fn set_mode(&mut self, mode: Mode) {
        if self.phase != Phase::Lobby || mode == self.mode {
            return;
        }
        self.mode = mode;
        for (i, f) in self.frogs.iter_mut().enumerate() {
            f.team = match mode {
                Mode::Teams => (i % 2) as u8,
                Mode::Ffa => i as u8,
            };
        }
        let teams = match mode {
            Mode::Teams => 2,
            Mode::Ffa => self.frogs.len().max(1),
        };
        self.scores = vec![0; teams];
        self.inventory = vec![[0; NUM_WEAPONS]; teams];
    }

    /// Lobby only: everyone readied up — fresh match in the chosen mode.
    pub fn start_match(&mut self) {
        if self.phase != Phase::Lobby {
            return;
        }
        self.reset_match(Phase::Pre);
    }

    pub fn set_input(&mut self, id: u8, input: Input) {
        if let Some(f) = self.frogs.iter_mut().find(|f| f.id == id) {
            f.input = input;
            f.input.aim = if input.aim.length_sq() > 1e-6 {
                input.aim.normalized()
            } else {
                f.aim
            };
        }
    }

    pub fn frog(&self, id: u8) -> Option<&Frog> {
        self.frogs.iter().find(|f| f.id == id)
    }

    fn pick_spawn(&mut self) -> Vec2 {
        let i = self.rng.below(self.spawns.len() as u32) as usize;
        self.spawns[i]
    }

    /// Test hook: jump straight into an active round.
    pub fn start_round(&mut self) {
        self.phase = Phase::Round;
        self.phase_t = 0.0;
        for i in 0..self.frogs.len() {
            if !self.frogs[i].alive {
                let pos = self.pick_spawn();
                let f = &mut self.frogs[i];
                f.alive = true;
                f.hp = 100.0;
                f.pos = pos;
                f.vel = Vec2::ZERO;
                f.rope = None;
                f.hurt_t = 0.0;
                f.last_hit_by = None;
            }
            let f = &mut self.frogs[i];
            f.armed = false;
            f.charge = None;
        }
        self.events.push(Event::RoundStart { round: self.round });
    }

    pub fn step(&mut self) {
        self.tick += 1;
        self.advance_phase();
        if self.phase == Phase::Round {
            self.spawn_crates();
        }
        let controls = !matches!(self.phase, Phase::Lobby | Phase::Pre | Phase::Ended { .. });
        let mut explosions: Vec<(Vec2, Weapon, u8, u8)> = Vec::new();

        for i in 0..self.frogs.len() {
            self.step_frog(i, controls, &mut explosions);
        }
        self.frog_collisions();
        self.step_crates();
        self.step_projectiles(&mut explosions);
        for (pos, kind, owner, owner_team) in explosions {
            self.explode(pos, kind, owner, owner_team);
        }
        self.water_and_deaths();
        for f in &mut self.frogs {
            f.prev_input = f.input;
        }
    }

    fn advance_phase(&mut self) {
        self.phase_t += DT;
        match self.phase {
            Phase::Lobby => {} // waits for start_match()
            Phase::Pre => {
                if self.phase_t >= PRE_TIME {
                    self.start_round();
                }
            }
            Phase::Round => {
                if self.phase_t >= ROUND_TIME {
                    self.phase = Phase::Break;
                    self.phase_t = 0.0;
                    for f in &mut self.frogs {
                        f.charge = None;
                    }
                    self.events.push(Event::RoundEnd);
                }
            }
            Phase::Break => {
                if self.phase_t >= BREAK_TIME {
                    self.round += 1;
                    self.phase = Phase::Pre;
                    self.phase_t = 0.0;
                }
            }
            Phase::Ended { .. } => {
                if self.phase_t >= ENDED_TIME {
                    // Back to the lobby: pick a mode, ready up again.
                    self.reset_match(Phase::Lobby);
                }
            }
        }
    }

    fn reset_match(&mut self, phase: Phase) {
        self.scores.iter_mut().for_each(|s| *s = 0);
        self.inventory.iter_mut().for_each(|i| *i = [0; NUM_WEAPONS]);
        self.round = 1;
        self.crates.clear();
        self.projectiles.clear();
        self.phase = phase;
        self.phase_t = 0.0;
        for i in 0..self.frogs.len() {
            let pos = self.pick_spawn();
            let f = &mut self.frogs[i];
            f.alive = true;
            f.hp = 100.0;
            f.pos = pos;
            f.vel = Vec2::ZERO;
            f.rope = None;
            f.armed = false;
            f.charge = None;
            f.hurt_t = 0.0;
            f.last_hit_by = None;
        }
        self.events.push(Event::MatchReset);
    }

    fn spawn_crates(&mut self) {
        let alive = self.frogs.iter().filter(|f| f.alive).count();
        if alive == 0 {
            return;
        }
        let target = (alive).clamp(1, 4);
        self.crate_timer -= DT;
        if self.crates.len() < target && self.crate_timer <= 0.0 {
            self.crate_timer = 3.0;
            // Find a clear air spot with room to fall.
            for _ in 0..40 {
                let x = self.rng.range(60.0, WIDTH - 60.0);
                let y = self.rng.range(60.0, WATER_Y - 220.0);
                let p = v2(x, y);
                if self.terrain.sample(p) > CRATE_R + 14.0 {
                    let id = self.next_crate_id;
                    self.next_crate_id = self.next_crate_id.wrapping_add(1);
                    let weapon = Weapon::from_index(self.rng.below(NUM_WEAPONS as u32) as u8);
                    self.crates.push(CrateBox {
                        id,
                        pos: p,
                        vel: Vec2::ZERO,
                        weapon,
                    });
                    self.events.push(Event::CrateSpawn { id, pos: p });
                    break;
                }
            }
        }
    }

    fn step_frog(&mut self, i: usize, controls: bool, explosions: &mut Vec<(Vec2, Weapon, u8, u8)>) {
        let phase = self.phase;
        // Work on a clone to keep borrows simple; frogs are small.
        let mut f = self.frogs[i].clone();
        if !f.alive {
            self.frogs[i] = f;
            return;
        }
        f.hurt_t = (f.hurt_t - DT).max(0.0);
        f.jump_t = (f.jump_t - DT).max(0.0);
        f.contact_dmg_cd = (f.contact_dmg_cd - DT).max(0.0);
        f.bounce_sound_cd = (f.bounce_sound_cd - DT).max(0.0);
        f.aim = if f.input.aim.length_sq() > 1e-6 {
            f.input.aim.normalized()
        } else {
            f.aim
        };
        if f.aim.x.abs() > 0.15 {
            f.facing = f.aim.x.signum();
        }
        let can_act = controls && f.hurt_t <= 0.0;
        let dir_x = if !can_act {
            0.0
        } else {
            (f.input.held(BTN_RIGHT) as i8 - f.input.held(BTN_LEFT) as i8) as f32
        };

        // --- tongue ---
        if can_act && f.pressed(BTN_TONGUE) && f.rope.is_none() {
            let from = f.pos + f.aim * (FROG_R + 1.0);
            match self.terrain.raycast(from, f.aim, ROPE_RANGE) {
                Some(hit) => {
                    let length = f.pos.distance(hit);
                    f.rope = Some(Rope {
                        anchors: vec![hit],
                        winds: Vec::new(),
                        length,
                    });
                    self.events.push(Event::TongueAttach { pos: hit });
                }
                None => self.events.push(Event::TongueMiss),
            }
        }
        // Hold-to-stay-attached: release the button, drop the rope.
        if f.rope.is_some() && (!f.input.held(BTN_TONGUE) || !can_act) {
            release_rope(&mut f, 1.0, 0.0);
        }
        // Rope jump: extra zip when jumping off the rope.
        if can_act && f.rope.is_some() && f.pressed(BTN_JUMP) {
            release_rope(&mut f, 1.15, -130.0);
            self.events.push(Event::Jump { frog: f.id });
        }

        // --- grounded state ---
        let d_ground = self.terrain.sample(f.pos) - FROG_R;
        let n = self.terrain.normal(f.pos);
        f.grounded = d_ground < 2.5 && n.y < -0.35;
        if f.grounded {
            f.ground_normal = n;
        }

        // Double tap within the window (still airborne from the hop)
        // converts it into a backflip: mostly straight up, slightly back.
        if can_act && f.rope.is_none() && !f.grounded && f.jump_t > 0.0 && f.pressed(BTN_JUMP) {
            f.vel -= f.jump_impulse;
            f.vel += f.ground_normal * BACKFLIP_UP + v2(-f.facing * BACKFLIP_BACK, 0.0);
            f.jump_t = 0.0;
            self.events.push(Event::Jump { frog: f.id });
        }

        if let Some(rope) = &mut f.rope {
            // --- attached: reel, folds, swing ---
            if can_act {
                if f.input.held(BTN_UP) {
                    rope.length -= REEL_SPEED * DT;
                }
                if f.input.held(BTN_DOWN) {
                    rope.length += REEL_SPEED * DT;
                }
                rope.length = rope.length.clamp(ROPE_MIN, ROPE_RANGE);
            }
            // Wrap around terrain: the segment to the pivot must stay clear.
            // Sample along the frog's last step too, so thin islands can't
            // slip between the segment's positions at high swing speed.
            let pivot = rope.pivot();
            let old = f.pos - f.vel * DT;
            let mut fold_hit = None;
            for k in [0.0f32, 0.5, 1.0] {
                let p = old.lerp(f.pos, k);
                let to = pivot - p;
                let dist = to.length();
                if dist > 6.0 {
                    if let Some(hit) = self.terrain.raycast(p, to, dist - 3.0) {
                        fold_hit = Some(hit);
                        break;
                    }
                }
            }
            if let Some(hit) = fold_hit {
                let fold = hit + self.terrain.normal(hit) * 2.5;
                if fold.distance(pivot) > 8.0 {
                    let wind = (fold - pivot).cross(f.pos - fold);
                    rope.anchors.push(fold);
                    rope.winds.push(wind.signum());
                }
            }
            // Unwrap only when the rope straightens back past a fold: the
            // frog crosses to the other side of the line it was on when the
            // fold formed. (Line-of-sight popping let the rope snap through
            // small islands as soon as the anchor was visible around the
            // far side.)
            while rope.anchors.len() > 1 {
                let n = rope.anchors.len();
                let prev = rope.anchors[n - 2];
                let pivot = rope.anchors[n - 1];
                let side = (pivot - prev).cross(f.pos - pivot);
                if side * rope.winds[n - 2] <= 0.0 {
                    rope.anchors.pop();
                    rope.winds.pop();
                } else {
                    break;
                }
            }
            // Swing: horizontal input projected on the swing tangent, so it
            // naturally reverses when upside down.
            let pivot = rope.pivot();
            let radial = (f.pos - pivot).normalized();
            let tangent = radial.perp();
            if dir_x != 0.0 {
                let mut a_t = v2(dir_x, 0.0).dot(tangent) * SWING_ACC;
                let vt = f.vel.dot(tangent);
                if a_t * vt >= 0.0 && vt.abs() < PUMP_MAX_VT {
                    a_t *= PUMP_BONUS;
                }
                f.vel += tangent * (a_t * DT);
            }
        } else if f.grounded {
            // --- walking ---
            let mut tangent = f.ground_normal.perp();
            if tangent.x < 0.0 {
                tangent = -tangent;
            }
            let vt = f.vel.dot(tangent);
            let target = dir_x * WALK_SPEED;
            let dv = (target - vt).clamp(-WALK_ACC * DT, WALK_ACC * DT);
            f.vel += tangent * dv;
            if can_act && f.pressed(BTN_JUMP) {
                // Shallow hop forward in the facing direction.
                let imp = f.ground_normal * JUMP_UP + v2(f.facing * JUMP_FWD, 0.0);
                f.vel += imp;
                f.grounded = false;
                f.jump_t = BACKFLIP_WINDOW;
                f.jump_impulse = imp;
                self.events.push(Event::Jump { frog: f.id });
            }
        } else {
            // --- air control ---
            f.vel.x += dir_x * AIR_ACC * DT;
        }

        // --- integrate ---
        f.vel.y += GRAVITY * DT;
        f.vel = f.vel.clamp_length(MAX_SPEED);

        // Rope radial constraint before the sweep.
        if let Some(rope) = &f.rope {
            let pivot = rope.pivot();
            let free = rope.free_length();
            let off = f.pos - pivot;
            let d = off.length();
            if d > free {
                let radial = off * (1.0 / d);
                f.pos = pivot + radial * free;
                let vr = f.vel.dot(radial);
                if vr > 0.0 {
                    f.vel -= radial * vr;
                }
            }
        }

        let restitution = if f.rope.is_some() { 0.72 } else { 0.28 };
        let (impact, contact_pos) = body_move(&self.terrain, &mut f.pos, &mut f.vel, FROG_R, restitution);
        if impact > BOUNCE_THRESHOLD && f.bounce_sound_cd <= 0.0 {
            f.bounce_sound_cd = 0.12;
            self.events.push(Event::Bounce {
                pos: contact_pos,
                impulse: impact,
            });
        }
        if impact > CONTACT_DMG_SPEED && f.contact_dmg_cd <= 0.0 {
            f.contact_dmg_cd = 0.5;
            let dmg = (impact - CONTACT_DMG_SPEED) * 0.045;
            f.hp -= dmg;
            f.hurt_t = f.hurt_t.max(0.35);
            self.events.push(Event::Damage {
                frog: f.id,
                amount: dmg,
            });
        }

        // --- crate pickup ---
        if phase == Phase::Round {
            let fpos = f.pos;
            let mut picked = None;
            self.crates.retain(|c| {
                if picked.is_none() && c.pos.distance(fpos) < FROG_R + CRATE_R + 3.0 {
                    picked = Some(c.weapon);
                    false
                } else {
                    true
                }
            });
            if let Some(w) = picked {
                let inv = &mut self.inventory[f.team as usize][w as usize];
                *inv = inv.saturating_add(1).min(9);
                f.armed = true;
                self.events.push(Event::CratePickup {
                    frog: f.id,
                    weapon: w,
                });
            }
        }

        // --- weapon charge / fire ---
        let sel = Weapon::from_index(f.input.sel.min(NUM_WEAPONS as u8 - 1));
        let can_fire = can_act
            && phase == Phase::Round
            && f.armed
            && self.inventory[f.team as usize][sel as usize] > 0;
        if f.pressed(BTN_FIRE) && can_fire && f.charge.is_none() {
            f.charge = Some(0.0);
        }
        if let Some(c) = &mut f.charge {
            *c = (*c + DT / CHARGE_TIME).min(1.0);
            let released = !f.input.held(BTN_FIRE);
            let still_ok = can_act && phase == Phase::Round && f.armed;
            if released || !still_ok {
                if released && still_ok && self.inventory[f.team as usize][sel as usize] > 0 {
                    let charge = *c;
                    self.inventory[f.team as usize][sel as usize] -= 1;
                    f.armed = false;
                    let id = self.next_proj_id;
                    self.next_proj_id = self.next_proj_id.wrapping_add(1);
                    let speed = match sel {
                        Weapon::Bazooka => 380.0 + 950.0 * charge,
                        Weapon::Grenade => 260.0 + 760.0 * charge,
                        Weapon::Mine => 160.0 + 360.0 * charge,
                    };
                    self.projectiles.push(Projectile {
                        id,
                        kind: sel,
                        owner: f.id,
                        owner_team: f.team,
                        pos: f.pos + f.aim * (FROG_R + 14.0),
                        vel: f.aim * speed + f.vel * 0.25,
                        age: 0.0,
                        fuse: match sel {
                            Weapon::Grenade => 3.0,
                            _ => 0.0,
                        },
                        triggered: false,
                    });
                    self.events.push(Event::Fire {
                        frog: f.id,
                        weapon: sel,
                    });
                }
                f.charge = None;
            }
        }
        let _ = explosions; // (explosions are produced by projectiles)
        self.frogs[i] = f;
    }

    fn frog_collisions(&mut self) {
        let n = self.frogs.len();
        for a in 0..n {
            for b in (a + 1)..n {
                if !self.frogs[a].alive || !self.frogs[b].alive {
                    continue;
                }
                let delta = self.frogs[b].pos - self.frogs[a].pos;
                let d = delta.length();
                let min_d = FROG_R * 2.0;
                if d < min_d && d > 1e-4 {
                    let nrm = delta * (1.0 / d);
                    let push = (min_d - d) * 0.5;
                    self.frogs[a].pos -= nrm * push;
                    self.frogs[b].pos += nrm * push;
                    let rel = self.frogs[b].vel - self.frogs[a].vel;
                    let vn = rel.dot(nrm);
                    if vn < 0.0 {
                        let imp = nrm * (vn * 0.6);
                        self.frogs[a].vel += imp;
                        self.frogs[b].vel -= imp;
                    }
                }
            }
        }
    }

    fn step_crates(&mut self) {
        let terrain = &self.terrain;
        let mut splashes = Vec::new();
        for c in &mut self.crates {
            c.vel.y += GRAVITY * DT;
            c.vel = c.vel.clamp_length(MAX_SPEED);
            body_move(terrain, &mut c.pos, &mut c.vel, CRATE_R, 0.3);
            if c.pos.y > WATER_Y {
                splashes.push(c.pos);
            }
        }
        self.crates.retain(|c| c.pos.y <= WATER_Y);
        for pos in splashes {
            self.events.push(Event::Splash { pos });
        }
    }

    fn step_projectiles(&mut self, explosions: &mut Vec<(Vec2, Weapon, u8, u8)>) {
        let mut i = 0;
        while i < self.projectiles.len() {
            let mut p = self.projectiles[i].clone();
            p.age += DT;
            let mut boom = false;
            match p.kind {
                Weapon::Bazooka => {
                    p.vel.y += GRAVITY * 0.35 * DT;
                    let (np, hit) = self.terrain.march_circle(p.pos, p.vel * DT, 4.0);
                    p.pos = np;
                    if hit.is_some() || p.age > 8.0 {
                        boom = true;
                    }
                    // Direct hit on a frog.
                    for f in &self.frogs {
                        if !f.alive {
                            continue;
                        }
                        if f.id == p.owner && p.age < OWNER_GRACE {
                            continue;
                        }
                        if f.pos.distance(p.pos) < FROG_R + 6.0 {
                            boom = true;
                        }
                    }
                }
                Weapon::Grenade => {
                    p.vel.y += GRAVITY * DT;
                    body_move(&self.terrain, &mut p.pos, &mut p.vel, 5.0, 0.55);
                    if p.age >= p.fuse {
                        boom = true;
                    }
                }
                Weapon::Mine => {
                    p.vel.y += GRAVITY * DT;
                    body_move(&self.terrain, &mut p.pos, &mut p.vel, 6.0, 0.2);
                    if !p.triggered && p.age > 1.2 {
                        if (p.age - DT) <= 1.2 {
                            self.events.push(Event::MineArmed { id: p.id });
                        }
                        for f in &self.frogs {
                            if !f.alive {
                                continue;
                            }
                            if f.id == p.owner && p.age < 2.0 {
                                continue;
                            }
                            if f.pos.distance(p.pos) < 46.0 {
                                p.triggered = true;
                                p.fuse = p.age + 0.6;
                                self.events.push(Event::MineTriggered { id: p.id });
                                break;
                            }
                        }
                    }
                    if p.triggered && p.age >= p.fuse {
                        boom = true;
                    }
                    if p.age > 60.0 {
                        boom = true;
                    }
                }
            }
            if p.pos.y > WATER_Y {
                self.events.push(Event::Splash { pos: p.pos });
                self.projectiles.remove(i);
                continue;
            }
            if boom {
                explosions.push((p.pos, p.kind, p.owner, p.owner_team));
                self.projectiles.remove(i);
                continue;
            }
            self.projectiles[i] = p;
            i += 1;
        }
    }

    fn explode(&mut self, pos: Vec2, kind: Weapon, owner: u8, _owner_team: u8) {
        let radius = kind.explosion_radius();
        let max_dmg = kind.max_damage();
        self.terrain.carve(pos, radius);
        self.events.push(Event::Explosion { pos, radius });
        let reach = radius * 1.6;
        for i in 0..self.frogs.len() {
            let (fpos, alive, fid) = {
                let f = &self.frogs[i];
                (f.pos, f.alive, f.id)
            };
            if !alive {
                continue;
            }
            let d = fpos.distance(pos);
            if d > reach {
                continue;
            }
            let falloff = (1.0 - d / reach).clamp(0.0, 1.0);
            let dir = if d > 1e-4 {
                (fpos - pos) * (1.0 / d)
            } else {
                v2(0.0, -1.0)
            };
            let f = &mut self.frogs[i];
            f.vel += dir * (560.0 * falloff + 160.0) + v2(0.0, -170.0 * falloff);
            f.hurt_t = f.hurt_t.max(0.7);
            f.rope = None;
            f.charge = None;
            let dmg = max_dmg * falloff;
            if dmg > 0.5 {
                f.hp -= dmg;
                if fid != owner {
                    f.last_hit_by = Some((owner, self.tick));
                }
                self.events.push(Event::Damage {
                    frog: fid,
                    amount: dmg,
                });
            }
        }
        // Shove crates and other projectiles around.
        for c in &mut self.crates {
            let d = c.pos.distance(pos);
            if d < reach && d > 1e-4 {
                let falloff = 1.0 - d / reach;
                c.vel += (c.pos - pos) * (1.0 / d) * (500.0 * falloff + 120.0);
            }
        }
        for p in &mut self.projectiles {
            let d = p.pos.distance(pos);
            if d < reach && d > 1e-4 {
                let falloff = 1.0 - d / reach;
                p.vel += (p.pos - pos) * (1.0 / d) * (500.0 * falloff + 120.0);
            }
        }
    }

    fn water_and_deaths(&mut self) {
        for i in 0..self.frogs.len() {
            let f = &self.frogs[i];
            if !f.alive {
                continue;
            }
            let (dead, cause) = if f.pos.y > WATER_Y {
                (true, DeathCause::Drown)
            } else if f.hp <= 0.0 {
                (true, DeathCause::Explosion)
            } else {
                (false, DeathCause::Explosion)
            };
            if !dead {
                continue;
            }
            let id = self.frogs[i].id;
            let team = self.frogs[i].team;
            let last_hit = self.frogs[i].last_hit_by;
            {
                let f = &mut self.frogs[i];
                f.alive = false;
                f.rope = None;
                f.charge = None;
                f.vel = Vec2::ZERO;
            }
            if cause == DeathCause::Drown {
                self.events.push(Event::Splash {
                    pos: self.frogs[i].pos,
                });
            }
            self.events.push(Event::Death { frog: id, cause });
            // Kill attribution: enemy damage within the last 5 seconds scores.
            if let Some((killer, t)) = last_hit {
                if self.tick.saturating_sub(t) < (5.0 / DT) as u64 {
                    if let Some(k) = self.frogs.iter().find(|f| f.id == killer) {
                        if k.team != team {
                            let kt = k.team as usize;
                            self.scores[kt] = self.scores[kt].saturating_add(1);
                            self.events.push(Event::Score {
                                team: k.team,
                                kills: self.scores[kt],
                            });
                            if self.scores[kt] >= KILLS_TO_WIN
                                && !matches!(self.phase, Phase::Ended { .. })
                            {
                                self.phase = Phase::Ended { winner: k.team };
                                self.phase_t = 0.0;
                                self.events.push(Event::MatchEnd { winner: k.team });
                            }
                        }
                    }
                }
            }
        }
    }

    /// Test/dev hook: detonate a weapon at a position as if `owner` fired it.
    pub fn debug_explode(&mut self, pos: Vec2, kind: Weapon, owner: u8) {
        let team = self.frog(owner).map(|f| f.team).unwrap_or(0);
        self.explode(pos, kind, owner, team);
    }

    /// Test/dev hook: drop a crate at a position (random weapon).
    pub fn debug_drop_crate(&mut self, pos: Vec2) -> u16 {
        let id = self.next_crate_id;
        self.next_crate_id = self.next_crate_id.wrapping_add(1);
        let weapon = Weapon::from_index(self.rng.below(NUM_WEAPONS as u32) as u8);
        self.crates.push(CrateBox {
            id,
            pos,
            vel: Vec2::ZERO,
            weapon,
        });
        self.events.push(Event::CrateSpawn { id, pos });
        id
    }

    /// FNV-1a over the canonical state, for determinism tests.
    pub fn hash(&self) -> u64 {
        let mut h: u64 = 0xcbf29ce484222325;
        let mut put = |v: u64| {
            for b in v.to_le_bytes() {
                h ^= b as u64;
                h = h.wrapping_mul(0x100000001b3);
            }
        };
        put(self.tick);
        for s in &self.scores {
            put(*s as u64);
        }
        for f in &self.frogs {
            put(f.id as u64);
            put(f.pos.x.to_bits() as u64);
            put(f.pos.y.to_bits() as u64);
            put(f.vel.x.to_bits() as u64);
            put(f.vel.y.to_bits() as u64);
            put(f.hp.to_bits() as u64);
            put(f.alive as u64);
        }
        for c in &self.crates {
            put(c.id as u64);
            put(c.pos.x.to_bits() as u64);
            put(c.pos.y.to_bits() as u64);
        }
        for p in &self.projectiles {
            put(p.id as u64);
            put(p.pos.x.to_bits() as u64);
            put(p.pos.y.to_bits() as u64);
        }
        h
    }
}

/// Release the rope, projecting velocity onto the useful swing arc:
/// keep the tangential component, drop inward radial velocity.
fn release_rope(f: &mut Frog, tangent_boost: f32, up_kick: f32) {
    if let Some(rope) = f.rope.take() {
        let pivot = rope.pivot();
        let radial = (f.pos - pivot).normalized();
        let tangent = radial.perp();
        let vt = f.vel.dot(tangent);
        let vr = f.vel.dot(radial).max(0.0);
        f.vel = tangent * (vt * tangent_boost) + radial * vr + v2(0.0, up_kick);
    }
}

/// Move a circular body with swept collision; on contact, reflect or slide.
/// Returns (impact_speed, contact_pos) — impact_speed is 0 when no real hit.
pub fn body_move(
    terrain: &Terrain,
    pos: &mut Vec2,
    vel: &mut Vec2,
    r: f32,
    restitution: f32,
) -> (f32, Vec2) {
    let (np, _) = terrain.march_circle(*pos, *vel * DT, r);
    *pos = np;
    // Clamp inside the world horizontally.
    if pos.x < r {
        pos.x = r;
        if vel.x < 0.0 {
            vel.x = 0.0;
        }
    }
    if pos.x > WIDTH - r {
        pos.x = WIDTH - r;
        if vel.x > 0.0 {
            vel.x = 0.0;
        }
    }
    let d = terrain.sample(*pos) - r;
    if d < 0.6 {
        let n = terrain.normal(*pos);
        // Depenetrate.
        if d < 0.0 {
            *pos += n * (-d).min(3.0);
        }
        let vn = vel.dot(n);
        if vn < 0.0 {
            let impact = -vn;
            let tangent = n.perp();
            let vt = vel.dot(tangent);
            if impact > BOUNCE_THRESHOLD && restitution > 0.01 {
                *vel = tangent * (vt * 0.985) + n * (impact * restitution);
                return (impact, *pos);
            } else {
                *vel = tangent * (vt * 0.995);
                return (0.0, *pos);
            }
        }
    }
    (0.0, *pos)
}
