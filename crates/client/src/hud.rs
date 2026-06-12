//! HUD: phase timer, team scores, weapon bar, status line, banners.

use crate::input::Selected;
use crate::net::NetState;
use crate::typography::{self, size};
use crate::view::{team_color, TEAM_COLORS};
use bevy::prelude::*;
use protocol::PlayerMeta;
use sim::game::{Event as SimEvent, Mode, Phase, Weapon, NUM_WEAPONS, PRE_TIME, ROUND_TIME};

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
#[derive(Component)]
pub struct LobbyPanel;
#[derive(Component)]
pub struct LobbyText;
#[derive(Component)]
pub struct HealthPanel;

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
                    border_radius: BorderRadius::all(Val::Px(8.0)),
                    ..default()
                },
                BackgroundColor(PANEL),
            ))
            .with_children(|p| {
                p.spawn((
                    typography::ui("--", size::PHASE, Color::WHITE),
                    PhaseText,
                ));
            });
            p.spawn((
                Node {
                    padding: UiRect::axes(Val::Px(10.0), Val::Px(3.0)),
                    column_gap: Val::Px(8.0),
                    border_radius: BorderRadius::all(Val::Px(8.0)),
                    ..default()
                },
                BackgroundColor(PANEL),
            ))
            .with_children(|p| {
                p.spawn((
                    typography::ui("GREEN 0", size::SCORE, TEAM_COLORS[0]),
                    ScoreText(0),
                ));
                p.spawn(typography::ui(":", size::SCORE, Color::WHITE));
                p.spawn((
                    typography::ui("0 PINK", size::SCORE, TEAM_COLORS[1]),
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
                typography::ui("", size::STATUS, Color::srgb(1.0, 0.9, 0.4)),
                StatusText,
            ));
            p.spawn((Node {
                column_gap: Val::Px(6.0),
                ..default()
            },))
                .with_children(|p| {
                    for i in 0..NUM_WEAPONS as u8 {
                        p.spawn((
                            Node {
                                padding: UiRect::axes(Val::Px(10.0), Val::Px(5.0)),
                                border_radius: BorderRadius::all(Val::Px(6.0)),
                                ..default()
                            },
                            BackgroundColor(PANEL),
                        ))
                        .with_children(|p| {
                            p.spawn((
                                typography::ui(
                                    format!(
                                        "{} {} x0",
                                        i + 1,
                                        weapon_name(Weapon::from_index(i))
                                    ),
                                    size::LABEL,
                                    Color::srgb(0.6, 0.6, 0.6),
                                ),
                                SlotText(i),
                            ));
                        });
                    }
                });
        });

    // top left: team health tracker (rows filled in by update_health_panel)
    commands.spawn((
        Node {
            position_type: PositionType::Absolute,
            top: Val::Px(8.0),
            left: Val::Px(10.0),
            padding: UiRect::axes(Val::Px(10.0), Val::Px(6.0)),
            flex_direction: FlexDirection::Column,
            row_gap: Val::Px(4.0),
            border_radius: BorderRadius::all(Val::Px(8.0)),
            ..default()
        },
        BackgroundColor(PANEL),
        Visibility::Hidden,
        HealthPanel,
    ));

    // bottom left: room code; bottom right: controls
    commands
        .spawn((
            Node {
                position_type: PositionType::Absolute,
                bottom: Val::Px(10.0),
                left: Val::Px(10.0),
                padding: UiRect::axes(Val::Px(8.0), Val::Px(4.0)),
                border_radius: BorderRadius::all(Val::Px(6.0)),
                ..default()
            },
            BackgroundColor(PANEL),
        ))
        .with_children(|p| {
            p.spawn(typography::ui(
                format!("room {} - share the link to invite", net.room),
                size::SMALL,
                Color::srgb(0.8, 0.85, 0.9),
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
                border_radius: BorderRadius::all(Val::Px(6.0)),
                ..default()
            },
            BackgroundColor(PANEL),
        ))
        .with_children(|p| {
            for line in [
                "A/D move   Enter jump (2x backflip)",
                "LMB tongue   W/S reel",
                "RMB charge, release fires",
                "1-3 weapon   -/= zoom",
            ] {
                p.spawn(typography::ui(
                    line,
                    size::CONTROLS,
                    Color::srgb(0.75, 0.78, 0.82),
                ));
            }
        });

    // lobby panel (visible only during Phase::Lobby)
    commands
        .spawn((
            Node {
                position_type: PositionType::Absolute,
                top: Val::Percent(24.0),
                left: Val::Px(0.0),
                right: Val::Px(0.0),
                justify_content: JustifyContent::Center,
                ..default()
            },
            Visibility::Hidden,
            LobbyPanel,
        ))
        .with_children(|p| {
            p.spawn((
                Node {
                    padding: UiRect::axes(Val::Px(22.0), Val::Px(14.0)),
                    flex_direction: FlexDirection::Column,
                    border_radius: BorderRadius::all(Val::Px(10.0)),
                    ..default()
                },
                BackgroundColor(PANEL),
            ))
            .with_children(|p| {
                p.spawn((
                    typography::ui("", size::LOBBY, Color::srgb(0.92, 0.94, 0.97)),
                    LobbyText,
                ));
            });
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
                typography::ui("", size::PHASE, Color::WHITE),
                UiTransform::from_scale(Vec2::splat(size::BANNER / size::PHASE)),
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
                typography::ui(
                    "connecting...",
                    size::CONNECTION,
                    Color::srgb(0.9, 0.9, 0.95),
                ),
                TextLayout::new_with_justify(Justify::Center),
                ConnText,
            ));
        });
}

