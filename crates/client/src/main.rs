//! Rebate Attack Force — Bevy client (native + wasm).
//! Server-authoritative: this binary renders snapshots and sends inputs.

mod hud;
mod input;
mod net;
mod sfx;
mod view;

use bevy::prelude::*;

fn main() {
    App::new()
        .add_plugins(
            DefaultPlugins
                .set(WindowPlugin {
                    primary_window: Some(Window {
                        title: "Rebate Attack Force".into(),
                        resolution: bevy::window::WindowResolution::new(1280, 720),
                        canvas: Some("#game".into()),
                        fit_canvas_to_parent: true,
                        prevent_default_event_handling: true,
                        ..default()
                    }),
                    ..default()
                })
                .set(ImagePlugin::default_nearest()),
        )
        .insert_resource(ClearColor(Color::srgb(0.46, 0.69, 0.90)))
        .init_resource::<net::NetState>()
        .init_resource::<net::ClientTerrain>()
        .init_resource::<view::VisIndex>()
        .init_resource::<view::CamCtl>()
        .init_resource::<input::Selected>()
        .init_resource::<input::SendTimer>()
        .init_resource::<hud::Banner>()
        .add_systems(
            Startup,
            (setup_camera, view::setup_world, hud::setup_hud, sfx::load_sfx, net::connect),
        )
        .add_systems(
            Update,
            (
                net::poll_net,
                net::advance_render_tick,
                (
                    view::repaint_terrain,
                    view::sync_world,
                    view::draw_ropes,
                    view::spawn_fx,
                    view::update_fx,
                    view::camera_follow,
                    input::gather_and_send,
                    input::lobby_keys,
                    hud::update_hud,
                    sfx::play_events,
                ),
                clear_events,
            )
                .chain(),
        )
        .run();
}

fn setup_camera(mut commands: Commands) {
    commands.spawn((
        Camera2d,
        Projection::Orthographic(OrthographicProjection {
            scale: 0.8,
            ..OrthographicProjection::default_2d()
        }),
    ));
}

fn clear_events(mut net: ResMut<net::NetState>) {
    net.events.clear();
}
