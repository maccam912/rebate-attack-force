//! Gather keyboard/mouse into a sim Input and stream it to the server.
//! No prediction: the server owns the truth, we just send intent.

use crate::net::{send_msg, NetSocket, NetState};
use crate::sfx::Sfx;
use crate::view::w2b;
use bevy::prelude::*;
use protocol::ClientMsg;
use sim::game::{
    Input as SimInput, Mode, Phase, BTN_DOWN, BTN_FIRE, BTN_JUMP, BTN_LEFT, BTN_RIGHT, BTN_TONGUE,
    BTN_UP, NUM_WEAPONS,
};

/// Lobby controls: M switches game mode, R toggles ready.
pub fn lobby_keys(
    mut commands: Commands,
    keys: Res<ButtonInput<KeyCode>>,
    net: Res<NetState>,
    socket: Option<NonSendMut<NetSocket>>,
    mut sfx: ResMut<Sfx>,
) {
    let Some(mut socket) = socket else { return };
    if !net.connected {
        return;
    }
    let Some(snap) = net.latest() else { return };
    if snap.phase != Phase::Lobby {
        return;
    }
    if keys.just_pressed(KeyCode::KeyM) {
        let next = match snap.mode {
            Mode::Teams => Mode::Ffa,
            Mode::Ffa => Mode::Teams,
        };
        send_msg(&mut socket, &ClientMsg::SetMode(next));
        sfx.play(&mut commands, "ui_switch", 0.6);
    }
    if keys.just_pressed(KeyCode::KeyR) {
        let ready = net
            .my_id
            .and_then(|id| net.roster.iter().find(|p| p.id == id))
            .map(|p| p.ready)
            .unwrap_or(false);
        send_msg(&mut socket, &ClientMsg::Ready(!ready));
        sfx.play(&mut commands, "ui_confirm", 0.6);
    }
}

#[derive(Resource, Default)]
pub struct Selected(pub u8);

#[derive(Resource, Default)]
pub struct SendTimer(pub f32);

#[allow(clippy::too_many_arguments)]
pub fn gather_and_send(
    mut commands: Commands,
    time: Res<Time>,
    keys: Res<ButtonInput<KeyCode>>,
    mouse: Res<ButtonInput<MouseButton>>,
    mut sel: ResMut<Selected>,
    mut timer: ResMut<SendTimer>,
    net: Res<NetState>,
    socket: Option<NonSendMut<NetSocket>>,
    mut sfx: ResMut<Sfx>,
    windows: Query<&Window>,
    camera: Query<(&Camera, &GlobalTransform), With<Camera2d>>,
) {
    let Some(mut socket) = socket else { return };
    if !net.connected {
        return;
    }
    // weapon selection
    for (key, idx) in [
        (KeyCode::Digit1, 0u8),
        (KeyCode::Digit2, 1),
        (KeyCode::Digit3, 2),
    ] {
        if keys.just_pressed(key) {
            sel.0 = idx.min(NUM_WEAPONS as u8 - 1);
            sfx.play(&mut commands, "ui_click", 0.5);
        }
    }

    timer.0 += time.delta_secs();
    if timer.0 < 1.0 / 50.0 {
        return;
    }
    timer.0 = 0.0;

    let mut buttons = 0u8;
    if keys.pressed(KeyCode::KeyA) || keys.pressed(KeyCode::ArrowLeft) {
        buttons |= BTN_LEFT;
    }
    if keys.pressed(KeyCode::KeyD) || keys.pressed(KeyCode::ArrowRight) {
        buttons |= BTN_RIGHT;
    }
    if keys.pressed(KeyCode::KeyW) || keys.pressed(KeyCode::ArrowUp) {
        buttons |= BTN_UP;
    }
    if keys.pressed(KeyCode::KeyS) || keys.pressed(KeyCode::ArrowDown) {
        buttons |= BTN_DOWN;
    }
    if keys.pressed(KeyCode::Enter)
        || keys.pressed(KeyCode::NumpadEnter)
        || keys.pressed(KeyCode::Space)
    {
        buttons |= BTN_JUMP;
    }
    if mouse.pressed(MouseButton::Left) {
        buttons |= BTN_TONGUE;
    }
    if mouse.pressed(MouseButton::Right) {
        buttons |= BTN_FIRE;
    }

    // aim: from my frog toward the cursor (world space)
    let mut aim = sim::v2(1.0, 0.0);
    if let (Ok(window), Ok((cam, cam_tr))) = (windows.single(), camera.single()) {
        if let Some(cursor) = window.cursor_position() {
            if let Ok(world) = cam.viewport_to_world_2d(cam_tr, cursor) {
                if let Some((_, next, _)) = net.frame() {
                    if let Some(me) = net
                        .my_id
                        .and_then(|id| next.frogs.iter().find(|f| f.id == id))
                    {
                        let fp = w2b(me.pos, 0.0);
                        let d = world - fp.truncate();
                        if d.length_squared() > 1.0 {
                            // bevy y-up → sim y-down
                            aim = sim::v2(d.x, -d.y).normalized();
                        }
                    }
                }
            }
        }
    }

    send_msg(
        &mut socket,
        &ClientMsg::Input(SimInput {
            buttons,
            aim,
            sel: sel.0,
        }),
    );
}
