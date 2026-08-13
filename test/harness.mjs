// A test harness small enough to read in one sitting: no framework, no config,
// no watch mode. Suites export `run(t)` and use these three assertions.

export function suite(name) {
    const failures = [];
    const checks = [];

    const t = {
        ok(condition, message) {
            checks.push(message);
            if (!condition) failures.push(message);
        },
        equal(actual, expected, message) {
            checks.push(message);
            if (actual !== expected) failures.push(`${message} — expected ${expected}, got ${actual}`);
        },
        // Reports every offender rather than only the first, which matters for
        // map data where one edit can break several spawns at once.
        empty(list, message) {
            checks.push(message);
            if (list.length > 0) failures.push(`${message}:\n      - ${list.join('\n      - ')}`);
        },
    };

    return {
        t,
        report() {
            const passed = checks.length - failures.length;
            if (failures.length === 0) {
                console.log(`  ✓ ${name} (${passed}/${checks.length})`);
            } else {
                console.log(`  ✗ ${name} (${passed}/${checks.length})`);
                for (const failure of failures) console.log(`      ${failure}`);
            }
            return failures.length;
        },
    };
}
