// The single CQB map: one building with three rooms, two doors, cover props and
// a tree line the squad stages behind. Geometry is plain data so the nav grid,
// the vision segments and the renderer can all consume the same source.

import { WORLD } from './config.js';

// Deterministic PRNG so the foliage looks hand-placed but is identical on every
// load (screenshots and bug reports stay reproducible).
function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
        a |= 0;
        a = (a + 0x6d2b79f5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

const BUILDING = { left: 900, top: 240, right: 1600, bottom: 660, thickness: 16 };

const walls = [
    // Outer shell. The bottom wall is split to leave the front door gap.
    { x: 900, y: 240, w: 700, h: 16 },
    { x: 900, y: 240, w: 16, h: 420 },
    { x: 1584, y: 240, w: 16, h: 420 },
    { x: 900, y: 644, w: 140, h: 16 },
    { x: 1140, y: 644, w: 460, h: 16 },
    // Vertical partition (room A | rooms B/C), split for the inner door.
    { x: 1180, y: 256, w: 16, h: 204 },
    { x: 1180, y: 560, w: 16, h: 84 },
    // Horizontal partition (room B | room C) with an open doorway, no door leaf.
    { x: 1196, y: 440, w: 184, h: 16 },
    { x: 1480, y: 440, w: 104, h: 16 },
];

const doors = [
    { id: 'front', x: 1040, y: 644, w: 100, h: 16, axis: 'h', open: false, breachedBy: null },
    { id: 'inner', x: 1180, y: 460, w: 16, h: 100, axis: 'v', open: false, breachedBy: null },
];

const props = [
    // Sandbag emplacement outside the east side: stops bullets, not sight.
    { type: 'sandbags', x: 1746, y: 726, radius: 70, angle: Math.PI * 1.5, blocksSight: false, blocksMove: true },
    // Burnt-out vehicles: hard cover, they block sight too.
    { type: 'wreck', x: 1966, y: 430, w: 104, h: 226, blocksSight: true, blocksMove: true },
    { type: 'wreck', x: 520, y: 690, w: 100, h: 210, blocksSight: true, blocksMove: true },
];

function buildTrees() {
    const rng = mulberry32(20260813);
    const trees = [];

    const addCluster = (cx, cy, scale) => {
        const blobCount = 5 + Math.floor(rng() * 4);
        const blobs = [];
        for (let i = 0; i < blobCount; i++) {
            const a = rng() * Math.PI * 2;
            const d = rng() * 34 * scale;
            blobs.push({
                dx: Math.cos(a) * d,
                dy: Math.sin(a) * d * 0.8,
                r: (26 + rng() * 20) * scale,
                tone: rng(),
            });
        }
        trees.push({ x: cx, y: cy, scale, blobs });
    };

    // Main tree line the squad forms up behind, drawn as a lazy wave.
    for (let x = 60; x < WORLD.width; x += 118 + rng() * 60) {
        const y = 1010 + Math.sin(x * 0.0032) * 90 + (rng() - 0.5) * 90;
        addCluster(x, y, 0.9 + rng() * 0.5);
    }
    // A thinner band along the north edge and scattered singles for depth.
    for (let x = 120; x < WORLD.width; x += 200 + rng() * 160) {
        addCluster(x, 90 + (rng() - 0.5) * 110, 0.8 + rng() * 0.4);
    }
    const scatter = [
        [230, 400], [360, 250], [180, 760], [2280, 240], [2300, 900],
        [2150, 1180], [700, 1420], [1900, 1380], [420, 1300], [2320, 620],
    ];
    for (const [x, y] of scatter) addCluster(x, y, 0.85 + rng() * 0.5);

    return trees;
}

export const LEVEL = {
    building: BUILDING,
    // White interior slab plus the little entry porch seen in the reference art.
    floors: [
        { x: 900, y: 240, w: 700, h: 420 },
        { x: 1046, y: 660, w: 88, h: 14 },
    ],
    walls,
    doors,
    props,
    trees: buildTrees(),
    squad: [
        { cls: 'operator', x: 1044, y: 1286, facing: -Math.PI / 2 },
        { cls: 'breacher', x: 1116, y: 1318, facing: -Math.PI / 2 },
        { cls: 'operator', x: 1188, y: 1286, facing: -Math.PI / 2 },
        { cls: 'breacher', x: 1260, y: 1318, facing: -Math.PI / 2 },
    ],
    hostiles: [
        // Room A: watches the front door.
        { x: 1010, y: 380, facing: Math.PI / 2, route: null },
        // Room B: static overwatch on the north-east corner.
        { x: 1460, y: 320, facing: Math.PI, route: null },
        // Room C: paces between the two ends of the back room.
        { x: 1282, y: 560, facing: 0, route: [{ x: 1282, y: 560 }, { x: 1518, y: 592 }] },
        // Outside: mans the sandbag position.
        { x: 1746, y: 676, facing: Math.PI / 2, route: [{ x: 1746, y: 676 }, { x: 1900, y: 800 }] },
    ],
    // Where the camera opens: on the squad, with the objective just up-screen.
    cameraStart: { x: 1180, y: 1060 },
};

export function rectContains(rect, x, y) {
    return x >= rect.x && x <= rect.x + rect.w && y >= rect.y && y <= rect.y + rect.h;
}

// Permanently solid geometry: walls and wrecks, never doors. The nav grid uses
// this one, because a closed door has to stay reachable — a unit walks up to it
// and breaches it.
export function staticSolidRects(level = LEVEL) {
    const rects = level.walls.slice();
    for (const prop of level.props) {
        if (!prop.blocksMove) continue;
        if (prop.type === 'wreck') {
            rects.push({ x: prop.x - prop.w / 2, y: prop.y - prop.h / 2, w: prop.w, h: prop.h });
        }
    }
    return rects;
}

// Every rectangle that should stop a bullet or a body, doors included when shut.
export function solidRects(level = LEVEL) {
    const rects = level.walls.slice();
    for (const door of level.doors) {
        if (!door.open) rects.push(door);
    }
    for (const prop of level.props) {
        if (!prop.blocksMove) continue;
        if (prop.type === 'wreck') {
            rects.push({ x: prop.x - prop.w / 2, y: prop.y - prop.h / 2, w: prop.w, h: prop.h });
        }
    }
    return rects;
}

// Rectangles that block line of sight. Sandbags are low cover: you can see over
// them, you just cannot walk or shoot through them.
export function sightBlockingRects(level = LEVEL) {
    const rects = level.walls.slice();
    for (const door of level.doors) {
        if (!door.open) rects.push(door);
    }
    for (const prop of level.props) {
        if (prop.blocksSight && prop.type === 'wreck') {
            rects.push({ x: prop.x - prop.w / 2, y: prop.y - prop.h / 2, w: prop.w, h: prop.h });
        }
    }
    return rects;
}

// Sandbags are an arc of low cover: bullets and bodies stop, sight does not.
export const SANDBAG_HALF_SPREAD = Math.PI * 0.62;
export const SANDBAG_THICKNESS = 15;

export function sandbagArcs(level = LEVEL) {
    return level.props.filter((p) => p.type === 'sandbags');
}

export function pointInSandbag(arc, x, y, pad = 0) {
    const dx = x - arc.x;
    const dy = y - arc.y;
    const dist = Math.hypot(dx, dy);
    const band = SANDBAG_THICKNESS + pad;
    if (dist < arc.radius - band || dist > arc.radius + band) return false;
    let delta = Math.atan2(dy, dx) - arc.angle;
    delta = Math.atan2(Math.sin(delta), Math.cos(delta));
    return Math.abs(delta) <= SANDBAG_HALF_SPREAD;
}
