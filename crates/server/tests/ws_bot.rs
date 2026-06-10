//! End-to-end over a real WebSocket: join, walk, collect a crate, fire.

use futures_util::{SinkExt, StreamExt};
use protocol::{ClientMsg, DebugCmd, ServerMsg, Snapshot};
use sim::game::{Event, Input, Phase, BTN_FIRE, BTN_LEFT, BTN_RIGHT};
use sim::math::v2;
use std::time::Duration;
use tokio::net::TcpStream;
use tokio_tungstenite::{tungstenite::Message, MaybeTlsStream, WebSocketStream};

type Ws = WebSocketStream<MaybeTlsStream<TcpStream>>;

async fn start_server() -> u16 {
    let state = server::new_state(true, Some(4242));
    let app = server::build_router(state, "nonexistent-dist");
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });
    port
}

async fn connect(port: u16, room: &str, name: &str) -> (Ws, u8) {
    let url = format!("ws://127.0.0.1:{port}/ws?room={room}&name={name}");
    let (mut ws, _) = tokio_tungstenite::connect_async(url).await.unwrap();
    // First message must be Welcome.
    loop {
        let msg = recv_msg(&mut ws).await;
        if let ServerMsg::Welcome { id, seed, .. } = msg {
            assert_eq!(seed, 4242);
            return (ws, id);
        }
    }
}

async fn recv_msg(ws: &mut Ws) -> ServerMsg {
    loop {
        let frame = tokio::time::timeout(Duration::from_secs(10), ws.next())
            .await
            .expect("server timed out")
            .expect("socket closed")
            .expect("socket error");
        if let Message::Binary(b) = frame {
            if let Some(m) = protocol::decode::<ServerMsg>(&b) {
                return m;
            }
        }
    }
}

async fn next_snapshot(ws: &mut Ws) -> Snapshot {
    loop {
        if let ServerMsg::Snapshot(s) = recv_msg(ws).await {
            return s;
        }
    }
}

async fn send(ws: &mut Ws, msg: &ClientMsg) {
    ws.send(Message::Binary(protocol::encode(msg).into()))
        .await
        .unwrap();
}

fn input(buttons: u8, aim_x: f32, aim_y: f32) -> ClientMsg {
    ClientMsg::Input(Input {
        buttons,
        aim: v2(aim_x, aim_y),
        sel: 0,
    })
}

/// Read snapshots until `pred` matches or the deadline passes.
async fn wait_for(ws: &mut Ws, secs: f32, mut pred: impl FnMut(&Snapshot) -> bool) -> Snapshot {
    let deadline = tokio::time::Instant::now() + Duration::from_secs_f32(secs);
    loop {
        let s = next_snapshot(ws).await;
        if pred(&s) {
            return s;
        }
        assert!(
            tokio::time::Instant::now() < deadline,
            "condition not met within {secs}s"
        );
    }
}

#[tokio::test]
async fn full_loop_join_walk_collect_fire() {
    let port = start_server().await;
    let (mut ws, my_id) = connect(port, "ITEST", "bot").await;

    // Wait for the round to begin (Pre phase is 3 s).
    wait_for(&mut ws, 8.0, |s| s.phase == Phase::Round).await;

    let me = |s: &Snapshot| s.frogs.iter().find(|f| f.id == my_id).cloned().unwrap();

    // Walk: terrain can block one direction, so accept either.
    // Pace by snapshot tick (sleeping would just buffer stale snapshots).
    let s0 = next_snapshot(&mut ws).await;
    let (x0, t0) = (me(&s0).pos.x, s0.tick);
    send(&mut ws, &input(BTN_RIGHT, 1.0, 0.0)).await;
    let s1 = wait_for(&mut ws, 10.0, |s| s.tick >= t0 + 180).await;
    let x1 = me(&s1).pos.x;
    send(&mut ws, &input(BTN_LEFT, -1.0, 0.0)).await;
    let s2 = wait_for(&mut ws, 10.0, |s| s.tick >= t0 + 360).await;
    let x2 = me(&s2).pos.x;
    send(&mut ws, &input(0, 1.0, 0.0)).await;
    let moved = (x1 - x0).abs().max((x2 - x0).abs());
    assert!(moved > 25.0, "bot should walk, moved {moved}px");

    // Crate: dev hook drops one on our head; we should pick it up and arm.
    send(&mut ws, &ClientMsg::Debug(DebugCmd::DropCrate)).await;
    wait_for(&mut ws, 5.0, |s| {
        s.events
            .iter()
            .any(|e| matches!(e, Event::CratePickup { frog, .. } if *frog == my_id))
            || s.frogs.iter().any(|f| f.id == my_id && f.armed)
    })
    .await;

    // Fire straight up: charge briefly (36 sim ticks), release.
    let tc = next_snapshot(&mut ws).await.tick;
    send(&mut ws, &input(BTN_FIRE, 0.0, -1.0)).await;
    wait_for(&mut ws, 10.0, |s| s.tick >= tc + 36).await;
    send(&mut ws, &input(0, 0.0, -1.0)).await;
    let snap = wait_for(&mut ws, 5.0, |s| {
        s.events
            .iter()
            .any(|e| matches!(e, Event::Fire { frog, .. } if *frog == my_id))
            || !s.projectiles.is_empty()
    })
    .await;
    let f = snap.frogs.iter().find(|f| f.id == my_id).unwrap();
    assert!(!f.armed, "one shot per round: disarmed after firing");
}

#[tokio::test]
async fn two_players_join_alternating_teams_and_rooms_are_isolated() {
    let port = start_server().await;
    let (mut a, _) = connect(port, "ROOMA", "alice").await;
    let (mut b, _) = connect(port, "ROOMA", "bob").await;
    let (mut c, _) = connect(port, "ROOMB", "carol").await;

    // Room A sees two players on opposite teams.
    let roster = loop {
        if let ServerMsg::Roster(r) = recv_msg(&mut a).await {
            if r.len() == 2 {
                break r;
            }
        }
    };
    assert_ne!(roster[0].team, roster[1].team, "teams alternate");

    // Room B only ever sees one frog in its snapshots.
    let snap = next_snapshot(&mut c).await;
    assert_eq!(snap.frogs.len(), 1, "rooms are isolated");

    let _ = (a.close(None).await, b.close(None).await, c.close(None).await);
}
