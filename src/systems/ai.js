// Hostile brain: PATROL/IDLE -> ALERT -> ENGAGE -> SEARCH -> back to post, with
// FALLING-BACK when badly hurt. Detection uses exactly the same line-of-sight
// test the player's fog uses, so "if I cannot see him, he cannot see me" holds.
//
// The garrison is not a set of independent sentries: contact is shouted to
// neighbours, a hostile that is not the closest tries to work around a flank,
// and a body on the floor is a warning to whoever finds it.

import { AI } from '../config.js';
import { CELL } from './nav.js';

export function updateHostile(unit, dt, ctx) {
    if (!unit.alive) return;
    const brain = unit.ai;

    // Rounds cracking overhead stop everything else: no advancing, no
    // patrolling. A flashbang does the same, harder — a blinded hostile is out
    // of the fight until its eyes come back.
    if (unit.pinned || unit.blinded > 0) unit.stop();
    if (unit.blinded > 0) {
        brain.state = 'blinded';
        brain.contactTimer = 0;
        unit.target = null;
        return;
    }
    if (brain.state === 'blinded') brain.state = 'search';

    // Badly hurt and still being shot at? Break contact.
    if (unit.hp / unit.maxHp <= AI.retreatHp && brain.state !== 'falling-back') {
        const threat = nearestVisible(unit, ctx);
        if (threat) {
            beginFallBack(unit, threat, ctx);
            return;
        }
    }
    if (brain.state === 'falling-back') {
        brain.retreatTimer -= dt;
        // Held fire while running; combat.mayFire only shoots in 'engage'.
        if (brain.retreatTimer > 0 && unit.path) return;
        brain.state = 'search';
        brain.searchTimer = AI.searchTimeout;
        return;
    }

    const contact = nearestVisible(unit, ctx);
    if (contact) {
        const firstSighting = brain.state !== 'engage' && brain.state !== 'alert';
        brain.lastKnown = { x: contact.x, y: contact.y };
        brain.contactTimer += dt;
        unit.aimAngle = Math.atan2(contact.y - unit.y, contact.x - unit.x);
        unit.travelAngle = unit.aimAngle;

        // Call it out: the room answers, not just the man who saw it.
        if (firstSighting) shout(unit, brain.lastKnown, ctx);

        const dist = Math.hypot(contact.x - unit.x, contact.y - unit.y);
        // Aggressive types (the shotgunner) close in rather than trade fire at a
        // range their weapon cannot reach.
        const closing = unit.stats.aggressive && !unit.pinned && dist > unit.stats.weapon.range * 0.6;

        if (closing) {
            repathEvery(unit, ctx, contact, 700, dt);
        } else if (shouldFlank(unit, contact, ctx)) {
            const spot = flankSpot(unit, contact, ctx);
            if (spot) repathEvery(unit, ctx, spot, AI.flankInterval, dt);
        } else {
            unit.stop();
        }

        if (unit.pinned) brain.state = 'pinned';
        else brain.state = brain.contactTimer >= AI.reactionTime ? 'engage' : 'alert';
        return;
    }

    brain.contactTimer = Math.max(0, brain.contactTimer - dt * 0.5);
    brain.flankTimer = 0;

    // Gunfire nearby is enough to go looking, even with nothing in sight.
    // Each noise carries its own reach: a suppressed shot is audible from a
    // fraction of the distance an unsuppressed one is.
    const noise = ctx.noises.find(
        (n) => n.team !== unit.team
            && Math.hypot(n.x - unit.x, n.y - unit.y) < (n.radius ?? AI.hearingRange),
    );
    if (noise && (brain.state === 'idle' || brain.state === 'patrol')) {
        brain.lastKnown = { x: noise.x, y: noise.y };
        startSearch(unit, ctx);
        return;
    }

    // A comrade face down on the floor is its own alarm — once per body.
    if (brain.state === 'idle' || brain.state === 'patrol') {
        const body = visibleBody(unit, ctx);
        if (body) {
            brain.seenBodies.add(body.id);
            brain.lastKnown = { x: body.x, y: body.y };
            startSearch(unit, ctx);
            shout(unit, brain.lastKnown, ctx);
            return;
        }
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

// Tell everyone within earshot where the trouble is. They investigate rather
// than teleport into an engagement — they still have to see for themselves.
function shout(unit, point, ctx) {
    for (const mate of ctx.hostiles) {
        if (mate === unit || !mate.alive) continue;
        if (Math.hypot(mate.x - unit.x, mate.y - unit.y) > AI.shoutRange) continue;
        const brain = mate.ai;
        if (brain.state !== 'idle' && brain.state !== 'patrol') continue;
        brain.lastKnown = { x: point.x, y: point.y };
        startSearch(mate, ctx);
    }
}

// Only hostiles that are not the closest bother flanking — somebody has to hold
// the target's attention while the others move.
function shouldFlank(unit, contact, ctx) {
    if (unit.pinned || unit.stats.aggressive) return false;
    if (unit.ai.contactTimer < AI.flankAfter) return false;

    const myDist = Math.hypot(contact.x - unit.x, contact.y - unit.y);
    for (const mate of ctx.hostiles) {
        if (mate === unit || !mate.alive) continue;
        if (mate.ai.state !== 'engage') continue;
        if (Math.hypot(contact.x - mate.x, contact.y - mate.y) < myDist) return true;
    }
    return false;
}

// A point off to one side of the line the target is watching, snapped to ground
// a body can actually stand on.
function flankSpot(unit, contact, ctx) {
    const angle = Math.atan2(unit.y - contact.y, unit.x - contact.x);
    const side = unit.ai.flankSide || (unit.ai.flankSide = Math.random() < 0.5 ? -1 : 1);
    const swung = angle + side * AI.flankArc;
    const radius = Math.max(140, Math.min(AI.flankRadius, unit.stats.weapon.range * 0.7));

    const wanted = {
        x: contact.x + Math.cos(swung) * radius,
        y: contact.y + Math.sin(swung) * radius,
    };
    const cell = ctx.nav.cellAtWorld(wanted.x, wanted.y);
    const open = ctx.nav.nearestOpen(cell.cx, cell.cy);
    if (!open) return null;
    return { x: open.cx * CELL + CELL / 2, y: open.cy * CELL + CELL / 2 };
}

function beginFallBack(unit, threat, ctx) {
    const brain = unit.ai;
    brain.state = 'falling-back';
    brain.retreatTimer = AI.retreatTime;
    unit.target = null;

    // Straight away from the threat, as far as the map allows.
    const angle = Math.atan2(unit.y - threat.y, unit.x - threat.x);
    const wanted = {
        x: unit.x + Math.cos(angle) * AI.retreatDistance,
        y: unit.y + Math.sin(angle) * AI.retreatDistance,
    };
    const cell = ctx.nav.cellAtWorld(wanted.x, wanted.y);
    const open = ctx.nav.nearestOpen(cell.cx, cell.cy);
    ctx.repath(unit, open ? { x: open.cx * CELL + CELL / 2, y: open.cy * CELL + CELL / 2 } : unit.spawn);
}

function repathEvery(unit, ctx, point, interval, dt) {
    unit.ai.chaseTimer -= dt;
    if (unit.ai.chaseTimer > 0 && unit.path) return;
    ctx.repath(unit, point);
    unit.ai.chaseTimer = interval;
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
        if (!ctx.vision.canObserve(unit.x, unit.y, friendly.x, friendly.y)) continue;
        best = friendly;
        bestDist = dist;
    }
    return best;
}

function visibleBody(unit, ctx) {
    for (const mate of ctx.hostiles) {
        if (mate.alive || mate === unit) continue;
        if (unit.ai.seenBodies.has(mate.id)) continue;
        const dist = Math.hypot(mate.x - unit.x, mate.y - unit.y);
        if (dist > unit.stats.sight * 0.7) continue;
        if (!ctx.vision.canObserve(unit.x, unit.y, mate.x, mate.y)) continue;
        return mate;
    }
    return null;
}
