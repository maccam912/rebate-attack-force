use sim::game::*;
use sim::math::v2;

fn main() {
    let seed: u64 = std::env::args()
        .nth(1)
        .and_then(|s| s.parse().ok())
        .unwrap_or(4242);
    let mut s = Sim::new(seed);
    let id = s.add_player();
    // run the natural phase flow like the server does
    for _ in 0..(4.0 / DT) as usize {
        s.step();
    }
    let f = s.frog(id).unwrap();
    println!(
        "phase={:?} pos=({:.1},{:.1}) vel=({:.1},{:.1}) grounded={} alive={} sdf={:.2} normal=({:.2},{:.2})",
        s.phase, f.pos.x, f.pos.y, f.vel.x, f.vel.y, f.grounded, f.alive,
        s.terrain.sample(f.pos), s.terrain.normal(f.pos).x, s.terrain.normal(f.pos).y
    );
    for (name, btn, aim) in [("right", BTN_RIGHT, 1.0f32), ("left", BTN_LEFT, -1.0)] {
        let x0 = s.frog(id).unwrap().pos.x;
        s.set_input(
            id,
            Input {
                buttons: btn,
                aim: v2(aim, 0.0),
                sel: 0,
            },
        );
        for i in 0..180 {
            s.step();
            if i % 60 == 0 {
                let f = s.frog(id).unwrap();
                println!(
                    "  {name} t={i} pos=({:.1},{:.1}) vel=({:.1},{:.1}) grounded={} sdf={:.2}",
                    f.pos.x, f.pos.y, f.vel.x, f.vel.y, f.grounded,
                    s.terrain.sample(f.pos)
                );
            }
        }
        let f = s.frog(id).unwrap();
        println!("{name}: moved {:.1}px", (f.pos.x - x0).abs());
    }
}
