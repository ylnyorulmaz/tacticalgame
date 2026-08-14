// Map validation. Runs in plain Node — the map modules and the nav grid touch
// no browser APIs, which is what makes this cheap enough to run on every push.
//
// This suite has already earned its keep: it caught a hostile spawned inside a
// crate and a patrol waypoint inside a wrecked truck.

import { MAPS, buildMap } from '../src/maps/index.js';
import { NavGrid } from '../src/systems/nav.js';
import { staticSolidRects, rectContains } from '../src/level.js';
import { WORLD, SURFACES, UNIT_CLASSES, ALARM } from '../src/config.js';

// Matches GameScene's vehicle grid.
const VEHICLE_RADIUS = 34;

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

        // Reinforcements walk in from these, so a point inside a wall or cut off
        // from the map would be a wave that never arrives.
        const badEntries = [];
        for (const entry of level.reinforce || []) {
            const where = `entry at ${entry.x},${entry.y}`;
            if (entry.x < 0 || entry.y < 0 || entry.x > WORLD.width || entry.y > WORLD.height) {
                badEntries.push(`${where} is off the map`);
            } else if (inGeometry(entry.x, entry.y)) {
                badEntries.push(`${where} is inside geometry`);
            } else if (!nav.findPath(entry.x, entry.y, from.x, from.y)) {
                badEntries.push(`${where} cannot reach the squad`);
            }
        }
        t.ok((level.reinforce || []).length > 0, `${label}: has reinforcement entry points`);
        t.empty(badEntries, `${label}: reinforcements can actually walk in`);

        // Terrain that sits off the map, or entirely inside a wall, is data
        // nobody will ever walk on.
        const badTerrain = [];
        for (const patch of level.terrain || []) {
            const where = `${patch.kind} at ${patch.x},${patch.y}`;
            if (!SURFACES[patch.kind]) badTerrain.push(`${where} is not a known surface`);
            else if (patch.w <= 0 || patch.h <= 0) badTerrain.push(`${where} has no area`);
            else if (patch.x < 0 || patch.y < 0
                || patch.x + patch.w > WORLD.width || patch.y + patch.h > WORLD.height) {
                badTerrain.push(`${where} runs off the map`);
            } else if (!nav.findPath(from.x, from.y, patch.x + patch.w / 2, patch.y + patch.h / 2)) {
                badTerrain.push(`${where} cannot be reached`);
            }
        }
        t.empty(badTerrain, `${label}: terrain patches are on the map and walkable`);

        // A road is a promise about where traffic comes from, so its ends should
        // be somewhere a unit could actually be.
        const badRoads = [];
        for (const road of level.roads || []) {
            if (!road.points || road.points.length < 2) {
                badRoads.push('a road with fewer than two points');
                continue;
            }
            for (const point of road.points) {
                if (point.x < 0 || point.y < 0 || point.x > WORLD.width || point.y > WORLD.height) {
                    badRoads.push(`road point ${point.x},${point.y} is off the map`);
                }
            }
        }
        t.empty(badRoads, `${label}: roads stay on the map`);

        // Armour routes on its own, wider grid. A tank parked somewhere it
        // cannot move, or cut off from the ground it is meant to threaten, is a
        // tank that never does anything.
        const vehicleNav = new NavGrid(level, { radius: VEHICLE_RADIUS, doorsPassable: false });
        const armour = level.hostiles.filter((h) => UNIT_CLASSES[h.cls] && UNIT_CLASSES[h.cls].vehicle);
        const waveHasArmour = ALARM.wave.some((cls) => UNIT_CLASSES[cls] && UNIT_CLASSES[cls].vehicle);
        const badArmour = [];
        for (const spec of armour) {
            const where = `${spec.cls} at ${spec.x},${spec.y}`;
            if (vehicleNav.isBlockedWorld(spec.x, spec.y)) badArmour.push(`${where} is wedged`);
            else if (!vehicleNav.findPath(spec.x, spec.y, level.cameraStart.x, level.cameraStart.y)) {
                badArmour.push(`${where} cannot reach the approach`);
            }
        }
        t.empty(badArmour, `${label}: armour can move and reach the fight`);

        // The wave brings a tank, so the entries have to admit one.
        if (waveHasArmour) {
            const badArmourEntries = (level.reinforce || []).filter(
                (entry) => vehicleNav.isBlockedWorld(entry.x, entry.y),
            );
            t.empty(
                badArmourEntries.map((e) => `entry at ${e.x},${e.y} is too tight for armour`),
                `${label}: reinforcement entries admit a tank`,
            );
        }

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
