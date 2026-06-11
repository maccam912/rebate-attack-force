# TODO / pickup notes (as of 2026-06-11)

Status: workspace builds, 23 tests green, browser smoke verified (lobby →
ready → round → walking with legs). Nothing committed yet.

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
- wasm-opt to shrink the ~9.5 MB gzipped wasm.
- Bevy 0.18 migration (currently pinned to 0.17).
- Initial commit still pending ("say the word").
