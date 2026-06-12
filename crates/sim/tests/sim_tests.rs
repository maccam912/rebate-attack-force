use sim::game::*;
use sim::math::{v2, Vec2};
use sim::terrain::{Terrain, GRID_H, GRID_W, WATER_Y, WIDTH};

const SEED: u64 = 42;

fn round_sim(players: usize) -> (Sim, Vec<u8>) {
    let mut s = Sim::new(SEED);
    let ids = (0..players).map(|_| s.add_player()).collect();
    s.start_round();
    // settle everyone onto the ground
    for _ in 0..240 {
        s.step();
        s.phase_t = 0.0; // freeze the round clock for tests
    }
    s.events.clear();
    (s, ids)
}

fn step_frozen(s: &mut Sim, n: usize) {
    for _ in 0..n {
        s.step();
        s.phase_t = 0.0;
    }
}

fn input(buttons: u8, aim: Vec2) -> Input {
    Input {
        buttons,
        aim,
        sel: 0,
    }
}

/// Teleport a frog to the first spawn point matching `pred`, then settle it.
fn place_at_spawn(s: &mut Sim, id: u8, pred: impl Fn(&Sim, Vec2) -> bool) -> Vec2 {
    let spawns = s.terrain.spawn_points();
    let spot = *spawns
        .iter()
        .find(|p| pred(s, **p))
        .unwrap_or_else(|| panic!("no spawn point matches predicate"));
    let f = s.frogs.iter_mut().find(|f| f.id == id).unwrap();
    f.pos = spot;
    f.vel = Vec2::ZERO;
    step_frozen(s, 120);
    s.events.clear();
    spot
}

// ---------- terrain ----------

#[test]
fn terrain_is_deterministic() {
    let a = Terrain::generate(SEED);
    let b = Terrain::generate(SEED);
    assert_eq!(a.solid, b.solid);
    assert_eq!(a.spawn_points(), b.spawn_points());
    let solid_count = a.solid.iter().filter(|s| **s).count();
    assert!(solid_count > GRID_W * GRID_H / 20, "has terrain");
    assert!(solid_count < GRID_W * GRID_H * 9 / 10, "has air");
}

#[test]
fn terrain_carve_opens_ground() {
    let mut t = Terrain::generate(SEED);
    // find a solid spot
    let mut p = None;
    'outer: for gy in 0..GRID_H {
        for gx in 0..GRID_W {
            if t.solid[gy * GRID_W + gx] {
                let c = v2(gx as f32 * 2.0, gy as f32 * 2.0);
                if t.sample(c) < -10.0 {
                    p = Some(c);
                    break 'outer;
                }
            }
        }
    }
    let p = p.expect("found deep solid point");
    assert!(t.is_solid_at(p));
    assert!(t.carve(p, 40.0));
    assert!(!t.is_solid_at(p));
    assert!(t.sample(p) > 5.0);
}

#[test]
fn terrain_raycast_hits_ground() {
    let t = Terrain::generate(SEED);
    let spawn = t.spawn_points()[0];
    let down = t.raycast(spawn, v2(0.0, 1.0), 600.0);
    assert!(down.is_some(), "ray down from spawn hits ground");
    let up = t.raycast(v2(spawn.x, 10.0), v2(0.0, -1.0), 200.0);
    assert!(up.is_none(), "ray up from the sky hits nothing");
}

#[test]
fn spawn_points_are_in_bounds_and_dry() {
    let t = Terrain::generate(SEED);
    let pts = t.spawn_points();
    assert!(pts.len() >= 3, "enough spawn points: {}", pts.len());
    for p in pts {
        assert!(p.x > 0.0 && p.x < WIDTH);
        assert!(p.y < WATER_Y - 30.0, "spawn above water: {:?}", p);
    }
}

// ---------- frog movement ----------

#[test]
fn frog_settles_on_ground() {
    let (s, ids) = round_sim(1);
    let f = s.frog(ids[0]).unwrap();
    assert!(f.alive);
    assert!(f.grounded, "frog should be standing");
    assert!(f.vel.length() < 30.0, "frog at rest, vel={:?}", f.vel);
    assert!(f.pos.y < WATER_Y);
}

