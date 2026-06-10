# Crate Before Attack: Technical and Mechanical Research Dossier

Research date: June 10, 2026  
Target game: [Crate Before Attack](https://cratebeforeattack.com/) by koalefant  
Purpose: document enough of the game's design and implementation to build an original game with closely comparable mechanics and feel.

## Scope, Method, and Confidence

This report combines:

1. Official descriptions and development posts.
2. The current public browser build and its JavaScript/WebAssembly interfaces.
3. The open-source `circle2d` physics library written for the game.
4. Public screenshots, videos, storefront metadata, and developer comments.
5. Static analysis of the publicly served `roper.wasm` binary.
6. Behavioral inference where source code is unavailable.

Claims are labeled:

- **Verified**: directly stated by the developer, present in official metadata, or plainly exposed by the public build.
- **Strong inference**: multiple implementation or behavioral signals agree.
- **Working hypothesis**: useful for reproduction, but not conclusively proven.

Static inspection is used to understand interfaces, mechanics, and architecture. Original art, audio, maps, and proprietary source should not be redistributed.

## Executive Summary

Crate Before Attack is a browser-based, 2D, turn-oriented multiplayer action game inspired by the Shopper family of Worms rope schemes. Frogs collect a crate, traverse terrain with a sticky tongue, attack, and then retreat before their turn ends. Its feel comes from a tightly coupled group of systems rather than one unusual parameter:

- A **120 Hz fixed-step simulation**.
- Circular dynamic bodies colliding against **signed-distance-field terrain**.
- An iterative impulse solver with friction, restitution, persistent contacts, rolling, sliding, and sleeping.
- A rope controller that deliberately preserves useful tangential energy.
- Explicit minimum bounce behavior and release-velocity correction.
- Continuous collision marching rather than simple overlap correction.
- Procedural posing driven by physics state.
- Numerous collision and attachment sound variants.
- Deterministic simulation and input replay for multiplayer.
- A high-contrast HUD that keeps timing, health, inventory, and active-player state visible.

The central lesson is that the rope is not an isolated grappling-hook feature. The terrain representation, character body, collision response, fixed timestep, animation, camera, sound, and networking are all designed around energetic circular motion.

## 1. Product Identity and Status

### Verified facts

- The developer/author is **koalefant**.
- The first public playable build was posted on May 3, 2020.
- The game remains labeled **in development** and **early access**.
- The official development log ends in October 2020, although the public build has a 2023 server timestamp and newer dependency fingerprints.
- It runs as an HTML5/WebAssembly game in desktop browsers.
- Keyboard and mouse are required.
- The itch.io page lists 1-8 players, local multiplayer, and server-based online multiplayer.
- Average session length is listed as about half an hour.
- The official site calls it a hybrid of real-time and turn-based play.

Primary sources:

- [Official homepage](https://cratebeforeattack.com/)
- [First public build](https://cratebeforeattack.com/posts/20200503-release-alpha-1/)
- [itch.io listing](https://koalefant.itch.io/crate-before-attack)
- [IndieDB entry](https://www.indiedb.com/games/crate-before-attack)

Direct server metadata dates the currently served HTML, JavaScript, and WASM files to December 31, 2023. The live client is therefore materially newer than the public devlog.

### Genre and ancestry

The name refers to the Worms community rule “Crate Before Attack.” The game is particularly close to Shopper-style rope play:

- Obtain a weapon from a crate during the turn.
- Move quickly through a compact terrain maze.
- Attack after collecting.
- Retreat while the remaining turn window permits.

The public build describes Shopper as:

> Get a random weapon every turn staying in the air as much as possible.

This is not a general Worms clone. Movement mastery is the main game, and weapons convert movement skill into tactical advantage.

## 2. Complete Gameplay Loop

### Shopper

**Verified**

1. A player controls one frog during a timed turn.
2. The frog begins unarmed or needs to obtain a fresh weapon.
3. A package crate must be collected.
4. Collection grants a random weapon.
5. The player traverses toward a target, aims, and attacks.
6. A configurable retreat period may follow the shot.
7. Control passes to the next player.

The first public build explicitly included Shopper rules, six weapons, local hot-seat, and online play. Later builds expose seven weapons.

### Battle

The current build exposes a separate **Battle** ruleset described as “Tactical battle.” Static symbols include:

- Plan time
- Action points
- Add orders
- Add and execute orders
- Cancel plan
- Execute plan
- Movement, collect, shoot, drop-down, and hang orders

This appears to be a more explicitly planned tactical mode than Shopper.

### Training

**Verified**

Training is crate collection against time. Options include:

- Start time
- Crate time bonus
- Rounds
- Starting crates
- Crates to keep
- Crate spawn delay
- Wait for first pickup

Crates can be caught in mid-air. The main menu currently includes Dungeon Easy and Dungeon Expert training configurations.

### Race

**Verified**

- Race against time, AI, local players, live alternating players, or ghosts.
- Configurable lap count.
- Optional turn duration on large maps.
- Quick Race uses the player's best ghost and another online ghost of similar skill.
- Results feed an interactive global histogram/leaderboard.

### Quick and demo modes

The current build includes:

- Quick Battle against AI.
- Quick Race.
- Demo Match controlled by AI.
- Observation mode for spectators.

## 3. Controls

### Confirmed logical actions

Static analysis exposes the following control actions:

- `Left`
- `Right`
- `Up`
- `Down`
- `RopeJump`
- `RopeCancel`
- `JumpOrFire`
- `Fire`
- `CycleLeft`
- Game/look-angle control
- Camera control
- Planning/order controls

The public UI assets include:

- Arrow-key icons
- Enter
- Backspace
- Slash
- Mouse left/right
- “tongue,” “swing,” “pull,” “jump,” “walk,” “aim,” “shot,” “camera,” and “zoom” hints

Third-party game listings consistently identify:

- Arrow keys for movement and aiming.
- Space for tongue.

The September changelog confirms:

- Backward jump is performed by **double Enter**.
- A “Hold to Stay Attached” option changes tongue input from toggle-like use to release-on-key-up.

### Control model

**Strong inference**

The default scheme is intentionally compact:

- Left/right alter walking direction when grounded.
- Left/right inject or redirect swing motion while attached.
- Up/down alter aim or rope behavior contextually.
- Space launches/releases the tongue.
- Enter jumps on ground and fires/uses the selected weapon in an attack context.
- Double Enter requests a backward jump.
- Mouse can split camera/order and tongue/camera responsibilities depending on options.

The options expose three mouse-button orders:

- Order / Camera
- Tongue / Camera
- Camera / Tongue

This suggests mouse buttons are context-sensitive and can be swapped to prioritize tactical ordering or rope control.

### Recommended input implementation

Use semantic actions rather than reading keys directly in gameplay:

```text
MoveLeft
MoveRight
AimUp
AimDown
TonguePressed
TongueReleased
JumpPressed
FirePressed
CameraDrag
Zoom
CycleWeapon
```

Sample input once per simulation frame and record it as deterministic bitfields plus quantized aim/camera values.

Important details:

- Preserve pressed, held, and released states separately.
- Detect double-presses in simulation time, not wall-clock time.
- Prevent browser defaults for gameplay keys.
- Continue simulation/input pumping when browser animation callbacks are throttled.
- Allow the rope key to operate in either toggle or hold mode.

## 4. Character State Machine

The developer published an early Rust enum with these states:

```text
Walk
PreJump { jump_type }
Jump { end_time }
Rope
RopeLaunch
Flight { hurt }
Idle
Burst
```

The current WebAssembly build exposes a richer state/visual vocabulary:

- Idle
- Walk
- PreJump
- RopeLaunch, with cancellation state
- Rope
- RopeJump
- Flight
- Hurt
- Burst
- Backflip
- Up jump
- Backward jump
- Forward jump

The pawn record includes:

- Health
- Body handle
- Aim direction
- Rope direction
- Velocity
- State and state time
- Bounce time
- Bump and bump time
- Rope process/state
- Orientation
- Hands and feet
- Last pain time
- Last attachment time
- Pose history
- Inflation

This is a strong indicator that animation and control are organized around explicit semantic states while physics remains authoritative.

## 5. Physics Architecture

### Fixed update rate

**Verified:** the first public build advertises **120 Hz physics**.

Use:

```text
fixed_dt = 1 / 120 second
```

Render independently and interpolate presentation transforms between completed simulation frames. Do not vary physics `dt` with rendering frame time.

### Body model

The open-source [circle2d](https://github.com/koalefant/circle2d) library states that it was written for Crate Before Attack. It supports:

- Circular shapes
- Static map shapes represented by distance fields
- Dynamic/static bodies
- Linear and angular velocity
- Mass and inertia
- Friction
- Restitution
- Persistent contacts
- Sleeping islands
- Spatial hashing

The character, crates, projectiles, mines, and other moving objects are primarily circle-based even when their drawn shapes are not.

This simplification is fundamental. A circular frog:

- Never catches polygon corners.
- Rolls naturally.
- Changes surface orientation continuously.
- Works well against arbitrary painted terrain.
- Produces stable rope arcs.

### Terrain collisions

**Verified**

Terrain collision is based on a signed distance field (SDF), generated from map alpha/collision data. The runtime and devlog expose:

- Offline-generated collision maps for bundled levels.
- Runtime SDF generation/download for custom content.
- Terrain normal sampling.
- Continuous circle marching.
- Separate map image and optional sky.

For a circle at `p` with radius `r`:

```text
penetration when sdf(p) < r
normal = normalize(gradient(sdf, p))
contact_point approximately p - normal * sdf(p)
```

The open library samples extra nearby directions when deeply intersecting terrain, groups similar normals, and can produce multiple terrain contacts. This is important in corners and narrow gaps.

### Continuous collision detection

Position updates do not simply integrate and push bodies out afterward. `march_circle` advances a swept circle through the SDF and backs up to the last valid location.

This reduces:

- Tunneling at high rope velocity.
- Penetration jitter.
- Inconsistent corner response.
- Dependence on rendering framerate.

The current build also exposes `march_circle_sliding` and `march_circle_along`, indicating specialized surface-following operations.

### Contact solver

The public `circle2d` code uses a sequential impulse solver inspired by Box2D-Lite and Chipmunk2D:

- Broad phase: 64-unit spatial hash cells.
- Narrow phase: circle-circle and circle-SDF contacts.
- Combined friction: geometric mean.
- Combined restitution: maximum of the two bodies.
- Warm starting through persistent accumulated impulses.
- Normal and tangent effective mass.
- Baumgarte-style penetration bias.
- Restitution only above a minimum impact velocity.
- Iterative impulse application.

The published library currently performs 100 solver iterations. The exact production build may differ, but the high iteration count helps dense frog piles and energetic contacts remain stable.

Open-library defaults provide useful starting values:

```text
body friction       0.5
body restitution    0.8
bounce threshold    200 units/s
max linear speed    4000 units/s
max angular speed   50 rad/s
allowed penetration 0.3 units in solver
bias factor         0.2
sleep delay         0.3 s
sleep speed         25 units/s
```

These are library defaults, not guaranteed final pawn values.

### Gravity and scale

Static analysis of the current build repeatedly shows a gravity-like acceleration of approximately:

```text
1200 world units / s^2
```

The same build clamps many dynamic velocities to:

```text
4000 world units / s
```

Crates use a swept-circle collision radius of approximately 28 world units in one visible update path.

Treat these values as strong reverse-engineering evidence, then tune by recorded reference motion.

### Sleeping

The engine tracks connected contact islands and sleeps an entire low-energy island together. This prevents resting frog piles, crates, and mines from continually jittering.

Wake bodies when:

- A force or velocity is applied.
- Position/shape changes.
- A new active body contacts the island.
- A connected static body is removed.

## 6. Why the Rope Feels Different

### Verified changes made specifically for feel

The developer documented:

1. A minimum bounce velocity allows vertical motion to begin while attached horizontally.
2. On tongue release, frog velocity is constrained to the rotation arc.
3. This makes release less affected by tongue contraction/elongation.
4. Frogs were later made “more bouncy” while attached.
5. They lose less energy and controls feel more energetic.
6. Swing direction reverses while upside down.
7. Sliding previously prevented bounce and was fixed.
8. Accidental tongue re-shooting in the same direction was fixed.

These are the most important clues in the entire project.

### Mechanical interpretation

Model the tongue as a dynamic radial constraint, not a simple rigid pin:

```text
anchor
rope_length
frog_position
radial_direction = normalize(frog_position - anchor)
radial_velocity = dot(velocity, radial_direction)
tangent = perpendicular(radial_direction)
tangential_velocity = dot(velocity, tangent)
```

The current rope record also exposes `folds`, `free_length`, and `anchor`. **Strong inference:** the tongue is a polyline that can wrap around terrain corners:

```text
frog -> zero or more terrain fold points -> final anchor
```

Constraint length should be measured along the complete polyline. Add a fold when a rope segment crosses a convex terrain feature, and remove a fold when adjacent segments regain clear line of sight. Solve motion relative to the final segment nearest the frog.

The controller should:

- Preserve and amplify tangential movement.
- Allow controlled rope contraction/elongation.
- Prevent radial correction from destroying tangential momentum.
- Add a minimum useful tangential or bounce impulse at low speed.
- Determine left/right swing intent relative to the frog's orientation around the anchor.
- On detach, remove or clamp undesirable radial velocity while retaining the arc tangent.

A practical release rule:

```text
v_tangent = tangent * dot(v, tangent)
v_outward = radial * max(dot(v, radial), small_outward_allowance)
release_velocity = v_tangent + v_outward
```

Do not preserve strong inward velocity generated by rope shortening. It makes release speed depend on rope correction rather than player timing.

### Recommended rope update

```text
1. Launch tongue ray/segment from frog along selected aim direction.
2. Attach at first valid terrain hit.
3. Initialize rope length from actual anchor distance.
4. Each 120 Hz tick:
   a. Integrate gravity and player swing force.
   b. Update desired rope length from pull/release input.
   c. Update terrain fold/unfold points.
   d. Solve the final-segment radial distance constraint while respecting total path length.
   e. Preserve tangential velocity.
   f. Add low-speed energy assistance when player is pumping correctly.
   g. Run swept circle-terrain collision.
   h. Resolve contacts and rolling/sliding.
5. On release, project velocity onto the useful swing arc.
```

### Energy assistance

Pure pendulum physics often feels dull because:

- Contact friction drains energy.
- Numerical correction removes velocity.
- Players cannot inject energy as effectively as a real body.
- Short input windows become frustrating.

Crate Before Attack explicitly reduces energy loss and guarantees useful bounce. Add controlled assistance:

```text
if attached and abs(tangential_speed) < desired_min
and swing_input agrees with tangential_direction:
    velocity += tangent * pump_acceleration * dt
```

Scale assistance down at high speed. Preserve timing skill by requiring the input direction to agree with the current swing phase.

### Surface interaction

Do not switch between “rope physics” and “ground physics” as unrelated modes. The same circular body should continue colliding, rolling, and bouncing while attached. Much of the satisfying feel comes from a frog brushing, compressing against, or rebounding from terrain without the rope system taking over completely.

## 7. Walking, Jumping, Rolling, and Damage

### Walking

**Strong inference**

Ground movement is normal-relative rather than axis-aligned:

- Sample terrain normal under/around the circle.
- Tangent is perpendicular to the normal.
- Apply target velocity or force along tangent.
- Rotate the visible frog to the surface orientation.

The game differentiates “walkable” and “not walkable” terrain positions. Very steep or unsupported surfaces transition into flight/slide rather than remaining grounded.

### Jumping

The current state vocabulary distinguishes:

- Forward
- Backward
- Up
- Backflip

Use surface normal and facing direction to construct jump impulses:

```text
jump_velocity =
    surface_normal * vertical_component
  + surface_tangent * directional_component
```

Backward double-press should produce a clearly different arc and pose rather than merely negating horizontal velocity.

### Bounce and slide

The game treats sliding and bouncing as important named feedback states. Static analysis shows sliding-loop volume based on:

- Body speed above roughly 10 units/s.
- A smooth ramp toward full level over a broad speed range.
- A 0.3-second fade/retention period.

There are nine bounce samples and a dedicated slide sound. Collision response should classify:

- Low impulse: no bounce sound.
- Moderate impulse: soft bounce.
- High impulse: harder randomized bounce.
- Sustained tangential contact: sliding/rolling loop.

### Contact damage

The current pawn module includes `apply_contact_damage`. This implies sufficiently hard impacts can hurt frogs independently of direct weapon damage.

Implement damage from contact impulse or change in normal velocity:

```text
impact_speed = max(0, -dot(relative_velocity, contact_normal))
damage = curve(max(0, impact_speed - safe_threshold))
```

Apply cooldowns to avoid repeated damage from one solver contact.

### Water and death

- Frogs can “plop” into water.
- Invincible mode still allows death by water.
- The HUD and results track drowned players.
- Explosions have a separate underwater sound.
- Burst/inflation states support death presentation.

## 8. Crates

### States and behavior

Static analysis exposes a crate state machine with:

- Position
- Intended position
- Velocity
- Ground normal
- State and state time
- Physics body
- Pickup state
- Collector
- Delay

Observed/verified behavior:

- Crates spawn to maintain a target count.
- A spawn delay can be configured.
- Crates can appear/drop with separate sounds.
- They fall under gravity.
- They collide and settle physically.
- They can be caught in mid-air.
- Collection produces a dedicated effect and sound.
- Collection grants a random weapon.

The current build integrates crate gravity at roughly `1200 units/s^2`, clamps at `4000 units/s`, and sweeps a circle of roughly radius 28 against terrain.

### Spawn quality

Do not spawn at arbitrary image-space points. Validate:

- Sufficient signed distance from terrain.
- Reachability or suitability for the mode.
- Clearance from water and invalid pockets.
- Distance from other crates and frogs.
- A safe fall path if the crate enters from above.

## 9. Weapons

The current build names seven weapons.

### Bomb

- Explodes on contact.
- Thrown projectile.
- Has launch, impact, and explosion feedback.

### Grenade

- Bounces.
- Explodes on a timer.
- Requires restitution and timer UI/audio.

### Proximity Mine

- Triggered by nearby bodies.
- Has arm, tick, and final sounds.
- Uses separate off/on visual states.

### Dynamite Pack

- Drops vertically.
- Splits into multiple bouncy pieces.
- Useful for area denial and irregular terrain.

### Boxing Gloves

- Melee attack.
- Two hits in the look direction.
- Static analysis shows two phased hand trajectories, smooth easing windows, neighbor queries, and approximately `800` units/s-scale knockback in one path.
- Four swing sounds and two confirmed-hit sounds avoid repetition.

### Golf Club

- Chargeable melee attack.
- Developer description: long throws with precise strength control.
- Current code shows an approximately **1.3-second** charge normalization.
- Wind-up feedback changes during charge.
- Release chooses soft/hard swing events.
- Procedural club/hand paths are generated from smooth phase functions.
- Contact uses swept segment tests rather than only a radial overlap.

### Hare

- A bouncing autonomous “friend” that carries chaos toward an enemy.
- Procedural animation derives from a colliding ball.
- Uses predicted landing, previous contact, current position, and velocity.
- Chooses short or long jumps.
- Has multiple footstep sounds.

### Explosion separation

The build stores explosion impulses separately from explosion sprites. Follow that design:

- Deterministic gameplay event: radius, damage, impulse, terrain interaction.
- Presentation event: flash, sprite, decal, sound, camera response.

This keeps multiplayer deterministic and lets effects be adjusted without changing simulation.

## 10. Animation

### Core approach

**Verified:** procedural animation is a headline feature.

Animation is not a sprite state machine detached from physics. The visible pose is reconstructed from:

- Semantic movement state.
- Body position and velocity.
- Surface normal.
- Facing/orientation.
- Rope anchor/direction.
- Hands and feet targets.
- Bounce and bump timing.
- Hurt state.
- Nearby danger.
- Pose history.

Recommended function:

```text
pose = f(
    movement_state,
    position,
    velocity,
    facing,
    surface_normal,
    rope_anchor,
    rope_tension,
    previous_contact,
    predicted_contact,
    nearby_danger,
    time_in_state
)
```

### Eyes

**Verified**

- Frogs track the closest danger, including projectiles and pets.
- Frogs close their eyes when another frog climbs on them.

Use eye direction as a high-value anticipation cue. Select the nearest high-threat object, apply a short hysteresis so targets do not flicker, and clamp pupils within the eye shape.

### Feet and hands

The build exposes foot-placement records with current/previous positions and timing. Recommended:

- Grounded feet target nearby terrain contacts.
- Feet alternate during walk based on distance traveled, not animation time alone.
- Flight feet trail or prepare for predicted contact.
- Rope hands target the tongue direction/attachment line.
- Weapon states override hand targets.

### Squash, stretch, hurt, and inflation

Use physics-derived deformation:

- Compress on high normal impulse.
- Stretch along velocity during fast flight.
- Inflate during burst/death presentation.
- Hold hurt pose until damage text/feedback is readable.

Smooth only the rendered pose. Never smooth the physics body used for collision.

### Hare procedure

The developer's documented method is directly reproducible:

1. Simulate a simple colliding ball.
2. Track last contact point.
3. Predict next landing point.
4. Derive body axis and limb placement from those points, current position, and velocity.
5. Choose a short or long jump pose on each bounce.

## 11. Camera

### Verified behavior

- Supports zoom.
- Supports configurable initial zoom: 50%, 100%, or 200%.
- Supports manual camera input.
- Tracks all action.
- Attempts to keep important objects in frame.
- Was explicitly redesigned to be “more intelligent.”

### Static-analysis evidence

The focus solver constructs multiple rectangles/regions with differing types and extents. Candidate tracked objects include:

- Active frog.
- Rope/tongue travel.
- Projectiles.
- Crates.
- Other active pawns.
- Action points and recent events.

The camera is therefore a multi-target framing system, not a single transform follower.

### Recommended solver

Each tracked item supplies:

```text
position
radius or bounds
priority
minimum lifetime
kind
```

Then:

1. Form a weighted or priority-filtered bounding rectangle.
2. Add look-ahead in the velocity/aim direction.
3. Expand to a safe rectangle that excludes HUD.
4. Compute target center and zoom.
5. Smooth center faster than zoom.
6. Limit zoom velocity.
7. Retain recent impact positions briefly.
8. Let player camera input bias or temporarily override automatic framing.

Avoid heavy camera shake. Precision matters more than spectacle.

## 12. UI and Readability

### In-game HUD

Public screenshots show:

- Menu button at upper left.
- Match elapsed clock near top center.
- Large turn countdown directly beneath it.
- Active-frog arrow.
- Compact colored health number above each frog.
- Bottom-center weapon inventory.
- Selected weapon outlined in team color/green.
- Item quantities.
- Team/player health bars and names below inventory.
- Water line clearly visible at screen bottom.

### Visual rules

- Near-black translucent panel fills.
- Thin gray outlines.
- Bright white primary text.
- Team-colored names, numbers, bars, and accents.
- Bright gameplay silhouettes over low-frequency dark backgrounds.
- Icons plus quantities plus selection border, rather than color alone.
- Stable HUD anchors instead of information following the camera.

### Fonts

The current bundle identifies:

- **Blogger Sans** generated at 16, 21, and 64 pixel sizes for the game.
- **LessPerfect** for the deliberately retro HTML crash overlay.

Blogger Sans is narrow, readable, informal, and supports Cyrillic. Use a legally suitable equivalent with:

- Large x-height.
- Compact width.
- Clear digits.
- Full localization coverage.
- Distinct punctuation at small sizes.

### Menus and lobby

The current UI includes:

- Large single-player/multiplayer action rows.
- Map thumbnail grid.
- Public match browser.
- Player list with country flags.
- Chat.
- Ready/unready state.
- Team colors.
- Human/robot player type.
- Secret-link copy flow.
- Host controls.
- Responsive leaderboard histogram.

### Accessibility

The itch listing identifies high contrast. Reproduce:

- Text/background contrast independent of map art.
- Outlines on small hazards.
- Team identity through text, placement, and shape in addition to hue.
- Persistent input hints that can be disabled.
- Aim/tongue direction hint.
- Large countdown digits.

## 13. Sound Design

### Confirmed event inventory

The public build contains at least:

- UI hover and click.
- Lobby enter, leave, ready, and game-start.
- Chat message.
- Get-ready cue.
- Five low-time ticks.
- Turn timeout.
- Race countdown, green light, and finish.
- Crate appear, drop, and collect.
- Tongue launch and seven tongue-stick variants.
- Nine bounce variants.
- Walk, jump, slide, and water plop.
- Draw, throw, and bomb launch.
- General, metal, rubber, and soft impacts.
- Four boxing swings and two boxing hits.
- Four golf windups, soft/hard golf swings, and golf hit.
- Mine arm, tick, and final.
- Three hare steps.
- Two ordinary explosions and underwater explosion.
- Four pain vocalizations.
- Inflate and burst.
- Victory and defeat.

### Runtime audio architecture

The browser bridge uses Web Audio:

- Decoded audio buffers.
- Independent source playback rate.
- Looping sources.
- Controllable source handles.
- Independent left/right gain.
- Runtime source-volume updates and stops.
- Short gain ramps aligned to approximately one 120 Hz simulation interval.

This provides stereo positioning without requiring full HRTF spatial audio.

### Design lessons

The most frequent actions get the most variation:

- Seven attachment sounds.
- Nine bounces.
- Multiple pain and footstep sounds.

Layer weapon feedback:

```text
anticipation -> release/swing -> contact -> aftermath
```

Classify impacts by:

- Material.
- Impulse magnitude.
- Whether contact is sustained.
- Whether underwater.

Randomization:

- Avoid immediate repeats.
- Add narrow pitch variation.
- Add small gain variation.
- Keep UI and countdown sounds non-spatial.
- Pan world effects by camera-relative position.

### Determinism warning

An official October bugfix says a network desync was caused by reading sound-system state. Audio must be a write-only consumer of deterministic events. Simulation must never branch on:

- Whether a sample loaded.
- Whether a source is playing.
- Browser audio time.
- Number of active sources.

### Music

No clear music tracks, composer, or soundtrack credits were found. Sound effects appear to carry most of the presentation.

## 14. Rendering and Map Technology

### Verified stack

- Rust client compiled to WebAssembly.
- `miniquad` graphics/window/input layer.
- WebGL browser rendering.
- Custom rendering and game engine.
- Custom `circle2d` physics.
- Inkscape for vector/UI art.
- Audacity for audio editing.

### Map pipeline

Maps can be:

- Bundled.
- Imported as custom PNG.
- Imported as `.cbmap`/ZIP packages.

Archive fields exposed by the build include:

- `main.png`
- Optional `sky.png`
- `map.json`

The runtime maintains:

- Map image cache.
- SDF cache.
- IndexedDB browser cache.
- Map hash/content handling for multiplayer.

Bundled maps use palette-based 8-bit formats. An update combined clear, sky, and terrain into a single render pass and reported up to 40% lower GPU frame time.

### Rendering style

- Painted bitmap terrain/background.
- Vector-derived character, weapon, and UI models.
- Pixelated canvas image-rendering mode in the host page.
- Separate layers for terrain, projectiles, crates, pawn foreground/background, water, hares, explosions, and overlays.
- Fast/low-quality map filtering option for weak GPUs when zoomed out.

## 15. Multiplayer

### Supported configurations

- Local hot-seat.
- Online public matches.
- Secret-link private matches.
- Mixed local and online players.
- AI slots.
- Up to eight players.
- Teams; same-colored players are allies.
- Late-joining spectators.

### Session flow

1. Browser connects to `wss://cratebeforeattack.com/ws`.
2. Client introduces itself and restores or receives session identity.
3. Server provides lobby users and public match list.
4. Host chooses map, mode, rules, seed, teams, and slots.
5. Browsers may add multiple local players.
6. Missing custom maps are uploaded/downloaded.
7. Players mark ready.
8. Server starts the match and assigns input ownership.
9. Clients simulate from ordered frame inputs.
10. Results/replays/ghosts can be uploaded.

### Architecture

**Verified and strong inference**

The developer says late observers join by replaying deterministic inputs. The current protocol/build exposes:

- `CasterInput`
- `CasterChange`
- `InjectedInput`
- `FrameFinished`
- `FrameHash`
- `Desync`
- Replay frames
- Input buffering
- `Buffering...`

The best-fitting architecture is:

**Centralized WebSocket relay plus deterministic lockstep/input replay.**

- Every client runs the simulation.
- One “caster” supplies active-turn input.
- Server orders and relays frame inputs.
- Clients buffer rather than predict missing input.
- Clients submit frame progress/hashes.
- Desync is detected through hash mismatch.
- Spectators replay history and catch up.

There is no strong evidence of snapshot replication, transform interpolation, or rollback.

### Why it fits the game

Only one player normally controls a turn. Therefore:

- Added input delay is less disruptive.
- Prediction is unnecessary.
- Replays are compact.
- Spectating is straightforward.
- Server bandwidth is low.
- Identical physics can run on every browser.

### Recommended clone protocol

```text
Introduction
Welcome
GameList
HostGame
JoinGame
UpdateSetup
AddPlayer
UpdatePlayer
Ready
StartedGame
CasterChange
CasterInput
InjectedInput
FrameFinished
FrameHash
Desync
UserLeftGame
PlayAgain
LeaveGame
```

Store:

- Build/protocol version.
- Map hash.
- Rules and seed.
- Player/client mapping.
- Ordered frame inputs.
- Deterministic administrative events.
- Periodic frame hash.
- End reason and results.

### Buffering and latency

Expected behavior:

- Keep roughly 100-250 ms of ordered inputs buffered.
- Pause with a buffering indicator if the stream is exhausted.
- Simulate faster than real time after stalls or when a spectator joins.
- Do not render every catch-up frame.
- Return to normal rate near the live frame.

An official bugfix mentions accidental accelerated playback of a later turn, confirming catch-up acceleration.

### Deterministic requirements

- Fixed timestep.
- Seeded deterministic RNG.
- Stable entity IDs (`slotmap` is used).
- Stable iteration order where outcomes depend on order.
- Quantized or fixed-point calculations where cross-platform float behavior is risky.
- No wall-clock time in simulation.
- No audio/render/browser state in simulation.
- Replay every gameplay-affecting host action as an injected event.

The open physics library includes optional 32.32 fixed-point arithmetic and deterministic trig approximations. The production client visibly uses many `f32` operations, so exact architecture likely mixes deterministic discipline with floating point rather than using fixed point everywhere.

## 16. Server and Supporting Technology

### Verified

- Rust is used for both game and server work.
- Developer confirmed `tokio` and `slotmap` on the server.
- Serde is used extensively.
- Current binary strongly indicates `bincode` for compact protocol/state serialization.
- WebSocket endpoint is first-party.
- Sentry handles crashes.
- Plausible handles website analytics.
- IndexedDB caches downloads.
- Local storage holds profile/options/session data.

Other dependencies visible in the current WASM include:

- `chrono`
- `hdrhistogram`
- `png`
- `zip`
- `flate2` / `miniz_oxide`
- `smallvec`
- `arrayvec`
- `wyhash`
- `serde_json`

The binary references project modules/crates including:

- `roper`
- `net-shared`
- `cbmap`
- `optimized`
- `sdf-gen`
- `realtime-drawing`
- a locally vendored/modified `miniquad`

Public supporting repositories provide more implementation evidence:

- [`realtime-drawing`](https://github.com/koalefant/realtime-drawing): runtime mesh generation, antialiased strips, streamed vertex/index buffers, batching, `miniquad`, and WebAssembly support. Its symbols are linked into the current game.
- [CBA map editor](https://github.com/koalefant/editor): a Rust/GPLv3 editor for `.cbmap` content, SDF-rendered lines, uploads, and play testing. It is useful evidence for the later map pipeline, not proof that every editor dependency is present in the game client.

## 17. AI

### Verified

- AI can play Shopper, Training, and Race.
- AI can attack and retreat.
- The developer showed a decision-tree visualization.
- Quick Battle uses an AI opponent.
- AI player slots can coexist with humans.

### Likely structure

The movement problem is difficult enough that AI probably evaluates candidate movement/action sequences rather than relying on a simple navigation mesh.

Useful clone approach:

1. Build reachable anchor/sample points from the SDF.
2. Generate rope launch directions and release times.
3. Simulate short deterministic trajectories.
4. Score crate reachability, target attack quality, safety, and remaining time.
5. Execute the best sequence.
6. Replan after major contacts or missed attachment.

For tactical modes, layer a decision tree over trajectory search:

```text
Need crate?
Can reach crate this turn?
Can attack after pickup?
Which target maximizes damage/position?
Can retreat to safety?
```

## 18. What Most Likely Creates the “Satisfying Physics”

Ranked by expected impact:

1. **120 Hz fixed simulation.**
2. **Circular pawn against smooth SDF terrain.**
3. **Swept collision marching at high speed.**
4. **Persistent-contact impulse solver with rolling and sliding.**
5. **Tangential velocity preservation on rope release.**
6. **Reduced energy loss and deliberate swing pumping.**
7. **Minimum bounce velocity at low-energy rope positions.**
8. **Ground normals sampled from a smooth distance field.**
9. **Procedural pose following actual motion.**
10. **Many attachment/bounce sounds tied to physical events.**
11. **Camera framing that keeps the full action readable.**
12. **Minimal visual obstruction around collision silhouettes.**

A conventional polygon character, 60 Hz timestep, spring-joint rope, sprite animation, and generic impact sound will not reproduce the feel even if the movement speed looks similar.

## 19. Recommended Clone Architecture

### Client

Rust is a natural match, but the design is portable to C++, C#, or another deterministic-capable stack.

Suggested modules:

```text
app
input
fixed_clock
simulation
physics
sdf
map
pawn
rope
crate
weapon
rules
replay
net_protocol
net_client
animation
camera
audio
render
ui
ai
```

Keep simulation and presentation data separate.

### Simulation pipeline per frame

```text
1. Consume frame-numbered player input.
2. Advance rules/turn state.
3. Advance pawn control state machines.
4. Advance rope constraints and player forces.
5. Advance weapons, crates, mines, and autonomous objects.
6. Apply gravity and forces.
7. Detect contacts.
8. Solve impulses/friction/restitution.
9. Sweep/update positions.
10. Apply damage, pickups, explosions, and water events.
11. Queue deterministic sound/effect events.
12. Update results and turn transitions.
13. Hash canonical state periodically.
```

### Presentation pipeline

```text
1. Interpolate render transforms.
2. Generate procedural pose.
3. Solve camera focus and zoom.
4. Render sky/map/gameplay/effects/water/UI.
5. Consume audio/effect events.
```

### Server

```text
WebSocket gateway
identity/session service
lobby and room manager
match setup authority
ordered input relay
replay/input history store
frame-hash comparison
map/blob store
leaderboard/ghost store
chat
crash/log ingestion
```

The server should never trust client positions, damage, pickups, or final scores. It should validate legal input ownership and either simulate matches itself or verify deterministic results/hashes.

## 20. Tuning Plan

Do not tune by memory. Build measurement scenes.

### Reference tests

Record or reproduce:

1. Free fall from a known screen-relative height.
2. Ground bounce from several impact speeds.
3. Rolling down 15°, 30°, 45°, and curved slopes.
4. Horizontal tongue attachment from rest.
5. Full pendulum period at several rope lengths.
6. Speed gain from repeated swing pumping.
7. Release at bottom, side, and top of arc.
8. Terrain skim while attached.
9. Corner collision at high speed.
10. Crate fall, bounce, and settle.
11. Explosion knockback by distance.
12. Golf-club charge and launch distance.

### Parameters to expose

```text
physics_hz
gravity
max_speed
pawn_radius
pawn_mass
pawn_inertia
friction
restitution
bounce_threshold
minimum_rope_bounce
rope_launch_speed
rope_max_range
rope_reel_speed
rope_constraint_strength
swing_pump_acceleration
swing_pump_speed_limit
release_radial_clamp
walk_acceleration
walk_speed
jump_normal_speed
jump_tangent_speed
contact_damage_threshold
camera_center_half_life
camera_zoom_half_life
```

### Order of tuning

1. Unit scale and gravity.
2. Pawn radius/mass and terrain collision.
3. Restitution/friction and rolling.
4. Rope constraint.
5. Release projection.
6. Energy pumping/minimum bounce.
7. Walking and jump variants.
8. Camera.
9. Animation.
10. Sound thresholds and variation.

Changing animation or sound before the trajectory is right can hide, but not fix, bad mechanics.

## 21. Validation and Instrumentation

Add a debug overlay with:

- Physics frame number.
- Body position/velocity/angular velocity.
- Rope length, radial speed, and tangential speed.
- SDF distance and sampled normal.
- Contact points and impulses.
- Current pawn state/state time.
- Energy before/after rope constraint.
- Camera focus regions.
- Replay input buffer depth.
- Canonical state hash.

Add deterministic tests:

- Replay produces identical hashes.
- Browser/native builds agree for a fixed test scene.
- Entity iteration order does not alter results.
- Audio enabled/disabled produces identical state.
- Rendering at 30, 60, 120, and variable FPS produces identical simulation.
- Background-tab catch-up produces identical state.

## 22. Legal and Product Boundaries

Reproduce mechanics and design principles, not protected expression.

Create original:

- Name and branding.
- Frog/character designs.
- Maps and illustrations.
- Weapon art.
- UI icons and layout details.
- Fonts or properly licensed equivalents.
- Sound recordings.
- Music.
- Source code.

The original sound files, vector models, maps, and UI assets are publicly downloadable by the browser but remain copyrighted assets unless separately licensed.

## 23. Source Index

### Official

- [Homepage](https://cratebeforeattack.com/)
- [Screenshots](https://cratebeforeattack.com/screenshots/)
- [First public build](https://cratebeforeattack.com/posts/20200503-release-alpha-1/)
- [May update 1](https://cratebeforeattack.com/posts/20200516-update-alpha-3/)
- [May update 2](https://cratebeforeattack.com/posts/20200524-update-alpha-4/)
- [June update](https://cratebeforeattack.com/posts/20200630-june-update/)
- [July update](https://cratebeforeattack.com/posts/20200731-july-update/)
- [August update](https://cratebeforeattack.com/posts/20200831-august-update/)
- [September update](https://cratebeforeattack.com/posts/20201001-september-update/)
- [October update](https://cratebeforeattack.com/posts/20201029-october-update/)
- [Rust experiment](https://cratebeforeattack.com/posts/20200502-rust/)
- [Hare animation](https://cratebeforeattack.com/posts/20200428-hare-animation/)
- [itch.io listing](https://koalefant.itch.io/crate-before-attack)
- [Official YouTube channel](https://www.youtube.com/channel/UC_xMilPTLuuE5iLs1Ml9zow)

### Technical

- [circle2d repository](https://github.com/koalefant/circle2d)
- [realtime-drawing repository](https://github.com/koalefant/realtime-drawing)
- [CBA map editor repository](https://github.com/koalefant/editor)
- [Developer confirmation of miniquad, circle2d, slotmap, and Tokio](https://www.reddit.com/r/rust/comments/ilo71n/crate_before_attack_a_brief_august_report/)
- [IndieDB entry](https://www.indiedb.com/games/crate-before-attack)
- [Public browser loader](https://cratebeforeattack.com/play/roper.js)
- [Public WebAssembly build](https://cratebeforeattack.com/play/roper.wasm)

### Secondary control/context sources

- [Gameflare listing](https://www.gameflare.com/online-game/crate-before-attack/)
- [Worms scheme rule background](https://worms2d.info/Scheme_rules)

## Final Recommendation

Build the movement prototype before the full game. The first milestone should contain only:

- One SDF map.
- One circular frog.
- 120 Hz physics.
- Walking and jump variants.
- Tongue launch, attachment, pumping, reel, and release.
- Rolling, sliding, and bounce sounds.
- Procedural body/eye/limb pose.
- Multi-target camera.
- Input recording and deterministic replay.

Do not add multiplayer or the full weapon set until a recorded rope course can be replayed deterministically and the traversal itself is enjoyable for several minutes. That prototype will establish whether the essential Crate Before Attack feel has actually been reproduced.
