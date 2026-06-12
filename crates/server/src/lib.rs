//! Authoritative game server: one tokio task per room, 120 Hz sim,
//! ~30 Hz snapshots, rooms keyed by party code.

use axum::{
    extract::{
        ws::{Message, WebSocket, WebSocketUpgrade},
        Query, State,
    },
    response::IntoResponse,
    routing::{any, get},
    Router,
};
use protocol::{
    ClientMsg, CrateSnap, DebugCmd, FrogSnap, PlayerMeta, ProjSnap, ServerMsg, Snapshot,
    PROTOCOL_VERSION,
};
use sim::game::{Event, Input, Mode, Phase, Sim, DT};
use sim::math::Vec2;
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tokio::sync::mpsc;
use tower_http::services::{ServeDir, ServeFile};
use tracing::info;

pub struct AppState {
    pub rooms: Mutex<HashMap<String, mpsc::UnboundedSender<RoomCmd>>>,
    pub dev_hooks: bool,
    pub seed: Option<u64>,
}

pub enum RoomCmd {
    Join {
        name: String,
        out: mpsc::UnboundedSender<Vec<u8>>,
        reply: tokio::sync::oneshot::Sender<u8>,
    },
    Leave {
        id: u8,
    },
    Input {
        id: u8,
        input: Input,
    },
    Ready {
        id: u8,
        ready: bool,
    },
    SetMode {
        mode: Mode,
    },
    Debug {
        id: u8,
        cmd: DebugCmd,
    },
}

struct Client {
    name: String,
    ready: bool,
    out: mpsc::UnboundedSender<Vec<u8>>,
}

/// The per-room actor: owns the sim, applies commands, broadcasts snapshots.
async fn room_task(code: String, mut rx: mpsc::UnboundedReceiver<RoomCmd>, state: Arc<AppState>) {
    let seed = state.seed.unwrap_or_else(|| {
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_millis() as u64
    });
    let mut game = Sim::new(seed);
    let mut clients: HashMap<u8, Client> = HashMap::new();
    let mut carves: Vec<(Vec2, f32)> = Vec::new();
    let mut pending_events: Vec<Event> = Vec::new();
    let mut empty_for = 0.0f32;
    let mut interval = tokio::time::interval(Duration::from_micros(8_333));
    interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Burst);
    info!("room {code}: created (seed {seed})");

    loop {
        interval.tick().await;
        // Apply all queued commands.
        loop {
            match rx.try_recv() {
                Ok(RoomCmd::Join { name, out, reply }) => {
                    let id = game.add_player();
                    let welcome = ServerMsg::Welcome {
                        protocol: PROTOCOL_VERSION,
                        id,
                        seed,
                        carves: carves.clone(),
                    };
                    let _ = out.send(protocol::encode(&welcome));
                    clients.insert(
                        id,
                        Client {
                            name,
                            ready: false,
                            out,
                        },
                    );
                    let _ = reply.send(id);
                    broadcast_roster(&game, &clients);
                    info!("room {code}: player {id} joined ({} online)", clients.len());
                }
                Ok(RoomCmd::Leave { id }) => {
                    clients.remove(&id);
                    game.remove_player(id);
                    // The last holdout leaving may make everyone-else ready.
                    try_start_match(&code, &mut game, &mut clients);
                    broadcast_roster(&game, &clients);
                    info!("room {code}: player {id} left ({} online)", clients.len());
                }
                Ok(RoomCmd::Input { id, input }) => game.set_input(id, input),
                Ok(RoomCmd::Ready { id, ready }) => {
                    if let Some(c) = clients.get_mut(&id) {
                        c.ready = ready;
                    }
                    try_start_match(&code, &mut game, &mut clients);
                    broadcast_roster(&game, &clients);
                }
                Ok(RoomCmd::SetMode { mode }) => {
                    game.set_mode(mode);
                    broadcast_roster(&game, &clients);
                }
                Ok(RoomCmd::Debug { id, cmd }) => {
                    if state.dev_hooks {
                        match cmd {
                            DebugCmd::DropCrate => {
                                if let Some(f) = game.frog(id) {
                                    let pos = f.pos;
                                    game.debug_drop_crate(pos);
                                }
                            }
                        }
                    }
                }
                Err(mpsc::error::TryRecvError::Empty) => break,
                Err(mpsc::error::TryRecvError::Disconnected) => return,
            }
        }

        game.step();
        for ev in game.events.drain(..) {
            if let Event::Explosion { pos, radius } = &ev {
                carves.push((*pos, *radius));
            }
            pending_events.push(ev);
        }

        // ~30 Hz snapshots.
        if game.tick % 4 == 0 && !clients.is_empty() {
            let snap = build_snapshot(&game, std::mem::take(&mut pending_events));
            let bytes = protocol::encode(&ServerMsg::Snapshot(snap));
            clients.retain(|_, c| c.out.send(bytes.clone()).is_ok());
        }

        if clients.is_empty() {
            pending_events.clear();
            empty_for += DT;
            if empty_for > 30.0 {
                info!("room {code}: idle, shutting down");
                state.rooms.lock().unwrap().remove(&code);
                return;
            }
        } else {
            empty_for = 0.0;
        }
    }
}

