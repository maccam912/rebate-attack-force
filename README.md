# Rebate Attack Force

**Swing. Loot. Fire.** An original browser game inspired by the grappling and Shopper combat loop of the Rust frog game [Crate Before Attack](https://cratebeforeattack.com/). Play as little salvage frogs in an overgrown scrapyard. No reference-game code, art, maps, or audio is included.

## Play locally

Requires Node.js 22+.

```sh
npm ci
npm run dev
```

Open **http://localhost:5173**. Vite and the Colyseus room server start together. The game fills the viewport, with a compact in-game HUD and a menu opened with Escape. Press F for browser fullscreen.

- **Practice:** unlimited movement time, a target frog, respawns, and all 24 weapons refilled every turn.
- **Local:** two players share one device and take turns.
- **Online:** create a private room, copy its invite link, and bring 1–3 friends. Everyone chooses a callsign; no accounts are involved. The host chooses each team’s frog count and starting HP, then starts the match.

For friends on the same network, use the network URL printed by Vite. A localhost invite only works on your own machine. Public play needs a reachable deployment.

## How it plays

Each player controls a team. Before a local or online match, configure **1–6 frogs** and **1–500 starting HP per frog** separately for each team (default: one frog, 100 HP). A versus turn lasts **45 seconds**. Move and grapple in real time during your turn, pick up weapon crates, and fire **one shot**. Melee and instant blasts end control immediately. Projectiles allow retreat until impact or detonation, for up to **5 seconds**; placing a mine gives the full five seconds. Last team standing wins; simultaneous eliminations can draw. Teams alternate turns, and each team rotates through its living frogs in order. Dead frogs and disconnected teams are skipped. Ammunition belongs to the frog that collected it.

After impact, everyone loses control while the camera follows the weapon and flying frogs, widening to show collisions. Brief slow motion and subtle shake accent big hits. Damage accumulates without reducing HP or removing lethally hit frogs from the physics. Once bodies and live weapons settle, the camera visits each damaged frog, pauses, and shows its HP being subtracted. Knocked-out frogs explode for a little nearby damage and knockback; any resulting mayhem settles and gets its own outcome before the turn changes. Water eliminations are also shown before victory or practice respawns.

**Every frog starts with all 24 weapons and limited ammunition. Unused ammunition carries across turns.** Mystery crates resupply a randomly chosen weapon; every box looks identical and its contents are revealed only after pickup. You may collect multiple crates and select any stocked weapon. Carrying a weapon lets you attack on a later turn without finding another crate. The one-shot limit still applies.

| Control | Action |
| --- | --- |
| A / D or ← / → | Walk and pump your swing |
| Enter (also W / ↑ or Shift) | Jump when grounded |
| Enter twice within 0.32 seconds | Higher jump backward, opposite the direction faced at takeoff |
| W / S or ↑ / ↓ while hooked | Reel rope in / pay it out |
| Mouse | Aim in world space |
| Click with tongue selected, Space, or right-click | Attach / release grapple |
| 1 / 2 | Select tongue / stocked weapon |
| B / Arsenal button | Open the grouped arsenal and choose a weapon |
| Hold left mouse with weapon selected, then release | Charge and fire |
| End turn button | End turn |
| F | Fullscreen |
| Escape | Open / close the game menu (pauses local play) |

On a phone or touch device, the game automatically shows a thumb control deck and keeps the arena above it. Rotate to **landscape** for more room to see and aim; portrait also works. The layout follows screen resizing and keeps controls clear of display cutouts and the home indicator.

| Touch control | Action |
| --- | --- |
| Left pad | Drag left/right to walk or pump a swing; up/down reels an attached rope in/out |
| Right pad | Drag to set your aim direction; it stays aimed relative to your frog as you move |
| Touch the arena | Aim at that spot without attacking |
| Jump | Tap to jump immediately; tap twice quickly for a backward jump |
| Hook | Attach toward your aim; tap again to release |
| Fire | Hold to charge the stocked weapon, then release to fire |
| Arsenal / End turn / menu buttons | Choose a weapon, pass the turn, or open the menu |

You can move, aim, and use an action with separate fingers. Opening the menu or arsenal or changing turns clears held controls and cancels a charged shot. An interrupted Fire touch also cancels the shot.

The scrapyard spans **4,320 × 1,800 world pixels**, with 29 platforms, elevated supply routes, and a camera that follows the active frog. Edge markers point toward opponents outside the view.

Aiming guides appear only while you control the active frog. Everyone can see that frog's eyes follow its aim, and frogs make an alarmed face when a living opponent comes within 160 world pixels. Jointed hind legs plant and step while walking, tuck near a jump's apex, and trail behind velocity, even during downward dives. Local spring animation adds leg flutter without affecting collisions. Fast launches widen the eyes; impacts squash the body.

Ropes reach 680 world pixels and attach to any solid platform surface. They wrap around corners and unwind as you swing back. Pumping acts along the swing, reeling adds angular momentum, and release retains both tangential and inward velocity. Frogs are solid bodies: push them, land on them, or stomp from height. Explosions and melee blows launch frogs into spins; they bounce off walls, roll across floors, and follow their flight arc as the spin subsides. The active frog's own traversal and terrain impacts are safe. High stomps hurt the frog underneath; fast body collisions and terrain impacts after a weapon or body launch add to the pending damage. Water still eliminates frogs.

Sound starts with your first click, touch, or keypress. The ♪ button mutes all effects and remembers your preference. Footsteps follow actual ground movement; swing and rushing-air sounds grow with speed. Jumps, reeling, weapon charging and firing, explosions, ricochets, impacts, panic croaks, deaths, water splashes, respawns, pickups, mines, character changes, and the final countdown all have cues. Background tabs go quiet. Online action sounds follow the server so prediction corrections cannot replay them.

The arsenal uses one shared catalog for simulation, aiming hints, and the interface:

| Family | Weapons |
| --- | --- |
| Launchers | Rebate Rocket, Salt Shaker, Complaint Department, Lob Goblin, Grand Finale |
| Bombs | Pocket Grenade, Demolition Melon, Confetti Cluster, Banana Split, Chewing Boom |
| Melee | Nine-Irony, Home Run, Express Delivery |
| Traps | Personal Space Mine, Unwelcome Mat |
| Air support | Special Delivery, Extinction Event, Gravity's Invoice |
| Oddities | Sonic Burp, Rubber Ruin, Debt Collector, Industrial Hairdryer, Disco Inferno, Return to Sender |

These have different trajectories, fuses, reach, recoil, fragmentation, bounce, and launch forces. Sticky bombs attach to terrain or frogs; the boomerang curves back toward its owner; vacuum blasts pull; the hairdryer pushes without direct damage. Melee requires line of sight. Air support enters from above the aimed column and strikes the first obstruction. Terrain reduces blast damage and radial force.

Mines persist across turns and arm only after their deployment turn. Only the active frog approaching within visible range starts the warning fuse, including the owner on a later turn. Untriggered traps do not hold up turn changes. The spring mine sacrifices direct damage for a huge upward launch and the resulting fall.

Online, the active player runs the same simulation locally with sequenced input and command prediction. Server checkpoints acknowledge inputs; the client restores authoritative state and replays pending input, smoothing small visible corrections and snapping large corrections or life-state changes. Other players use a 120 ms snapshot interpolation buffer for bodies, ropes, projectiles, traps, and effects. They do not independently predict remote combat. Server time, damage, inventory, and turns remain authoritative; client poses and clocks are never accepted. Reconnecting and turn changes reset prediction history.

## Deploy to Kubernetes

A single image serves the client, matchmaking, and WebSockets on one port. No database or authentication service is required.

```sh
docker build -t rebate-attack-force:0.1.0 .
docker run --rm -p 2567:2567 rebate-attack-force:0.1.0
```

For a cluster, push the image to your registry and set the image in `deploy/base/kustomization.yaml`, then:

```sh
kubectl apply -k deploy/base
kubectl rollout status deployment/rebate-attack-force
kubectl port-forward service/rebate-attack-force 8080:80
```

See [deployment instructions](docs/deployment.md) for ingress, TLS, health probes, graceful shutdown, and scaling. The included deployment uses **one replica** because rooms live in memory. Restarts end active matches. Horizontal scaling requires shared Colyseus coordination and room-aware routing.

## Code and verification

- `shared/game.ts`: headless, fixed 120 Hz simulation; no renderer or transport dependencies.
- `server/AttackRoom.ts`: authoritative Colyseus room; validates and rate-limits client inputs, steps the simulation, broadcasts snapshots.
- `shared/physics.ts`: shared impulse, impact, angular attitude, and velocity rules.
- `shared/weapons.ts`: 24-weapon catalog, ballistics, loadouts, and display metadata.
- `shared/protocol.ts`: authoritative checkpoints and sequenced input envelopes.
- `src/prediction.ts`: rollback/replay, visual correction, and delayed spectator interpolation.
- `shared/rope.ts`: persistent rope contacts and terrain visibility routing.
- `src/camera.ts`: viewport scaling, active-player tracking, and pointer conversion.
- `src/renderer.ts`: original Canvas 2D frogs, terrain, effects, and atmosphere.
- `src/frog.ts`: shared gaze presentation, proximity expressions, and two-bone leg poses.
- `src/main.ts`: browser interface, input, and render interpolation.
- `src/audio.ts` and `src/game-audio.ts`: procedural sound mixer, spatial cues, and motion foley; the shared simulation retains a bounded sound event history for online delivery.
- `src/network.ts`: anonymous rooms, automatic reconnects, and saved team seats for reloads.

```sh
npm run typecheck
npm test
npm run build
# With npm run dev running in another terminal:
npm run test:browser
npm run test:mobile
npm run test:audio
# Optional local oMLX visual check, after screenshots exist:
npm run test:visual
```

The optional visual check uses your local oMLX vision model and a blank-image negative control; it skips when the service or a supported model is unavailable. Override with `OMLX_BASE_URL`, `OMLX_API_KEY`, and `OMLX_VISION_MODEL`.

The unit suite covers deterministic simulation and checkpoint replay, latency and jitter, all weapon families, mystery pickups, saved ammunition, rope momentum, damaging impacts, body collisions, mine arming, deadlines, drowning, delayed victory, sound event delivery, movement foley, and complete matches. Integration tests use real Colyseus clients on an ephemeral local port. The browser smoke test drives two actual browser clients and saves screenshots to `test-results/`. The mobile smoke test sends browser touch input, including simultaneous fingers, and checks phone layouts, movement and aim, jumps, grappling, firing, and interrupted gestures. It uses Chromium touch emulation; physical-device testing is still useful for browser chrome, cutouts, and handling. The audio smoke test uses the Vite dev server to measure real Web Audio output and check every cue, weapon, mute/unlock controls, and audio graph cleanup.

Browser tests use system Chrome on macOS when present. Otherwise install Chromium with `npx playwright install chromium`, or set `CHROME_PATH`. To check the production bundle served by `npm start`, use `BASE_URL=http://localhost:2567 npm run test:browser` after building.

## Scope of this first version

One arena, 1–6 frogs per team, 2–4 online teams, 24 weapons, original visuals and sound effects. There is no AI opponent, terrain destruction, public matchmaking, recovery after a server restart, or support for multiple uncoordinated server replicas. Accidental disconnects keep the team alive and skip its turns. Brief drops reconnect automatically. A saved private reconnect token lets you reload or reopen the room link in the same browser and recover the same team; it is refreshed on every successful reconnection. Rejoining restores eligibility for the team’s next turn, without interrupting another team. If every team is offline, play waits; rooms are discarded after 30 minutes with nobody connected. Explicitly choosing Leave match forfeits the team and clears its saved token. Play with keyboard and mouse or the adaptive phone controls.

Research and fidelity boundaries are recorded in [reference mechanics](docs/reference-mechanics.md). Weapon carryover is an intentional beginner-friendly adaptation requested for Rebate Attack Force.

## Credits

All game illustrations, branding, and the procedural Web Audio sound effects were created in code for this project. Earlier [Kenney](https://kenney.nl/) CC0 audio assets remain bundled; filenames and included licenses are in [audio attribution](docs/audio-attribution.md). Fonts and licenses are documented in [font attribution](docs/font-attribution.md).
