//! World rendering: terrain texture, frogs, crates, projectiles, rope, fx.

use crate::net::{ClientTerrain, NetState};
use bevy::asset::RenderAssetUsages;
use bevy::prelude::*;
use bevy::render::render_resource::{Extent3d, TextureDimension, TextureFormat};
use protocol::FrogSnap;
use sim::game::{Event as SimEvent, Weapon, FROG_R};
use sim::rng::hash2;
use sim::terrain::{GRID_H, GRID_W, HEIGHT, WATER_Y, WIDTH};
use std::collections::HashMap;

/// Team palette: 0/1 are the classic green/pink Teams pair; the rest serve
/// free-for-all, cycling if more than 8 players join.
pub const TEAM_COLORS: [Color; 8] = [
    Color::srgb(0.45, 0.80, 0.25), // green
    Color::srgb(0.95, 0.45, 0.75), // pink
    Color::srgb(0.35, 0.65, 0.95), // blue
    Color::srgb(0.95, 0.75, 0.25), // gold
    Color::srgb(0.70, 0.45, 0.95), // purple
    Color::srgb(0.95, 0.50, 0.30), // orange
    Color::srgb(0.30, 0.85, 0.80), // teal
    Color::srgb(0.85, 0.85, 0.90), // white
];

pub fn team_color(team: u8) -> Color {
    TEAM_COLORS[team as usize % TEAM_COLORS.len()]
}

/// sim (y-down) → bevy (y-up, centered)
pub fn w2b(p: sim::Vec2, z: f32) -> Vec3 {
    Vec3::new(p.x - WIDTH / 2.0, HEIGHT / 2.0 - p.y, z)
}

#[derive(Resource)]
pub struct Textures {
    pub circle32: Handle<Image>,   // white filled circle, 32px
    pub circle8: Handle<Image>,    // white filled circle, 8px
    pub ring: Handle<Image>,       // white ring, 64px
    pub crate_box: Handle<Image>,  // 24px crate
    pub pixel: Handle<Image>,      // 1x1 white
    pub terrain: Handle<Image>,    // repainted from ClientTerrain
}

#[derive(Component)]
pub struct TerrainSprite;
#[derive(Component)]
pub struct FrogVis {
    #[allow(dead_code)] // handy when debugging entity/state mismatches
    pub id: u8,
}
#[derive(Component)]
pub struct Pupil {
    pub side: f32,
}
#[derive(Component)]
pub struct NameTag;
#[derive(Component)]
pub struct HpTag;
#[derive(Component)]
pub struct AimReticle;
#[derive(Component)]
pub struct ChargeBar;
#[derive(Component)]
pub struct CrateVis {
    #[allow(dead_code)]
    pub id: u16,
}
#[derive(Component)]
pub struct ProjVis {
    #[allow(dead_code)]
    pub id: u16,
    pub kind: Weapon,
}
#[derive(Component)]
pub struct Fx {
    pub age: f32,
    pub life: f32,
    pub grow: f32,
}

fn solid_color_image(w: u32, h: u32, px: impl Fn(u32, u32) -> [u8; 4]) -> Image {
    let mut data = Vec::with_capacity((w * h * 4) as usize);
    for y in 0..h {
        for x in 0..w {
            data.extend_from_slice(&px(x, y));
        }
    }
    Image::new(
        Extent3d {
            width: w,
            height: h,
            depth_or_array_layers: 1,
        },
        TextureDimension::D2,
        data,
        TextureFormat::Rgba8UnormSrgb,
        RenderAssetUsages::default(),
    )
}

fn circle_image(d: u32) -> Image {
    let r = d as f32 / 2.0;
    solid_color_image(d, d, |x, y| {
        let dx = x as f32 + 0.5 - r;
        let dy = y as f32 + 0.5 - r;
        let dist = (dx * dx + dy * dy).sqrt();
        let a = ((r - dist).clamp(0.0, 1.0) * 255.0) as u8;
        [255, 255, 255, a]
    })
}

fn ring_image(d: u32, thickness: f32) -> Image {
    let r = d as f32 / 2.0;
    solid_color_image(d, d, |x, y| {
        let dx = x as f32 + 0.5 - r;
        let dy = y as f32 + 0.5 - r;
        let dist = (dx * dx + dy * dy).sqrt();
        let edge = (r - 1.0 - dist).clamp(0.0, 1.0);
        let inner = (dist - (r - 1.0 - thickness)).clamp(0.0, 1.0);
        [255, 255, 255, (edge * inner * 255.0) as u8]
    })
}

