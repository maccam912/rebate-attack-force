//! Measure sim step cost and snapshot wire size for capacity planning.
//! Run: cargo run --release -p server --example netbench

use protocol::{CrateSnap, FrogSnap, ProjSnap, ServerMsg, Snapshot};
use sim::game::{Input, Sim, BTN_FIRE, BTN_JUMP, BTN_LEFT, BTN_RIGHT, BTN_TONGUE};
use sim::v2;
use std::time::Instant;

fn build_snapshot(game: &Sim) -> Snapshot {
    Snapshot {
        tick: game.tick,
        phase: game.phase,
        phase_t: game.phase_t,
        round: game.round,
        mode: game.mode,
        scores: game.scores.clone(),
        inventory: game.inventory.clone(),
        frogs: game
            .frogs
            .iter()
            .map(|f| FrogSnap {
                id: f.id,
                pos: f.pos,
                vel: f.vel,
                hp: f.hp,
                alive: f.alive,
                aim: f.aim,
                facing: f.facing,
                grounded: f.grounded,
                charge: f.charge,
                rope: f.rope.as_ref().map(|r| r.anchors.clone()),
            })
            .collect(),
        crates: game
            .crates
            .iter()
            .map(|c| CrateSnap { id: c.id, pos: c.pos })
            .collect(),
        projectiles: game
            .projectiles
            .iter()
            .map(|p| ProjSnap {
                id: p.id,
                kind: p.kind,
                pos: p.pos,
                vel: p.vel,
                triggered: p.triggered,
            })
            .collect(),
        events: Vec::new(),
    }
}

fn main() {
    for players in [2usize, 8] {
        let mut game = Sim::new(42);
        let ids: Vec<u8> = (0..players).map(|_| game.add_player()).collect();
        game.start_match();

        let ticks = 60_000u64; // 500 sim-seconds
        let mut snap_bytes = 0usize;
        let mut snap_max = 0usize;
        let mut snaps = 0usize;
        let start = Instant::now();
        for t in 0..ticks {
            // Busy inputs: everyone swings tongues, fires, hops around.
            for (k, &id) in ids.iter().enumerate() {
                let phase = (t as f32) / 120.0 + k as f32;
                let mut buttons = BTN_TONGUE;
                buttons |= if phase.sin() > 0.0 { BTN_RIGHT } else { BTN_LEFT };
                if (t + k as u64 * 13).is_multiple_of(90) {
                    buttons |= BTN_JUMP;
                }
                if (t + k as u64 * 29).is_multiple_of(150) {
                    buttons |= BTN_FIRE;
                }
                let aim = v2(phase.cos(), -phase.sin().abs()).normalized();
                game.set_input(id, Input { buttons, aim, sel: (k % 3) as u8 });
            }
            game.step();
            game.events.clear();
            if t % 4 == 0 {
                let bytes = protocol::encode(&ServerMsg::Snapshot(build_snapshot(&game)));
                snap_bytes += bytes.len();
                snap_max = snap_max.max(bytes.len());
                snaps += 1;
            }
        }
        let dt = start.elapsed();
        let per_step = dt.as_secs_f64() / ticks as f64 * 1e6;
        println!(
            "{players} players: {per_step:.1} us/step ({:.0}x realtime at 120 Hz) | snapshot avg {} B, max {} B -> {:.1} KB/s per client at 30 Hz",
            (1.0 / 120.0) / (dt.as_secs_f64() / ticks as f64),
            snap_bytes / snaps,
            snap_max,
            (snap_bytes / snaps) as f64 * 30.0 / 1024.0,
        );
    }
}
