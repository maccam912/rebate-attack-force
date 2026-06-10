//! Deterministic, engine-free game core for Rebate Attack Force.
//! Everything here can run a whole match headless in a unit test.

pub mod game;
pub mod math;
pub mod rng;
pub mod terrain;

pub use game::*;
pub use math::{v2, Vec2};
pub use terrain::Terrain;
