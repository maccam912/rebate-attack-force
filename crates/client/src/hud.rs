//! HUD: phase timer, team scores, weapon bar, status line, banners.

use crate::input::Selected;
use crate::net::NetState;
use crate::view::TEAM_COLORS;
use bevy::prelude::*;
use sim::game::{Event as SimEvent, Phase, Weapon, NUM_WEAPONS, PRE_TIME, ROUND_TIME};

#[derive(Component)]
pub struct PhaseText;
#[derive(Component)]
pub struct ScoreText(pub u8);
#[derive(Component)]
pub struct StatusText;
#[derive(Component)]
pub struct SlotText(pub u8);
#[derive(Component)]
pub struct BannerText;
#[derive(Component)]
pub struct ConnText;

#[derive(Resource, Default)]
pub struct Banner {
    pub text: String,
    pub t: f32,
}

const PANEL: Color = Color::srgba(0.04, 0.05, 0.08, 0.72);

pub fn weapon_name(w: Weapon) -> &'static str {
    match w {
        Weapon::Bazooka => "BAZOOKA",
        Weapon::Grenade => "GRENADE",
        Weapon::Mine => "MINE",
    }
}

pub fn setup_hud(mut commands: Commands, net: Res<NetState>) {
    // top center: phase + scores
    commands
        .spawn(Node {
            position_type: PositionType::Absolute,
            top: Val::Px(8.0),
            left: Val::Px(0.0),
            right: Val::Px(0.0),
            flex_direction: FlexDirection::Column,
            align_items: AlignItems::Center,
            row_gap: Val::Px(4.0),
            ..default()
        })
        .with_children(|p| {
            p.spawn((
                Node {
                    padding: UiRect::axes(Val::Px(14.0), Val::Px(4.0)),
                    ..default()
                },
                BackgroundColor(PANEL),
                BorderRadius::all(Val::Px(8.0)),
            ))
            .with_children(|p| {
                p.spawn((
                    Text::new("--"),
                    TextFont::from_font_size(26.0),
                    TextColor(Color::WHITE),
                    PhaseText,
                ));
            });
            p.spawn((
                Node {
                    padding: UiRect::axes(Val::Px(10.0), Val::Px(3.0)),
                    column_gap: Val::Px(8.0),
                    ..default()
                },
                BackgroundColor(PANEL),
                BorderRadius::all(Val::Px(8.0)),
            ))
            .with_children(|p| {
                p.spawn((
                    Text::new("GREEN 0"),
                    TextFont::from_font_size(16.0),
                    TextColor(TEAM_COLORS[0]),
                    ScoreText(0),
                ));
                p.spawn((
                    Text::new(":"),
                    TextFont::from_font_size(16.0),
                    TextColor(Color::WHITE),
                ));
                p.spawn((
                    Text::new("0 PINK"),
                    TextFont::from_font_size(16.0),
                    TextColor(TEAM_COLORS[1]),
                    ScoreText(1),
                ));
            });
        });

    // bottom center: status + weapon slots
    commands
        .spawn(Node {
            position_type: PositionType::Absolute,
            bottom: Val::Px(10.0),
            left: Val::Px(0.0),
            right: Val::Px(0.0),
            flex_direction: FlexDirection::Column,
            align_items: AlignItems::Center,
            row_gap: Val::Px(5.0),
            ..default()
        })
        .with_children(|p| {
            p.spawn((
                Text::new(""),
                TextFont::from_font_size(15.0),
                TextColor(Color::srgb(1.0, 0.9, 0.4)),
                StatusText,
            ));
            p.spawn((
                Node {
                    column_gap: Val::Px(6.0),
                    ..default()
                },
            ))
            .with_children(|p| {
                for i in 0..NUM_WEAPONS as u8 {
                    p.spawn((
                        Node {
                            padding: UiRect::axes(Val::Px(10.0), Val::Px(5.0)),
                            ..default()
                        },
                        BackgroundColor(PANEL),
                        BorderRadius::all(Val::Px(6.0)),
                    ))
                    .with_children(|p| {
                        p.spawn((
                            Text::new(format!(
                                "{} {} x0",
                                i + 1,
                                weapon_name(Weapon::from_index(i))
                            )),
                            TextFont::from_font_size(13.0),
                            TextColor(Color::srgb(0.6, 0.6, 0.6)),
                            SlotText(i),
                        ));
                    });
                }
            });
        });

    // bottom left: room code; bottom right: controls
    commands
        .spawn((
            Node {
                position_type: PositionType::Absolute,
                bottom: Val::Px(10.0),
                left: Val::Px(10.0),
                padding: UiRect::axes(Val::Px(8.0), Val::Px(4.0)),
                ..default()
            },
            BackgroundColor(PANEL),
            BorderRadius::all(Val::Px(6.0)),
        ))
        .with_children(|p| {
            p.spawn((
                Text::new(format!("room {} - share the link to invite", net.room)),
                TextFont::from_font_size(12.0),
                TextColor(Color::srgb(0.8, 0.85, 0.9)),
            ));
        });
    commands
        .spawn((
            Node {
                position_type: PositionType::Absolute,
                top: Val::Px(8.0),
                right: Val::Px(10.0),
                padding: UiRect::axes(Val::Px(8.0), Val::Px(4.0)),
                flex_direction: FlexDirection::Column,
                ..default()
            },
            BackgroundColor(PANEL),
            BorderRadius::all(Val::Px(6.0)),
        ))
        .with_children(|p| {
            for line in [
                "A/D move   Space jump",
                "LMB tongue   W/S reel",
                "RMB charge, release fires",
                "1-3 weapon   -/= zoom",
            ] {
                p.spawn((
                    Text::new(line),
                    TextFont::from_font_size(11.0),
                    TextColor(Color::srgb(0.75, 0.78, 0.82)),
                ));
            }
        });

    // center banner + connecting overlay
    commands
        .spawn(Node {
            position_type: PositionType::Absolute,
            top: Val::Percent(30.0),
            left: Val::Px(0.0),
            right: Val::Px(0.0),
            justify_content: JustifyContent::Center,
            ..default()
        })
        .with_children(|p| {
            p.spawn((
                Text::new(""),
                TextFont::from_font_size(54.0),
                TextColor(Color::WHITE),
                BannerText,
            ));
        });
    commands
        .spawn(Node {
            position_type: PositionType::Absolute,
            top: Val::Percent(46.0),
            left: Val::Px(0.0),
            right: Val::Px(0.0),
            justify_content: JustifyContent::Center,
            ..default()
        })
        .with_children(|p| {
            p.spawn((
                Text::new("connecting..."),
                TextFont::from_font_size(24.0),
                TextColor(Color::srgb(0.9, 0.9, 0.95)),
                ConnText,
            ));
        });
}

