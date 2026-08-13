// Warehouse: one big structure carved into six rooms by two long partitions,
// with four doors and crates for cover. Two ways in — the south loading door and
// an east side door — and almost no sightline longer than a room, so this is the
// Breacher's and the Machine Gunner's map.

import { treeField } from './foliage.js';

const BUILDING = { left: 560, top: 300, right: 1840, bottom: 980, thickness: 16 };

const walls = [
    // Shell. The bottom is split for the loading door, the east side for a
    // personnel door.
    { x: 560, y: 300, w: 1280, h: 16 },
    { x: 560, y: 300, w: 16, h: 680 },
    { x: 1824, y: 300, w: 16, h: 480 },
    { x: 1824, y: 880, w: 16, h: 100 },
    { x: 560, y: 964, w: 140, h: 16 },
    { x: 800, y: 964, w: 1040, h: 16 },

    // West partition: open doorway up north, a door down south.
    { x: 1000, y: 316, w: 16, h: 164 },
    { x: 1000, y: 560, w: 16, h: 240 },
    { x: 1000, y: 880, w: 16, h: 84 },

    // East partition: a door up north, open doorway down south.
    { x: 1420, y: 316, w: 16, h: 64 },
    { x: 1420, y: 460, w: 16, h: 400 },
    { x: 1420, y: 940, w: 16, h: 24 },

    // The long cross-partition, with two open gaps and one door at the far end.
    { x: 576, y: 640, w: 44, h: 16 },
    { x: 700, y: 640, w: 480, h: 16 },
    { x: 1260, y: 640, w: 440, h: 16 },
    { x: 1780, y: 640, w: 44, h: 16 },
];

// Crates: hard cover inside, and a few stacked in the yard outside.
const crate = (x, y, size = 62) => ({
    type: 'crate', x, y, w: size, h: size, blocksSight: true, blocksMove: true,
});

const props = [
    crate(760, 470), crate(830, 500, 54),
    crate(1120, 420), crate(1300, 520, 70),
    crate(1560, 430), crate(1640, 500, 54),
    crate(860, 780, 70), crate(1180, 880),
    crate(1560, 760), crate(1680, 900, 54),
    crate(2010, 900, 70), crate(2080, 830),
    { type: 'sandbags', x: 900, y: 1120, radius: 74, angle: Math.PI * 1.5, blocksSight: false, blocksMove: true },
    { type: 'wreck', x: 2130, y: 520, w: 104, h: 220, blocksSight: true, blocksMove: true },
    { type: 'wreck', x: 330, y: 780, w: 100, h: 210, blocksSight: true, blocksMove: true },
];

const trees = treeField(770231, {
    bands: [
        { y: 1330, wave: 70, waveLength: 0.0028, spacing: 150, jitter: 80, scale: 0.85 },
        { y: 120, spacing: 260, jitter: 90, scale: 0.75 },
    ],
    scatter: [[180, 380], [2280, 180], [2300, 1250], [260, 1180], [1250, 1500]],
});

export function build() {
    return {
        id: 'warehouse',
        building: BUILDING,
        floors: [
            { x: 560, y: 300, w: 1280, h: 680 },
            { x: 706, y: 980, w: 88, h: 14 },
        ],
        walls,
        doors: [
            { id: 'loading', x: 700, y: 964, w: 100, h: 16, axis: 'h', open: false },
            { id: 'side', x: 1824, y: 780, w: 16, h: 100, axis: 'v', open: false },
            { id: 'store', x: 1000, y: 800, w: 16, h: 80, axis: 'v', open: false },
            { id: 'office', x: 1420, y: 380, w: 16, h: 80, axis: 'v', open: false },
            { id: 'back', x: 1700, y: 640, w: 80, h: 16, axis: 'h', open: false },
        ],
        props,
        trees,
        // Formed up behind the sandbags south of the loading door.
        squad: [
            { cls: 'breacher', x: 760, y: 1230, facing: -Math.PI / 2 },
            { cls: 'operator', x: 830, y: 1262, facing: -Math.PI / 2 },
            { cls: 'machinegunner', x: 900, y: 1230, facing: -Math.PI / 2 },
            { cls: 'grenadier', x: 970, y: 1262, facing: -Math.PI / 2 },
            { cls: 'medic', x: 1040, y: 1230, facing: -Math.PI / 2 },
            { cls: 'marksman', x: 1110, y: 1262, facing: -Math.PI / 2 },
        ],
        hostiles: [
            // South-west bay: first contact through the loading door.
            { cls: 'hostileShotgun', x: 760, y: 870, facing: Math.PI / 2, route: null },
            { cls: 'hostile', x: 890, y: 700, facing: Math.PI / 2, route: null },
            // South-middle bay, pacing the aisle.
            { cls: 'hostileShotgun', x: 1200, y: 800, facing: 0, route: [{ x: 1160, y: 780 }, { x: 1360, y: 900 }] },
            // North-west room.
            { cls: 'hostile', x: 672, y: 396, facing: 0, route: null },
            // North-middle room, walking the length of it.
            { cls: 'hostile', x: 1190, y: 372, facing: Math.PI, route: [{ x: 1080, y: 350 }, { x: 1372, y: 588 }] },
            // The office in the north-east corner.
            { cls: 'hostileHeavy', x: 1624, y: 366, facing: Math.PI / 2, route: null },
            // South-east bay, covering the side door.
            { cls: 'hostileShotgun', x: 1650, y: 820, facing: Math.PI, route: null },
            // Outside, behind the wrecked truck in the east yard.
            { cls: 'hostileHeavy', x: 2020, y: 700, facing: Math.PI, route: null },
        ],
        // The alarm brings a team in off the yard: the north gate and the
        // east loading road.
        reinforce: [{ x: 1200, y: 120 }, { x: 2280, y: 900 }],
        // Get in, take what you came for, get out — the garrison is an
        // obstacle rather than the objective.
        objectives: [
            { kind: 'intel', x: 1740, y: 380, label: 'Recover the intel' },
            { kind: 'exfil', x: 840, y: 1200, w: 360, h: 130, label: 'Exfil with the squad' },
            { kind: 'eliminate', optional: true, label: 'Clear the warehouse (bonus)' },
        ],
        cameraStart: { x: 930, y: 1080 },
    };
}
