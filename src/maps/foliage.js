// Shared foliage generator. Every map seeds it differently, so the greenery
// looks hand-placed but is identical on every load — screenshots and bug reports
// stay reproducible.

export function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
        a |= 0;
        a = (a + 0x6d2b79f5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

// A leafy cluster is a handful of overlapping blobs; the renderer layers them
// dark to light to make foliage out of them.
export function makeCluster(rng) {
    return (cx, cy, scale) => {
        const blobs = [];
        const count = 5 + Math.floor(rng() * 4);
        for (let i = 0; i < count; i++) {
            const angle = rng() * Math.PI * 2;
            const dist = rng() * 34 * scale;
            blobs.push({
                dx: Math.cos(angle) * dist,
                dy: Math.sin(angle) * dist * 0.8,
                r: (26 + rng() * 20) * scale,
                tone: rng(),
            });
        }
        return { x: cx, y: cy, scale, blobs };
    };
}

// `bands` are wavy tree lines, `scatter` are individual clumps.
export function treeField(seed, { bands = [], scatter = [] } = {}) {
    const rng = mulberry32(seed);
    const cluster = makeCluster(rng);
    const trees = [];

    for (const band of bands) {
        const { fromX = 0, toX = 2400, y, wave = 0, waveLength = 0.003, spacing = 120, jitter = 90, scale = 1 } = band;
        for (let x = fromX; x < toX; x += spacing + rng() * (spacing * 0.5)) {
            const cy = y + Math.sin(x * waveLength) * wave + (rng() - 0.5) * jitter;
            trees.push(cluster(x, cy, scale + rng() * 0.5));
        }
    }
    for (const [x, y, scale = 0.85] of scatter) {
        trees.push(cluster(x, y, scale + rng() * 0.5));
    }
    return trees;
}
