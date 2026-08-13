// Hostile brain: PATROL/IDLE -> ALERT -> ENGAGE -> SEARCH -> back to post.
// Detection uses exactly the same line-of-sight test the player's fog uses, so
// "if I cannot see him, he cannot see me" actually holds.

import { AI } from '../config.js';

export function updateHostile(unit, dt, ctx) {
    if (!unit.alive) return;
    const brain = unit.ai;

    // Rounds cracking overhead stop everything else: no advancing, no patrolling.
    if (unit.pinned) unit.stop();

    const contact = nearestVisible(unit, ctx);
    if (contact) {
        brain.lastKnown = { x: contact.x, y: contact.y };
        brain.contactTimer += dt;
        unit.aimAngle = Math.atan2(contact.y - unit.y, contact.x - unit.x);
        unit.travelAngle = unit.aimAngle;

        // Aggressive types (the shotgunner) close in rather than trade fire at
        // a range their weapon cannot reach.
        const dist = Math.hypot(contact.x - unit.x, contact.y - unit.y);
        const closing = unit.stats.aggressive && !unit.pinned && dist > unit.stats.weapon.range * 0.6;
        if (closing) {
            brain.chaseTimer -= dt;
            if (brain.chaseTimer <= 0) {
                ctx.repath(unit, contact);
                brain.chaseTimer = 700;
            }
        } else {
            unit.stop();
        }

        if (unit.pinned) brain.state = 'pinned';
        else brain.state = brain.contactTimer >= AI.reactionTime ? 'engage' : 'alert';
        return;
    }

    brain.contactTimer = Math.max(0, brain.contactTimer - dt * 0.5);

    // Gunfire nearby is enough to go looking, even with nothing in sight.
    const noise = ctx.noises.find(
        (n) => n.team !== unit.team && Math.hypot(n.x - unit.x, n.y - unit.y) < AI.hearingRange,
    );
    if (noise && (brain.state === 'idle' || brain.state === 'patrol')) {
        brain.lastKnown = { x: noise.x, y: noise.y };
        startSearch(unit, ctx);
        return;
    }

    if (brain.state === 'engage' || brain.state === 'alert' || brain.state === 'pinned') {
        startSearch(unit, ctx);
        return;
    }

    if (brain.state === 'search') {
        if (unit.pinned) return;
        brain.searchTimer -= dt;
        const arrived = !unit.path;
        if (brain.searchTimer <= 0 || arrived) {
            brain.state = unit.route ? 'patrol' : 'idle';
            brain.lastKnown = null;
            if (!unit.route) ctx.repath(unit, unit.spawn);
        }
        return;
    }

    if (brain.state === 'patrol' && unit.route) {
        if (!unit.path) {
            brain.routeIndex = (brain.routeIndex + 1) % unit.route.length;
            ctx.repath(unit, unit.route[brain.routeIndex]);
        }
        return;
    }

    // Idle sentry: hold the assigned arc of fire.
    if (!unit.path) unit.travelAngle = brain.homeFacing;
}

function startSearch(unit, ctx) {
    const brain = unit.ai;
    brain.state = 'search';
    brain.searchTimer = AI.searchTimeout;
    unit.target = null;
    if (brain.lastKnown) ctx.repath(unit, brain.lastKnown);
}

function nearestVisible(unit, ctx) {
    let best = null;
    let bestDist = Infinity;
    for (const friendly of ctx.friendlies) {
        if (!friendly.alive) continue;
        const dist = Math.hypot(friendly.x - unit.x, friendly.y - unit.y);
        if (dist > unit.stats.sight || dist > bestDist) continue;
        if (!ctx.vision.hasLineOfSight(unit.x, unit.y, friendly.x, friendly.y)) continue;
        best = friendly;
        bestDist = dist;
    }
    return best;
}
