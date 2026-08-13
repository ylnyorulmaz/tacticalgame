// Map validation. Runs in plain Node — the map modules and the nav grid touch
// no browser APIs, which is what makes this cheap enough to run on every push.
//
// This suite has already earned its keep: it caught a hostile spawned inside a
// crate and a patrol waypoint inside a wrecked truck.

import { MAPS, buildMap } from '../src/maps/index.js';
import { NavGrid } from '../src/systems/nav.js';
import { staticSolidRects, rectContains } from '../src/level.js';
import { WORLD } from '../src/config.js';

export const name = 'maps';

export function run(t) {
    t.ok(MAPS.length >= 3, 'at least three maps are on the roster');

    for (const meta of MAPS) {
        const level = buildMap(meta.id);
        const nav = new NavGrid(level);
        const solids = staticSolidRects(level);
        const inGeometry = (x, y) => solids.some((r) => rectContains(r, x, y));
        const label = meta.id;

        t.ok(level.squad.length > 0, `${label}: has a squad`);
        t.ok(level.hostiles.length > 0, `${label}: has hostiles`);

        // Inside the map, and not inside a wall or a crate. Standing in a sandbag
        // ring is fine — the nav grid inflates obstacles by a body radius, so
        // "blocked cell" alone is not a fault.
        const badSpawns = [];
        for (const spec of [...level.squad, ...level.hostiles]) {
            const who = `${spec.cls} at ${spec.x},${spec.y}`;
            if (spec.x < 0 || spec.y < 0 || spec.x > WORLD.width || spec.y > WORLD.height) {
                badSpawns.push(`${who} is off the map`);
            } else if (inGeometry(spec.x, spec.y)) {
                badSpawns.push(`${who} is inside geometry`);
            }
        }
        t.empty(badSpawns, `${label}: every spawn is standable`);

        // A sealed room means a mission that cannot be finished.
        const from = level.squad[0];
        const unreachable = [];
        for (const hostile of level.hostiles) {
            if (!nav.findPath(from.x, from.y, hostile.x, hostile.y)) {
                unreachable.push(`hostile at ${hostile.x},${hostile.y}`);
            }
        }
        for (const door of level.doors) {
            const cx = door.x + door.w / 2;
            const cy = door.y + door.h / 2;
            if (!nav.findPath(from.x, from.y, cx, cy)) unreachable.push(`door ${door.id}`);
        }
        t.empty(unreachable, `${label}: everything is reachable from the squad`);

        const badRoutes = [];
        for (const hostile of level.hostiles) {
            if (!hostile.route) continue;
            for (const wp of hostile.route) {
                if (inGeometry(wp.x, wp.y)) badRoutes.push(`waypoint ${wp.x},${wp.y}`);
            }
        }
        t.empty(badRoutes, `${label}: patrol routes stay out of walls`);

        // Doors carry state, so a second build must not inherit the first's.
        level.doors[0].open = true;
        const rebuilt = buildMap(meta.id);
        t.ok(rebuilt.doors.every((d) => !d.open), `${label}: buildMap returns fresh door state`);
    }
}
