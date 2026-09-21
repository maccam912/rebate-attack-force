# Crate Before Attack reference mechanics

Research date: 2026-09-20. Reference: **Crate Before Attack by koalefant**, the browser frog game written in Rust. This document describes observable behavior and the creator's published notes; it is not a port of their code. No original game art, maps, audio, or source files were copied.

## Confirmed reference behavior

- The game combines alternating turns with real-time movement during the active turn. Sticky tongues act as grappling hooks. The creator lists local and online multiplayer; itch.io lists 1–8 players. [Official site](https://cratebeforeattack.com/), [creator's itch.io page](https://koalefant.itch.io/crate-before-attack).
- The first release explicitly implements Shopper rules, six weapons, local hot-seat play, and 120 Hz physics including rolling and sliding. [First Public Build, May 3, 2020](https://cratebeforeattack.com/posts/20200503-release-alpha-1/).
- Tongue length changes during play. Swing controls invert when upside down. Training exists specifically to practice reaching crates. [May Update 1](https://cratebeforeattack.com/posts/20200516-update-alpha-3/).
- Releasing the tongue retains motion along the swing's tangent; the developer adjusted this to avoid rope-length changes dominating launch velocity. A horizontal attachment can produce a minimum bounce so the player can begin swinging. The game supports private invitations through a secret link and multiple local players in a network match. [June Update](https://cratebeforeattack.com/posts/20200630-june-update/).
- Later changes made swinging retain more energy and added an optional hold-to-stay-attached mode. Double Enter performs a backward jump. [September Update](https://cratebeforeattack.com/posts/20201001-september-update/).
- Explosions have damage and blast radii. Weapons mentioned by the creator include boxing gloves, explosive hare, dynamite, mines, and a golf club with adjustable strength and significant knockback. A post-attack retreat period exists. [July Update](https://cratebeforeattack.com/posts/20200731-july-update/), [Alpha Update 4](https://koalefant.itch.io/crate-before-attack/devlog/148821/alpha-update-4), [Golf Club](https://koalefant.itch.io/crate-before-attack/devlog/161226/golf-club-is-a-new-weapon).

## Directly observed in the official game's UI

These observations came from the playable early-access build `08e87460` at [the official play page](https://cratebeforeattack.com/play/), using its menus and a local training/AI match:

| Item | Observation |
| --- | --- |
| Shopper room defaults | 4 frogs, 10 mines, 100 HP, 45-second turn, 10-second retreat; settings are configurable. |
| Crate gate | The empty weapon tooltip says the player is unarmed and must collect a package box to obtain a weapon. |
| Movement | Left/right arrows or A/D walk and pump the swing. |
| Rope length / aim | Up/down arrows or W/S adjust length while attached and angle while detached. |
| Rope action | Space has a shoot/release diagram; Z/X and a mouse button appear as alternatives. |
| Jump | Enter shows a jump diagram; double Enter shows a backward jump. |
| Mouse options | Defaults show Tongue / Camera; the options include aim hints and input hints. |
| Modes | Crate Training, Quick Battle against AI, Race Challenges, public matches, private matches. |
| Training | Easy and Expert variants; crates appear suspended in traversable spaces. |

## Boundaries of the research

The inspected sources do not establish exact damage numbers, knockback curves, projectile fuses, crate spawn distribution, whether every attack must be made while roping, inventory carryover, fall-damage rules, terrain destruction, or the precise consequences of entering water. Do not silently import all Worms Shopper conventions as confirmed behavior. Water and mines are visible in the reference, but exact elimination behavior still needs a dedicated play session.

## Recommended Rebate Attack Force interpretation

Preserve the central skill loop: **swing to a crate → acquire ammunition → position and attack → retreat → next player**. Begin with anonymous invite-code rooms, 2–4 players, a small original arena with overhead attachment surfaces, visible 45-second turns, one attack per turn, a 10-second retreat, health, and a last-survivor win condition. These are implementation choices; the crate acquisition, rope mechanics, timers, and retreat are grounded above. Make crate placement reachable so the timer rewards traversal instead of luck.

The user explicitly requested persistent ammunition as an adaptation: unused ammunition carries between turns, and a player with saved ammunition can fire without collecting a fresh crate. Keep the limit of one attack per turn. Require a crate pickup only when the player has no usable ammunition; do not erase unused ammunition when the turn changes. This is a Rebate Attack Force rule, not a claim about the reference game's inventory behavior.

Keep the movement responsive: preserve tangential release momentum, let players shorten/lengthen the rope, let pumping add energy, and allow rapid reattachment. Provide clear on-screen controls plus a practice mode. Show ammunition and explicitly lock firing when ammunition is empty; do not make players learn an unwritten etiquette rule.

Start with three distinct original weapons: a direct explosive projectile, a bouncing timed explosive, and a close-range knockback attack. Tune damage, blast radius, and water elimination for this implementation rather than claiming numerical fidelity. Terrain destruction, rope wrapping around corners, full weapon parity, and large teams can follow after the traversal/combat loop is fun.

Use original code-drawn characters, arena geometry, UI, branding, and effects. Separately licensed CC0 audio is acceptable. Do not extract, trace, or redistribute the reference game's distinctive assets or level designs.