fn crate_image() -> Image {
    let d = 24u32;
    solid_color_image(d, d, |x, y| {
        let border = x < 2 || y < 2 || x >= d - 2 || y >= d - 2;
        let plank = (x as i32 - y as i32).abs() < 2 || (x + y) as i32 % 24 < 2;
        if border {
            [96, 64, 28, 255]
        } else if plank {
            [142, 100, 48, 255]
        } else {
            [176, 128, 64, 255]
        }
    })
}

pub fn setup_world(
    mut commands: Commands,
    mut images: ResMut<Assets<Image>>,
) {
    let terrain_img = images.add(solid_color_image(
        GRID_W as u32,
        GRID_H as u32,
        |_, _| [0, 0, 0, 0],
    ));
    let tex = Textures {
        circle32: images.add(circle_image(32)),
        circle8: images.add(circle_image(8)),
        ring: images.add(ring_image(64, 3.0)),
        crate_box: images.add(crate_image()),
        pixel: images.add(solid_color_image(1, 1, |_, _| [255, 255, 255, 255])),
        terrain: terrain_img.clone(),
    };

    // Terrain sprite (texture is repainted when dirty).
    commands.spawn((
        Sprite {
            image: terrain_img,
            custom_size: Some(Vec2::new(WIDTH, HEIGHT)),
            ..default()
        },
        Transform::from_xyz(0.0, 0.0, 1.0),
        TerrainSprite,
    ));
    // Water overlay.
    let water_h = HEIGHT - WATER_Y;
    commands.spawn((
        Sprite {
            image: tex.pixel.clone(),
            color: Color::srgba(0.15, 0.38, 0.70, 0.78),
            custom_size: Some(Vec2::new(WIDTH * 2.0, water_h * 2.0)),
            ..default()
        },
        Transform::from_xyz(0.0, -HEIGHT / 2.0 + water_h / 2.0 - water_h, 5.0),
    ));
    // Sun.
    commands.spawn((
        Sprite {
            image: tex.circle32.clone(),
            color: Color::srgba(1.0, 0.95, 0.7, 0.9),
            custom_size: Some(Vec2::splat(110.0)),
            ..default()
        },
        Transform::from_xyz(-WIDTH / 2.0 + 180.0, HEIGHT / 2.0 - 130.0, 0.1),
    ));
    commands.insert_resource(tex);
}

/// Repaint the terrain texture from the client terrain copy when carved.
pub fn repaint_terrain(
    mut ct: ResMut<ClientTerrain>,
    tex: Res<Textures>,
    mut images: ResMut<Assets<Image>>,
) {
    if !ct.dirty {
        return;
    }
    let Some(t) = ct.terrain.as_ref() else { return };
    let Some(img) = images.get_mut(&tex.terrain) else {
        return;
    };
    let Some(data) = img.data.as_mut() else { return };
    let seed = t.seed;
    for gy in 0..GRID_H {
        for gx in 0..GRID_W {
            let i = gy * GRID_W + gx;
            let o = i * 4;
            if !t.solid[i] {
                data[o..o + 4].copy_from_slice(&[0, 0, 0, 0]);
                continue;
            }
            // grass if there is air within 3 cells above
            let mut grass = false;
            for k in 1..=3 {
                if gy >= k && !t.solid[(gy - k) * GRID_W + gx] {
                    grass = true;
                    break;
                }
            }
            let n = hash2(gx as i32, gy as i32, seed) * 0.12;
            let depth = (-t.sdf[i] / 160.0).clamp(0.0, 0.45);
            let edge = t.sdf[i] > -3.0;
            let (r, g, b) = if grass {
                (0.30 - n * 0.3, 0.62 - depth * 0.3 - n, 0.24)
            } else if edge {
                (0.30, 0.21, 0.13)
            } else {
                (
                    0.45 - depth * 0.35 - n,
                    0.32 - depth * 0.25 - n * 0.8,
                    0.20 - depth * 0.15,
                )
            };
            data[o] = (r.clamp(0.02, 1.0) * 255.0) as u8;
            data[o + 1] = (g.clamp(0.02, 1.0) * 255.0) as u8;
            data[o + 2] = (b.clamp(0.02, 1.0) * 255.0) as u8;
            data[o + 3] = 255;
        }
    }
    ct.dirty = false;
}

