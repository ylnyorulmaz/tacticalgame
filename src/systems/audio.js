// Sound playback through Howler.
//
// The bank itself is rendered ahead of time by tools/build-audio.mjs into one
// WAV sprite (assets/audio/sfx.wav) with several takes of each weapon, so this
// module only has to choose a take, place it in the stereo field and keep the
// number of simultaneous voices sane.
//
// The camera is the ear: sounds attenuate with distance from the middle of the
// view and pan to the side they happened on. Anything inaudible is dropped
// before Howler is asked for a voice at all.

import { SPRITE, VARIANTS } from '../audio-sprite.js';

const MAX_VOICES = 28;
const FALLOFF_RANGE = 1500;     // px from view centre at which a sound is inaudible

// Per-sound mix levels and the minimum gap between repeats. Rounds hitting walls
// would otherwise become a drum roll, and a machine gun would drown everything.
const MIX = {
    carbine: { gain: 0.5, minGap: 20 },
    shotgun: { gain: 0.8, minGap: 40 },
    mg: { gain: 0.4, minGap: 15 },
    dmr: { gain: 0.85, minGap: 60 },
    pdw: { gain: 0.38, minGap: 18 },
    grenadeThrow: { gain: 0.55, minGap: 80 },
    explosion: { gain: 1, minGap: 60 },
    impact: { gain: 0.2, minGap: 70 },
    hit: { gain: 0.55, minGap: 35 },
    down: { gain: 0.75, minGap: 60 },
    breachStart: { gain: 0.5, minGap: 120 },
    breach: { gain: 0.9, minGap: 80 },
    revive: { gain: 0.6 },
    select: { gain: 0.25, minGap: 30 },
    order: { gain: 0.3, minGap: 30 },
    pause: { gain: 0.35 },
    unpause: { gain: 0.35 },
    win: { gain: 0.8 },
    lose: { gain: 0.8 },
};

let shared = null;

// One engine for the whole game: Howler's context is global, and the menu and
// the mission both play through it. Scenes hand it their camera as they start.
export function getAudio(scene) {
    if (!shared) shared = new AudioEngine(scene);
    shared.setScene(scene);
    return shared;
}

export class AudioEngine {
    constructor(scene, { volume = 0.6 } = {}) {
        this.scene = scene;
        this.volume = volume;
        this.muted = false;
        this.voices = 0;
        this.loaded = false;
        this.lastPlayed = {};
        this.played = {};            // per-sound counters, used by the tests
        this.howl = null;

        if (typeof Howl === 'undefined') {
            console.warn('[audio] Howler failed to load — running silent');
            return;
        }

        this.howl = new Howl({
            src: ['assets/audio/sfx.wav'],
            sprite: SPRITE,
            html5: false,
            volume,
            onload: () => { this.loaded = true; },
            onloaderror: (id, error) => {
                console.warn('[audio] sound bank failed to load — running silent', error);
            },
        });
    }

    setScene(scene) {
        this.scene = scene;
    }

    get available() {
        return !!this.howl && this.loaded;
    }

    static get ids() {
        return Object.keys(VARIANTS);
    }

    // Browsers keep audio suspended until the page is interacted with. Howler
    // installs its own unlock handlers; this covers the rest.
    resume() {
        if (typeof Howler !== 'undefined' && Howler.ctx && Howler.ctx.state === 'suspended') {
            Howler.ctx.resume();
        }
    }

    setMuted(muted) {
        this.muted = muted;
        if (this.howl) this.howl.mute(muted);
    }

    toggleMute() {
        this.setMuted(!this.muted);
        return this.muted;
    }

    dispose() {
        // The engine is shared and outlives any one scene; nothing to tear down.
    }

    playEvents(events) {
        for (const event of events) this.play(event.type, event.x, event.y);
    }

    play(id, x, y) {
        const takes = VARIANTS[id];
        if (!takes || !this.howl || !this.loaded || this.muted) return false;

        const now = performance.now();
        const mix = MIX[id] || { gain: 0.5 };
        if (mix.minGap && this.lastPlayed[id] !== undefined && now - this.lastPlayed[id] < mix.minGap) {
            return false;
        }
        if (this.voices >= MAX_VOICES) return false;

        // World sounds attenuate and pan; UI sounds (no coordinates) play flat.
        const place = x === undefined ? { gain: 1, pan: 0 } : this.placement(x, y);
        if (place.gain <= 0.02) return false;

        const take = takes[(Math.random() * takes.length) | 0];
        const voice = this.howl.play(take);
        if (voice === undefined) return false;

        this.howl.volume(mix.gain * place.gain * this.volume, voice);
        this.howl.stereo(place.pan, voice);
        // A touch of pitch drift on top of the separate takes, so even the same
        // take twice in a row is not identical.
        this.howl.rate(0.94 + Math.random() * 0.12, voice);

        this.voices++;
        this.howl.once('end', () => { this.voices--; }, voice);

        this.lastPlayed[id] = now;
        this.played[id] = (this.played[id] || 0) + 1;
        return true;
    }

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
