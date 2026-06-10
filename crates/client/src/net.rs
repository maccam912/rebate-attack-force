//! WebSocket client + snapshot buffer. The socket is a non-send resource
//! (the wasm WebSocket isn't Send); everything else is normal ECS data.

use bevy::prelude::*;
use ewebsock::{WsEvent, WsMessage, WsReceiver, WsSender};
use protocol::{ClientMsg, PlayerMeta, ServerMsg, Snapshot};
use sim::game::Event as SimEvent;
use sim::Terrain;
use std::collections::VecDeque;

pub struct NetSocket {
    pub sender: WsSender,
    pub receiver: WsReceiver,
}

#[derive(Resource, Default)]
pub struct NetState {
    pub connected: bool,
    pub error: Option<String>,
    pub my_id: Option<u8>,
    pub roster: Vec<PlayerMeta>,
    pub room: String,
    pub snaps: VecDeque<Snapshot>,
    pub render_tick: f64,
    /// Sim events from snapshots, drained by fx/audio/banner systems each frame.
    pub events: Vec<SimEvent>,
}

/// Client copy of the terrain, used purely for rendering (carved on events).
#[derive(Resource, Default)]
pub struct ClientTerrain {
    pub terrain: Option<Terrain>,
    pub dirty: bool,
}

pub fn server_config() -> (String, String, String) {
    // returns (ws_url_base, room, name)
    #[cfg(target_arch = "wasm32")]
    {
        let loc = web_sys::window().unwrap().location();
        let proto = if loc.protocol().unwrap_or_default() == "https:" {
            "wss:"
        } else {
            "ws:"
        };
        let host = loc.host().unwrap_or_else(|_| "127.0.0.1:3000".into());
        let search = loc.search().unwrap_or_default();
        let params = web_sys::UrlSearchParams::new_with_str(&search).unwrap();
        let room = params.get("room").unwrap_or_else(|| "PUBLIC".into());
        let name = params.get("name").unwrap_or_else(|| {
            format!("frog{}", (js_sys::Math::random() * 900.0) as u32 + 100)
        });
        (format!("{proto}//{host}/ws"), room, name)
    }
    #[cfg(not(target_arch = "wasm32"))]
    {
        let url = std::env::var("SERVER").unwrap_or_else(|_| "ws://127.0.0.1:3000/ws".into());
        let room = std::env::var("ROOM").unwrap_or_else(|_| "PUBLIC".into());
        let name = std::env::var("NAME").unwrap_or_else(|_| {
            let n = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .subsec_nanos()
                % 900
                + 100;
            format!("frog{n}")
        });
        (url, room, name)
    }
}

pub fn connect(world: &mut World) {
    let (base, room, name) = server_config();
    let url = format!("{base}?room={room}&name={name}");
    info!("connecting to {url}");
    match ewebsock::connect(url, ewebsock::Options::default()) {
        Ok((sender, receiver)) => {
            world.insert_non_send_resource(NetSocket { sender, receiver });
            world.resource_mut::<NetState>().room = room;
        }
        Err(e) => {
            world.resource_mut::<NetState>().error = Some(format!("connect failed: {e}"));
        }
    }
}

pub fn send_msg(socket: &mut NetSocket, msg: &ClientMsg) {
    socket.sender.send(WsMessage::Binary(protocol::encode(msg)));
}

pub fn poll_net(
    socket: Option<NonSendMut<NetSocket>>,
    mut net: ResMut<NetState>,
    mut terrain: ResMut<ClientTerrain>,
) {
    let Some(socket) = socket else { return };
    while let Some(event) = socket.receiver.try_recv() {
        match event {
            WsEvent::Opened => net.connected = true,
            WsEvent::Closed => {
                net.connected = false;
                net.error = Some("connection closed".into());
            }
            WsEvent::Error(e) => {
                net.error = Some(e);
            }
            WsEvent::Message(WsMessage::Binary(bytes)) => {
                match protocol::decode::<ServerMsg>(&bytes) {
                    Some(ServerMsg::Welcome {
                        id, seed, carves, ..
                    }) => {
                        net.my_id = Some(id);
                        let mut t = Terrain::generate(seed);
                        for (pos, r) in carves {
                            t.carve(pos, r);
                        }
                        terrain.terrain = Some(t);
                        terrain.dirty = true;
                    }
                    Some(ServerMsg::Roster(r)) => net.roster = r,
                    Some(ServerMsg::Snapshot(mut snap)) => {
                        // Apply carve-relevant events to the local terrain copy.
                        let mut carved = false;
                        if let Some(t) = terrain.terrain.as_mut() {
                            for ev in &snap.events {
                                if let SimEvent::Explosion { pos, radius } = ev {
                                    t.carve(*pos, *radius);
                                    carved = true;
                                }
                            }
                        }
                        if carved {
                            terrain.dirty = true;
                        }
                        net.events.append(&mut snap.events);
                        if net.snaps.back().map(|s| s.tick).unwrap_or(0) < snap.tick {
                            net.snaps.push_back(snap);
                        }
                        while net.snaps.len() > 60 {
                            net.snaps.pop_front();
                        }
                    }
                    _ => {}
                }
            }
            WsEvent::Message(_) => {}
        }
    }
}

/// Advance the interpolation clock: ~100 ms behind the newest snapshot.
pub fn advance_render_tick(time: Res<Time>, mut net: ResMut<NetState>) {
    let (Some(lo), Some(hi)) = (
        net.snaps.front().map(|s| s.tick as f64),
        net.snaps.back().map(|s| s.tick as f64),
    ) else {
        return;
    };
    let target = hi - 12.0;
    if net.render_tick < lo || (net.render_tick - target).abs() > 30.0 {
        net.render_tick = target;
    } else {
        net.render_tick += time.delta_secs_f64() * 120.0;
        if net.render_tick > target + 4.0 {
            net.render_tick = target + 4.0;
        }
    }
    net.render_tick = net.render_tick.clamp(lo, hi);
}

impl NetState {
    /// The two snapshots bracketing the render tick, and the blend factor.
    pub fn frame(&self) -> Option<(&Snapshot, &Snapshot, f32)> {
        if self.snaps.is_empty() {
            return None;
        }
        let t = self.render_tick;
        let mut prev = self.snaps.front().unwrap();
        for s in &self.snaps {
            if (s.tick as f64) <= t {
                prev = s;
            } else {
                let span = (s.tick - prev.tick).max(1) as f64;
                let alpha = ((t - prev.tick as f64) / span).clamp(0.0, 1.0) as f32;
                return Some((prev, s, alpha));
            }
        }
        Some((prev, prev, 0.0))
    }

    pub fn latest(&self) -> Option<&Snapshot> {
        self.snaps.back()
    }
}
