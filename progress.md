# Rebate Attack Force

Original request: Build an original-art clone of the Rust frog game Crate Before Attack, preserving turn-based slinging/swinging, crate-before-attack mechanics, and anonymous rooms, potentially Colyseus. Research mechanics and consider the new game skill.

User steering: no accounts, easy Kubernetes deploys, Phaser optional, and unused weapons may carry between turns to help new players.

## Implementation

- Found and applied the user's local `/Users/maccam912/.claude/skills/new-game/SKILL.md` after checking the ordinary Codex skill directories. Earlier OpenAI develop-web-game lookup returned an upstream 404; the local skill was the intended match.
- TypeScript + original Canvas 2D client; shared deterministic 120 Hz simulation; server-authoritative Colyseus 0.18 anonymous private rooms for 2–4 players.
- Practice, local hot-seat, online invites/host start, reconnection for brief drops, explicit leave forfeits, rematches.
- Original map/frogs/effects, locally bundled Kenney CC0 audio, self-hosted OFL fonts. No original game's code/assets extracted.
- Ground movement, jump, raycast grapples, reeling, swinging, momentum-preserving release, three weapons, damage, knockback, water elimination, 45s turns, 10s retreat.
- Persistent per-weapon ammo. Multiple crates add ammo; players may select stocked weapons. One shot per turn; saved ammo needs no new crate.
- Fixed premature victory when the final survivor was still falling toward water; motion resolves first and can produce a draw.
- Responsive UI, basic touch controls, fullscreen, sound toggle, original illustrated scrapyard, trajectory hints, smooth online rendering, readable state snapshot for testing.
- Multi-stage nonroot Dockerfile, one-replica Kustomize Deployment/Service with probes and read-only filesystem, ingress example, deployment/scaling notes.

## Verification

- `npm run typecheck` passes.
- `npm test`: 20/20 tests passed (18 isolated simulation + 2 real Colyseus integration tests).
- `npm run build` passes; client JS about 69KB gzip, all public assets about180KB.
- `npm run test:browser` passed against Vite and `BASE_URL=http://localhost:2567 npm run test:browser` passed against the built production client.
- Browser tests cover walking, pickup, charged attack, retreat, grapple/reel/release, guide, local turn swap, saved ammo + selection, two anonymous browser clients, synced movement/pickup, turn authority/handoff, disconnect winner, responsive layout. Screenshots in `test-results/` were visually inspected.
- `kubectl kustomize deploy/base` renders successfully. No cluster deployment performed.
- Docker daemon unavailable: image build could not be tested.
- Optional `npm run test:visual` passed using local oMLX Gemma4 12B: the actual game screenshot passed and the synthetic blank negative control was correctly rejected. The check is gated on service/model availability. Non-thinking JSON mode is required to avoid a reasoning-only response at short token budgets.

## Running preview

`npm run dev` serves http://localhost:5173 and the room/server production client at http://localhost:2567. Both were started together. The Codex preview was opened on port5173.

## Deliberate scope / next work

- One map, one frog/player, three weapons. No bots (practice target only), destructible terrain, multi-frog teams, or rope wrapping around corners.
- Rooms are ephemeral in-process state: keep Kubernetes replicas=1 until shared presence/driver and room-owner routing are implemented. Rollouts/restarts end matches.
- Brief reconnects keep the existing browser session, but page reload does not restore a seat in a running match.
- Keyboard/mouse is the intended control scheme; touch controls are a basic fallback.