fn lerp_frog(a: &FrogSnap, b: &FrogSnap, t: f32) -> sim::Vec2 {
    if a.pos.distance(b.pos) > 250.0 {
        return b.pos; // teleport (respawn): don't sweep across the map
    }
    a.pos.lerp(b.pos, t)
}

#[derive(Resource, Default)]
pub struct VisIndex {
    pub frogs: HashMap<u8, Entity>,
    pub crates: HashMap<u16, Entity>,
    pub projs: HashMap<u16, Entity>,
}

#[allow(clippy::too_many_arguments)]
pub fn sync_world(
    mut commands: Commands,
    time: Res<Time>,
    net: Res<NetState>,
    tex: Res<Textures>,
    mut vis: ResMut<VisIndex>,
    mut frog_q: Query<(&FrogVis, &mut Transform, &mut Visibility, &mut Sprite)>,
    mut crate_q: Query<(&CrateVis, &mut Transform), (Without<FrogVis>, Without<ProjVis>)>,
    mut proj_q: Query<
        (&ProjVis, &mut Transform, &mut Sprite),
        (Without<FrogVis>, Without<CrateVis>),
    >,
    mut tags: ParamSet<(
        Query<
            (&ChildOf, &mut Transform, &mut Visibility),
            (With<AimReticle>, Without<FrogVis>, Without<CrateVis>, Without<ProjVis>),
        >,
        Query<
            (&ChildOf, &mut Transform, &mut Visibility, &mut Sprite),
            (With<ChargeBar>, Without<FrogVis>, Without<CrateVis>, Without<ProjVis>),
        >,
        Query<
            (&ChildOf, &mut Transform, &Pupil),
            (Without<FrogVis>, Without<CrateVis>, Without<ProjVis>),
        >,
        Query<(&ChildOf, &mut Text2d, &mut TextColor), With<HpTag>>,
        Query<(&ChildOf, &mut Text2d), With<NameTag>>,
    )>,
) {
    let Some((prev, next, alpha)) = net.frame() else {
        return;
    };
    let my_id = net.my_id;

    // --- frogs ---
    for fb in &next.frogs {
        let fa = prev.frogs.iter().find(|f| f.id == fb.id).unwrap_or(fb);
        let pos = lerp_frog(fa, fb, alpha);
        let team = net
            .roster
            .iter()
            .find(|p| p.id == fb.id)
            .map(|p| p.team)
            .unwrap_or(0);
        let entity = *vis.frogs.entry(fb.id).or_insert_with(|| {
            spawn_frog(&mut commands, &tex, fb.id, my_id == Some(fb.id), team)
        });
        if let Ok((_, mut tr, mut vis_, mut sprite)) = frog_q.get_mut(entity) {
            tr.translation = w2b(pos, 10.0);
            // velocity stretch: only at swing speeds (well above jump speed,
            // so a plain hop never tips the frog) and eased over time so the
            // pose never snaps.
            let speed = fb.vel.length();
            let dir = Vec2::new(fb.vel.x, -fb.vel.y).normalize_or_zero();
            let (target_rot, target_scale) = if speed > 430.0 && dir != Vec2::ZERO {
                let s = 1.0 + (speed / 2400.0).min(0.22);
                (
                    Quat::from_rotation_z(dir.y.atan2(dir.x)),
                    Vec3::new(s, 1.0 / s, 1.0),
                )
            } else {
                (Quat::IDENTITY, Vec3::ONE)
            };
            let ease = 1.0 - (-12.0 * time.delta_secs()).exp();
            tr.rotation = tr.rotation.slerp(target_rot, ease);
            tr.scale = tr.scale.lerp(target_scale, ease);
            *vis_ = if fb.alive {
                Visibility::Inherited
            } else {
                Visibility::Hidden
            };
            // flash white-red shortly after damage
            let base = team_color(team);
            sprite.color = if fb.hp < 35.0 {
                base.mix(&Color::srgb(0.9, 0.2, 0.15), 0.35)
            } else {
                base
            };
        }
        // children: aim reticle / charge bar / pupils / hp / name
        for (childof, mut tr, mut v) in tags.p0().iter_mut() {
            if childof.parent() != entity {
                continue;
            }
            let aim = Vec2::new(fb.aim.x, -fb.aim.y);
            tr.translation = (aim * 44.0).extend(0.5);
            *v = if fb.alive && my_id == Some(fb.id) {
                Visibility::Inherited
            } else {
                Visibility::Hidden
            };
        }
        for (childof, mut tr, mut v, mut sp) in tags.p1().iter_mut() {
            if childof.parent() != entity {
                continue;
            }
            match fb.charge {
                Some(c) if fb.alive => {
                    *v = Visibility::Inherited;
                    sp.custom_size = Some(Vec2::new(30.0 * c, 4.0));
                    sp.color = Color::srgb(1.0, 1.0 - c * 0.8, 0.2);
                    tr.translation = Vec3::new(-15.0 + 15.0 * c, 24.0, 0.6);
                }
                _ => *v = Visibility::Hidden,
            }
        }
        for (childof, mut tr, pupil) in tags.p2().iter_mut() {
            if childof.parent() != entity {
                continue;
            }
            let aim = Vec2::new(fb.aim.x, -fb.aim.y);
            tr.translation = Vec3::new(pupil.side * 5.0 + aim.x * 2.5, 6.0 + aim.y * 2.5, 0.3);
        }
        for (childof, mut text, mut color) in tags.p3().iter_mut() {
            if childof.parent() != entity {
                continue;
            }
            let hp = fb.hp.max(0.0).round() as i32;
            let new = format!("{hp}");
            if text.0 != new {
                text.0 = new;
            }
            color.0 = if fb.hp > 60.0 {
                Color::WHITE
            } else if fb.hp > 30.0 {
                Color::srgb(1.0, 0.85, 0.3)
            } else {
                Color::srgb(1.0, 0.35, 0.3)
            };
        }
        for (childof, mut text) in tags.p4().iter_mut() {
            if childof.parent() != entity {
                continue;
            }
            let name = net
                .roster
                .iter()
                .find(|p| p.id == fb.id)
                .map(|p| p.name.as_str())
                .unwrap_or("frog");
            if text.0 != name {
                text.0 = name.to_string();
            }
        }
    }
    // despawn frogs that left
    vis.frogs.retain(|id, e| {
        if next.frogs.iter().any(|f| f.id == *id) {
            true
        } else {
            commands.entity(*e).despawn();
            false
        }
    });

    // --- crates ---
    for c in &next.crates {
        let ca = prev
            .crates
            .iter()
            .find(|x| x.id == c.id)
            .map(|x| x.pos)
            .unwrap_or(c.pos);
        let pos = ca.lerp(c.pos, alpha);
        let e = *vis.crates.entry(c.id).or_insert_with(|| {
            commands
                .spawn((
                    Sprite {
                        image: tex.crate_box.clone(),
                        custom_size: Some(Vec2::splat(24.0)),
                        ..default()
                    },
                    Transform::from_translation(w2b(c.pos, 9.0)),
                    CrateVis { id: c.id },
                ))
                .id()
        });
        if let Ok((_, mut tr)) = crate_q.get_mut(e) {
            tr.translation = w2b(pos, 9.0);
        }
    }
    vis.crates.retain(|id, e| {
        if next.crates.iter().any(|c| c.id == *id) {
            true
        } else {
            commands.entity(*e).despawn();
            false
        }
    });

    // --- projectiles ---
    for p in &next.projectiles {
        let pa = prev
            .projectiles
            .iter()
            .find(|x| x.id == p.id)
            .map(|x| x.pos)
            .unwrap_or(p.pos);
        let pos = pa.lerp(p.pos, alpha);
        let e = *vis.projs.entry(p.id).or_insert_with(|| {
            let (size, color) = match p.kind {
                Weapon::Bazooka => (Vec2::new(16.0, 7.0), Color::srgb(0.25, 0.25, 0.3)),
                Weapon::Grenade => (Vec2::splat(11.0), Color::srgb(0.2, 0.45, 0.2)),
                Weapon::Mine => (Vec2::splat(13.0), Color::srgb(0.25, 0.25, 0.28)),
            };
            commands
                .spawn((
                    Sprite {
                        image: tex.circle32.clone(),
                        color,
                        custom_size: Some(size),
                        ..default()
                    },
                    Transform::from_translation(w2b(p.pos, 11.0)),
                    ProjVis {
                        id: p.id,
                        kind: p.kind,
                    },
                ))
                .id()
        });
        if let Ok((pv, mut tr, mut sp)) = proj_q.get_mut(e) {
            tr.translation = w2b(pos, 11.0);
            if pv.kind == Weapon::Bazooka {
                let d = Vec2::new(p.vel.x, -p.vel.y);
                if d != Vec2::ZERO {
                    tr.rotation = Quat::from_rotation_z(d.y.atan2(d.x));
                }
            }
            if pv.kind == Weapon::Mine && p.triggered {
                sp.color = Color::srgb(0.9, 0.2, 0.15);
            }
        }
    }
    vis.projs.retain(|id, e| {
        if next.projectiles.iter().any(|p| p.id == *id) {
            true
        } else {
            commands.entity(*e).despawn();
            false
        }
    });
}

