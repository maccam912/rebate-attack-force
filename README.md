# Rebate Attack Force

A from-scratch, browser-playable multiplayer frog-artillery game inspired by the
mechanics of [Crate Before Attack](https://cratebeforeattack.com/) (an anagram!).
Swing on your tongue, grab a crate to arm your one attack per round, and knock
the other team into the water. First team to 10 kills wins.

Everything is Rust: a deterministic engine-free sim crate, a tokio/axum
authoritative server, and a Bevy client compiled to WebAssembly — no JavaScript.

## Play

```sh
# build the browser client (once, or after client changes)
cd crates/client && trunk build && cd ../..

# run the server (serves the game + websocket on :3000)
cargo run -p server
```

Open `http://localhost:3000` — share `http://<your-host>:3000/?room=SOMECODE`
with friends; everyone with the same room code lands in the same match.
Optional query params: `?room=CODE&name=YourName`.

A native client also works: `cargo run -p client` (env: `SERVER`, `ROOM`, `NAME`).

## Container

Pushes to `main` and version tags publish a multi-architecture image to
`ghcr.io/<owner>/<repository>`. Pull requests build the image without pushing it.

```sh
docker run --rm -p 3000:3000 ghcr.io/<owner>/<repository>:latest
```

For Kubernetes, expose container port `3000` and use `GET /healthz` for both
readiness and liveness probes. The server stores active matches in memory, so
use one replica unless ingress keeps every room's WebSocket connections pinned
to the same pod.

### Controls

- **A/D** walk, **Space** jump (jump while roped = zip release)
- **mouse** aims; **hold LMB** = tongue grapple, release lets go; **W/S** reel
- **hold RMB** charge, **release** fire; **1/2/3** select weapon; **-/=** zoom

### Rules

- Timed simultaneous rounds (45 s round / 5 s break). Hybrid realtime/turn-based.
- Each frog must **grab a crate during the round to unlock its one attack**.
- Crate weapons go into a **per-team shared inventory** that persists across rounds.
- Friendly fire hurts but scores nothing. Water kills. First team to 10 kills.

## Architecture

| crate | what it is |
| --- | --- |
| `crates/sim` | deterministic 120 Hz game core: SDF terrain, swept circle physics, tongue/rope with terrain folds, weapons, rules. No engine deps; a whole match runs in a unit test. |
| `crates/protocol` | bincode wire messages (client ⇄ server) |
| `crates/server` | axum WebSocket server; one tokio task per room (party code), authoritative sim, ~30 Hz snapshots. No client prediction — clients interpolate. |
| `crates/client` | Bevy 0.18 client (native + wasm via trunk), renders snapshots, streams inputs |

## Tests

```sh
cargo test --workspace   # sim unit tests (incl. a full match) + server WS bot tests
```

Dev hooks: run the server with `DEV_HOOKS=1` to enable the debug drop-crate
message used by the e2e test; `SEED=n` fixes the terrain; `PORT`, `CLIENT_DIST`.

## Credits

Sound effects from [Kenney](https://kenney.nl)'s CC0 game asset packs
(Impact Sounds, Sci-Fi Sounds, Interface Sounds, Foley Sounds, Retro Sounds,
Music Jingles). Thanks Kenney!

Frog croaks (`crates/client/assets/audio/croak_*.ogg`) are synthesized by
`scripts/gen_croaks.py` (regenerate with python3 + ffmpeg).
