// Outpost: open ground with two huts, dug-in sandbag positions and a wrecked
// convoy. Sightlines run the length of the map, so this is where the Marksman
// earns its keep — and where walking into the open gets people shot.

import { treeField } from './foliage.js';

const hutWalls = (left, top, width, height, gap) => {
    const right = left + width;
    const bottom = top + height;
    const walls = [
        { x: left, y: top, w: 16, h: height },
        { x: right - 16, y: top, w: 16, h: height },
    ];
    // `gap` cuts the doorway out of the top wall or the bottom one.
    if (gap.side === 'top') {
        walls.push({ x: left, y: top, w: gap.from - left, h: 16 });
        walls.push({ x: gap.from + gap.width, y: top, w: right - (gap.from + gap.width), h: 16 });
        walls.push({ x: left, y: bottom - 16, w: width, h: 16 });
    } else {
        walls.push({ x: left, y: top, w: width, h: 16 });
        walls.push({ x: left, y: bottom - 16, w: gap.from - left, h: 16 });
        walls.push({ x: gap.from + gap.width, y: bottom - 16, w: right - (gap.from + gap.width), h: 16 });
    }
    return walls;
};

const NORTH_HUT = { left: 700, top: 400, w: 300, h: 220 };
const EAST_HUT = { left: 1500, top: 700, w: 300, h: 220 };

const walls = [
    ...hutWalls(NORTH_HUT.left, NORTH_HUT.top, NORTH_HUT.w, NORTH_HUT.h, { side: 'bottom', from: 800, width: 80 }),
    ...hutWalls(EAST_HUT.left, EAST_HUT.top, EAST_HUT.w, EAST_HUT.h, { side: 'top', from: 1600, width: 80 }),
];

const props = [
    // Dug-in positions covering the approaches.
    { type: 'sandbags', x: 1180, y: 900, radius: 78, angle: Math.PI * 1.5, blocksSight: false, blocksMove: true },
    { type: 'sandbags', x: 1720, y: 420, radius: 70, angle: Math.PI, blocksSight: false, blocksMove: true },
    { type: 'sandbags', x: 560, y: 900, radius: 70, angle: 0, blocksSight: false, blocksMove: true },
    // The convoy that never made it out.
    { type: 'wreck', x: 1320, y: 300, w: 104, h: 226, blocksSight: true, blocksMove: true },
    { type: 'wreck', x: 1560, y: 260, w: 100, h: 210, blocksSight: true, blocksMove: true },
    { type: 'wreck', x: 2020, y: 980, w: 104, h: 220, blocksSight: true, blocksMove: true },
    { type: 'crate', x: 940, y: 1020, w: 66, h: 66, blocksSight: true, blocksMove: true },
    { type: 'crate', x: 1010, y: 1080, w: 54, h: 54, blocksSight: true, blocksMove: true },
];

const trees = treeField(451199, {
    bands: [
        { y: 1420, wave: 60, waveLength: 0.0025, spacing: 190, jitter: 70, scale: 0.8 },
    ],
    scatter: [
        [220, 260], [420, 620], [180, 1100], [900, 180], [1750, 1150],
        [2200, 400], [2280, 820], [2120, 1320], [640, 1250], [1450, 1250],
    ],
});

export function build() {
    return {
        id: 'outpost',
        building: { left: NORTH_HUT.left, top: NORTH_HUT.top, right: 1800, bottom: 920, thickness: 16 },
        floors: [
            { x: NORTH_HUT.left, y: NORTH_HUT.top, w: NORTH_HUT.w, h: NORTH_HUT.h },
            { x: EAST_HUT.left, y: EAST_HUT.top, w: EAST_HUT.w, h: EAST_HUT.h },
        ],
        walls,
        doors: [
            { id: 'north-hut', x: 800, y: 604, w: 80, h: 16, axis: 'h', open: false },
            { id: 'east-hut', x: 1600, y: 700, w: 80, h: 16, axis: 'h', open: false },
        ],
        props,
        trees,
        // Coming in from the south-west, with a long approach across open ground.
        squad: [
            { cls: 'marksman', x: 380, y: 1280, facing: -Math.PI / 2 },
            { cls: 'operator', x: 450, y: 1312, facing: -Math.PI / 2 },
            { cls: 'machinegunner', x: 520, y: 1280, facing: -Math.PI / 2 },
            { cls: 'medic', x: 590, y: 1312, facing: -Math.PI / 2 },
            { cls: 'grenadier', x: 660, y: 1280, facing: -Math.PI / 2 },
            { cls: 'breacher', x: 730, y: 1312, facing: -Math.PI / 2 },
        ],
        hostiles: [
            // Sentry inside the north hut.
            { cls: 'hostile', x: 780, y: 500, facing: Math.PI / 2, route: null },
            // Sentry inside the east hut.
            { cls: 'hostile', x: 1700, y: 820, facing: Math.PI, route: null },
            // The sandbag position covering the southern approach.
            { cls: 'hostileHeavy', x: 1180, y: 840, facing: Math.PI / 2, route: null },
            // Long patrol across the open middle.
            { cls: 'hostile', x: 1100, y: 620, facing: 0, route: [{ x: 900, y: 700 }, { x: 1450, y: 560 }] },
            // Patrol along the eastern edge.
            { cls: 'hostile', x: 1900, y: 600, facing: Math.PI, route: [{ x: 1900, y: 600 }, { x: 1888, y: 1128 }] },
            // Overwatch behind the convoy.
            { cls: 'hostileHeavy', x: 1440, y: 380, facing: Math.PI / 2, route: null },
            // Roams the western flank — the one that finds you first.
            { cls: 'hostileShotgun', x: 664, y: 756, facing: Math.PI / 2, route: [{ x: 664, y: 756 }, { x: 840, y: 1080 }] },
        ],
        // Open ground all round, so reinforcements simply drive up: the
        // northern track and the eastern edge.
        reinforce: [{ x: 1200, y: 120 }, { x: 2280, y: 620 }],
        // Somebody is being held in the east hut, and a grenade through the
        // door kills them as dead as it kills the guard.
        // Open ground, so the ground itself is the cover: a berm the marksman
        // can shoot over, grass to cross the middle in, and mud that bogs
        // anything heavy trying to swing round the west.
        terrain: [
            { kind: 'high', x: 980, y: 1020, w: 300, h: 180 },
            { kind: 'high', x: 1840, y: 300, w: 240, h: 200 },
            { kind: 'grass', x: 380, y: 560, w: 300, h: 520 },
            { kind: 'grass', x: 1240, y: 620, w: 420, h: 300 },
            { kind: 'grass', x: 700, y: 1140, w: 640, h: 240 },
            { kind: 'mud', x: 240, y: 1060, w: 320, h: 320 },
            { kind: 'gravel', x: 1480, y: 640, w: 360, h: 260 },
            { kind: 'gravel', x: 660, y: 340, w: 380, h: 100 },
        ],
        roads: [
            { width: 80, points: [{ x: 1200, y: 60 }, { x: 1260, y: 340 }, { x: 1420, y: 640 }, { x: 1560, y: 900 }] },
            { width: 64, points: [{ x: 2260, y: 620 }, { x: 1860, y: 700 }, { x: 1560, y: 900 }] },
        ],
        objectives: [
            { kind: 'rescue', x: 1620, y: 850, label: 'Reach the hostage' },
            { kind: 'exfil', x: 400, y: 1230, w: 380, h: 130, label: 'Walk them out' },
            { kind: 'eliminate', optional: true, label: 'Clear the outpost (bonus)' },
        ],
        cameraStart: { x: 700, y: 1120 },
    };
}