/// Start the match when the lobby has players and they're all ready.
fn try_start_match(code: &str, game: &mut Sim, clients: &mut HashMap<u8, Client>) {
    if game.phase != Phase::Lobby || clients.is_empty() || !clients.values().all(|c| c.ready) {
        return;
    }
    game.start_match();
    for c in clients.values_mut() {
        c.ready = false; // fresh lobby after the match ends
    }
    info!("room {code}: all ready, match starting ({:?})", game.mode);
}

fn broadcast_roster(game: &Sim, clients: &HashMap<u8, Client>) {
    let roster: Vec<PlayerMeta> = game
        .frogs
        .iter()
        .filter_map(|f| {
            clients.get(&f.id).map(|c| PlayerMeta {
                id: f.id,
                name: c.name.clone(),
                team: f.team,
                ready: c.ready,
            })
        })
        .collect();
    let bytes = protocol::encode(&ServerMsg::Roster(roster));
    for c in clients.values() {
        let _ = c.out.send(bytes.clone());
    }
}

fn build_snapshot(game: &Sim, events: Vec<Event>) -> Snapshot {
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
        events,
    }
}

#[derive(serde::Deserialize)]
struct WsQuery {
    #[serde(default)]
    room: Option<String>,
    #[serde(default)]
    name: Option<String>,
}

async fn ws_handler(
    ws: WebSocketUpgrade,
    Query(q): Query<WsQuery>,
    State(state): State<Arc<AppState>>,
) -> impl IntoResponse {
    ws.on_upgrade(move |socket| handle_socket(socket, q, state))
}

fn room_sender(state: &Arc<AppState>, code: &str) -> mpsc::UnboundedSender<RoomCmd> {
    let mut rooms = state.rooms.lock().unwrap();
    if let Some(tx) = rooms.get(code) {
        if !tx.is_closed() {
            return tx.clone();
        }
    }
    let (tx, rx) = mpsc::unbounded_channel();
    rooms.insert(code.to_string(), tx.clone());
    tokio::spawn(room_task(code.to_string(), rx, state.clone()));
    tx
}