#[test]
fn frog_walks() {
    let (mut s, ids) = round_sim(1);
    let x0 = s.frog(ids[0]).unwrap().pos.x;
    // random terrain can block one direction; either must work
    s.set_input(ids[0], input(BTN_RIGHT, v2(1.0, 0.0)));
    step_frozen(&mut s, 240);
    let moved_right = (s.frog(ids[0]).unwrap().pos.x - x0).abs();
    s.set_input(ids[0], input(BTN_LEFT, v2(-1.0, 0.0)));
    step_frozen(&mut s, 240);
    let x2 = s.frog(ids[0]).unwrap().pos.x;
    let moved = moved_right.max((x2 - x0).abs());
    assert!(moved > 40.0, "frog should walk somewhere, moved {moved}");
}

#[test]
fn frog_jumps() {
    let (mut s, ids) = round_sim(1);
    // jump somewhere with clear headroom so we measure the full arc
    place_at_spawn(&mut s, ids[0], |s, p| {
        s.terrain.raycast(p, v2(0.0, -1.0), 120.0).is_none()
    });
    let y0 = s.frog(ids[0]).unwrap().pos.y;
    s.set_input(ids[0], input(BTN_JUMP, v2(1.0, 0.0)));
    let mut min_y = y0;
    for _ in 0..40 {
        s.step();
        s.phase_t = 0.0;
        min_y = min_y.min(s.frog(ids[0]).unwrap().pos.y);
    }
    assert!(y0 - min_y > 20.0, "jump should rise, rose {}", y0 - min_y);
    assert!(s
        .events
        .iter()
        .any(|e| matches!(e, Event::Jump { .. })));
}

fn find_rope_aim(s: &Sim, pos: Vec2) -> Option<Vec2> {
    for i in 0..48 {
        let a = std::f32::consts::TAU * i as f32 / 48.0;
        let dir = v2(a.cos(), a.sin());
        if dir.y > 0.3 {
            continue; // not straight down at our own ground
        }
        if let Some(hit) = s.terrain.raycast(pos + dir * (FROG_R + 1.0), dir, ROPE_RANGE * 0.9) {
            if hit.distance(pos) > 50.0 {
                return Some(dir);
            }
        }
    }
    None
}

#[test]
fn tongue_attaches_swings_and_releases() {
    let (mut s, ids) = round_sim(1);
    let id = ids[0];
    let spot = place_at_spawn(&mut s, id, |s, p| find_rope_aim(s, p).is_some());
    let aim = find_rope_aim(&s, spot).expect("anchor reachable from chosen spawn");
    s.set_input(id, input(BTN_TONGUE, aim));
    step_frozen(&mut s, 2);
    assert!(s.frog(id).unwrap().rope.is_some(), "tongue attached");
    assert!(s
        .events
        .iter()
        .any(|e| matches!(e, Event::TongueAttach { .. })));
    // swing for a second; reel up too
    s.set_input(id, input(BTN_TONGUE | BTN_RIGHT | BTN_UP, aim));
    step_frozen(&mut s, 120);
    let f = s.frog(id).unwrap();
    assert!(f.rope.is_some());
    let len_after = f.rope.as_ref().unwrap().length;
    // release
    s.set_input(id, input(0, aim));
    step_frozen(&mut s, 1);
    assert!(s.frog(id).unwrap().rope.is_none(), "rope released");
    assert!(len_after < ROPE_RANGE);
}