/// Team health tracker: one row per team — color swatch label, hp bar, and
/// the summed hp of the team's living frogs. Rows are only rebuilt when the
/// displayed values actually change.
pub fn update_health_panel(
    mut commands: Commands,
    net: Res<NetState>,
    mut panel: Query<(Entity, &mut Visibility), With<HealthPanel>>,
    mut last: Local<String>,
) {
    let Ok((panel, mut vis)) = panel.single_mut() else {
        return;
    };
    let Some(snap) = net.latest() else { return };
    let show = snap.phase != Phase::Lobby && !net.roster.is_empty();
    *vis = if show {
        Visibility::Inherited
    } else {
        Visibility::Hidden
    };
    if !show {
        last.clear();
        return;
    }

    // (team, label, hp, max_hp): Teams mode shows the two team names with
    // all members summed; FFA shows one row per player.
    let mut teams: Vec<(u8, String, f32, f32)> = Vec::new();
    for p in &net.roster {
        let hp: f32 = snap
            .frogs
            .iter()
            .filter(|f| f.id == p.id && f.alive)
            .map(|f| f.hp.max(0.0))
            .sum();
        if let Some(t) = teams.iter_mut().find(|t| t.0 == p.team) {
            t.2 += hp;
            t.3 += 100.0;
        } else {
            let label = match snap.mode {
                Mode::Teams => (if p.team == 0 { "GREEN" } else { "PINK" }).to_string(),
                Mode::Ffa => p.name.clone(),
            };
            teams.push((p.team, label, hp, 100.0));
        }
    }
    teams.sort_by_key(|t| t.0);
    let sig: String = teams
        .iter()
        .map(|(t, l, hp, max)| format!("{t}|{l}|{hp:.0}|{max};"))
        .collect();
    if *last == sig {
        return;
    }
    *last = sig;

    commands.entity(panel).despawn_related::<Children>();
    commands.entity(panel).with_children(|p| {
        for (team, label, hp, max) in teams {
            let color = team_color(team);
            p.spawn(Node {
                align_items: AlignItems::Center,
                column_gap: Val::Px(7.0),
                ..default()
            })
            .with_children(|row| {
                row.spawn((
                    Node {
                        width: Val::Px(64.0),
                        ..default()
                    },
                    typography::ui(label, size::LABEL, color),
                ));
                row.spawn((
                    Node {
                        width: Val::Px(70.0),
                        height: Val::Px(8.0),
                        border_radius: BorderRadius::all(Val::Px(4.0)),
                        ..default()
                    },
                    BackgroundColor(Color::srgba(1.0, 1.0, 1.0, 0.13)),
                ))
                .with_children(|bar| {
                    bar.spawn((
                        Node {
                            width: Val::Percent((hp / max * 100.0).clamp(0.0, 100.0)),
                            height: Val::Percent(100.0),
                            border_radius: BorderRadius::all(Val::Px(4.0)),
                            ..default()
                        },
                        BackgroundColor(color),
                    ));
                });
                row.spawn(typography::ui(
                    format!("{hp:.0}"),
                    size::SMALL,
                    Color::WHITE,
                ));
            });
        }
    });
}

/// Display name for a winning team: team name in Teams, player name in FFA.
fn winner_label(winner: u8, mode: Mode, roster: &[PlayerMeta]) -> String {
    match mode {
        Mode::Teams => (if winner == 0 { "GREEN" } else { "PINK" }).to_string(),
        Mode::Ffa => roster
            .iter()
            .find(|p| p.team == winner)
            .map(|p| p.name.to_uppercase())
            .unwrap_or_else(|| format!("FROG {winner}")),
    }
}