#[allow(clippy::type_complexity)]
pub fn update_hud(
    time: Res<Time>,
    net: Res<NetState>,
    sel: Res<Selected>,
    mut banner: ResMut<Banner>,
    mut texts: ParamSet<(
        Query<&mut Text, With<PhaseText>>,
        Query<(&mut Text, &ScoreText)>,
        Query<&mut Text, With<StatusText>>,
        Query<(&mut Text, &mut TextColor, &SlotText)>,
        Query<(&mut Text, &mut TextColor), (With<BannerText>, Without<SlotText>)>,
        Query<&mut Text, With<ConnText>>,
    )>,
) {
    // connecting overlay
    {
        let msg = if let Some(e) = &net.error {
            format!("connection problem: {e}\nreload to retry")
        } else if !net.connected || net.latest().is_none() {
            "connecting...".into()
        } else {
            String::new()
        };
        if let Ok(mut t) = texts.p5().single_mut() {
            if t.0 != msg {
                t.0 = msg;
            }
        }
    }
    let Some(snap) = net.latest() else { return };

    // phase line
    let phase_str = match snap.phase {
        Phase::Pre => format!("GET READY  {:.0}", (PRE_TIME - snap.phase_t).max(0.0).ceil()),
        Phase::Round => {
            let left = (ROUND_TIME - snap.phase_t).max(0.0);
            format!("ROUND {}   {:>2.0}s", snap.round, left.ceil())
        }
        Phase::Break => "ROUND OVER".to_string(),
        Phase::Ended { winner } => format!(
            "{} TEAM WINS THE MATCH",
            if winner == 0 { "GREEN" } else { "PINK" }
        ),
    };
    if let Ok(mut t) = texts.p0().single_mut() {
        if t.0 != phase_str {
            t.0 = phase_str;
        }
    }

    // scores
    for (mut t, s) in texts.p1().iter_mut() {
        let txt = match s.0 {
            0 => format!("GREEN {}", snap.scores[0]),
            _ => format!("{} PINK", snap.scores[1]),
        };
        if t.0 != txt {
            t.0 = txt;
        }
    }

    // status + slots (need my frog/team)
    let me = net
        .my_id
        .and_then(|id| snap.frogs.iter().find(|f| f.id == id));
    let my_team = net
        .my_id
        .and_then(|id| net.roster.iter().find(|p| p.id == id))
        .map(|p| p.team as usize)
        .unwrap_or(0);
    let status = match me {
        Some(f) if !f.alive => "down for this round — respawning next round".to_string(),
        Some(f) if f.charge.is_some() => "release to FIRE!".to_string(),
        Some(f) if f.armed => {
            if snap.inventory[my_team][sel.0 as usize] > 0 {
                "ARMED — hold RMB to charge, release to fire".to_string()
            } else {
                "ARMED — but no ammo in this slot, pick 1-3".to_string()
            }
        }
        Some(_) if snap.phase == Phase::Round => "grab a CRATE to arm your attack".to_string(),
        _ => String::new(),
    };
    if let Ok(mut t) = texts.p2().single_mut() {
        if t.0 != status {
            t.0 = status;
        }
    }
    for (mut t, mut c, slot) in texts.p3().iter_mut() {
        let w = Weapon::from_index(slot.0);
        let count = snap.inventory[my_team][slot.0 as usize];
        let txt = format!("{} {} x{}", slot.0 + 1, weapon_name(w), count);
        if t.0 != txt {
            t.0 = txt;
        }
        c.0 = if sel.0 == slot.0 && count > 0 {
            Color::srgb(1.0, 1.0, 0.5)
        } else if sel.0 == slot.0 {
            Color::srgb(0.95, 0.95, 0.95)
        } else if count > 0 {
            Color::srgb(0.85, 0.85, 0.85)
        } else {
            Color::srgb(0.55, 0.55, 0.58)
        };
    }

    // banners from events
    for ev in &net.events {
        match ev {
            SimEvent::RoundStart { round } => {
                banner.text = format!("ROUND {round} — GO!");
                banner.t = 1.6;
            }
            SimEvent::RoundEnd => {
                banner.text = "ROUND OVER".into();
                banner.t = 1.4;
            }
            SimEvent::MatchEnd { winner } => {
                banner.text = format!("{} WINS!", if *winner == 0 { "GREEN" } else { "PINK" });
                banner.t = 5.0;
            }
            SimEvent::MatchReset => {
                banner.text = "NEW MATCH".into();
                banner.t = 1.5;
            }
            _ => {}
        }
    }
    banner.t = (banner.t - time.delta_secs()).max(0.0);
    if let Ok((mut t, mut c)) = texts.p4().single_mut() {
        let txt = if banner.t > 0.0 { banner.text.clone() } else { String::new() };
        if t.0 != txt {
            t.0 = txt;
        }
        c.0 = Color::srgba(1.0, 1.0, 1.0, banner.t.min(1.0));
    }
}
