# TODO / pickup notes (as of 2026-06-10)

Status: workspace builds, 23 tests green, browser smoke verified (lobby →
mode switch → ready → round running). Nothing committed yet beyond the
existing two commits.

## Done 2026-06-10 (this session)

- **Tongue phasing fix** — unwrap is now winding-based (fold stores which side
  the frog was on; it only unwinds when the frog crosses back), and the wrap
  raycast samples along the frog's last step so thin islands can't tunnel
  between ticks at high swing speed. Regression test:
  `rope_fold_holds_until_frog_swings_back`.
- **Jump 90° glitch fix** — the velocity-stretch pose in `view.rs` only kicks
  in above swing speeds (430, above hop speed) and rotation/scale are eased
  over time instead of snapping.
- **Enter-key jump** — Enter (and Space) = jump. Single tap: shallow hop
  forward in the facing direction. Double tap within 0.25 s: converts the hop
  into a backflip (mostly up, slightly back). Test:
  `jump_hops_forward_and_double_tap_backflips`.
- **Lobby + game-mode select** — rooms start in `Phase::Lobby`; the panel
  shows mode + roster, `[M]` toggles Teams ↔ Free-for-all (any player),
  `[R]` readies up; the match starts when everyone is ready and returns to
  the lobby after the end screen. FFA gives each player their own
  team/color/stash (sim generalized to N teams: scores/inventory are Vecs,
  8-color palette cycling in the client). Protocol bumped to v2
  (`Ready`/`SetMode`, `mode` + Vec scores in snapshots, `ready` in roster).
  Tests: `lobby_gates_match_and_mode_select_reassigns_teams` (sim),
  `lobby_waits_for_all_ready_and_any_player_switches_mode` (ws).
- `scripts/drive_keys.mjs` — CDP helper to send key presses to a running tab
  (used to smoke the lobby flow headlessly).

## Next steps

- Playtest the tongue fix + new jump feel with a human (numbers may want
  tuning: `JUMP_UP/JUMP_FWD/BACKFLIP_*` in sim `game.rs`).
- Procedural legs / pose animation, squash-on-impact (dossier feel item #9)
- Multi-target camera
- Lobby polish: per-player colors in the roster list, maybe clickable buttons
- wasm-opt to shrink the ~9.5 MB gzipped wasm
- Bevy 0.18 migration (currently pinned to 0.17)
- Initial commit still pending ("say the word")
