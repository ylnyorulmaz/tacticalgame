// What the mission is actually for. Without this every map is "kill everyone",
// which is one plan repeated three times.
//
// Four kinds, composed per map:
//   eliminate  no hostile left standing
//   intel      reach a point and hold it long enough to pick something up
//   rescue     reach a hostage, who then follows you out
//   exfil      everyone still alive back in the extraction zone
//
// An exfil waits on every other required objective, so it is always the last
// thing on the list and never a way to skip the mission.

import { RATING } from '../config.js';

const PICKUP_RADIUS = 46;
const PICKUP_TIME = 900;        // ms standing on it
const RESCUE_RADIUS = 60;
const FOLLOW_GAP = 52;          // how close the hostage tries to stay
const FOLLOW_REPATH = 900;

export class ObjectiveSystem {
    constructor(level) {
        const specs = level.objectives && level.objectives.length
            ? level.objectives
            : [{ kind: 'eliminate', label: 'Clear the map' }];
        this.list = specs.map((spec, i) => ({ ...spec, id: `${spec.kind}-${i}`, done: false, progress: 0 }));
        this.failed = false;
        this.failure = null;
        this.hostage = null;        // the scene spawns it and hands it over
        this.carrier = null;        // who picked the intel up
        this.followTimer = 0;
        this.pending = [];          // completions the scene has not announced
    }

    get required() {
        return this.list.filter((o) => !o.optional);
    }

    get complete() {
        return this.required.every((o) => o.done);
    }

    // The zone, if this mission has one — the renderer and the HUD both want it.
    get exfil() {
        return this.list.find((o) => o.kind === 'exfil') || null;
    }

    update(dt, ctx) {
        this.updateHostage(dt, ctx);

        for (const objective of this.list) {
            if (objective.done) continue;
            const done = this.check(objective, dt, ctx);
            if (!done) continue;
            objective.done = true;
            this.pending.push(objective);
        }
    }

    check(objective, dt, ctx) {
        const living = ctx.friendlies.filter((u) => u.alive);

        if (objective.kind === 'eliminate') {
            return ctx.hostiles.length > 0 && ctx.hostiles.every((h) => !h.alive);
        }

        if (objective.kind === 'intel') {
            const near = living.find(
                (u) => Math.hypot(u.x - objective.x, u.y - objective.y) <= PICKUP_RADIUS,
            );
            if (!near) {
                objective.progress = 0;
                return false;
            }
            objective.progress = Math.min(1, objective.progress + dt / PICKUP_TIME);
            if (objective.progress < 1) return false;
            this.carrier = near;
            return true;
        }

        if (objective.kind === 'rescue') {
            if (!this.hostage || !this.hostage.alive) return false;
            const near = living.some(
                (u) => Math.hypot(u.x - this.hostage.x, u.y - this.hostage.y) <= RESCUE_RADIUS,
            );
            if (near) this.hostage.freed = true;
            return !!this.hostage.freed;
        }

        if (objective.kind === 'exfil') {
            // Everything else first, then everyone in the zone — including the
            // person you came for.
            if (!this.required.every((o) => o === objective || o.done)) return false;
            if (living.length === 0) return false;
            if (!living.every((u) => inZone(objective, u))) return false;
            if (this.hostage && this.hostage.alive && !inZone(objective, this.hostage)) return false;
            return true;
        }

        return false;
    }

    // A freed hostage tags along behind whoever is nearest, and stops when close
    // enough. Losing them is a lost mission, so they do not wander.
    updateHostage(dt, ctx) {
        const hostage = this.hostage;
        if (!hostage) return;

        if (!hostage.alive && !this.failed) {
            this.failed = true;
            this.failure = 'The hostage is dead';
            return;
        }
        if (!hostage.freed || !hostage.alive) return;

        this.followTimer -= dt;
        if (this.followTimer > 0) return;
        this.followTimer = FOLLOW_REPATH;

        let escort = null;
        let best = Infinity;
        for (const unit of ctx.friendlies) {
            if (!unit.alive) continue;
            const dist = Math.hypot(unit.x - hostage.x, unit.y - hostage.y);
            if (dist >= best) continue;
            escort = unit;
            best = dist;
        }
        if (!escort) return;
        if (best <= FOLLOW_GAP) {
            hostage.stop();
            return;
        }
        ctx.repath(hostage, escort);
    }

    // Completions the scene has not put in the feed yet.
    drain() {
        const out = this.pending;
        this.pending = [];
        return out;
    }

    // What the HUD tracker draws.
    status() {
        return this.list.map((o) => ({
            label: o.label || o.kind,
            done: o.done,
            optional: !!o.optional,
            progress: o.progress || 0,
        }));
    }
}

export function inZone(zone, unit) {
    return unit.x >= zone.x && unit.x <= zone.x + zone.w
        && unit.y >= zone.y && unit.y <= zone.y + zone.h;
}

// End-of-mission grade. Missions are standalone, so this is the only thing that
// makes a second run of the same map worth doing: it is entirely possible to win
// badly.
export function rateMission(stats) {
    let score = 100;
    score -= stats.casualties * RATING.perCasualty;
    if (stats.alarmRaised) score -= RATING.alarmPenalty;

    const overtime = Math.max(0, stats.timeMs - RATING.parTime) / 60000;
    score -= Math.min(RATING.latePenaltyCap, overtime * RATING.perMinuteLate);

    if (stats.bonusDone) score += RATING.bonus;
    score = Math.max(0, Math.min(100, Math.round(score)));

    const grade = RATING.grades.find((g) => score >= g.min) || RATING.grades[RATING.grades.length - 1];
    return { score, grade: grade.letter, note: grade.note };
}
