//! Wire messages between client and server. Binary (bincode) over WebSocket.

use serde::{Deserialize, Serialize};
use sim::game::{Event, Input, Phase, Weapon, NUM_WEAPONS};
use sim::math::Vec2;

pub const PROTOCOL_VERSION: u32 = 1;

#[derive(Clone, Debug, Serialize, Deserialize)]
pub enum ClientMsg {
    Hello { name: String, room: String },
    Input(Input),
    Ping(u32),
    /// Only honored when the server runs with DEV_HOOKS=1.
    Debug(DebugCmd),
}

#[derive(Clone, Copy, Debug, Serialize, Deserialize)]
pub enum DebugCmd {
    /// Drop a crate right on the sender's frog.
    DropCrate,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct PlayerMeta {
    pub id: u8,
    pub name: String,
    pub team: u8,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct FrogSnap {
    pub id: u8,
    pub pos: Vec2,
    pub vel: Vec2,
    pub hp: f32,
    pub alive: bool,
    pub aim: Vec2,
    pub facing: f32,
    pub grounded: bool,
    pub armed: bool,
    pub charge: Option<f32>,
    pub rope: Option<Vec<Vec2>>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct CrateSnap {
    pub id: u16,
    pub pos: Vec2,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ProjSnap {
    pub id: u16,
    pub kind: Weapon,
    pub pos: Vec2,
    pub vel: Vec2,
    pub triggered: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Snapshot {
    pub tick: u64,
    pub phase: Phase,
    pub phase_t: f32,
    pub round: u32,
    pub scores: [u8; 2],
    pub inventory: [[u8; NUM_WEAPONS]; 2],
    pub frogs: Vec<FrogSnap>,
    pub crates: Vec<CrateSnap>,
    pub projectiles: Vec<ProjSnap>,
    /// Events since the previous snapshot, in sim order.
    pub events: Vec<Event>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub enum ServerMsg {
    Welcome {
        protocol: u32,
        id: u8,
        seed: u64,
        /// Terrain carves that already happened, so late joiners can catch up.
        carves: Vec<(Vec2, f32)>,
    },
    Roster(Vec<PlayerMeta>),
    Snapshot(Snapshot),
    Pong(u32),
}

pub fn encode<T: Serialize>(msg: &T) -> Vec<u8> {
    bincode::serialize(msg).expect("encode")
}

pub fn decode<'a, T: Deserialize<'a>>(bytes: &'a [u8]) -> Option<T> {
    bincode::deserialize(bytes).ok()
}
