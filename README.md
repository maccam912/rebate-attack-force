# Rebate Attack Force

**Swing. Loot. Fire.** An original browser game inspired by the grappling and Shopper combat loop of the Rust frog game [Crate Before Attack](https://cratebeforeattack.com/). Play as little salvage frogs in an overgrown scrapyard. No reference-game code, art, maps, or audio is included.

## Play locally

Requires Node.js 22+.

```sh
npm ci
npm run dev
```

Open **http://localhost:5173**. Vite and the Colyseus room server start together.

- **Practice:** unlimited movement time, a target frog, respawns, and all three weapons to discover.
- **Local:** two players share one keyboard and take turns.
- **Online:** create a private room, copy its invite link, and bring 1–3 friends. Everyone chooses a callsign; no accounts are involved. The host starts the match.

For friends on the same network, use the network URL printed by Vite. A localhost invite only works on your own machine. Public play needs a reachable deployment.

## How it plays

Each frog has 100 HP. A versus turn lasts **45 seconds**. Move and grapple in real time during your turn, pick up weapon crates, and fire **one shot**. Firing starts **10 seconds of retreat**. Blast damage and knockback can send frogs into the water, which eliminates them. Last frog standing wins; simultaneous eliminations can draw.

**Unused ammunition carries across turns.** Every crate adds one round to your stash. You may collect multiple crates and select any stocked weapon. Carrying a weapon lets you attack on a later turn without finding another crate. The one-shot limit still applies.

| Control | Action |
| --- | --- |
| A / D or ← / → | Walk and pump your swing |
| W / ↑, or Shift | Jump when grounded |
| W / S or ↑ / ↓ while hooked | Reel rope in / pay it out |
| Mouse | Aim in world space |
| Click with tongue selected, Space, or right-click | Attach / release grapple |
| 1 / 2 | Select tongue / stocked weapon |
| Stash buttons | Choose a weapon type |
| Hold left mouse with weapon selected, then release | Charge and fire |
| Enter | End turn |
| F | Fullscreen |

Ropes reach 680 world pixels and attach to any solid platform surface. Release preserves momentum. The trajectory hint uses the selected weapon's speed and gravity. Rockets explode on impact, grenades bounce with a short fuse, and the recoil popper creates a close-range blast. Grenades and rockets can hurt their owner.

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
- `src/renderer.ts`: original Canvas 2D frogs, terrain, effects, and atmosphere.
- `src/main.ts`: browser interface, input, sound, and render interpolation.
- `src/network.ts`: anonymous rooms and short-drop reconnects.

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

One arena, one frog per player, 2–4 online players, three weapons, original visuals and sound effects. There is no AI opponent, terrain destruction, rope wrapping around corners, multi-frog teams, public matchmaking, persistent match recovery, or support for multiple uncoordinated server replicas. Short connection drops reconnect within 15 seconds while the tab stays open; reloading does not reclaim a running match's seat. Keyboard and mouse provide the intended experience; the responsive UI includes basic touch controls.

Research and fidelity boundaries are recorded in [reference mechanics](docs/reference-mechanics.md). Weapon carryover is an intentional beginner-friendly adaptation requested for Rebate Attack Force.

## Credits

All game illustrations and branding were drawn in code for this project. Audio uses [Kenney](https://kenney.nl/)'s CC0 packs; filenames and included licenses are in [audio attribution](docs/audio-attribution.md). Fonts and licenses are documented in [font attribution](docs/font-attribution.md).
