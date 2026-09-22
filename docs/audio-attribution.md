# Audio credits

The current soundtrack of effects is synthesized by `src/audio.ts` using Web Audio oscillators, filtered noise, and envelopes. These original effects include frog vocalizations, movement, impacts, water, weapon families, mines, and interface cues. They require no downloads, external voices, or speech service. `src/game-audio.ts` controls movement foley, stereo positioning, distance, and event playback.

The five earlier sound assets below remain bundled but are no longer used by the mixer. They are by [Kenney](https://kenney.nl), distributed under [Creative Commons Zero (CC0)](https://creativecommons.org/publicdomain/zero/1.0/). Copied from the user's Kenney Game Assets All-in-1 3.5.0 library. These files are unrelated to Crate Before Attack and no audio from that game was copied.

| Project asset | Kenney pack | Original filename | Intended cue |
| --- | --- | --- | --- |
| `public/audio/grapple.ogg` | Retro Sounds 1 | `jump1.ogg` | Grapple launch |
| `public/audio/pickup.ogg` | Retro Sounds 1 | `pickup1.ogg` | Crate collected |
| `public/audio/shot.ogg` | Retro Sounds 1 | `laser3.ogg` | Weapon fired |
| `public/audio/explosion.ogg` | Retro Sounds 1 | `rumble1.ogg` | Explosion |
| `public/audio/ui.ogg` | Interface Sounds | `click_001.ogg` | Button action |

The original pack licenses are included alongside the audio as `LICENSE-retro-sounds-1.txt` and `LICENSE-interface-sounds.txt`. The audio files are unmodified. All five were checked with ffprobe to confirm valid Ogg files and short durations suitable for effects.
