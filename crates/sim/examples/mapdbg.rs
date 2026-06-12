//! Print the generated terrain as ASCII for quick map-shape tuning.
//! Usage: cargo run -p sim --example mapdbg [seed]
use sim::terrain::{GRID_H, GRID_W};
use sim::Terrain;

fn main() {
    let seed: u64 = std::env::args()
        .nth(1)
        .and_then(|s| s.parse().ok())
        .unwrap_or(42);
    let t = Terrain::generate(seed);
    let (cols, rows) = (128, 48);
    for r in 0..rows {
        let mut line = String::new();
        for c in 0..cols {
            let gx0 = c * GRID_W / cols;
            let gx1 = ((c + 1) * GRID_W / cols).max(gx0 + 1);
            let gy0 = r * GRID_H / rows;
            let gy1 = ((r + 1) * GRID_H / rows).max(gy0 + 1);
            let mut solid = 0;
            let mut total = 0;
            for gy in gy0..gy1 {
                for gx in gx0..gx1 {
                    solid += t.solid[gy * GRID_W + gx] as usize;
                    total += 1;
                }
            }
            line.push(match solid * 4 / total {
                0 => ' ',
                1 => '.',
                2 => 'o',
                _ => '#',
            });
        }
        println!("{line}");
    }
    println!("spawns: {}", t.spawn_points().len());
}
