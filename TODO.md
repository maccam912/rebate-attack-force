# TODO / pickup notes (as of 2026-06-11)

Status: workspace builds, 26 tests green, browser smoke verified (lobby →
ready → round → walking with legs → tongue swing → fall off platforms).

## Done (compressed log)

- 2026-06-10: tongue phasing fix (winding unwrap + swept wrap raycast),
  jump 90° glitch fix (eased velocity pose), Enter jump (tap hop / double-tap
  backflip), lobby with Teams ↔ FFA mode select (N-team sim, protocol v2).
- 2026-06-11: procedural spider-walk legs (client `legs.rs`: feet raycast-plant
  on terrain, stay put until out of reach, lifted step + grass footstep sound,
  dangle when airborne, two-bone IK gizmo render). Sound pass: UI clicks
  (weapon select / lobby M / lobby R), crate-spawn pop layer, synthesized frog
  croaks (`scripts/gen_croaks.py` → ambient ribbits per frog, jump "hup",
  pickup trill, death croak). `scripts/drive_hold.mjs` (CDP key-hold + console
  capture). Fixed clippy `approx_constant` in sim terrain.
- 2026-06-11 (later): assets moved to `crates/client/assets` (fixes native
  "Path not found" audio errors; trunk copy-dir + Dockerfile updated). Crate
  rule change: firing only needs a weapon in the team stash (leftovers from
  earlier rounds usable immediately; `armed` removed, protocol v3). Fat
  tongue (TongueGizmos config group, 7px + round joints). Dive pose only
  after 1 s of tongue-less free fall (FrogPose.air, client-side). Fall
  damage: `Event::Ouch` on hard landings → `croak_ouch_*` yelp (gen_croaks)
  + body wobble + leg thrash for ~1.1 s. Legs ragdoll (verlet + hip tether)
  whenever airborne/swinging. No side walls: terrain sinks below water at
  both map ends, x-clamp removed — you can fall off the sides. Terrain gen:
  pits, worm tunnels, explicit floating islands + slab platforms (all still
  seed-deterministic). New examples: `botdbg` (ws-bot mirror), `mapdbg`
  (ASCII map dump).
- 2026-06-11: client upgraded from Bevy 0.17 to 0.18.1.
- 2026-06-12: deploy + capacity pass. Audio embedded into the binary
  (`bevy_embedded_assets` ReplaceDefault; `.cargo/config.toml` sets
  `BEVY_ASSET_PATH`; copy-dir dropped from index.html) — the browser never
  fetches assets/ over HTTP, fixes missing audio on deploys. Measured
  (`netbench` example): sim 0.8 us/step @ 8 players, snapshots 172-466 B —
  the real per-connection cost was CompressionLayer gzipping the 35 MB wasm
  on the fly. Now: dist precompressed in Dockerfile (gzip -9 + brotli -q 11),
  served via ServeDir precompressed_br/gzip (no runtime compression);
  wasm-opt -Oz via trunk (35.1 → 29.5 MB raw, 7.6 MB br). Snapshots
  30 → 20 Hz; broadcast encoded once as refcounted Bytes; bounded 64-msg
  per-client outbox sheds slow consumers; client sends input only on change
  (250 ms keepalive).

## Next steps

- Playtest feel: jump/backflip constants (`JUMP_UP/JUMP_FWD/BACKFLIP_*` in sim
  `game.rs`), tongue behavior, and now leg tuning (`REACH/STEP_TRIGGER/
  STEP_TIME` etc. in client `legs.rs`) + sound mix levels.
- Squash-on-impact body pose (dossier feel item #9 — legs half done, body
  squash still missing).
- Audio polish: master volume / mute key; stereo pan by world position
  (currently only distance attenuation on footsteps + ambient croaks);
  consider recorded ribbits to replace the synthesized croaks if they feel
  too retro. Note: homebrew ffmpeg lacks libvorbis — gen_croaks converts via
  the built-in `vorbis` encoder, which requires `-ac 2 -strict experimental`.
- Multi-target camera.
- Lobby polish: per-player colors in the roster list, maybe clickable buttons.
- If the deployed host STILL can't get audio after this image: the assets are
  in the wasm now, so any remaining problem is the platform serving a stale
  image — re-pull `ghcr.io/maccam912/rebate-attack-force:latest`.
- 2026-06-12 work uncommitted ("say the word").
