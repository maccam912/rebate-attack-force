//! Rebate Attack Force — Bevy client (native + wasm).
//! Server-authoritative: this binary renders snapshots and sends inputs.

mod hud;
mod input;
mod legs;
mod net;
mod sfx;
mod typography;
mod view;

use bevy::prelude::*;
use bevy_embedded_assets::{EmbeddedAssetPlugin, PluginMode};

fn main() {
    App::new()
        // Audio is compiled into the binary: deployments only need the wasm
        // bundle, the browser never fetches assets/ over HTTP.
        .add_plugins(EmbeddedAssetPlugin {
            mode: PluginMode::ReplaceDefault,
        })
        .add_plugins(
            DefaultPlugins
                // No .meta files exist, and the game server SPA-fallbacks
                // missing paths to index.html with a 200 — on wasm that
                // "meta" is HTML, fails to parse, and kills the whole asset
                // load. Don't probe for meta at all.
                .set(AssetPlugin {
                    meta_check: bevy::asset::AssetMetaCheck::Never,
                    ..default()
                })
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
        .insert_gizmo_config(
            view::TongueGizmos,
            GizmoConfig {
                line: GizmoLineConfig {
                    width: 7.0,
                    joints: GizmoLineJoint::Round(6),
                    ..default()
                },
                ..default()
            },
        )
        .insert_gizmo_config(
            legs::LegGizmos,
            GizmoConfig {
                line: GizmoLineConfig {
                    width: 7.0,
                    joints: GizmoLineJoint::Round(6),
                    ..default()
                },
                ..default()
            },
        )
        .init_resource::<net::NetState>()
        .init_resource::<net::ClientTerrain>()
        .init_resource::<view::VisIndex>()
        .init_resource::<view::FrogPose>()
        .init_resource::<view::CamCtl>()
        .init_resource::<input::Selected>()
        .init_resource::<input::SendTimer>()
        .init_resource::<hud::Banner>()
        .init_resource::<legs::LegRigs>()
        .init_resource::<sfx::CroakTimers>()
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
                    view::update_pose,
                    view::sync_world,
                    view::draw_ropes,
                    legs::update_legs,
                    view::spawn_fx,
                    view::update_fx,
                    view::camera_follow,
                    input::gather_and_send,
                    input::lobby_keys,
                    hud::update_hud,
                    hud::update_health_panel,
                    sfx::play_events,
                    sfx::ambient_croaks,
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
