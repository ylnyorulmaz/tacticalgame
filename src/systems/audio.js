// Procedural sound. Every effect is synthesised from noise and oscillators at
// runtime — the game ships no audio files, for the same reason it ships no
// sprites: nothing to load, nothing to go missing.
//
// A sound is a stack of layers. Each layer is either a burst of filtered noise
// (the body of a gunshot, an explosion, splintering wood) or a swept oscillator
// (the low thump under a shot, UI blips, the win/lose stings). Position comes
// from the camera: sounds fall off with distance from the middle of the view and
// pan to the side they happened on.

const MAX_VOICES = 28;          // hard cap; a machine gun plus a firefight can ask for far more
const FALLOFF_RANGE = 1500;     // px from view centre at which a sound is inaudible

const SOUNDS = {
    carbine: {
        gain: 0.5,
        minGap: 20,
        layers: [
            { kind: 'noise', filter: 'bandpass', freq: [2600, 700], q: 0.9, duration: 0.11, attack: 0.002 },
            { kind: 'tone', type: 'square', freq: [180, 60], duration: 0.08, gain: 0.35 },
        ],
    },
    shotgun: {
        gain: 0.8,
        minGap: 40,
        layers: [
            { kind: 'noise', filter: 'lowpass', freq: [1800, 220], q: 0.7, duration: 0.28, attack: 0.003 },
            { kind: 'tone', type: 'sine', freq: [120, 40], duration: 0.22, gain: 0.6 },
        ],
    },
    mg: {
        gain: 0.4,
        minGap: 15,
        layers: [
            { kind: 'noise', filter: 'bandpass', freq: [2200, 600], q: 1.1, duration: 0.075, attack: 0.001 },
            { kind: 'tone', type: 'square', freq: [150, 55], duration: 0.06, gain: 0.3 },
        ],
    },
    dmr: {
        gain: 0.85,
        minGap: 60,
        layers: [
            { kind: 'noise', filter: 'bandpass', freq: [3400, 500], q: 0.8, duration: 0.34, attack: 0.001 },
            { kind: 'tone', type: 'sawtooth', freq: [220, 50], duration: 0.3, gain: 0.4 },
        ],
    },
    pdw: {
        gain: 0.38,
        minGap: 18,
        layers: [
            { kind: 'noise', filter: 'bandpass', freq: [3000, 900], q: 1.2, duration: 0.07, attack: 0.001 },
            { kind: 'tone', type: 'square', freq: [200, 80], duration: 0.05, gain: 0.25 },
        ],
    },
    grenadeThrow: {
        gain: 0.55,
        minGap: 80,
        layers: [
            { kind: 'noise', filter: 'lowpass', freq: [900, 200], q: 0.6, duration: 0.18, attack: 0.004 },
            { kind: 'tone', type: 'sine', freq: [420, 120], duration: 0.16, gain: 0.4 },
        ],
    },
    explosion: {
        gain: 1,
        minGap: 60,
        layers: [
            { kind: 'noise', filter: 'lowpass', freq: [1400, 60], q: 0.6, duration: 0.9, attack: 0.004 },
            { kind: 'tone', type: 'sine', freq: [90, 26], duration: 0.7, gain: 0.9 },
            { kind: 'noise', filter: 'highpass', freq: [2400, 900], duration: 0.14, gain: 0.5 },
        ],
    },
    impact: {
        gain: 0.2,
        minGap: 70,                 // rounds hit walls constantly; keep it a texture, not a drumroll
        layers: [
            { kind: 'noise', filter: 'highpass', freq: [1800, 3200], duration: 0.05, attack: 0.001 },
        ],
    },
    hit: {
        gain: 0.55,
        minGap: 35,
        layers: [
            { kind: 'noise', filter: 'lowpass', freq: [700, 180], q: 0.8, duration: 0.12, attack: 0.001 },
            { kind: 'tone', type: 'sine', freq: [160, 70], duration: 0.1, gain: 0.5 },
        ],
    },
    down: {
        gain: 0.75,
        minGap: 60,
        layers: [
            { kind: 'tone', type: 'triangle', freq: [420, 110], duration: 0.5, gain: 0.7 },
            { kind: 'noise', filter: 'lowpass', freq: [600, 120], duration: 0.4, gain: 0.4 },
        ],
    },
    breachStart: {
        gain: 0.5,
        minGap: 120,
        layers: [
            { kind: 'noise', filter: 'lowpass', freq: [500, 140], q: 0.9, duration: 0.16, attack: 0.002 },
            { kind: 'tone', type: 'sine', freq: [90, 50], duration: 0.14, gain: 0.5 },
        ],
    },
    breach: {
        gain: 0.9,
        minGap: 80,
        layers: [
            { kind: 'noise', filter: 'bandpass', freq: [900, 180], q: 0.7, duration: 0.35, attack: 0.002 },
            { kind: 'tone', type: 'square', freq: [110, 45], duration: 0.28, gain: 0.5 },
            { kind: 'noise', filter: 'highpass', freq: [3000, 1200], duration: 0.2, gain: 0.35, delay: 0.04 },
        ],
    },
    revive: {
        gain: 0.6,
        layers: [
            { kind: 'tone', type: 'sine', freq: [300, 760], duration: 0.35, gain: 0.6 },
            { kind: 'tone', type: 'sine', freq: [450, 1140], duration: 0.35, gain: 0.25, delay: 0.05 },
        ],
    },
    select: {
        gain: 0.25,
        minGap: 30,
        layers: [{ kind: 'tone', type: 'square', freq: [720, 900], duration: 0.05, gain: 0.5 }],
    },
    order: {
        gain: 0.3,
        minGap: 30,
        layers: [{ kind: 'tone', type: 'square', freq: [520, 780], duration: 0.07, gain: 0.5 }],
    },
    pause: {
        gain: 0.35,
        layers: [{ kind: 'tone', type: 'sine', freq: [620, 300], duration: 0.13, gain: 0.5 }],
    },
    unpause: {
        gain: 0.35,
        layers: [{ kind: 'tone', type: 'sine', freq: [300, 620], duration: 0.13, gain: 0.5 }],
    },
    win: {
        gain: 0.8,
        layers: [
            { kind: 'tone', type: 'triangle', freq: [523, 523], duration: 0.18, gain: 0.5 },
            { kind: 'tone', type: 'triangle', freq: [659, 659], duration: 0.18, gain: 0.5, delay: 0.16 },
            { kind: 'tone', type: 'triangle', freq: [784, 784], duration: 0.5, gain: 0.5, delay: 0.32 },
        ],
    },
    lose: {
        gain: 0.8,
        layers: [
            { kind: 'tone', type: 'sawtooth', freq: [330, 320], duration: 0.22, gain: 0.4 },
            { kind: 'tone', type: 'sawtooth', freq: [262, 250], duration: 0.22, gain: 0.4, delay: 0.2 },
            { kind: 'tone', type: 'sawtooth', freq: [180, 90], duration: 0.8, gain: 0.45, delay: 0.4 },
        ],
    },
};

