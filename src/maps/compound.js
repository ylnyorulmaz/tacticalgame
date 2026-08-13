// Compound: one building with three rooms and two doors, approached from a tree
// line to the south. The starter map — a straightforward breach and clear.

import { treeField } from './foliage.js';

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

const props = [
    // Sandbag emplacement outside the east side: stops bullets, not sight.
    { type: 'sandbags', x: 1746, y: 726, radius: 70, angle: Math.PI * 1.5, blocksSight: false, blocksMove: true },
    // Burnt-out vehicles: hard cover, they block sight too.
    { type: 'wreck', x: 1966, y: 430, w: 104, h: 226, blocksSight: true, blocksMove: true },
    { type: 'wreck', x: 520, y: 690, w: 100, h: 210, blocksSight: true, blocksMove: true },
];

const trees = treeField(20260813, {
    bands: [
        // The tree line the squad forms up behind, and a thinner northern band.
        { y: 1010, wave: 90, waveLength: 0.0032, spacing: 118, jitter: 90, scale: 0.9 },
        { y: 90, spacing: 200, jitter: 110, scale: 0.8 },
    ],
    scatter: [
        [230, 400], [360, 250], [180, 760], [2280, 240], [2300, 900],
        [2150, 1180], [700, 1420], [1900, 1380], [420, 1300], [2320, 620],
    ],
});

// Doors carry state (open/shut), so every mission gets its own.
export function build() {
    return {
        id: 'compound',
        building: BUILDING,
        // White interior slab plus the little entry porch from the reference art.
        floors: [
            { x: 900, y: 240, w: 700, h: 420 },
            { x: 1046, y: 660, w: 88, h: 14 },
        ],
        walls,
        doors: [
            { id: 'front', x: 1040, y: 644, w: 100, h: 16, axis: 'h', open: false },
            { id: 'inner', x: 1180, y: 460, w: 16, h: 100, axis: 'v', open: false },
        ],
        props,
        trees,
        // One of each class, staged along the tree line south of the objective.
        squad: [
            { cls: 'operator', x: 1000, y: 1288, facing: -Math.PI / 2 },
            { cls: 'breacher', x: 1070, y: 1320, facing: -Math.PI / 2 },
            { cls: 'grenadier', x: 1140, y: 1286, facing: -Math.PI / 2 },
            { cls: 'medic', x: 1210, y: 1322, facing: -Math.PI / 2 },
            { cls: 'marksman', x: 1280, y: 1288, facing: -Math.PI / 2 },
            { cls: 'machinegunner', x: 1350, y: 1320, facing: -Math.PI / 2 },
        ],
        hostiles: [
            // Room A: watches the front door.
            { cls: 'hostile', x: 1010, y: 380, facing: Math.PI / 2, route: null },
            // Room B: static overwatch on the north-east corner.
            { cls: 'hostile', x: 1460, y: 320, facing: Math.PI, route: null },
            // Room C: paces between the two ends of the back room.
            { cls: 'hostile', x: 1282, y: 560, facing: 0, route: [{ x: 1282, y: 560 }, { x: 1518, y: 592 }] },
            // Room C corner: rushes the inner door the moment it hears anything.
            { cls: 'hostileShotgun', x: 1530, y: 500, facing: Math.PI, route: null },
            // Outside: mans the sandbag position.
            { cls: 'hostile', x: 1746, y: 676, facing: Math.PI / 2, route: [{ x: 1746, y: 676 }, { x: 1900, y: 800 }] },
            // Outside: covers the yard from behind the wreck.
            { cls: 'hostileHeavy', x: 1930, y: 660, facing: Math.PI, route: null },
        ],
        // Where the camera opens: on the squad, with the objective just up-screen.
        // Where a second team walks in from once the alarm goes up: the road
        // to the north and the yard track to the east.
        reinforce: [{ x: 1240, y: 120 }, { x: 2240, y: 700 }],
        cameraStart: { x: 1180, y: 1060 },
    };
}
