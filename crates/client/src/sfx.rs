//! Map sim events to Kenney sounds. Audio is a pure consumer of events.

use crate::net::NetState;
use bevy::audio::{PlaybackSettings, Volume};
use bevy::prelude::*;
use sim::game::{Event as SimEvent, Weapon};
use sim::rng::Pcg32;
use std::collections::HashMap;

#[derive(Resource, Default)]
pub struct Sfx {
    sets: HashMap<&'static str, Vec<Handle<AudioSource>>>,
    counter: usize,
}

impl Sfx {
    /// Play the next variant of a set as a fire-and-forget audio entity.
    pub fn play(&mut self, commands: &mut Commands, set: &str, vol: f32) {
        self.counter = self.counter.wrapping_add(1);
        if let Some(handles) = self.sets.get(set) {
            if handles.is_empty() {
                return;
            }
            let h = handles[self.counter % handles.len()].clone();
            commands.spawn((
                AudioPlayer::new(h),
                PlaybackSettings::DESPAWN.with_volume(Volume::Linear(vol)),
            ));
        }
    }
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
    load("step", &["step_0", "step_1", "step_2", "step_3", "step_4"]);
    load("ui_click", &["ui_click_0", "ui_click_1", "ui_click_2"]);
    load("ui_confirm", &["ui_confirm"]);
    load("ui_switch", &["ui_switch"]);
    load("crate_pop", &["crate_pop"]);
    load("croak", &["croak_0", "croak_1", "croak_2", "croak_3"]);
    load("croak_jump", &["croak_jump_0", "croak_jump_1"]);
    load("croak_pickup", &["croak_pickup"]);
    load("croak_ouch", &["croak_ouch_0", "croak_ouch_1"]);
    load("croak_death", &["croak_death"]);
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
            SimEvent::Jump { .. } => {
                picks.push(("jump", 0.35));
                picks.push(("croak_jump", 0.4));
            }
            SimEvent::Splash { .. } => picks.push(("splash", 0.7)),
            SimEvent::Damage { .. } => picks.push(("hurt", 0.45)),
            // hard landing: pained yelp on top of the impact thud
            SimEvent::Ouch { .. } => picks.push(("croak_ouch", 0.65)),
            SimEvent::Fire { weapon, .. } => picks.push((
                match weapon {
                    Weapon::Bazooka => "fire_bazooka",
                    _ => "fire_throw",
                },
                0.7,
            )),
            SimEvent::CratePickup { .. } => {
                picks.push(("pickup", 0.8));
                picks.push(("croak_pickup", 0.55));
            }
            SimEvent::CrateSpawn { .. } => {
                picks.push(("crate_spawn", 0.55));
                picks.push(("crate_pop", 0.5));
            }
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
            // a last sad croak for any death; splash/explosion layer on top
            SimEvent::Death { .. } => picks.push(("croak_death", 0.55)),
            _ => {}
        }
    }
    for (set, vol) in picks {
        sfx.play(&mut commands, set, vol);
    }
}

/// Idle frogs ribbit on their own every few seconds, quieter with distance,
/// so the swamp always sounds inhabited.
#[derive(Resource)]
pub struct CroakTimers {
    timers: HashMap<u8, f32>,
    rng: Pcg32,
}

impl Default for CroakTimers {
    fn default() -> Self {
        CroakTimers {
            timers: HashMap::new(),
            rng: Pcg32::new(0xC50A4),
        }
    }
}

pub fn ambient_croaks(
    mut commands: Commands,
    time: Res<Time>,
    net: Res<NetState>,
    mut croaks: ResMut<CroakTimers>,
    mut sfx: ResMut<Sfx>,
) {
    let Some(snap) = net.latest() else { return };
    let listener = net
        .my_id
        .and_then(|id| snap.frogs.iter().find(|f| f.id == id))
        .map(|f| f.pos);
    let croaks = &mut *croaks;
    for f in &snap.frogs {
        if !f.alive {
            croaks.timers.remove(&f.id);
            continue;
        }
        let t = croaks
            .timers
            .entry(f.id)
            .or_insert_with(|| croaks.rng.range(2.0, 10.0));
        *t -= time.delta_secs();
        if *t > 0.0 {
            continue;
        }
        *t = croaks.rng.range(6.0, 16.0);
        let d = listener.map(|l| l.distance(f.pos)).unwrap_or(400.0);
        let vol = 0.4 * (1.0 - (d / 900.0).clamp(0.0, 1.0)).powi(2);
        if vol > 0.04 {
            sfx.play(&mut commands, "croak", vol);
        }
    }
    croaks
        .timers
        .retain(|id, _| snap.frogs.iter().any(|f| f.id == *id));
}
