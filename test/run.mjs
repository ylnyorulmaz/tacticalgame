// Test runner. `npm test` runs everything it can: the map and audio suites are
// plain Node and always run, the browser suite runs when Playwright is available
// and is skipped with a notice when it is not.

import { suite } from './harness.mjs';
import * as maps from './maps.test.mjs';
import * as audio from './audio.test.mjs';
import * as smoke from './smoke.test.mjs';

const suites = [maps, audio, smoke];

// Normally a devDependency. PLAYWRIGHT_PATH lets a machine with a global or
// otherwise unusual install point the runner at it instead.
let chromium = null;
for (const specifier of [process.env.PLAYWRIGHT_PATH, 'playwright'].filter(Boolean)) {
    try {
        const mod = await import(specifier);
        chromium = mod.chromium || (mod.default && mod.default.chromium);
        if (chromium) break;
    } catch {
        // Try the next candidate; browser suites are skipped if none work.
    }
}

console.log('tactical cqb — tests\n');
let failures = 0;

for (const module of suites) {
    if (module.needsBrowser && !chromium) {
        console.log(`  – ${module.name} (skipped: playwright not installed)`);
        continue;
    }
    const { t, report } = suite(module.name);
    try {
        await module.run(t, { chromium });
    } catch (error) {
        console.log(`  ✗ ${module.name} threw: ${error.stack || error.message}`);
        failures++;
        continue;
    }
    failures += report();
}

console.log(failures === 0 ? '\nall good' : `\n${failures} failing check(s)`);
process.exit(failures === 0 ? 0 : 1);
