// Orders: everything the player can tell a unit to do beyond "walk here".
//
// The whole system is one plain record per unit (`unit.order`). This module owns
// the verbs that write it; `units.js` and `combat.js` only ever read it. A unit
// whose record is untouched behaves exactly as it did before orders existed,
// which is what keeps the new verbs optional rather than mandatory.

import { ORDERS } from '../config.js';
import { CELL } from './nav.js';

export function makeOrder() {
    return {
        stance: 'free',     // 'free' | 'hold' — hold means do not open fire
        pace: 'normal',     // 'normal' | 'sprint' | 'careful'
        facing: null,       // arrival facing in rad; null = look where you walked
        suppressAt: null,   // {x, y} patch of ground to keep rounds on
        throwAt: null,      // {x, y, kind} aimed throw waiting to go out
        stackAt: null,      // door to wait beside instead of breaching
        useCharge: false,   // blow the next door rather than force it
    };
}

export function paceScale(unit) {
    if (unit.order.pace === 'sprint') return ORDERS.sprintScale;
    if (unit.order.pace === 'careful') return ORDERS.carefulScale;
    return 1;
}

// Sprinting is a commitment: you get there faster with your weapon down.
export function isSprinting(unit) {
    return unit.order.pace === 'sprint' && unit.isMoving;
}

// Creeping keeps you set, so a marksman can advance without losing the shot.
export function staysSet(unit) {
    return unit.order.pace === 'careful';
}

export function toggleHold(units) {
    // One press sets the whole selection to the same stance rather than
    // scattering it: if anyone is still free, everybody holds.
    const anyFree = units.some((u) => u.order.stance === 'free');
    for (const unit of units) {
        unit.order.stance = anyFree ? 'hold' : 'free';
        if (anyFree) unit.order.suppressAt = null;
    }
    return anyFree ? 'hold' : 'free';
}

export function cyclePace(units) {
    if (units.length === 0) return 'normal';
    const current = units[0].order.pace;
    const next = ORDERS.paces[(ORDERS.paces.indexOf(current) + 1) % ORDERS.paces.length];
    for (const unit of units) unit.order.pace = next;
    return next;
}

// Suppressive fire is aimed at ground, so it needs no target and no sighting —
// only reach. Units too far away to put rounds there are left out.
export function setSuppress(units, x, y) {
    let ordered = 0;
    for (const unit of units) {
        if (!unit.alive) continue;
        if (Math.hypot(x - unit.x, y - unit.y) > unit.stats.weapon.range) continue;
        unit.order.suppressAt = { x, y };
        unit.order.stance = 'free';
        unit.stop();
        ordered++;
    }
    return ordered;
}

// An aimed throw goes to the one unit best placed to make it, not to all six —
// six grenades on one spot is a waste of the squad's kit.
export function setThrow(units, x, y, kind = 'frag') {
    let best = null;
    let bestDist = Infinity;
    for (const unit of units) {
        if (!unit.alive || !canThrow(unit, kind)) continue;
        const dist = Math.hypot(x - unit.x, y - unit.y);
        if (dist > ORDERS.throwRange || dist > bestDist) continue;
        best = unit;
        bestDist = dist;
    }
    if (!best) return null;
    best.order.throwAt = { x, y, kind };
    return best;
}

export function canThrow(unit, kind = 'frag') {
    return (unit.kit[kind] || 0) > 0;
}

// Stacking: walk to a spot beside the door and wait there. Nobody goes through
// until the player says go, which is the point — the squad arrives together.
export function stackOn(units, door, ctx) {
    let ordered = 0;
    units.filter((u) => u.alive).forEach((unit, i) => {
        const spot = stackSpot(door, unit, i, ctx);
        if (!spot) return;
        unit.order.stackAt = door;
        unit.order.facing = Math.atan2(
            door.y + door.h / 2 - spot.y,
            door.x + door.w / 2 - spot.x,
        );
        unit.breaching = null;
        ctx.repath(unit, spot);
        ordered++;
    });
    return ordered;
}

// Go: everyone stacked on a door heads through it, and the normal breach
// behaviour in units.js takes over from there.
//
// An ordered breach is the one that uses a charge — fast and very loud. Walking
// into a door on the way past still forces it by hand, quietly, which is the
// trade the two make.
export function goBreach(units, ctx) {
    let ordered = 0;
    for (const unit of units) {
        const door = unit.order.stackAt;
        if (!door || !unit.alive) continue;
        unit.order.stackAt = null;
        unit.order.facing = null;
        unit.order.useCharge = unit.kit.charge > 0;
        ctx.repath(unit, { x: door.x + door.w / 2, y: door.y + door.h / 2 });
        ordered++;
    }
    return ordered;
}

export function stackedOn(units, door) {
    return units.filter((u) => u.alive && u.order.stackAt === door);
}

// A move order supersedes whatever the unit was told to do standing still.
export function clearOnMove(unit) {
    unit.order.suppressAt = null;
    unit.order.stackAt = null;
}

// Beside the door, on the side of the wall the unit is already on, alternating
// left and right so a four-man stack forms two files rather than one pile.
function stackSpot(door, unit, index, ctx) {
    const cx = door.x + door.w / 2;
    const cy = door.y + door.h / 2;
    const horizontal = door.w >= door.h;
    const side = index % 2 === 0 ? 1 : -1;
    const rank = 1 + Math.floor(index / 2);
    const outward = horizontal ? Math.sign(unit.y - cy) || 1 : Math.sign(unit.x - cx) || 1;
    const along = (door.w + door.h) / 2 + ORDERS.stackOffset * rank;

    const wanted = horizontal
        ? { x: cx + side * along, y: cy + outward * ORDERS.stackOffset }
        : { x: cx + outward * ORDERS.stackOffset, y: cy + side * along };

    const cell = ctx.nav.cellAtWorld(wanted.x, wanted.y);
    const open = ctx.nav.nearestOpen(cell.cx, cell.cy);
    if (!open) return null;
    return { x: open.cx * CELL + CELL / 2, y: open.cy * CELL + CELL / 2 };
}
