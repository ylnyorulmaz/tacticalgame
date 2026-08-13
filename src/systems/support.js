// Medic behaviour: patch up wounded squadmates, and drag downed ones back into
// the fight before they bleed out. Anything with a `support` block on its class
// runs through here; everyone else is skipped.

import { DOWNED } from '../config.js';

export function updateSupport(units, dt, events = []) {
    for (const medic of units) {
        if (!medic.alive || !medic.stats.support) continue;
        const support = medic.stats.support;

        // Reviving takes priority: a body on the floor is worth more than a
        // few points of health on someone still standing.
        const casualty = nearestDowned(medic, units, support.healRadius);
        if (casualty) {
            medic.reviving = casualty;
            casualty.reviveTotal = support.reviveTime;   // the HUD ring reads this
            casualty.reviveProgress += dt;
            if (casualty.reviveProgress >= support.reviveTime) {
                casualty.revive(support.reviveHp ?? DOWNED.reviveHp);
                medic.reviving = null;
                events.push({ type: 'revive', x: casualty.x, y: casualty.y });
            }
            continue;
        }
        medic.reviving = null;

        // No healing mid-firefight — the medic has to break contact first.
        if (medic.target) continue;
        const patient = mostWounded(medic, units, support.healRadius);
        if (patient) patient.heal((support.healRate * dt) / 1000);
    }

    // Revive progress decays when nobody is working on the casualty, so a medic
    // cannot start a revive, wander off, and have it finish itself.
    for (const unit of units) {
        if (!unit.downed || unit.reviveProgress <= 0) continue;
        const beingWorkedOn = units.some((u) => u.alive && u.reviving === unit);
        if (!beingWorkedOn) unit.reviveProgress = Math.max(0, unit.reviveProgress - dt * 2);
    }
}

function nearestDowned(medic, units, radius) {
    let best = null;
    let bestDist = Infinity;
    for (const unit of units) {
        if (!unit.downed || unit.team !== medic.team) continue;
        const dist = Math.hypot(unit.x - medic.x, unit.y - medic.y);
        if (dist > radius || dist > bestDist) continue;
        best = unit;
        bestDist = dist;
    }
    return best;
}

function mostWounded(medic, units, radius) {
    let best = null;
    let worstRatio = 1;
    for (const unit of units) {
        if (!unit.alive || unit.team !== medic.team) continue;
        const ratio = unit.hp / unit.maxHp;
        if (ratio >= 1 || ratio >= worstRatio) continue;
        if (Math.hypot(unit.x - medic.x, unit.y - medic.y) > radius) continue;
        best = unit;
        worstRatio = ratio;
    }
    return best;
}
