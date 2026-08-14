// Armour.
//
// A tank is a Unit with a `vehicle` block on its class rather than a new kind of
// entity, so cover, the fog, the event stream, the feed and the roster all keep
// working without knowing anything about it. What the block changes is the three
// things that actually make a tank different: it is hard to hurt from the front,
// its turret turns independently of where it is driving, and it is far too wide
// to fit through a door.

import { AI, ARMOUR } from '../config.js';

export function isVehicle(unit) {
    return !!unit.stats.vehicle;
}

// Which plate a round striking at `angle` (the direction it is travelling) lands
// on. The hull's facing is what counts — the turret can be pointing anywhere.
export function armourFacet(unit, angle) {
    const from = angle + Math.PI;   // where it came from, not where it is going
    const delta = Math.abs(Math.atan2(Math.sin(from - unit.facing), Math.cos(from - unit.facing)));
    if (delta <= ARMOUR.frontArc) return 'front';
    if (delta >= Math.PI - ARMOUR.rearArc) return 'rear';
    return 'side';
}

export function armourAt(unit, angle) {
    const armour = unit.stats.vehicle.armour;
    return armour[armourFacet(unit, angle)] ?? armour.side;
}

// A deliberately small brain. A tank does not need to flank or take cover: it
// holds its ground or drives at you, and the interesting decisions are the
// player's.
export function updateVehicle(unit, dt, ctx) {
    if (!unit.alive) return;
    const brain = unit.ai;

    const contact = nearestVisible(unit, ctx);
    if (contact) {
        brain.lastKnown = { x: contact.x, y: contact.y };
        brain.contactTimer += dt;
        unit.aimAngle = Math.atan2(contact.y - unit.y, contact.x - unit.x);
        if (brain.contactTimer >= AI.reactionTime) brain.state = 'engage';

        // Aggressive hulls close the distance; dug-in ones hold and shoot.
        const dist = Math.hypot(contact.x - unit.x, contact.y - unit.y);
        if (unit.stats.aggressive && dist > unit.stats.weapon.range * 0.7) {
            repathEvery(unit, ctx, brain.lastKnown, 1400, dt);
        } else if (!unit.stats.aggressive) {
            unit.stop();
        }
    } else {
        brain.contactTimer = 0;
        if (brain.state === 'engage') {
            brain.state = 'search';
            brain.searchTimer = AI.searchTimeout;
        }
        if (brain.state === 'search') {
            brain.searchTimer -= dt;
            if (brain.lastKnown) repathEvery(unit, ctx, brain.lastKnown, 1800, dt);
            if (brain.searchTimer <= 0) {
                brain.state = 'idle';
                brain.lastKnown = null;
                unit.stop();
            }
        }
    }

    // The turret itself is driven by Unit.desiredTurret, so a tank the player is
    // driving aims by exactly the same rules as one that is hunting them.
}

function nearestVisible(unit, ctx) {
    const enemies = unit.isFriendly ? ctx.hostiles : ctx.friendlies;
    let best = null;
    let bestDist = Infinity;
    for (const other of enemies) {
        if (!other.alive) continue;
        const dist = Math.hypot(other.x - unit.x, other.y - unit.y);
        if (dist > ctx.vision.sightRadius(unit) || dist > bestDist) continue;
        if (!ctx.vision.canSeeUnit(unit.x, unit.y, other)) continue;
        best = other;
        bestDist = dist;
    }
    return best;
}

function repathEvery(unit, ctx, point, interval, dt) {
    unit.repathTimer = (unit.repathTimer ?? 0) - dt;
    if (unit.repathTimer > 0 && unit.path) return;
    unit.repathTimer = interval;
    ctx.repath(unit, point);
}
