//! Procedural spider-style legs (client-only cosmetics).
//!
//! Each frog gets four legs. A foot raycasts to the terrain below its hip
//! and *plants* there in world space — the body slides around above it —
//! until the body drags the hip out of reach, at which point the foot takes
//! a quick lifted step to a fresh spot ahead of the motion. Airborne feet
//! ragdoll: verlet points under gravity tethered to the hip, so they trail
//! and flop while swinging or falling, and thrash for a moment after a
//! hard landing (FrogPose ragdoll timers).

use crate::net::{ClientTerrain, NetState};
use crate::sfx::Sfx;
use crate::view::{team_color, w2b, FrogPose};
use bevy::prelude::*;
use sim::game::FROG_R;
use sim::rng::Pcg32;
use sim::Terrain;
use std::collections::HashMap;

/// Legs draw in their own gizmo group, configured as fat as the tongue.
#[derive(Default, Reflect, GizmoConfigGroup)]
pub struct LegGizmos;

/// Hip x-offsets from the body center (sim units); two legs per side.
const HIP_X: [f32; 4] = [-10.0, -4.0, 4.0, 10.0];
const REACH: f32 = 30.0; // hip→foot distance that forces a step
const STEP_TRIGGER: f32 = 14.0; // planted-vs-desired drift that wants a step
const STEP_TIME: f32 = 0.085;
const LIFT: f32 = 6.5; // foot arc height mid-step
const UPPER: f32 = 13.0; // thigh segment length
const LOWER: f32 = 16.0; // shin segment length
const PROBE: f32 = FROG_R + 26.0; // how far below the hip we look for ground

struct Foot {
    pos: sim::Vec2,
    /// previous position for verlet integration while ragdolling
    prev: sim::Vec2,
    from: sim::Vec2,
    target: sim::Vec2,
    /// step progress; >= 1 means planted at `target`
    t: f32,
    grounded: bool,
}

/// Ragdoll integration: gravity + damping, tethered to the hip at full leg
/// length, kept out of the terrain. `twitch` adds random thrash kicks.
fn flop(foot: &mut Foot, hip: sim::Vec2, twitch: f32, rng: &mut Pcg32, terrain: &Terrain, dt: f32) {
    let dt = dt.min(1.0 / 30.0);
    let mut next = foot.pos + (foot.pos - foot.prev) * 0.985 + sim::v2(0.0, 1500.0 * dt * dt);
    if twitch > 0.0 {
        next += sim::v2(rng.range(-1.0, 1.0), rng.range(-1.0, 1.0)) * (twitch * dt);
    }
    foot.prev = foot.pos;
    foot.pos = next;
    let max_d = UPPER + LOWER - 1.0;
    let off = foot.pos - hip;
    let d = off.length();
    if d > max_d {
        foot.pos = hip + off * (max_d / d);
    }
    let sd = terrain.sample(foot.pos);
    if sd < 1.5 {
        foot.pos += terrain.normal(foot.pos) * (1.5 - sd).min(4.0);
    }
    foot.grounded = false;
    foot.t = 1.0;
    foot.target = foot.pos;
}

struct Rig {
    feet: Vec<Foot>,
}

#[derive(Resource)]
pub struct LegRigs {
    rigs: HashMap<u8, Rig>,
    rng: Pcg32,
}

impl Default for LegRigs {
    fn default() -> Self {
        LegRigs {
            rigs: HashMap::new(),
            rng: Pcg32::new(0x1265),
        }
    }
}

