//! Map sim events to Kenney sounds. Audio is a pure consumer of events.

use crate::net::NetState;
use bevy::audio::{PlaybackSettings, Volume};
use bevy::prelude::*;
use sim::game::{DeathCause, Event as SimEvent, Weapon};
use std::collections::HashMap;

#[derive(Resource, Default)]
pub struct Sfx {
    sets: HashMap<&'static str, Vec<Handle<AudioSource>>>,
    counter: usize,
}

pub fn load_sfx(mut commands: Commands, assets: Res<AssetServer>) {
    let mut sets: HashMap<&'static str, Vec<Handle<AudioSource>>> = HashMap::new();
    let mut load = |name: &'static str, files: &[&str]| {
        sets.insert(
            name,
            files
                .iter()
                .map(|f| assets.load(format!("audio/{f}.ogg")))
                .collect(),
        );
    };
    load("bounce", &["bounce_0", "bounce_1", "bounce_2", "bounce_3", "bounce_4"]);
    load(
        "explosion",
        &["explosion_0", "explosion_1", "explosion_2", "explosion_3", "explosion_4"],
    );
    load("attach", &["attach_0", "attach_1", "attach_2", "attach_3"]);
    load("jump", &["jump_0", "jump_1", "jump_2"]);
    load("splash", &["splash_0", "splash_1", "splash_2", "splash_3"]);
    load("hurt", &["hurt_0", "hurt_1", "hurt_2"]);
    load("fire_bazooka", &["fire_bazooka"]);
    load("fire_throw", &["fire_throw"]);
    load("pickup", &["pickup"]);
    load("crate_spawn", &["crate_spawn"]);
    load("mine_armed", &["mine_armed"]);
    load("mine_trigger", &["mine_trigger"]);
    load("round_start", &["round_start"]);
    load("victory", &["victory"]);
    load("defeat", &["defeat"]);
    load("tick", &["tick"]);
    commands.insert_resource(Sfx { sets, counter: 0 });
}

pub fn play_events(mut commands: Commands, net: Res<NetState>, mut sfx: ResMut<Sfx>) {
    let my_team = net
        .my_id
        .and_then(|id| net.roster.iter().find(|p| p.id == id))
        .map(|p| p.team);
    // borrow workaround: collect (set, volume) picks first
    let mut picks: Vec<(&'static str, f32)> = Vec::new();
    for ev in &net.events {
        match ev {
            SimEvent::Bounce { impulse, .. } => {
                picks.push(("bounce", (impulse / 900.0).clamp(0.25, 0.9)))
            }
            SimEvent::Explosion { .. } => picks.push(("explosion", 0.85)),
            SimEvent::TongueAttach { .. } => picks.push(("attach", 0.8)),
            SimEvent::Jump { .. } => picks.push(("jump", 0.35)),
            SimEvent::Splash { .. } => picks.push(("splash", 0.7)),
            SimEvent::Damage { .. } => picks.push(("hurt", 0.45)),
            SimEvent::Fire { weapon, .. } => picks.push((
                match weapon {
                    Weapon::Bazooka => "fire_bazooka",
                    _ => "fire_throw",
                },
                0.7,
            )),
            SimEvent::CratePickup { .. } => picks.push(("pickup", 0.8)),
            SimEvent::CrateSpawn { .. } => picks.push(("crate_spawn", 0.45)),
            SimEvent::MineArmed { .. } => picks.push(("mine_armed", 0.6)),
            SimEvent::MineTriggered { .. } => picks.push(("mine_trigger", 0.8)),
            SimEvent::RoundStart { .. } => picks.push(("round_start", 0.5)),
            SimEvent::Score { .. } => picks.push(("tick", 0.7)),
            SimEvent::MatchEnd { winner } => picks.push((
                if Some(*winner) == my_team {
                    "victory"
                } else {
                    "defeat"
                },
                0.7,
            )),
            SimEvent::Death {
                cause: DeathCause::Drown,
                ..
            } => {} // splash already covers it
            _ => {}
        }
    }
    for (set, vol) in picks {
        sfx.counter = sfx.counter.wrapping_add(1);
        if let Some(handles) = sfx.sets.get(set) {
            if handles.is_empty() {
                continue;
            }
            let h = handles[sfx.counter % handles.len()].clone();
            commands.spawn((
                AudioPlayer::new(h),
                PlaybackSettings::DESPAWN.with_volume(Volume::Linear(vol)),
            ));
        }
    }
}
