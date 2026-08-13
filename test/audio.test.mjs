// The generated sound bank and the code that asks for it must agree. The sprite
// module and the weapon `sound` ids are written by different hands (one by
// tools/build-audio.mjs, one by hand in config.js), so this is exactly the seam
// where a rename goes unnoticed until the game is silent.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { SPRITE, VARIANTS } from '../src/audio-sprite.js';
import { UNIT_CLASSES } from '../src/config.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

export const name = 'audio';

export function run(t) {
    // Every sound the game plays by name, beyond the weapons.
    const expected = [
        'carbine', 'shotgun', 'mg', 'dmr', 'pdw', 'grenadeThrow', 'explosion',
        'impact', 'hit', 'down', 'breachStart', 'breach', 'revive',
        'select', 'order', 'pause', 'unpause', 'win', 'lose',
    ];
    const missing = expected.filter((id) => !VARIANTS[id]);
    t.empty(missing, 'every sound the game asks for exists in the bank');

    const unresolved = [];
    for (const cls of Object.values(UNIT_CLASSES)) {
        const sound = cls.weapon.sound;
        if (!sound) unresolved.push(`${cls.id} has no weapon sound`);
        else if (!VARIANTS[sound]) unresolved.push(`${cls.id} -> ${sound}`);
    }
    t.empty(unresolved, 'every weapon resolves to a sound in the bank');

    // Each take must exist as a sprite entry with a sane length.
    const badTakes = [];
    for (const [id, takes] of Object.entries(VARIANTS)) {
        if (takes.length === 0) badTakes.push(`${id} has no takes`);
        for (const take of takes) {
            const entry = SPRITE[take];
            if (!entry) { badTakes.push(`${take} missing from the sprite`); continue; }
            const [offset, duration] = entry;
            if (!(offset >= 0)) badTakes.push(`${take} has a bad offset`);
            if (!(duration > 20 && duration < 4000)) badTakes.push(`${take} lasts ${duration}ms`);
        }
    }
    t.empty(badTakes, 'every take has a usable sprite entry');

    // Weapons get several takes so a burst does not sound like one sample.
    const thin = ['carbine', 'shotgun', 'mg', 'dmr', 'pdw']
        .filter((id) => (VARIANTS[id] || []).length < 2);
    t.empty(thin, 'weapons have more than one take');

    // The WAV really contains what the sprite claims.
    const wav = readFileSync(join(ROOT, 'assets/audio/sfx.wav'));
    t.equal(wav.toString('ascii', 0, 4), 'RIFF', 'sound bank is a RIFF file');
    const rate = wav.readUInt32LE(24);
    const dataBytes = wav.readUInt32LE(40);
    const seconds = dataBytes / (rate * 2);           // 16-bit mono
    const lastEnd = Math.max(...Object.values(SPRITE).map(([o, d]) => o + d)) / 1000;
    t.ok(rate >= 16000, `sample rate is usable (${rate} Hz)`);
    t.ok(seconds >= lastEnd, `wav is long enough for the sprite (${seconds.toFixed(2)}s >= ${lastEnd.toFixed(2)}s)`);
}