#[allow(clippy::too_many_arguments)]
pub fn update_legs(
    mut commands: Commands,
    time: Res<Time>,
    net: Res<NetState>,
    ct: Res<ClientTerrain>,
    pose: Res<FrogPose>,
    mut rigs: ResMut<LegRigs>,
    mut sfx: ResMut<Sfx>,
    mut gizmos: Gizmos<LegGizmos>,
) {
    let Some((prev, next, alpha)) = net.frame() else {
        return;
    };
    let Some(terrain) = ct.terrain.as_ref() else {
        return;
    };
    let dt = time.delta_secs();

    // listener position for footstep attenuation: my frog, else map center
    let listener = net
        .my_id
        .and_then(|id| next.frogs.iter().find(|f| f.id == id))
        .map(|f| f.pos)
        .unwrap_or(sim::v2(
            sim::terrain::WIDTH / 2.0,
            sim::terrain::HEIGHT / 2.0,
        ));

    let rigs = &mut *rigs;
    for fb in &next.frogs {
        if !fb.alive {
            rigs.rigs.remove(&fb.id);
            continue;
        }
        let fa = prev.frogs.iter().find(|f| f.id == fb.id).unwrap_or(fb);
        let body = if fa.pos.distance(fb.pos) > 250.0 {
            fb.pos
        } else {
            fa.pos.lerp(fb.pos, alpha)
        };
        let team = net
            .roster
            .iter()
            .find(|p| p.id == fb.id)
            .map(|p| p.team)
            .unwrap_or(0);

        let rig = rigs.rigs.entry(fb.id).or_insert_with(|| Rig {
            feet: HIP_X
                .iter()
                .map(|&ox| {
                    let p = body + sim::v2(ox, FROG_R);
                    Foot {
                        pos: p,
                        prev: p,
                        from: p,
                        target: p,
                        t: 1.0,
                        grounded: false,
                    }
                })
                .collect(),
        });

        // feet step slightly ahead of where the body is going
        let lead = (fb.vel.x * 0.085).clamp(-12.0, 12.0);

        // ragdoll after a hard landing overrides planting even on the ground
        let ragdolling = pose.ragdoll.contains_key(&fb.id);
        let limp = ragdolling || !fb.grounded;

        // which legs are mid-step this frame (gait: neighbors wait their turn)
        let stepping: Vec<bool> = rig.feet.iter().map(|f| f.t < 1.0).collect();

        for (i, foot) in rig.feet.iter_mut().enumerate() {
            let hip = body + sim::v2(HIP_X[i] * 0.55, FROG_R * 0.45);
            // probe for ground below the desired foothold
            let probe_from = body + sim::v2(HIP_X[i] + lead, -2.0);
            let hit = if limp {
                None
            } else {
                terrain.raycast(probe_from, sim::v2(0.0, 1.0), PROBE)
            };

            match hit {
                Some(ground) => {
                    let landing = !foot.grounded;
                    foot.grounded = true;
                    let forced = hip.distance(foot.pos) > REACH;
                    let drifted = foot.target.distance(ground) > STEP_TRIGGER;
                    let neighbor_busy = (i > 0 && stepping[i - 1])
                        || (i + 1 < stepping.len() && stepping[i + 1]);
                    if foot.t >= 1.0
                        && (landing || forced || (drifted && !neighbor_busy))
                    {
                        foot.from = foot.pos;
                        // tiny jitter so 4 feet never land in lockstep
                        let j = rigs.rng.range(-1.5, 1.5);
                        foot.target = ground + sim::v2(j, 0.0);
                        foot.t = 0.0;
                    }
                }
                None => {
                    // airborne (or stunned): legs go limp and flop around;
                    // a fresh ouch adds panicked thrashing on top.
                    let twitch = if ragdolling { 240.0 } else { 0.0 };
                    flop(foot, hip, twitch, &mut rigs.rng, terrain, dt);
                }
            }

            // advance an in-flight step with a lift arc (sim y is down)
            if foot.t < 1.0 {
                foot.t = (foot.t + dt / STEP_TIME).min(1.0);
                let s = foot.t * foot.t * (3.0 - 2.0 * foot.t); // smoothstep
                let arc = (std::f32::consts::PI * foot.t).sin() * LIFT;
                foot.pos = foot.from.lerp(foot.target, s) - sim::v2(0.0, arc);
                if foot.t >= 1.0 {
                    foot.pos = foot.target;
                    // stamp! quiet grass footstep, fading with distance
                    let d = listener.distance(foot.pos);
                    let vol = 0.22 * (1.0 - (d / 700.0).clamp(0.0, 1.0));
                    if vol > 0.02 {
                        sfx.play(&mut commands, "step", vol);
                    }
                }
            }
            if foot.grounded {
                // keep the verlet state in sync while planted so the leg
                // starts from rest when it next goes limp
                foot.prev = foot.pos;
            }

            // draw: two-bone IK, knee bent up and outward
            let hip_b = w2b(hip, 9.5).truncate();
            let foot_b = w2b(foot.pos, 9.5).truncate();
            let d = (foot_b - hip_b).length().clamp(0.001, UPPER + LOWER - 0.5);
            let dir = (foot_b - hip_b) / d;
            let a = (UPPER * UPPER - LOWER * LOWER + d * d) / (2.0 * d);
            let h = (UPPER * UPPER - a * a).max(0.0).sqrt();
            // pick the perpendicular that pushes the knee up & away from center
            let side = if HIP_X[i] < 0.0 { -1.0 } else { 1.0 };
            let mut perp = Vec2::new(-dir.y, dir.x);
            if perp.y * 0.4 + perp.x * side < 0.0 {
                perp = -perp;
            }
            let knee = hip_b + dir * a + perp * h;

            let c = team_color(team).mix(&Color::BLACK, 0.25);
            gizmos.line_2d(hip_b, knee, c);
            gizmos.line_2d(knee, foot_b, c);
            gizmos.circle_2d(foot_b, 2.0, c);
        }
    }

    // drop rigs for frogs that left the snapshot
    rigs.rigs
        .retain(|id, _| next.frogs.iter().any(|f| f.id == *id && f.alive));
}
