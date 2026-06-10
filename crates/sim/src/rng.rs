/// Minimal PCG32 — deterministic across platforms, no dependencies.
#[derive(Clone, Debug)]
pub struct Pcg32 {
    state: u64,
    inc: u64,
}

impl Pcg32 {
    pub fn new(seed: u64) -> Self {
        let mut r = Pcg32 {
            state: 0,
            inc: (seed << 1) | 1,
        };
        r.next_u32();
        r.state = r.state.wrapping_add(seed);
        r.next_u32();
        r
    }

    pub fn next_u32(&mut self) -> u32 {
        let old = self.state;
        self.state = old
            .wrapping_mul(6364136223846793005)
            .wrapping_add(self.inc);
        let xorshifted = (((old >> 18) ^ old) >> 27) as u32;
        let rot = (old >> 59) as u32;
        xorshifted.rotate_right(rot)
    }

    /// Uniform float in [0, 1).
    pub fn f32(&mut self) -> f32 {
        (self.next_u32() >> 8) as f32 / (1u32 << 24) as f32
    }

    pub fn range(&mut self, lo: f32, hi: f32) -> f32 {
        lo + self.f32() * (hi - lo)
    }

    pub fn below(&mut self, n: u32) -> u32 {
        // Simple modulo is fine for gameplay purposes.
        self.next_u32() % n.max(1)
    }
}

/// Deterministic 2D lattice hash for value noise.
pub fn hash2(x: i32, y: i32, seed: u64) -> f32 {
    let mut h = (x as u64)
        .wrapping_mul(0x9E3779B97F4A7C15)
        .wrapping_add((y as u64).wrapping_mul(0xC2B2AE3D27D4EB4F))
        .wrapping_add(seed.wrapping_mul(0xD6E8FEB86659FD93));
    h ^= h >> 32;
    h = h.wrapping_mul(0xD6E8FEB86659FD93);
    h ^= h >> 32;
    (h & 0xFFFFFF) as f32 / 0xFFFFFF as f32
}