async fn handle_socket(mut socket: WebSocket, q: WsQuery, state: Arc<AppState>) {
    // The first message must be Hello (URL query works too).
    let (mut name, mut room) = (q.name, q.room);
    if name.is_none() || room.is_none() {
        match socket.recv().await {
            Some(Ok(Message::Binary(b))) => {
                if let Some(ClientMsg::Hello { name: n, room: r }) = protocol::decode(&b) {
                    name = Some(n);
                    room = Some(r);
                }
            }
            _ => return,
        }
    }
    let name = sanitize_name(name.as_deref().unwrap_or("frog"));
    let code = sanitize_code(room.as_deref().unwrap_or("PUBLIC"));

    let (out_tx, mut out_rx) = mpsc::unbounded_channel::<Vec<u8>>();
    let (reply_tx, reply_rx) = tokio::sync::oneshot::channel();
    let room_tx = room_sender(&state, &code);
    if room_tx
        .send(RoomCmd::Join {
            name,
            out: out_tx,
            reply: reply_tx,
        })
        .is_err()
    {
        return;
    }
    let Ok(my_id) = reply_rx.await else { return };

    loop {
        tokio::select! {
            out = out_rx.recv() => match out {
                Some(bytes) => {
                    if socket.send(Message::Binary(bytes.into())).await.is_err() {
                        break;
                    }
                }
                None => break,
            },
            msg = socket.recv() => match msg {
                Some(Ok(Message::Binary(b))) => match protocol::decode::<ClientMsg>(&b) {
                    Some(ClientMsg::Input(input)) => {
                        let _ = room_tx.send(RoomCmd::Input { id: my_id, input });
                    }
                    Some(ClientMsg::Ready(ready)) => {
                        let _ = room_tx.send(RoomCmd::Ready { id: my_id, ready });
                    }
                    Some(ClientMsg::SetMode(mode)) => {
                        let _ = room_tx.send(RoomCmd::SetMode { mode });
                    }
                    Some(ClientMsg::Ping(n)) => {
                        let bytes = protocol::encode(&ServerMsg::Pong(n));
                        if socket.send(Message::Binary(bytes.into())).await.is_err() {
                            break;
                        }
                    }
                    Some(ClientMsg::Debug(cmd)) => {
                        let _ = room_tx.send(RoomCmd::Debug { id: my_id, cmd });
                    }
                    _ => {}
                },
                Some(Ok(Message::Close(_))) | Some(Err(_)) | None => break,
                _ => {}
            },
        }
    }
    let _ = room_tx.send(RoomCmd::Leave { id: my_id });
}

fn sanitize_name(s: &str) -> String {
    let t: String = s.trim().chars().take(16).collect();
    if t.is_empty() {
        "frog".to_string()
    } else {
        t
    }
}

fn sanitize_code(s: &str) -> String {
    let t: String = s
        .trim()
        .chars()
        .filter(|c| c.is_ascii_alphanumeric())
        .take(12)
        .collect::<String>()
        .to_ascii_uppercase();
    if t.is_empty() {
        "PUBLIC".to_string()
    } else {
        t
    }
}

/// Cache policy for redeploys: trunk content-hashes the js/wasm bundles, so
/// those can be cached forever; everything else (index.html, assets/) must
/// revalidate so a new image is picked up immediately (304s keep it cheap).
async fn cache_headers(
    req: axum::extract::Request,
    next: axum::middleware::Next,
) -> axum::response::Response {
    let immutable = {
        let p = req.uri().path();
        p.ends_with(".wasm") || p.ends_with(".js")
    };
    let mut res = next.run(req).await;
    res.headers_mut().insert(
        axum::http::header::CACHE_CONTROL,
        axum::http::HeaderValue::from_static(if immutable {
            "public, max-age=31536000, immutable"
        } else {
            "no-cache"
        }),
    );
    res
}

pub fn build_router(state: Arc<AppState>, dist_dir: &str) -> Router {
    let index = format!("{dist_dir}/index.html");
    let files = ServeDir::new(dist_dir).fallback(ServeFile::new(index));
    Router::new()
        .route("/healthz", get(|| async { "ok" }))
        .route("/ws", any(ws_handler))
        .fallback_service(
            tower::ServiceBuilder::new()
                .layer(tower_http::compression::CompressionLayer::new())
                .layer(axum::middleware::from_fn(cache_headers))
                .service(files),
        )
        .with_state(state)
}

pub fn new_state(dev_hooks: bool, seed: Option<u64>) -> Arc<AppState> {
    Arc::new(AppState {
        rooms: Mutex::new(HashMap::new()),
        dev_hooks,
        seed,
    })
}
