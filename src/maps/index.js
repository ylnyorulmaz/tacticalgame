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

// How much punishment each kind of cover takes before it stops being cover.
// A wrecked vehicle is already wrecked; nothing short of another war moves it.
const PROP_HP = { crate: 55, sandbags: 130, wreck: Infinity };

export function buildMap(id) {
    const builder = BUILDERS[id] || BUILDERS[DEFAULT_MAP];
    const level = builder();
    // Assigned here rather than in every map file: cover carries state through a
    // mission exactly like doors do, and both get a fresh copy per build.
    for (const prop of level.props) {
        if (prop.hp === undefined) prop.hp = PROP_HP[prop.type] ?? Infinity;
        prop.maxHp = prop.hp;
    }
    return level;
}

export function mapInfo(id) {
    return MAPS.find((m) => m.id === id) || MAPS[0];
}
