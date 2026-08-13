// Cover.
//
// Sandbags, crates and wrecks already stop bullets physically. What was missing
// was the aiming difficulty: a body hugging a barricade is a far worse target
// than one standing in the open, even for the rounds that clear the obstacle.
//
// `coverScore` asks a narrow question — is there something solid between the
// threat and this unit, *close to the unit*? Cover halfway down a long corridor
// protects nobody; cover you are pressed against does.

import { COVER } from '../config.js';
import { staticSolidRects, sandbagArcs, pointInSandbag, rectContains } from '../level.js';

// Cached per level: the geometry that can shelter somebody never changes.
const cacheKey = new WeakMap();

function coverGeometry(level) {
    let cached = cacheKey.get(level);
    if (!cached) {
        cached = { rects: staticSolidRects(level), arcs: sandbagArcs(level) };
        cacheKey.set(level, cached);
    }
    return cached;
}

function blocksAt(geometry, x, y) {
    for (const rect of geometry.rects) {
        if (rectContains(rect, x, y)) return true;
    }
    for (const arc of geometry.arcs) {
        if (pointInSandbag(arc, x, y)) return true;
    }
    return false;
}

// 0 = wide open, 1 = pressed right up against something solid.
export function coverScore(level, unit, threatX, threatY) {
    const dx = unit.x - threatX;
    const dy = unit.y - threatY;
    const dist = Math.hypot(dx, dy);
    if (dist < 1) return 0;

    const ux = dx / dist;
    const uy = dy / dist;
    const geometry = coverGeometry(level);

    // Walk back from the unit toward the threat. The closer the obstacle sits to
    // the unit, the more of it the unit is actually using.
    const step = 6;
    for (let back = unit.radius; back <= COVER.radius; back += step) {
        const x = unit.x - ux * back;
        const y = unit.y - uy * back;
        if (blocksAt(geometry, x, y)) {
            return Math.max(0, 1 - (back - unit.radius) / (COVER.radius - unit.radius));
        }
    }
    return 0;
}

// A unit only benefits from cover it is actually settled behind: run past a crate
// and you get nothing. Called once per frame per unit, against its nearest known
// threat, and cached on the unit for the renderer and the HUD to read.
export function updateCover(units, level) {
    for (const unit of units) {
        if (!unit.alive) {
            unit.inCover = 0;
            continue;
        }
        if (unit.stationaryFor < COVER.settleTime) {
            unit.inCover = 0;
            continue;
        }

        const threat = nearestThreat(units, unit);
        unit.inCover = threat ? coverScore(level, unit, threat.x, threat.y) : 0;
    }
}

function nearestThreat(units, unit) {
    let best = null;
    let bestDist = Infinity;
    for (const other of units) {
        if (!other.alive || other.team === unit.team) continue;
        const dist = Math.hypot(other.x - unit.x, other.y - unit.y);
        if (dist > COVER.threatRange || dist >= bestDist) continue;
        best = other;
        bestDist = dist;
    }
    return best;
}