#[test]
fn jump_hops_forward_and_double_tap_backflips() {
    let (mut s, ids) = round_sim(1);
    let id = ids[0];
    // Find a spawn where the frog settles on flat ground with headroom, so
    // the hop impulse isn't slope-tilted (frogs can slide off their spawn).
    let mut placed = false;
    for sp in s.terrain.spawn_points() {
        {
            let f = s.frogs.iter_mut().find(|f| f.id == id).unwrap();
            f.pos = sp;
            f.vel = Vec2::ZERO;
        }
        step_frozen(&mut s, 120);
        let f = s.frog(id).unwrap();
        if f.grounded
            && f.ground_normal.y < -0.95
            && s.terrain.raycast(f.pos, v2(0.0, -1.0), 160.0).is_none()
        {
            placed = true;
            break;
        }
    }
    assert!(placed, "found a flat spawn with headroom");
    s.events.clear();
    let p0 = s.frog(id).unwrap().pos;
    let facing = s.frog(id).unwrap().facing;

    // single tap: shallow hop forward in the facing direction
    s.set_input(id, input(BTN_JUMP, v2(facing, 0.0)));
    step_frozen(&mut s, 2);
    let v = s.frog(id).unwrap().vel;
    assert!(v.y < 0.0, "hop rises");
    assert!(
        v.x * facing > 0.0 && v.x.abs() > v.y.abs() * 0.5,
        "hop is shallow and forward, vel={v:?}"
    );

    // second tap inside the window: converted into a backflip
    s.set_input(id, input(0, v2(facing, 0.0)));
    step_frozen(&mut s, 3);
    s.set_input(id, input(BTN_JUMP, v2(facing, 0.0)));
    step_frozen(&mut s, 1);
    let f = s.frog(id).unwrap();
    assert!(f.jump_t == 0.0, "backflip consumed the window");
    let v = f.vel;
    assert!(
        v.x * facing < 0.0 && -v.y > v.x.abs() * 2.0,
        "backflip goes mostly up, slightly back, vel={v:?}"
    );
    // it should rise clearly higher than where it started
    let mut min_y = p0.y;
    for _ in 0..60 {
        s.step();
        s.phase_t = 0.0;
        min_y = min_y.min(s.frog(id).unwrap().pos.y);
    }
    assert!(p0.y - min_y > 50.0, "backflip rose {}", p0.y - min_y);
}

#[test]
fn rope_fold_holds_until_frog_swings_back() {
    let (mut s, ids) = round_sim(1);
    let id = ids[0];
    let p = place_at_spawn(&mut s, id, |s, p| {
        s.terrain.raycast(p, v2(0.0, -1.0), 160.0).is_none()
    });
    let a1 = p + v2(0.0, -80.0); // fold pivot straight above the frog
    let a0 = a1 + v2(-60.0, 0.0); // original anchor, off to the side
    let wind = (a1 - a0).cross(p - a1).signum();
    {
        let f = s.frogs.iter_mut().find(|f| f.id == id).unwrap();
        f.rope = Some(Rope {
            anchors: vec![a0, a1],
            winds: vec![wind],
            length: 200.0,
        });
        f.vel = Vec2::ZERO;
    }
    s.set_input(id, input(BTN_TONGUE, v2(0.0, -1.0)));
    step_frozen(&mut s, 1);
    // The frog has a clear line of sight to a0, but it hasn't swung back
    // past the fold — the rope must stay hung up on it.
    let f = s.frog(id).unwrap();
    assert_eq!(f.rope.as_ref().unwrap().anchors.len(), 2, "fold held");
    // Move the frog across the a0→a1 line: now the fold unwinds.
    {
        let f = s.frogs.iter_mut().find(|f| f.id == id).unwrap();
        f.pos = a1 + v2(10.0, -30.0);
        f.vel = Vec2::ZERO;
    }
    step_frozen(&mut s, 1);
    let f = s.frog(id).unwrap();
    assert_eq!(f.rope.as_ref().unwrap().anchors.len(), 1, "fold unwound");
}

// ---------- rules ----------

#[test]
fn crate_pickup_stocks_team_inventory() {
    let (mut s, ids) = round_sim(1);
    let f = s.frog(ids[0]).unwrap();
    let team = f.team as usize;
    assert_eq!(s.inventory[team].iter().sum::<u8>(), 0);
    s.debug_drop_crate(f.pos);
    step_frozen(&mut s, 2);
    assert_eq!(s.inventory[team].iter().sum::<u8>(), 1);
    assert!(s
        .events
        .iter()
        .any(|e| matches!(e, Event::CratePickup { .. })));
}

