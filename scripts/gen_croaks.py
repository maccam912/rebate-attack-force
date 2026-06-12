#!/usr/bin/env python3
"""Synthesize cartoon frog croaks as WAVs (convert to ogg with ffmpeg).

The croak recipe: a tanh-saturated sine carrier (gives the buzzy throat
timbre), amplitude-modulated around 20-30 Hz (the "ribbit" roughness),
one-pole lowpassed, with a pitch glide per burst.
"""
import math
import os
import random
import struct
import wave

SR = 44100
OUT = "/tmp/croaks"


def burst(dur, f0, f1, am=24.0, timbre=2.5, decay=0.7):
    n = int(dur * SR)
    out = []
    ph = 0.0
    for i in range(n):
        t = i / n
        f = f0 * (1 - t) + f1 * t
        ph += f / SR
        carrier = math.tanh(timbre * math.sin(2 * math.pi * ph))
        rough = 0.55 + 0.45 * math.sin(2 * math.pi * am * (i / SR))
        env = min(1.0, i / (0.008 * SR)) * (1 - t) ** decay
        out.append(carrier * rough * env)
    return out


def silence(dur):
    return [0.0] * int(dur * SR)


def lowpass(sig, k=0.22):
    y = 0.0
    out = []
    for s in sig:
        y += k * (s - y)
        out.append(y)
    return out


def write(name, sig, gain=0.9):
    peak = max(abs(s) for s in sig) or 1.0
    g = gain / peak
    with wave.open(os.path.join(OUT, name + ".wav"), "w") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(
            b"".join(struct.pack("<h", int(s * g * 32000)) for s in sig)
        )


def main():
    os.makedirs(OUT, exist_ok=True)
    rng = random.Random(0xF706)

    # ambient ribbits: two-burst "rib-bit", random register per variant
    for i in range(4):
        f0 = rng.uniform(95, 150)
        sig = (
            burst(0.10, f0 * 1.05, f0 * 0.85, am=rng.uniform(20, 28))
            + silence(0.055)
            + burst(0.17, f0 * 1.3, f0 * 0.9, am=rng.uniform(20, 28))
        )
        write(f"croak_{i}", lowpass(sig))

    # jump "hup!": short rising chirp
    for i, f in enumerate([260.0, 320.0]):
        sig = burst(0.13, f, f * 2.1, am=34.0, timbre=1.6, decay=0.5)
        write(f"croak_jump_{i}", lowpass(sig, 0.35), gain=0.8)

    # pickup: happy three-note trill
    sig = []
    for f in [330.0, 415.0, 525.0]:
        sig += burst(0.075, f, f * 1.12, am=30.0, timbre=1.8, decay=0.4)
        sig += silence(0.018)
    write("croak_pickup", lowpass(sig, 0.4), gain=0.8)

    # ouch: short pained yelp after a hard landing
    for i, f in enumerate([340.0, 285.0]):
        sig = burst(0.17, f, f * 0.45, am=42.0, timbre=3.0, decay=1.1)
        write(f"croak_ouch_{i}", lowpass(sig, 0.3), gain=0.85)

    # death: long sad deflating croak
    sig = burst(0.5, 185.0, 62.0, am=17.0, timbre=2.8, decay=1.4)
    write("croak_death", lowpass(sig))

    print("wrote", sorted(os.listdir(OUT)))


if __name__ == "__main__":
    main()