fn spawn_frog(
    commands: &mut Commands,
    tex: &Textures,
    id: u8,
    is_me: bool,
    team: u8,
) -> Entity {
    let color = team_color(team);
    commands
        .spawn((
            Sprite {
                image: tex.circle32.clone(),
                color,
                custom_size: Some(Vec2::splat(FROG_R * 2.0)),
                ..default()
            },
            Transform::default(),
            Visibility::default(),
            FrogVis { id },
        ))
        .with_children(|p| {
            // eyes
            for side in [-1.0f32, 1.0] {
                p.spawn((
                    Sprite {
                        image: tex.circle8.clone(),
                        color: Color::WHITE,
                        custom_size: Some(Vec2::splat(9.0)),
                        ..default()
                    },
                    Transform::from_xyz(side * 5.0, 6.0, 0.2),
                ));
                p.spawn((
                    Sprite {
                        image: tex.circle8.clone(),
                        color: Color::srgb(0.08, 0.08, 0.1),
                        custom_size: Some(Vec2::splat(4.5)),
                        ..default()
                    },
                    Transform::from_xyz(side * 5.0, 6.0, 0.3),
                    Pupil { side },
                ));
            }
            p.spawn((
                Text2d::new("frog"),
                TextFont::from_font_size(13.0),
                TextColor(color),
                Transform::from_xyz(0.0, 36.0, 0.5),
                NameTag,
            ));
            p.spawn((
                Text2d::new("100"),
                TextFont::from_font_size(12.0),
                TextColor(Color::WHITE),
                Transform::from_xyz(0.0, 22.0, 0.5),
                HpTag,
            ));
            p.spawn((
                Sprite {
                    image: tex.circle8.clone(),
                    color: Color::srgba(1.0, 1.0, 1.0, 0.85),
                    custom_size: Some(Vec2::splat(7.0)),
                    ..default()
                },
                Transform::from_xyz(44.0, 0.0, 0.5),
                Visibility::Hidden,
                AimReticle,
            ));
            p.spawn((
                Sprite {
                    image: tex.pixel.clone(),
                    color: Color::srgb(1.0, 0.9, 0.2),
                    custom_size: Some(Vec2::new(0.0, 4.0)),
                    ..default()
                },
                Transform::from_xyz(0.0, 24.0, 0.6),
                Visibility::Hidden,
                ChargeBar,
            ));
            let _ = is_me;
        })
        .id()
}