#[allow(clippy::type_complexity)]
pub fn update_hud(
    time: Res<Time>,
    net: Res<NetState>,
    sel: Res<Selected>,
    mut banner: ResMut<Banner>,
    mut lobby_vis: Query<&mut Visibility, With<LobbyPanel>>,
    mut texts: ParamSet<(
        Query<&mut Text, With<PhaseText>>,
        Query<(&mut Text, &mut TextColor, &ScoreText)>,
        Query<&mut Text, With<StatusText>>,
        Query<(&mut Text, &mut TextColor, &SlotText)>,
        Query<(&mut Text, &mut TextColor), (With<BannerText>, Without<SlotText>)>,
        Query<&mut Text, With<ConnText>>,
        Query<&mut Text, With<LobbyText>>,
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
            typography::set_ui(&mut t, msg);
        }
    }
    let Some(snap) = net.latest() else { return };

    // lobby panel
    let in_lobby = snap.phase == Phase::Lobby;
    for mut v in lobby_vis.iter_mut() {
        *v = if in_lobby {
            Visibility::Inherited
        } else {
            Visibility::Hidden
        };
    }
    if in_lobby {
        let mode_str = match snap.mode {
            Mode::Teams => "TEAMS - green vs pink, shared stash",
            Mode::Ffa => "FREE-FOR-ALL - every frog for itself",
        };
        let mut txt = format!("mode: {mode_str}\n[M] switch mode    [R] ready up\n");
        for p in &net.roster {
            txt += &format!(
                "\n{}  {}",
                if p.ready { "[READY]" } else { "[ -- ]" },
                p.name
            );
        }
        if let Ok(mut t) = texts.p6().single_mut() {
            typography::set_ui(&mut t, txt);
        }
    }

    // phase line
    let phase_str = match snap.phase {
        Phase::Lobby => "LOBBY".to_string(),
        Phase::Pre => format!(
            "GET READY  {:.0}",
            (PRE_TIME - snap.phase_t).max(0.0).ceil()
        ),
        Phase::Round => {
            let left = (ROUND_TIME - snap.phase_t).max(0.0);
            format!("ROUND {}   {:>2.0}s", snap.round, left.ceil())
        }
        Phase::Break => "ROUND OVER".to_string(),
        Phase::Ended { winner } => format!(
            "{} WINS THE MATCH",
            winner_label(winner, snap.mode, &net.roster)
        ),
    };
    if let Ok(mut t) = texts.p0().single_mut() {
        typography::set_ui(&mut t, phase_str);
    }

    // scores: team pair in Teams mode; you vs the leader in FFA
    let my_team = net
        .my_id
        .and_then(|id| net.roster.iter().find(|p| p.id == id))
        .map(|p| p.team as usize)
        .unwrap_or(0);
    let score_of = |team: usize| *snap.scores.get(team).unwrap_or(&0);
    for (mut t, mut c, s) in texts.p1().iter_mut() {
        let (txt, color) = match (snap.mode, s.0) {
            (Mode::Teams, 0) => (format!("GREEN {}", score_of(0)), TEAM_COLORS[0]),
            (Mode::Teams, _) => (format!("{} PINK", score_of(1)), TEAM_COLORS[1]),
            (Mode::Ffa, 0) => (
                format!("YOU {}", score_of(my_team)),
                team_color(my_team as u8),
            ),
            (Mode::Ffa, _) => {
                // best score among the other teams
                let lead = snap
                    .scores
                    .iter()
                    .enumerate()
                    .filter(|(t, _)| *t != my_team)
                    .max_by_key(|(_, s)| **s);
                match lead {
                    Some((team, s)) => (format!("{s} BEST"), team_color(team as u8)),
                    None => ("- BEST".to_string(), Color::WHITE),
                }
            }
        };
        typography::set_ui(&mut t, txt);
        c.0 = color;
    }

    // status + slots (need my frog/team)
    let me = net
        .my_id
        .and_then(|id| snap.frogs.iter().find(|f| f.id == id));
    let ammo = |slot: usize| {
        snap.inventory
            .get(my_team)
            .map(|inv| inv[slot])
            .unwrap_or(0)
    };
    let status = match me {
        Some(f) if !f.alive => "down for this round - respawning next round".to_string(),
        Some(f) if f.charge.is_some() => "release to FIRE!".to_string(),
        Some(_) if ammo(sel.0 as usize) > 0 => {
            "ARMED - hold RMB to charge, release to fire".to_string()
        }
        Some(_) if (0..NUM_WEAPONS).any(|w| ammo(w) > 0) => {
            "no ammo in this slot - pick 1-3".to_string()
        }
        Some(_) if snap.phase == Phase::Round => "grab a CRATE to stock a weapon".to_string(),
        _ => String::new(),
    };
    if let Ok(mut t) = texts.p2().single_mut() {
        typography::set_ui(&mut t, status);
    }
    for (mut t, mut c, slot) in texts.p3().iter_mut() {
        let w = Weapon::from_index(slot.0);
        let count = ammo(slot.0 as usize);
        let txt = format!("{} {} x{}", slot.0 + 1, weapon_name(w), count);
        typography::set_ui(&mut t, txt);
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
                banner.text = format!("ROUND {round} - GO!");
                banner.t = 1.6;
            }
            SimEvent::RoundEnd => {
                banner.text = "ROUND OVER".into();
                banner.t = 1.4;
            }
            SimEvent::MatchEnd { winner } => {
                banner.text = format!("{} WINS!", winner_label(*winner, snap.mode, &net.roster));
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
        let txt = if banner.t > 0.0 {
            banner.text.clone()
        } else {
            String::new()
        };
        typography::set_ui(&mut t, txt);
        c.0 = Color::srgba(1.0, 1.0, 1.0, banner.t.min(1.0));
    }
}