#[test]
fn firing_consumes_weapon_until_stash_is_empty() {
    let (mut s, ids) = round_sim(1);
    let id = ids[0];
    let team = s.frog(id).unwrap().team as usize;
    s.debug_drop_crate(s.frog(id).unwrap().pos);
    step_frozen(&mut s, 2);
    // find which weapon we got
    let widx = (0..NUM_WEAPONS)
        .find(|w| s.inventory[team][*w] > 0)
        .unwrap() as u8;
    let aim = v2(0.0, -1.0); // fire straight up into open sky
    s.set_input(
        id,
        Input {
            buttons: BTN_FIRE,
            aim,
            sel: widx,
        },
    );
    step_frozen(&mut s, 30); // charge a bit
    s.set_input(
        id,
        Input {
            buttons: 0,
            aim,
            sel: widx,
        },
    );
    step_frozen(&mut s, 2);
    assert_eq!(s.projectiles.len(), 1, "projectile spawned");
    assert_eq!(s.inventory[team][widx as usize], 0, "weapon consumed");
    // owner grace: it must not have detonated on the shooter immediately
    assert!(s
        .events
        .iter()
        .all(|e| !matches!(e, Event::Explosion { .. })));
    // try to fire again with an empty stash: nothing happens
    s.set_input(
        id,
        Input {
            buttons: BTN_FIRE,
            aim,
            sel: widx,
        },
    );
    step_frozen(&mut s, 10);
    s.set_input(
        id,
        Input {
            buttons: 0,
            aim,
            sel: widx,
        },
    );
    step_frozen(&mut s, 2);
    assert_eq!(s.projectiles.len(), 1, "no second shot from an empty stash");
}

#[test]
fn leftover_stash_fires_next_round_without_a_crate() {
    let (mut s, ids) = round_sim(1);
    let id = ids[0];
    let team = s.frog(id).unwrap().team as usize;
    // stock a weapon this round but don't use it
    s.debug_drop_crate(s.frog(id).unwrap().pos);
    step_frozen(&mut s, 2);
    let widx = (0..NUM_WEAPONS)
        .find(|w| s.inventory[team][*w] > 0)
        .unwrap() as u8;
    // round end → break → pre → next round
    s.phase_t = ROUND_TIME + 1.0;
    s.step();
    s.phase_t = BREAK_TIME + 1.0;
    s.step();
    s.phase_t = PRE_TIME + 1.0;
    s.step();
    assert_eq!(s.phase, Phase::Round);
    assert_eq!(s.inventory[team][widx as usize], 1, "stash persisted");
    step_frozen(&mut s, 120); // settle on the ground
    // fire straight away — no crate picked up this round
    let aim = v2(0.0, -1.0);
    s.set_input(
        id,
        Input {
            buttons: BTN_FIRE,
            aim,
            sel: widx,
        },
    );
    step_frozen(&mut s, 30);
    s.set_input(
        id,
        Input {
            buttons: 0,
            aim,
            sel: widx,
        },
    );
    step_frozen(&mut s, 2);
    assert_eq!(s.projectiles.len(), 1, "fired from leftover stash");
    assert_eq!(s.inventory[team][widx as usize], 0);
}

#[test]
fn cannot_fire_with_empty_stash() {
    let (mut s, ids) = round_sim(1);
    let id = ids[0];
    s.set_input(id, input(BTN_FIRE, v2(0.0, -1.0)));
    step_frozen(&mut s, 20);
    s.set_input(id, input(0, v2(0.0, -1.0)));
    step_frozen(&mut s, 2);
    assert!(s.projectiles.is_empty());
}

#[test]
fn explosion_carves_damages_and_scores_enemy_kill() {
    let (mut s, ids) = round_sim(2);
    let (a, b) = (ids[0], ids[1]);
    let (ta, tb) = (s.frog(a).unwrap().team, s.frog(b).unwrap().team);
    assert_ne!(ta, tb, "two players land on different teams");
    let bpos = s.frog(b).unwrap().pos;
    // boom until dead (3 should do it)
    for _ in 0..4 {
        let bpos = s.frog(b).unwrap().pos;
        s.debug_explode(bpos, Weapon::Grenade, a);
        step_frozen(&mut s, 1);
        if !s.frog(b).unwrap().alive {
            break;
        }
    }
    assert!(!s.frog(b).unwrap().alive, "victim died");
    assert_eq!(s.scores[ta as usize], 1, "killer team scored");
    assert_eq!(s.scores[tb as usize], 0);
    assert!(!s.terrain.is_solid_at(bpos) || s.terrain.sample(bpos) > 0.0);
    assert!(s
        .events
        .iter()
        .any(|e| matches!(e, Event::Death { cause: DeathCause::Explosion, .. })));
}

