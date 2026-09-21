# Rebate Attack Force

**Swing. Loot. Fire.** An original browser game inspired by the grappling and Shopper combat loop of the Rust frog game [Crate Before Attack](https://cratebeforeattack.com/). Play as little salvage frogs in an overgrown scrapyard. No reference-game code, art, maps, or audio is included.

## Play locally

Requires Node.js 22+.

```sh
npm ci
npm run dev
```

Open **http://localhost:5173**. Vite and the Colyseus room server start together. The game fills the viewport, with a compact in-game HUD and a menu opened with Escape. Press F for browser fullscreen.

- **Practice:** unlimited movement time, a target frog, respawns, and all three weapons to discover.
- **Local:** two players share one keyboard and take turns.
- **Online:** create a private room, copy its invite link, and bring 1–3 friends. Everyone chooses a callsign; no accounts are involved. The host chooses each team’s frog count and starting HP, then starts the match.

For friends on the same network, use the network URL printed by Vite. A localhost invite only works on your own machine. Public play needs a reachable deployment.

## How it plays

Each player controls a team. Before a local or online match, configure **1–6 frogs** and **1–500 starting HP per frog** separately for each team (default: one frog, 100 HP). A versus turn lasts **45 seconds**. Move and grapple in real time during your turn, pick up weapon crates, and fire **one shot**. Firing starts **10 seconds of retreat**. Blast damage and knockback can send frogs into the water, which eliminates them. Last team standing wins; simultaneous eliminations can draw. Teams alternate turns, and each team rotates through its living frogs in order. Dead frogs and disconnected teams are skipped. Ammunition belongs to the frog that collected it.

**Unused ammunition carries across turns.** Every crate adds one round to your stash. You may collect multiple crates and select any stocked weapon. Carrying a weapon lets you attack on a later turn without finding another crate. The one-shot limit still applies.

| Control | Action |
| --- | --- |
| A / D or ← / → | Walk and pump your swing |
| Enter (also W / ↑ or Shift) | Jump when grounded |
| Enter twice within 0.32 seconds | Higher jump backward, opposite the direction faced at takeoff |
| W / S or ↑ / ↓ while hooked | Reel rope in / pay it out |
| Mouse | Aim in world space |
| Click with tongue selected, Space, or right-click | Attach / release grapple |
| 1 / 2 | Select tongue / stocked weapon |
| Stash buttons | Choose a weapon type |
| Hold left mouse with weapon selected, then release | Charge and fire |
| End turn button | End turn |
| F | Fullscreen |
| Escape | Open / close the game menu (pauses local play) |

The scrapyard spans **4,320 × 1,800 world pixels**, with 29 platforms, elevated supply routes, and a camera that follows the active frog. Edge markers point toward opponents outside the view.

Aiming guides appear only while you control the active frog. Everyone can see that frog's eyes follow its aim, and frogs make an alarmed face when a living opponent comes within 160 world pixels. Jointed hind legs plant and step while walking, tuck near a jump's apex, and extend or trail while airborne.

Ropes reach 680 world pixels and attach to any solid platform surface. They wrap around terrain corners and unwind as you swing back; reeling accounts for every segment. Release preserves momentum. Frogs are solid bodies: push them, land on them and jump off, or stomp from height to send them tumbling. The trajectory hint uses the selected weapon's speed and gravity. Rockets explode on impact, grenades bounce with a short fuse, and the recoil popper creates a close-range blast. Grenades and rockets can hurt their owner.

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
- `shared/rope.ts`: persistent rope contacts and terrain visibility routing.
- `src/camera.ts`: viewport scaling, active-player tracking, and pointer conversion.
- `src/renderer.ts`: original Canvas 2D frogs, terrain, effects, and atmosphere.
- `src/frog.ts`: shared gaze presentation, proximity expressions, and two-bone leg poses.
- `src/main.ts`: browser interface, input, sound, and render interpolation.
- `src/network.ts`: anonymous rooms, automatic reconnects, and saved team seats for reloads.

```sh
npm run typecheck
npm test
npm run build
# With npm run dev running in another terminal:
npm run test:browser
# Optional local oMLX visual check, after screenshots exist:
npm run test:visual
```

The optional visual check uses your local oMLX vision model and a blank-image negative control; it skips when the service or a supported model is unavailable. Override with `OMLX_BASE_URL`, `OMLX_API_KEY`, and `OMLX_VISION_MODEL`.

The unit suite covers deterministic simulation, actual reachable pickups, attacks, saved ammunition, rope dynamics, collisions, deadlines, drowning, delayed victory, and a complete match. Integration tests use real Colyseus clients on an ephemeral local port. The browser smoke test drives two actual browser clients and saves screenshots to `test-results/`.

Browser tests use system Chrome on macOS when present. Otherwise install Chromium with `npx playwright install chromium`, or set `CHROME_PATH`. To check the production bundle served by `npm start`, use `BASE_URL=http://localhost:2567 npm run test:browser` after building.

## Scope of this first version

One arena, 1–6 frogs per team, 2–4 online teams, three weapons, original visuals and sound effects. There is no AI opponent, terrain destruction, public matchmaking, recovery after a server restart, or support for multiple uncoordinated server replicas. Accidental disconnects keep the team alive and skip its turns. Brief drops reconnect automatically. A saved private reconnect token lets you reload or reopen the room link in the same browser and recover the same team; it is refreshed on every successful reconnection. Rejoining restores eligibility for the team’s next turn, without interrupting another team. If every team is offline, play waits; rooms are discarded after 30 minutes with nobody connected. Explicitly choosing Leave match forfeits the team and clears its saved token. Keyboard and mouse provide the intended experience; the responsive UI includes basic touch controls.

Research and fidelity boundaries are recorded in [reference mechanics](docs/reference-mechanics.md). Weapon carryover is an intentional beginner-friendly adaptation requested for Rebate Attack Force.

## Credits

All game illustrations and branding were drawn in code for this project. Audio uses [Kenney](https://kenney.nl/)'s CC0 packs; filenames and included licenses are in [audio attribution](docs/audio-attribution.md). Fonts and licenses are documented in [font attribution](docs/font-attribution.md).