export class AudioEngine {
    constructor(scene, { volume = 0.55 } = {}) {
        this.scene = scene;
        this.volume = volume;
        this.muted = false;
        this.voices = 0;
        this.lastPlayed = {};
        this.played = {};            // per-sound counters, handy for tests and tuning
        this.ctx = resolveContext(scene);

        if (!this.ctx) return;       // no audio available: every call below no-ops
        this.master = this.ctx.createGain();
        this.master.gain.value = volume;
        this.master.connect(this.ctx.destination);
        this.noiseBuffer = createNoiseBuffer(this.ctx);
    }

    get available() {
        return !!this.ctx;
    }

    // The AudioContext is shared with Phaser and outlives a scene restart; this
    // engine's own mixer node does not.
    dispose() {
        if (this.master) this.master.disconnect();
    }

    // Every id the game can ask for. Used by the tests to prove the weapon table
    // and the sound table agree.
    static get ids() {
        return Object.keys(SOUNDS);
    }

    // Browsers keep the context suspended until the user interacts with the page.
    resume() {
        if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
    }

    setMuted(muted) {
        this.muted = muted;
        if (this.master) {
            this.master.gain.setTargetAtTime(muted ? 0 : this.volume, this.ctx.currentTime, 0.02);
        }
    }

    toggleMute() {
        this.setMuted(!this.muted);
        return this.muted;
    }