#[test]
fn friendly_fire_scores_nothing() {
    let mut s = Sim::new(SEED);
    let a = s.add_player();
    let _b = s.add_player();
    let c = s.add_player(); // same team as a
    s.start_round();
    step_frozen(&mut s, 240);
    assert_eq!(s.frog(a).unwrap().team, s.frog(c).unwrap().team);
    for _ in 0..6 {
        let cpos = s.frog(c).unwrap().pos;
        s.debug_explode(cpos, Weapon::Grenade, a);
        step_frozen(&mut s, 1);
        if !s.frog(c).unwrap().alive {
            break;
        }
    }
    assert!(!s.frog(c).unwrap().alive);
    assert_eq!(s.scores, [0, 0], "no score for friendly fire");
}

#[test]
fn falling_off_the_island_side_drowns() {
    let (mut s, ids) = round_sim(1);
    let id = ids[0];
    {
        let f = s.frogs.iter_mut().find(|f| f.id == id).unwrap();
        // off the west end of the island, in open air: nothing but water below
        f.pos = v2(20.0, 300.0);
        f.vel = v2(-40.0, 0.0);
        f.rope = None;
    }
    step_frozen(&mut s, 600); // 5 s of falling
    assert!(!s.frog(id).unwrap().alive, "fell past the side into the sea");
    assert!(s
        .events
        .iter()
        .any(|e| matches!(e, Event::Death { cause: DeathCause::Drown, .. })));
}

#[test]
fn hard_landing_damages_and_says_ouch() {
    let (mut s, ids) = round_sim(1);
    let id = ids[0];
    {
        let f = s.frogs.iter_mut().find(|f| f.id == id).unwrap();
        // slam straight down into the ground it was standing on
        f.pos.y -= 6.0;
        f.vel = v2(0.0, 900.0);
    }
    step_frozen(&mut s, 10);
    let f = s.frog(id).unwrap();
    assert!(f.hp < 100.0, "fall damage applied, hp {}", f.hp);
    assert!(s.events.iter().any(|e| matches!(e, Event::Ouch { .. })));
}

#[test]
fn water_drowns() {
    let (mut s, ids) = round_sim(1);
    let id = ids[0];
    if let Some(f) = s.frogs.iter_mut().find(|f| f.id == id) {
        f.pos = v2(WIDTH / 2.0, WATER_Y + 10.0);
    }
    step_frozen(&mut s, 2);
    assert!(!s.frog(id).unwrap().alive);
    assert!(s
        .events
        .iter()
        .any(|e| matches!(e, Event::Death { cause: DeathCause::Drown, .. })));
}

#[test]
fn full_match_to_ten_kills_and_reset() {
    let (mut s, ids) = round_sim(2);
    let (a, b) = (ids[0], ids[1]);
    let ta = s.frog(a).unwrap().team;
    for kill in 1..=KILLS_TO_WIN {
        assert_eq!(s.phase, Phase::Round, "round active before kill {kill}");
        for _ in 0..6 {
            let bpos = s.frog(b).unwrap().pos;
            s.debug_explode(bpos, Weapon::Grenade, a);
            s.step();
            if !s.frog(b).unwrap().alive {
                break;
            }
        }
        assert!(!s.frog(b).unwrap().alive);
        assert_eq!(s.scores[ta as usize], kill);
        if kill == KILLS_TO_WIN {
            break;
        }
        // fast-forward: round end → break → pre → next round (respawns victim)
        s.phase_t = ROUND_TIME + 1.0;
        s.step();
        assert_eq!(s.phase, Phase::Break);
        s.phase_t = BREAK_TIME + 1.0;
        s.step();
        assert_eq!(s.phase, Phase::Pre);
        s.phase_t = PRE_TIME + 1.0;
        s.step();
        assert_eq!(s.phase, Phase::Round);
        assert!(s.frog(b).unwrap().alive, "victim respawned");
        // settle and freeze clock
        step_frozen(&mut s, 120);
    }
    assert_eq!(s.phase, Phase::Ended { winner: ta });
    assert!(s
        .events
        .iter()
        .any(|e| matches!(e, Event::MatchEnd { .. })));
    // after the end screen everyone returns to the lobby, scores wiped
    s.phase_t = ENDED_TIME + 1.0;
    s.step();
    assert_eq!(s.scores, [0, 0]);
    assert_eq!(s.phase, Phase::Lobby);
    assert!(s.frogs.iter().all(|f| f.alive));
}

