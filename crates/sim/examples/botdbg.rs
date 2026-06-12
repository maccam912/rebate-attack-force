//! Mirror of the ws_bot full-loop test, for debugging it against a seed.
use sim::game::*;
use sim::math::v2;

fn main() {
    let seed: u64 = std::env::args()
        .nth(1)
        .and_then(|s| s.parse().ok())
        .unwrap_or(4242);
    let mut s = Sim::new(seed);
    let id = s.add_player();
    s.start_match();
    while s.phase != Phase::Round {
        s.step();
    }
    let f = s.frog(id).unwrap();
    println!("round start pos=({:.1},{:.1})", f.pos.x, f.pos.y);
    for (name, btn, aim) in [("right", BTN_RIGHT, 1.0f32), ("left", BTN_LEFT, -1.0)] {
        s.set_input(
            id,
            Input {
                buttons: btn,
                aim: v2(aim, 0.0),
                sel: 0,
            },
        );
        for _ in 0..180 {
            s.step();
        }
        let f = s.frog(id).unwrap();
        println!(
            "{name}: pos=({:.1},{:.1}) alive={} grounded={}",
            f.pos.x, f.pos.y, f.alive, f.grounded
        );
    }
    s.set_input(id, Input { buttons: 0, aim: v2(1.0, 0.0), sel: 0 });
    let pos = s.frog(id).unwrap().pos;
    s.debug_drop_crate(pos);
    for _ in 0..120 {
        s.step();
    }
    println!(
        "after drop: alive={} inv={:?} events_pickup={}",
        s.frog(id).unwrap().alive,
        s.inventory,
        s.events
            .iter()
            .filter(|e| matches!(e, Event::CratePickup { .. }))
            .count()
    );
}
