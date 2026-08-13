// The map roster. `build(id)` returns a fresh level every time — doors carry
// open/shut state, so a mission must never be handed the previous one's.

import { build as compound } from './compound.js';
import { build as warehouse } from './warehouse.js';
import { build as outpost } from './outpost.js';

const BUILDERS = { compound, warehouse, outpost };

export const MAPS = [
    {
        id: 'compound',
        name: 'Compound',
        blurb: 'Three rooms, two doors, one way in. Breach and clear.',
        difficulty: 1,
    },
    {
        id: 'warehouse',
        name: 'Warehouse',
        blurb: 'Six bays, four doors, crates everywhere. Nothing is farther than a room away.',
        difficulty: 3,
    },
    {
        id: 'outpost',
        name: 'Outpost',
        blurb: 'Open ground, two huts, dug-in positions. They will see you coming.',
        difficulty: 2,
    },
];

export const DEFAULT_MAP = MAPS[0].id;

export function buildMap(id) {
    const builder = BUILDERS[id] || BUILDERS[DEFAULT_MAP];
    return builder();
}

export function mapInfo(id) {
    return MAPS.find((m) => m.id === id) || MAPS[0];
}