#[test]
fn lobby_gates_match_and_mode_select_reassigns_teams() {
    let mut s = Sim::new(SEED);
    assert_eq!(s.phase, Phase::Lobby);
    let a = s.add_player();
    let b = s.add_player();
    let c = s.add_player();
    // Teams (default): balanced two-team split
    let teams: Vec<u8> = s.frogs.iter().map(|f| f.team).collect();
    assert_eq!(teams, [0, 1, 0]);
    // the lobby never starts on its own
    for _ in 0..(5.0 / DT) as usize {
        s.step();
    }
    assert_eq!(s.phase, Phase::Lobby);
    // FFA: everyone gets their own team, scores/stash sized to match
    s.set_mode(Mode::Ffa);
    let teams: Vec<u8> = s.frogs.iter().map(|f| f.team).collect();
    assert_eq!(teams, [0, 1, 2]);
    assert_eq!(s.scores.len(), 3);
    assert_eq!(s.inventory.len(), 3);
    // a fourth joiner gets the next free team
    let d = s.add_player();
    assert_eq!(s.frog(d).unwrap().team, 3);
    // if someone leaves, their team slot is recycled for the next joiner
    s.remove_player(b);
    let e = s.add_player();
    assert_eq!(s.frog(e).unwrap().team, 1);
    // ready-up starts the match; mode is locked outside the lobby
    s.start_match();
    assert_eq!(s.phase, Phase::Pre);
    s.set_mode(Mode::Teams);
    assert_eq!(s.mode, Mode::Ffa);
    let _ = (a, c);
}

#[test]
fn crates_spawn_during_round() {
    let mut s = Sim::new(SEED);
    s.add_player();
    s.start_round();
    let mut saw_crate = false;
    for _ in 0..(8.0 / DT) as usize {
        s.step();
        s.phase_t = s.phase_t.min(1.0); // stay in round
        if !s.crates.is_empty() {
            saw_crate = true;
            break;
        }
    }
    assert!(saw_crate, "a crate spawned within 8 seconds");
}

// ---------- determinism ----------

#[test]
fn input_script_is_deterministic() {
    let run = || {
        let mut s = Sim::new(SEED);
        let a = s.add_player();
        let b = s.add_player();
        s.start_round();
        let mut hashes = Vec::new();
        for t in 0..900u32 {
            let phase = t / 90;
            let buttons_a = match phase % 5 {
                0 => BTN_RIGHT,
                1 => BTN_RIGHT | BTN_JUMP,
                2 => BTN_TONGUE | BTN_RIGHT,
                3 => BTN_TONGUE | BTN_UP,
                _ => BTN_LEFT,
            };
            let ang = t as f32 * 0.01;
            s.set_input(
                a,
                Input {
                    buttons: buttons_a,
                    aim: v2(ang.cos(), -ang.sin().abs()),
                    sel: 0,
                },
            );
            s.set_input(b, input(BTN_LEFT, v2(-1.0, -0.3)));
            s.step();
            if t % 100 == 0 {
                hashes.push(s.hash());
            }
        }
        hashes.push(s.hash());
        hashes
    };
    assert_eq!(run(), run(), "same seed + same inputs → same state");
}
