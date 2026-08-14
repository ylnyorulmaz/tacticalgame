// The garrison's state of mind, for the whole map rather than one hostile.
//
// CALM      nobody knows you are here
// SUSPICIOUS somebody heard something and went to look
// ALARMED   they know, everyone knows, and a second team is on its way
//
// This reads world state rather than being told about events, so there is no
// bookkeeping to keep in sync: a hostile in contact, a body that has been found,
// or a loud noise inside somebody's earshot each speak for themselves.

import { AI, ALARM } from '../config.js';

export const CALM = 'calm';
export const SUSPICIOUS = 'suspicious';
export const ALARMED = 'alarmed';

const RANK = { [CALM]: 0, [SUSPICIOUS]: 1, [ALARMED]: 2 };

export class AlarmSystem {
    constructor() {
        this.state = CALM;
        this.raisedAt = null;       // where the trouble was when it went up
        this.everAlarmed = false;   // the mission rating cares about this
        this.reinforceTimer = 0;
        this.waveSent = false;
        this.pending = [];          // level changes for the scene to announce
    }

    update(dt, ctx) {
        const next = this.assess(ctx);
        if (RANK[next] > RANK[this.state]) this.escalate(next, ctx);

        if (this.state === ALARMED && !this.waveSent) {
            this.reinforceTimer -= dt;
            if (this.reinforceTimer <= 0) this.sendWave(ctx);
        }
    }

    // The highest thing anybody currently has cause to believe.
    assess(ctx) {
        let suspicious = false;
        for (const hostile of ctx.hostiles) {
            if (!hostile.alive) continue;
            const brain = hostile.ai;
            // Eyes on a squadmate, or a body already found: no ambiguity left.
            if (brain.state === 'engage' || brain.state === 'alert') return ALARMED;
            if (brain.seenBodies.size > 0) return ALARMED;
            if (brain.state === 'search') suspicious = true;

            // A loud shot inside earshot is the alarm. A suppressed one carries
            // a fraction as far and only ever makes somebody curious.
            for (const noise of ctx.noises) {
                if (noise.team === hostile.team) continue;
                const reach = noise.radius ?? AI.hearingRange;
                if (Math.hypot(noise.x - hostile.x, noise.y - hostile.y) > reach) continue;
                if (noise.loud) return ALARMED;
                suspicious = true;
            }
        }
        return suspicious ? SUSPICIOUS : this.state;
    }

    escalate(next, ctx) {
        this.state = next;
        this.pending.push(next);
        if (next !== ALARMED) return;

        this.everAlarmed = true;
        this.reinforceTimer = ALARM.reinforceDelay;
        this.raisedAt = contactPoint(ctx);

        // Map-wide shout: patrol routes are abandoned and everyone who is not
        // already busy heads for the last known position.
        for (const hostile of ctx.hostiles) {
            if (!hostile.alive) continue;
            const brain = hostile.ai;
            if (brain.state !== 'idle' && brain.state !== 'patrol') continue;
            brain.lastKnown = this.raisedAt ? { ...this.raisedAt } : brain.lastKnown;
            brain.state = 'search';
            brain.searchTimer = AI.searchTimeout;
            if (brain.lastKnown) ctx.repath(hostile, brain.lastKnown);
        }
    }

    // One wave, once. The point is pressure on a mission that has gone loud,
    // not an endless faucet that makes clearing the map impossible.
    sendWave(ctx) {
        this.waveSent = true;
        const entries = ctx.level.reinforce || [];
        if (entries.length === 0 || !ctx.spawnHostile) return;

        const target = this.raisedAt || contactPoint(ctx);
        ALARM.wave.forEach((cls, i) => {
            const entry = entries[i % entries.length];
            const unit = ctx.spawnHostile(cls, entry.x, entry.y);
            if (!unit) return;
            unit.ai.state = 'search';
            unit.ai.searchTimer = AI.searchTimeout * 3;
            if (target) {
                unit.ai.lastKnown = { ...target };
                ctx.repath(unit, target);
            }
        });
        this.pending.push('reinforcements');
    }

    // Level changes the scene has not announced yet.
    drain() {
        const out = this.pending;
        this.pending = [];
        return out;
    }
}

// Wherever the trouble is: a hostile in contact knows best, otherwise anyone who
// is out looking, otherwise nothing.
function contactPoint(ctx) {
    for (const hostile of ctx.hostiles) {
        if (hostile.alive && hostile.ai.lastKnown) return hostile.ai.lastKnown;
    }
    const alive = ctx.friendlies.find((u) => u.alive);
    return alive ? { x: alive.x, y: alive.y } : null;
}
