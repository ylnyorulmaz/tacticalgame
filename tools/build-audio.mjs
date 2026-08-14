// Offline sound bank generator.
//
// Renders every effect to samples and packs them into one WAV sprite that Howler
// plays at runtime. Doing this ahead of time buys things the old per-frame Web
// Audio synthesis could never afford: layered transients, saturation, reverb
// tails, and several takes of each weapon so a burst does not sound like one
// sample on repeat.
//
// Deterministic: same seed in, same bytes out.
//
//   node tools/build-audio.mjs
//
// Writes assets/audio/sfx.wav and src/audio-sprite.js.

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const RATE = 22050;
const GAP = 0.03;              // silence between clips so neighbours cannot bleed

// ---------------------------------------------------------------- primitives

function mulberry32(seed) {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

// RBJ cookbook biquad, coefficients recomputed per sample so the cutoff can
// sweep across the life of a layer.
function biquad(input, type, freqFrom, freqTo, q) {
    const out = new Float32Array(input.length);
    let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
    for (let i = 0; i < input.length; i++) {
        const t = i / Math.max(1, input.length - 1);
        const freq = Math.max(20, freqFrom * Math.pow(freqTo / freqFrom, t));
        const w0 = (2 * Math.PI * freq) / RATE;
        const cos = Math.cos(w0);
        const alpha = Math.sin(w0) / (2 * q);

        let b0, b1, b2;
        const a0 = 1 + alpha;
        const a1 = -2 * cos;
        const a2 = 1 - alpha;
        if (type === 'lowpass') {
            b0 = (1 - cos) / 2; b1 = 1 - cos; b2 = (1 - cos) / 2;
        } else if (type === 'highpass') {
            b0 = (1 + cos) / 2; b1 = -(1 + cos); b2 = (1 + cos) / 2;
        } else {
            b0 = alpha; b1 = 0; b2 = -alpha;                    // bandpass
        }

        const x0 = input[i];
        const y0 = (b0 / a0) * x0 + (b1 / a0) * x1 + (b2 / a0) * x2 - (a1 / a0) * y1 - (a2 / a0) * y2;
        x2 = x1; x1 = x0; y2 = y1; y1 = y0;
        out[i] = y0;
    }
    return out;
}

function envelope(length, attack, decay, curve = 3) {
    const env = new Float32Array(length);
    const attackSamples = Math.max(1, Math.floor(attack * RATE));
    for (let i = 0; i < length; i++) {
        if (i < attackSamples) {
            env[i] = i / attackSamples;
        } else {
            const t = (i - attackSamples) / Math.max(1, length - attackSamples);
            env[i] = Math.pow(1 - t, curve) * Math.exp(-t * decay);
        }
    }
    return env;
}

function noiseLayer(length, rng) {
    const buf = new Float32Array(length);
    for (let i = 0; i < length; i++) buf[i] = rng() * 2 - 1;
    return buf;
}

function oscLayer(length, type, freqFrom, freqTo) {
    const buf = new Float32Array(length);
    let phase = 0;
    for (let i = 0; i < length; i++) {
        const t = i / Math.max(1, length - 1);
        const freq = freqFrom * Math.pow(Math.max(1, freqTo) / Math.max(1, freqFrom), t);
        phase += (2 * Math.PI * freq) / RATE;
        if (type === 'sine') buf[i] = Math.sin(phase);
        else if (type === 'square') buf[i] = Math.sin(phase) >= 0 ? 1 : -1;
        else if (type === 'triangle') buf[i] = (2 / Math.PI) * Math.asin(Math.sin(phase));
        else buf[i] = ((phase / Math.PI) % 2) - 1;              // sawtooth
    }
    return buf;
}

// Schroeder reverb: four combs in parallel into two allpasses. Cheap, and the
// short tail is what makes a shot sound like it happened somewhere.
function reverb(input, { decay = 0.4, wet = 0.3, tailSeconds = 0.5 }) {
    const tail = Math.floor(tailSeconds * RATE);
    const out = new Float32Array(input.length + tail);
    out.set(input);

    const combs = [1116, 1188, 1277, 1356].map((d) => ({
        buf: new Float32Array(Math.floor((d * RATE) / 44100)),
        idx: 0,
        store: 0,
    }));
    const allpasses = [556, 441].map((d) => ({
        buf: new Float32Array(Math.floor((d * RATE) / 44100)),
        idx: 0,
    }));

    const wetOut = new Float32Array(out.length);
    for (let i = 0; i < out.length; i++) {
        const dry = out[i];
        let acc = 0;
        for (const comb of combs) {
            const sample = comb.buf[comb.idx];
            acc += sample;
            comb.store = sample * (1 - 0.25) + comb.store * 0.25;   // damping
            comb.buf[comb.idx] = dry + comb.store * decay;
            comb.idx = (comb.idx + 1) % comb.buf.length;
        }
        let value = acc / combs.length;
        for (const ap of allpasses) {
            const sample = ap.buf[ap.idx];
            const output = -value + sample;
            ap.buf[ap.idx] = value + sample * 0.5;
            ap.idx = (ap.idx + 1) % ap.buf.length;
            value = output;
        }
        wetOut[i] = value;
    }

    for (let i = 0; i < out.length; i++) out[i] = out[i] + wetOut[i] * wet;
    return out;
}

function saturate(buf, amount) {
    if (!amount) return buf;
    for (let i = 0; i < buf.length; i++) buf[i] = Math.tanh(buf[i] * amount) / Math.tanh(amount);
    return buf;
}

function normalize(buf, peak = 0.92) {
    let max = 0;
    for (let i = 0; i < buf.length; i++) max = Math.max(max, Math.abs(buf[i]));
    if (max < 1e-6) return buf;
    const scale = peak / max;
    for (let i = 0; i < buf.length; i++) buf[i] *= scale;
    return buf;
}

// Reverb tails decay exponentially and spend most of their length inaudible.
// Cut the clip once the signal stays below the floor — this is the difference
// between a 1 MB sprite and a 600 KB one, with nothing audible lost.
function trimTail(buf, floor = 0.004) {
    let last = buf.length - 1;
    while (last > 0 && Math.abs(buf[last]) < floor) last--;
    return buf.subarray(0, Math.min(buf.length, last + Math.floor(0.02 * RATE)));
}

// Kill the last few ms so a clip never ends on a step.
function fadeOut(buf, seconds = 0.012) {
    const n = Math.min(buf.length, Math.floor(seconds * RATE));
    for (let i = 0; i < n; i++) buf[buf.length - n + i] *= 1 - i / n;
    return buf;
}

function render(def, rng) {
    const longest = def.layers.reduce((max, l) => Math.max(max, (l.delay || 0) + l.duration), 0);
    const total = Math.ceil(longest * RATE);
    const mix = new Float32Array(total);

    for (const layer of def.layers) {
        const length = Math.floor(layer.duration * RATE);
        const jitter = 1 + (rng() - 0.5) * (layer.jitter ?? 0.12);
        let buf = layer.kind === 'noise'
            ? noiseLayer(length, rng)
            : oscLayer(length, layer.type || 'sine', layer.freq[0] * jitter, layer.freq[1] * jitter);

        if (layer.kind === 'noise') {
            buf = biquad(buf, layer.filter || 'lowpass', layer.freq[0] * jitter, layer.freq[1] * jitter, layer.q ?? 1);
        }
        const env = envelope(length, layer.attack ?? 0.002, layer.decay ?? 4, layer.curve ?? 3);
        const gain = layer.gain ?? 1;
        const offset = Math.floor((layer.delay || 0) * RATE);
        for (let i = 0; i < length; i++) {
            const target = offset + i;
            if (target >= total) break;
            mix[target] += buf[i] * env[i] * gain;
        }
    }

    let out = saturate(mix, def.drive);
    if (def.reverb) out = reverb(out, def.reverb);
    return fadeOut(trimTail(normalize(out, def.peak ?? 0.92)));
}

// ------------------------------------------------------------- the sound bank

// Layer shapes carry over from the old runtime recipes; the extra time budget
// buys longer bodies, reverb tails and per-take jitter.
const BANK = {
    carbine: {
        takes: 3,
        drive: 2.2,
        reverb: { decay: 0.32, wet: 0.28, tailSeconds: 0.34 },
        layers: [
            { kind: 'noise', filter: 'bandpass', freq: [3200, 700], q: 0.9, duration: 0.09, attack: 0.0008, decay: 9 },
            { kind: 'noise', filter: 'lowpass', freq: [1400, 240], q: 0.8, duration: 0.2, attack: 0.001, decay: 6, gain: 0.7 },
            { kind: 'osc', type: 'square', freq: [190, 62], duration: 0.1, decay: 8, gain: 0.5 },
        ],
    },
    shotgun: {
        takes: 3,
        drive: 2.6,
        reverb: { decay: 0.42, wet: 0.34, tailSeconds: 0.5 },
        layers: [
            { kind: 'noise', filter: 'lowpass', freq: [2200, 200], q: 0.7, duration: 0.34, attack: 0.0012, decay: 5 },
            { kind: 'osc', type: 'sine', freq: [140, 38], duration: 0.28, decay: 5, gain: 0.85 },
            { kind: 'noise', filter: 'highpass', freq: [2600, 1200], duration: 0.06, decay: 12, gain: 0.4 },
        ],
    },
    mg: {
        takes: 3,
        drive: 2.4,
        reverb: { decay: 0.3, wet: 0.24, tailSeconds: 0.26 },
        layers: [
            { kind: 'noise', filter: 'bandpass', freq: [2600, 620], q: 1.1, duration: 0.07, attack: 0.0006, decay: 11 },
            { kind: 'osc', type: 'square', freq: [165, 55], duration: 0.08, decay: 9, gain: 0.45 },
            { kind: 'noise', filter: 'lowpass', freq: [900, 200], duration: 0.14, decay: 8, gain: 0.5 },
        ],
    },
    dmr: {
        takes: 3,
        drive: 2.8,
        reverb: { decay: 0.55, wet: 0.4, tailSeconds: 0.7 },
        layers: [
            { kind: 'noise', filter: 'bandpass', freq: [4200, 520], q: 0.8, duration: 0.13, attack: 0.0005, decay: 8 },
            { kind: 'noise', filter: 'lowpass', freq: [1800, 180], q: 0.7, duration: 0.3, decay: 5, gain: 0.8 },
            { kind: 'osc', type: 'sawtooth', freq: [240, 46], duration: 0.24, decay: 6, gain: 0.5 },
        ],
    },
    pdw: {
        takes: 3,
        drive: 2,
        reverb: { decay: 0.28, wet: 0.22, tailSeconds: 0.24 },
        layers: [
            { kind: 'noise', filter: 'bandpass', freq: [3600, 900], q: 1.2, duration: 0.06, attack: 0.0006, decay: 12 },
            { kind: 'osc', type: 'square', freq: [220, 85], duration: 0.06, decay: 10, gain: 0.35 },
        ],
    },
    grenadeThrow: {
        takes: 2,
        drive: 1.6,
        reverb: { decay: 0.3, wet: 0.2, tailSeconds: 0.24 },
        layers: [
            { kind: 'noise', filter: 'lowpass', freq: [1100, 180], q: 0.6, duration: 0.2, attack: 0.003, decay: 6 },
            { kind: 'osc', type: 'sine', freq: [460, 120], duration: 0.18, decay: 7, gain: 0.5 },
        ],
    },
    explosion: {
        takes: 2,
        drive: 3.2,
        peak: 0.98,
        reverb: { decay: 0.72, wet: 0.5, tailSeconds: 1 },
        layers: [
            { kind: 'noise', filter: 'lowpass', freq: [1800, 50], q: 0.6, duration: 0.85, attack: 0.003, decay: 3.5 },
            { kind: 'osc', type: 'sine', freq: [110, 22], duration: 0.7, decay: 3, gain: 1 },
            { kind: 'noise', filter: 'highpass', freq: [3000, 800], duration: 0.16, decay: 9, gain: 0.55 },
            { kind: 'noise', filter: 'lowpass', freq: [700, 120], duration: 0.5, decay: 4, gain: 0.4, delay: 0.05 },
        ],
    },
    impact: {
        takes: 3,
        drive: 1.4,
        layers: [
            { kind: 'noise', filter: 'highpass', freq: [2000, 3400], duration: 0.05, attack: 0.0006, decay: 14 },
            { kind: 'noise', filter: 'bandpass', freq: [900, 400], q: 1.4, duration: 0.09, decay: 10, gain: 0.5 },
        ],
    },
    hit: {
        takes: 3,
        drive: 1.8,
        layers: [
            { kind: 'noise', filter: 'lowpass', freq: [800, 160], q: 0.8, duration: 0.13, attack: 0.0008, decay: 9 },
            { kind: 'osc', type: 'sine', freq: [180, 62], duration: 0.11, decay: 8, gain: 0.6 },
        ],
    },
    down: {
        takes: 2,
        drive: 1.5,
        reverb: { decay: 0.4, wet: 0.25, tailSeconds: 0.4 },
        layers: [
            { kind: 'osc', type: 'triangle', freq: [430, 100], duration: 0.5, decay: 3.5, gain: 0.75 },
            { kind: 'noise', filter: 'lowpass', freq: [700, 120], duration: 0.42, decay: 4, gain: 0.45 },
        ],
    },
    breachStart: {
        takes: 2,
        drive: 2,
        reverb: { decay: 0.4, wet: 0.28, tailSeconds: 0.34 },
        layers: [
            { kind: 'noise', filter: 'lowpass', freq: [600, 130], q: 0.9, duration: 0.18, attack: 0.0015, decay: 7 },
            { kind: 'osc', type: 'sine', freq: [95, 46], duration: 0.16, decay: 6, gain: 0.6 },
        ],
    },
    breach: {
        takes: 2,
        drive: 2.4,
        reverb: { decay: 0.5, wet: 0.36, tailSeconds: 0.55 },
        layers: [
            { kind: 'noise', filter: 'bandpass', freq: [1200, 170], q: 0.7, duration: 0.4, attack: 0.0015, decay: 5 },
            { kind: 'osc', type: 'square', freq: [120, 42], duration: 0.3, decay: 6, gain: 0.55 },
            { kind: 'noise', filter: 'highpass', freq: [3400, 1100], duration: 0.24, decay: 8, gain: 0.4, delay: 0.05 },
        ],
    },
    revive: {
        takes: 1,
        reverb: { decay: 0.35, wet: 0.3, tailSeconds: 0.4 },
        layers: [
            { kind: 'osc', type: 'sine', freq: [320, 780], duration: 0.34, attack: 0.02, decay: 3, gain: 0.7 },
            { kind: 'osc', type: 'sine', freq: [480, 1170], duration: 0.34, attack: 0.02, decay: 3, gain: 0.3, delay: 0.06 },
        ],
    },
    select: {
        takes: 1,
        layers: [{ kind: 'osc', type: 'square', freq: [760, 940], duration: 0.05, attack: 0.002, decay: 8, gain: 0.5 }],
    },
    order: {
        takes: 1,
        layers: [
            { kind: 'osc', type: 'square', freq: [520, 800], duration: 0.07, attack: 0.002, decay: 7, gain: 0.5 },
            { kind: 'osc', type: 'sine', freq: [1040, 1600], duration: 0.06, decay: 9, gain: 0.18 },
        ],
    },
    pause: {
        takes: 1,
        layers: [{ kind: 'osc', type: 'sine', freq: [640, 300], duration: 0.14, attack: 0.004, decay: 5, gain: 0.6 }],
    },
    unpause: {
        takes: 1,
        layers: [{ kind: 'osc', type: 'sine', freq: [300, 640], duration: 0.14, attack: 0.004, decay: 5, gain: 0.6 }],
    },
    win: {
        takes: 1,
        reverb: { decay: 0.5, wet: 0.32, tailSeconds: 0.6 },
        layers: [
            { kind: 'osc', type: 'triangle', freq: [523, 523], duration: 0.2, attack: 0.01, decay: 4, gain: 0.5 },
            { kind: 'osc', type: 'triangle', freq: [659, 659], duration: 0.2, attack: 0.01, decay: 4, gain: 0.5, delay: 0.17 },
            { kind: 'osc', type: 'triangle', freq: [784, 784], duration: 0.45, attack: 0.01, decay: 2.5, gain: 0.55, delay: 0.34 },
        ],
    },
    // A suppressed weapon: the crack is gone and what is left is the action
    // working. Quiet enough that the alarm rules treat it as a local noise only.
    suppressed: {
        takes: 3,
        drive: 1.2,
        reverb: { decay: 0.22, wet: 0.12, tailSeconds: 0.16 },
        layers: [
            { kind: 'noise', filter: 'lowpass', freq: [900, 190], q: 0.8, duration: 0.1, attack: 0.001, decay: 11, gain: 0.55 },
            { kind: 'osc', type: 'sine', freq: [180, 70], duration: 0.09, decay: 12, gain: 0.35 },
            { kind: 'noise', filter: 'bandpass', freq: [2600, 2100], q: 1.4, duration: 0.07, decay: 16, gain: 0.22, delay: 0.03 },
        ],
    },
    // Magazine out, magazine in, bolt home — three mechanical events in one clip.
    reload: {
        takes: 2,
        reverb: { decay: 0.25, wet: 0.14, tailSeconds: 0.2 },
        layers: [
            { kind: 'noise', filter: 'bandpass', freq: [2200, 1800], q: 2.2, duration: 0.04, attack: 0.001, decay: 22, gain: 0.32 },
            { kind: 'osc', type: 'square', freq: [220, 120], duration: 0.06, decay: 16, gain: 0.22, delay: 0.08 },
            { kind: 'noise', filter: 'bandpass', freq: [1500, 900], q: 1.6, duration: 0.08, decay: 14, gain: 0.38, delay: 0.34 },
            { kind: 'osc', type: 'square', freq: [300, 150], duration: 0.05, decay: 18, gain: 0.28, delay: 0.36 },
            { kind: 'noise', filter: 'highpass', freq: [2800, 2000], duration: 0.06, decay: 18, gain: 0.34, delay: 0.56 },
        ],
    },
    // Smoke: a small pop, then a long hiss as the canister burns.
    smokePop: {
        takes: 2,
        reverb: { decay: 0.4, wet: 0.24, tailSeconds: 0.5 },
        layers: [
            { kind: 'noise', filter: 'bandpass', freq: [1700, 800], q: 1.1, duration: 0.09, attack: 0.001, decay: 13, gain: 0.5 },
            { kind: 'osc', type: 'sine', freq: [260, 110], duration: 0.1, decay: 12, gain: 0.3 },
            { kind: 'noise', filter: 'highpass', freq: [3200, 2600], duration: 0.85, attack: 0.05, decay: 2.2, gain: 0.3, delay: 0.06 },
        ],
    },
    // Flashbang: all crack and ring, almost no body.
    flashBang: {
        takes: 2,
        drive: 3.2,
        reverb: { decay: 0.6, wet: 0.4, tailSeconds: 0.8 },
        layers: [
            { kind: 'noise', filter: 'highpass', freq: [2200, 1400], duration: 0.3, attack: 0.001, decay: 7, gain: 1 },
            { kind: 'osc', type: 'square', freq: [900, 300], duration: 0.12, decay: 10, gain: 0.5 },
            { kind: 'osc', type: 'sine', freq: [4200, 3600], duration: 0.9, attack: 0.02, decay: 1.6, gain: 0.22, delay: 0.08 },
        ],
    },
    // A breaching charge: sharper and shorter than a grenade, with the door in it.
    charge: {
        takes: 2,
        drive: 3,
        reverb: { decay: 0.55, wet: 0.38, tailSeconds: 0.7 },
        layers: [
            { kind: 'noise', filter: 'lowpass', freq: [1500, 180], q: 0.8, duration: 0.34, attack: 0.001, decay: 6, gain: 1 },
            { kind: 'osc', type: 'square', freq: [150, 40], duration: 0.28, decay: 7, gain: 0.7 },
            { kind: 'noise', filter: 'bandpass', freq: [2600, 1200], q: 0.9, duration: 0.35, decay: 5, gain: 0.4, delay: 0.04 },
        ],
    },
    // The garrison waking up: a two-tone call, deliberately unpleasant.
    alarm: {
        takes: 1,
        drive: 1.6,
        reverb: { decay: 0.6, wet: 0.34, tailSeconds: 0.7 },
        layers: [
            { kind: 'osc', type: 'sawtooth', freq: [520, 520], duration: 0.28, attack: 0.01, decay: 3, gain: 0.5 },
            { kind: 'osc', type: 'sawtooth', freq: [392, 392], duration: 0.34, attack: 0.01, decay: 2.6, gain: 0.5, delay: 0.26 },
        ],
    },
    // An objective ticking over: short, bright, clearly not the win sting.
    objective: {
        takes: 1,
        reverb: { decay: 0.4, wet: 0.3, tailSeconds: 0.45 },
        layers: [
            { kind: 'osc', type: 'triangle', freq: [880, 880], duration: 0.13, attack: 0.005, decay: 5, gain: 0.45 },
            { kind: 'osc', type: 'triangle', freq: [1318, 1318], duration: 0.26, attack: 0.005, decay: 3.4, gain: 0.4, delay: 0.11 },
        ],
    },
    // A tank's main gun: a flat, enormous crack with a long tail. Louder and
    // lower than anything infantry carries, so it is unmistakable.
    mainGun: {
        takes: 2,
        drive: 3.4,
        reverb: { decay: 0.75, wet: 0.42, tailSeconds: 1 },
        layers: [
            { kind: 'noise', filter: 'lowpass', freq: [2200, 110], q: 0.7, duration: 0.5, attack: 0.001, decay: 5, gain: 1 },
            { kind: 'osc', type: 'square', freq: [160, 32], duration: 0.45, decay: 5, gain: 0.8 },
            { kind: 'osc', type: 'sine', freq: [70, 26], duration: 0.6, decay: 3.5, gain: 0.7 },
            { kind: 'noise', filter: 'highpass', freq: [3600, 900], duration: 0.3, decay: 7, gain: 0.45, delay: 0.02 },
        ],
    },
    // Where the shell lands: earth and metal rather than the sharper grenade.
    shellImpact: {
        takes: 2,
        drive: 2.8,
        reverb: { decay: 0.6, wet: 0.4, tailSeconds: 0.8 },
        layers: [
            { kind: 'noise', filter: 'lowpass', freq: [1300, 90], q: 0.8, duration: 0.55, attack: 0.001, decay: 4.5, gain: 1 },
            { kind: 'osc', type: 'sawtooth', freq: [120, 30], duration: 0.5, decay: 4, gain: 0.65 },
            { kind: 'noise', filter: 'bandpass', freq: [2400, 800], q: 0.9, duration: 0.4, decay: 6, gain: 0.4, delay: 0.05 },
        ],
    },
    // A round failing to get through armour: bright, metallic, and a whine off
    // into the distance. This is the sound of shooting the wrong side of a tank.
    ricochet: {
        takes: 3,
        drive: 1.8,
        reverb: { decay: 0.4, wet: 0.3, tailSeconds: 0.5 },
        layers: [
            { kind: 'noise', filter: 'bandpass', freq: [3200, 2400], q: 2.6, duration: 0.07, attack: 0.001, decay: 16, gain: 0.7 },
            { kind: 'osc', type: 'sine', freq: [2600, 900], duration: 0.36, attack: 0.004, decay: 4.5, gain: 0.4, delay: 0.02 },
            { kind: 'osc', type: 'triangle', freq: [1800, 640], duration: 0.3, decay: 5, gain: 0.22, delay: 0.03 },
        ],
    },
    // The launcher: a whoosh and a backblast rather than a bang.
    atLaunch: {
        takes: 2,
        drive: 2.2,
        reverb: { decay: 0.55, wet: 0.35, tailSeconds: 0.7 },
        layers: [
            { kind: 'noise', filter: 'lowpass', freq: [1800, 300], q: 0.7, duration: 0.42, attack: 0.004, decay: 4, gain: 0.9 },
            { kind: 'noise', filter: 'highpass', freq: [1200, 2600], duration: 0.5, attack: 0.02, decay: 3, gain: 0.5, delay: 0.04 },
            { kind: 'osc', type: 'sawtooth', freq: [220, 70], duration: 0.3, decay: 6, gain: 0.45 },
        ],
    },
    // Idling armour: a low diesel rumble, looped by the audio engine while a
    // tank is alive and near enough to hear.
    engine: {
        takes: 1,
        drive: 1.6,
        layers: [
            { kind: 'osc', type: 'sawtooth', freq: [48, 44], duration: 0.9, attack: 0.05, decay: 0.4, gain: 0.55 },
            { kind: 'osc', type: 'square', freq: [24, 23], duration: 0.9, attack: 0.05, decay: 0.4, gain: 0.35 },
            { kind: 'noise', filter: 'lowpass', freq: [260, 180], q: 0.8, duration: 0.9, attack: 0.06, decay: 0.5, gain: 0.3 },
        ],
    },
    lose: {
        takes: 1,
        drive: 1.4,
        reverb: { decay: 0.55, wet: 0.35, tailSeconds: 0.7 },
        layers: [
            { kind: 'osc', type: 'sawtooth', freq: [330, 318], duration: 0.24, attack: 0.01, decay: 4, gain: 0.4 },
            { kind: 'osc', type: 'sawtooth', freq: [262, 250], duration: 0.24, attack: 0.01, decay: 4, gain: 0.4, delay: 0.21 },
            { kind: 'osc', type: 'sawtooth', freq: [180, 88], duration: 0.6, attack: 0.01, decay: 2.5, gain: 0.45, delay: 0.42 },
        ],
    },
};

// ----------------------------------------------------------------- packing

const clips = [];
const sprite = {};
const variants = {};
let cursor = 0;
const rng = mulberry32(0x5eed1234);

for (const [id, def] of Object.entries(BANK)) {
    const takes = def.takes || 1;
    variants[id] = [];
    for (let take = 1; take <= takes; take++) {
        const name = takes > 1 ? `${id}_${take}` : id;
        const samples = render(def, rng);
        sprite[name] = [Math.round(cursor * 1000), Math.round((samples.length / RATE) * 1000)];
        variants[id].push(name);
        clips.push(samples);
        cursor += samples.length / RATE + GAP;
    }
}

const totalSamples = Math.ceil(cursor * RATE);
const pcm = new Int16Array(totalSamples);
let writeAt = 0;
for (const clip of clips) {
    for (let i = 0; i < clip.length; i++) {
        pcm[writeAt + i] = Math.max(-32768, Math.min(32767, Math.round(clip[i] * 32767)));
    }
    writeAt += clip.length + Math.floor(GAP * RATE);
}

const header = Buffer.alloc(44);
header.write('RIFF', 0);
header.writeUInt32LE(36 + pcm.length * 2, 4);
header.write('WAVE', 8);
header.write('fmt ', 12);
header.writeUInt32LE(16, 16);
header.writeUInt16LE(1, 20);            // PCM
header.writeUInt16LE(1, 22);            // mono
header.writeUInt32LE(RATE, 24);
header.writeUInt32LE(RATE * 2, 28);
header.writeUInt16LE(2, 32);
header.writeUInt16LE(16, 34);
header.write('data', 36);
header.writeUInt32LE(pcm.length * 2, 40);

mkdirSync(join(ROOT, 'assets/audio'), { recursive: true });
writeFileSync(join(ROOT, 'assets/audio/sfx.wav'), Buffer.concat([header, Buffer.from(pcm.buffer)]));

const module = `// GENERATED by tools/build-audio.mjs — do not edit by hand.
// Sprite offsets into assets/audio/sfx.wav, and the takes available per sound.

export const SPRITE = ${JSON.stringify(sprite, null, 4).replace(/"([^"]+)":/g, '$1:')};

export const VARIANTS = ${JSON.stringify(variants, null, 4).replace(/"([^"]+)":/g, '$1:')};
`;
writeFileSync(join(ROOT, 'src/audio-sprite.js'), module);

const bytes = 44 + pcm.length * 2;
console.log(`${clips.length} clips, ${cursor.toFixed(2)}s, ${(bytes / 1024).toFixed(0)} KB`);
console.log(`sounds: ${Object.keys(variants).length}, sprite entries: ${Object.keys(sprite).length}`);