/// Tongue/rope rendering with gizmo polylines.
pub fn draw_ropes(net: Res<NetState>, mut gizmos: Gizmos) {
    let Some((_, next, _)) = net.frame() else {
        return;
    };
    for f in &next.frogs {
        if !f.alive {
            continue;
        }
        if let Some(anchors) = &f.rope {
            let mut pts: Vec<Vec3> = anchors.iter().map(|a| w2b(*a, 12.0)).collect();
            pts.push(w2b(f.pos, 12.0));
            for w in pts.windows(2) {
                gizmos.line_2d(
                    w[0].truncate(),
                    w[1].truncate(),
                    Color::srgb(0.98, 0.45, 0.5),
                );
            }
            // tongue tip blob
            gizmos.circle_2d(pts[0].truncate(), 3.0, Color::srgb(0.98, 0.45, 0.5));
        }
    }
}

/// Spawn visual effects from sim events.
pub fn spawn_fx(mut commands: Commands, net: Res<NetState>, tex: Res<Textures>) {
    for ev in &net.events {
        match ev {
            SimEvent::Explosion { pos, radius } => {
                commands.spawn((
                    Sprite {
                        image: tex.circle32.clone(),
                        color: Color::srgba(1.0, 0.75, 0.3, 0.9),
                        custom_size: Some(Vec2::splat(radius * 1.6)),
                        ..default()
                    },
                    Transform::from_translation(w2b(*pos, 20.0)),
                    Fx {
                        age: 0.0,
                        life: 0.28,
                        grow: 1.5,
                    },
                ));
                commands.spawn((
                    Sprite {
                        image: tex.ring.clone(),
                        color: Color::srgba(1.0, 1.0, 1.0, 0.9),
                        custom_size: Some(Vec2::splat(radius * 1.2)),
                        ..default()
                    },
                    Transform::from_translation(w2b(*pos, 20.1)),
                    Fx {
                        age: 0.0,
                        life: 0.45,
                        grow: 2.6,
                    },
                ));
            }
            SimEvent::TongueAttach { pos } => {
                commands.spawn((
                    Sprite {
                        image: tex.ring.clone(),
                        color: Color::srgba(1.0, 1.0, 1.0, 0.8),
                        custom_size: Some(Vec2::splat(10.0)),
                        ..default()
                    },
                    Transform::from_translation(w2b(*pos, 20.0)),
                    Fx {
                        age: 0.0,
                        life: 0.25,
                        grow: 2.0,
                    },
                ));
            }
            SimEvent::Splash { pos } => {
                commands.spawn((
                    Sprite {
                        image: tex.circle32.clone(),
                        color: Color::srgba(0.6, 0.8, 1.0, 0.8),
                        custom_size: Some(Vec2::new(30.0, 10.0)),
                        ..default()
                    },
                    Transform::from_translation(w2b(
                        sim::v2(pos.x, WATER_Y),
                        20.0,
                    )),
                    Fx {
                        age: 0.0,
                        life: 0.4,
                        grow: 1.8,
                    },
                ));
            }
            _ => {}
        }
    }
}