    // Drain a batch of {type, x, y} events emitted by the simulation.
    playEvents(events) {
        for (const event of events) this.play(event.type, event.x, event.y);
    }

    play(id, x, y) {
        const def = SOUNDS[id];
        if (!def || !this.ctx || this.muted) return false;

        const now = this.ctx.currentTime;
        const gap = (def.minGap || 0) / 1000;
        if (gap && this.lastPlayed[id] !== undefined && now - this.lastPlayed[id] < gap) return false;
        if (this.voices >= MAX_VOICES) return false;

        // World sounds attenuate and pan; UI sounds (no coordinates) play flat.
        const place = x === undefined ? { gain: 1, pan: 0 } : this.placement(x, y);
        if (place.gain <= 0.02) return false;

        this.lastPlayed[id] = now;
        this.played[id] = (this.played[id] || 0) + 1;

        const out = this.ctx.createGain();
        out.gain.value = (def.gain ?? 0.5) * place.gain;
        const panner = this.createPanner(place.pan);
        if (panner) {
            out.connect(panner);
            panner.connect(this.master);
        } else {
            out.connect(this.master);
        }

        for (const layer of def.layers) this.startLayer(layer, out, now + (layer.delay || 0));
        return true;
    }

    startLayer(layer, dest, when) {
        const ctx = this.ctx;
        const gain = ctx.createGain();
        const peak = layer.gain ?? 1;
        const attack = layer.attack ?? 0.005;

        gain.gain.setValueAtTime(0.0001, when);
        gain.gain.linearRampToValueAtTime(peak, when + attack);
        gain.gain.exponentialRampToValueAtTime(0.0001, when + layer.duration);
        gain.connect(dest);

        let source;
        if (layer.kind === 'noise') {
            source = ctx.createBufferSource();
            source.buffer = this.noiseBuffer;
            source.loop = true;
            const filter = ctx.createBiquadFilter();
            filter.type = layer.filter || 'lowpass';
            filter.Q.value = layer.q ?? 1;
            filter.frequency.setValueAtTime(layer.freq[0], when);
            filter.frequency.exponentialRampToValueAtTime(Math.max(20, layer.freq[1]), when + layer.duration);
            source.connect(filter);
            filter.connect(gain);
            // Start somewhere random in the buffer so repeated shots are not clones.
            source.start(when, Math.random() * 0.8);
        } else {
            source = ctx.createOscillator();
            source.type = layer.type || 'sine';
            source.frequency.setValueAtTime(layer.freq[0], when);
            source.frequency.exponentialRampToValueAtTime(Math.max(20, layer.freq[1]), when + layer.duration);
            source.connect(gain);
            source.start(when);
        }

        source.stop(when + layer.duration + 0.02);
        this.voices++;
        source.onended = () => {
            this.voices--;
            gain.disconnect();
        };
    }

    createPanner(pan) {
        if (!this.ctx.createStereoPanner) return null;
        const panner = this.ctx.createStereoPanner();
        panner.pan.value = pan;
        return panner;
    }

    // Distance from the middle of what the player is looking at, not from a unit:
    // the camera is the ear.
    placement(x, y) {
        const view = this.scene.cameras.main.worldView;
        const dx = x - (view.x + view.width / 2);
        const dy = y - (view.y + view.height / 2);
        const falloff = Math.max(0, 1 - Math.hypot(dx, dy) / FALLOFF_RANGE);
        return {
            gain: falloff * falloff,
            pan: Math.max(-1, Math.min(1, dx / (view.width * 0.6))),
        };
    }
}

function resolveContext(scene) {
    // Phaser owns an AudioContext and unlocks it on the first user gesture, so
    // borrow that one when it exists rather than fighting it with a second.
    if (scene.sound && scene.sound.context) return scene.sound.context;
    const Ctor = window.AudioContext || window.webkitAudioContext;
    return Ctor ? new Ctor() : null;
}

function createNoiseBuffer(ctx, seconds = 1) {
    const buffer = ctx.createBuffer(1, Math.floor(ctx.sampleRate * seconds), ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    return buffer;
}