pub fn update_fx(
    mut commands: Commands,
    time: Res<Time>,
    mut q: Query<(Entity, &mut Fx, &mut Sprite, &mut Transform)>,
) {
    for (e, mut fx, mut sp, mut tr) in &mut q {
        fx.age += time.delta_secs();
        let t = (fx.age / fx.life).min(1.0);
        let scale = 1.0 + (fx.grow - 1.0) * t;
        tr.scale = Vec3::splat(scale);
        sp.color = sp.color.with_alpha((1.0 - t) * 0.9);
        if t >= 1.0 {
            commands.entity(e).despawn();
        }
    }
}

#[derive(Resource)]
pub struct CamCtl {
    pub zoom: f32,
}
impl Default for CamCtl {
    fn default() -> Self {
        CamCtl { zoom: 0.8 }
    }
}

pub fn camera_follow(
    time: Res<Time>,
    net: Res<NetState>,
    keys: Res<ButtonInput<KeyCode>>,
    mut ctl: ResMut<CamCtl>,
    mut q: Query<(&mut Transform, &mut Projection), With<Camera2d>>,
) {
    if keys.pressed(KeyCode::Equal) {
        ctl.zoom *= 1.0 - time.delta_secs() * 1.5;
    }
    if keys.pressed(KeyCode::Minus) {
        ctl.zoom *= 1.0 + time.delta_secs() * 1.5;
    }
    ctl.zoom = ctl.zoom.clamp(0.4, 1.25);
    let Ok((mut tr, mut proj)) = q.single_mut() else {
        return;
    };
    if let Projection::Orthographic(o) = &mut *proj {
        o.scale += (ctl.zoom - o.scale) * (time.delta_secs() * 6.0).min(1.0);
    }
    let target = net
        .frame()
        .and_then(|(_, next, _)| {
            net.my_id
                .and_then(|id| next.frogs.iter().find(|f| f.id == id))
                .filter(|f| f.alive)
                .map(|f| w2b(f.pos, 0.0))
        })
        .unwrap_or(Vec3::ZERO);
    let k = (time.delta_secs() * 5.0).min(1.0);
    tr.translation.x += (target.x - tr.translation.x) * k;
    tr.translation.y += (target.y + 30.0 - tr.translation.y) * k;
    // soft clamp to world
    tr.translation.x = tr.translation.x.clamp(-WIDTH * 0.45, WIDTH * 0.45);
    tr.translation.y = tr.translation.y.clamp(-HEIGHT * 0.48, HEIGHT * 0.48);
}
