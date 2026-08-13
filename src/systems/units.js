// Unit model: stats, movement along a smoothed path, door breaching, damage and
// death. Rendering lives in render/entities.js — a unit here is plain state.

import { UNIT_CLASSES, UNIT_RADIUS, SUPPRESSION, DOWNED } from '../config.js';
import { rectContains } from '../level.js';
import { makeOrder, paceScale, staysSet } from './orders.js';
import { settings } from './settings.js';

let nextId = 1;

export class Unit {
    constructor({ cls, x, y, facing = 0 }) {
        this.id = nextId++;
        this.stats = UNIT_CLASSES[cls];
        this.cls = cls;
        this.team = this.stats.team;
        this.x = x;
        this.y = y;
        this.spawn = { x, y };
        this.radius = UNIT_RADIUS;
        this.facing = facing;
        this.aimAngle = facing;
        this.maxHp = this.stats.hp;
        this.hp = this.maxHp;
        this.alive = true;
        // A downed unit is out of the fight but not gone: alive === false and
        // downed === true. Once it bleeds out both are false and it is dead.
        this.downed = false;
        this.bleedOut = 0;
        this.reviveProgress = 0;
        this.selected = false;

        this.path = null;
        this.pathIndex = 0;
        this.orderPoint = null;
        this.breaching = null;
        // What the player has told this unit to do beyond walking. Hostiles
        // carry the record too and simply never have it written to.
        this.order = makeOrder();

        // Weapon state.
        this.fireTimer = 0;
        this.burstLeft = this.stats.weapon.burst;
        this.burstGapTimer = 0;
        this.target = null;
        this.muzzleFlash = 0;
        this.recoil = 0;
        this.grenadesLeft = this.stats.grenade ? this.stats.grenade.count : 0;
        this.grenadeTimer = 0;

        // Magazines, but only if the player asked for them on the menu. With the
        // switch off these are Infinity, which turns every ammo check below into
        // a no-op rather than forking the firing code down a second path.
        const weapon = this.stats.weapon;
        const finite = settings.ammo && !!weapon.magazine;
        this.magSize = finite ? weapon.magazine : Infinity;
        this.mag = this.magSize;
        this.reserve = finite ? weapon.magazine * (weapon.spare || 0) : Infinity;
        this.reloadTimer = 0;

        // How long this unit has been standing still (the marksman needs to be
        // set before firing) and how much incoming fire is pinning it down.
        this.stationaryFor = 0;
        this.suppression = 0;
        this.pinned = false;
        this.inCover = 0;        // 0..1, maintained by systems/cover.js

        // Hostile-only brain state, harmless on friendlies.
        this.ai = {
            state: 'idle',
            routeIndex: 0,
            contactTimer: 0,
            searchTimer: 0,
            chaseTimer: 0,
            flankTimer: 0,
            flankSide: 0,
            retreatTimer: 0,
            seenBodies: new Set(),   // bodies already reacted to
            lastKnown: null,
            homeFacing: facing,
        };
    }

    get isFriendly() {
        return this.team === 'friendly';
    }

    setPath(path) {
        if (!path || path.length === 0) {
            this.path = null;
            this.orderPoint = null;
            return;
        }
        this.path = path;
        this.pathIndex = 0;
        this.orderPoint = { x: path[path.length - 1].x, y: path[path.length - 1].y };
    }

    stop() {
        this.path = null;
        this.orderPoint = null;
        this.breaching = null;
    }

    get isMoving() {
        return !!this.path && this.pathIndex < this.path.length && !this.breaching;
    }

    takeDamage(amount) {
        if (!this.alive) return;
        this.hp -= amount;
        if (this.hp > 0) return;

        this.hp = 0;
        this.alive = false;
        this.stop();
        this.target = null;
        // The dropped weapon lands roughly where the unit was looking.
        this.dropAngle = this.facing + (Math.random() - 0.5) * 1.4;
        this.dropOffset = { x: Math.cos(this.dropAngle) * 22, y: Math.sin(this.dropAngle) * 22 };

        // Squadmates go down rather than out, giving the medic a window.
        if (this.isFriendly) {
            this.downed = true;
            this.bleedOut = DOWNED.bleedOut;
            this.reviveProgress = 0;
        }
    }

    heal(amount) {
        if (!this.alive) return;
        this.hp = Math.min(this.maxHp, this.hp + amount);
    }

    revive(hp) {
        if (!this.downed) return;
        this.downed = false;
        this.alive = true;
        this.hp = Math.min(this.maxHp, hp);
        this.reviveProgress = 0;
        this.dropOffset = null;
        this.burstLeft = this.stats.weapon.burst;
    }

    // Out of rounds and out of magazines: this weapon is finished for the
    // mission, which the roster reports so it is never a silent failure.
    get isDry() {
        return this.mag <= 0 && this.reserve <= 0;
    }

    startReload() {
        if (this.reloadTimer > 0 || this.reserve <= 0 || this.mag >= this.magSize) return false;
        this.reloadTimer = this.stats.weapon.reloadTime || 2000;
        return true;
    }

    finishReload() {
        const taken = Math.min(this.magSize - this.mag, this.reserve);
        this.mag += taken;
        this.reserve -= taken;
        this.reloadTimer = 0;
    }

    addSuppression(amount) {
        if (!this.alive) return;
        this.suppression = Math.min(SUPPRESSION.max, this.suppression + amount);
    }

    update(dt, ctx) {
        // Bleeding out is the only thing a downed unit does on its own.
        if (this.downed) {
            this.bleedOut -= dt;
            if (this.bleedOut <= 0) {
                this.downed = false;
                this.reviveProgress = 0;
            }
            return;
        }
        if (!this.alive) return;

        this.fireTimer = Math.max(0, this.fireTimer - dt);
        this.burstGapTimer = Math.max(0, this.burstGapTimer - dt);
        this.grenadeTimer = Math.max(0, this.grenadeTimer - dt);
        this.muzzleFlash = Math.max(0, this.muzzleFlash - dt);
        if (this.reloadTimer > 0) {
            this.reloadTimer -= dt;
            if (this.reloadTimer <= 0) this.finishReload();
        }
        this.recoil = Math.max(0, this.recoil - dt / 90);   // gun slides back home
        this.suppression = Math.max(0, this.suppression - (SUPPRESSION.decayPerSecond * dt) / 1000);
        // Hysteresis, so a unit hovering at the threshold does not flicker
        // between pinned and firing every frame.
        if (this.suppression >= SUPPRESSION.threshold) this.pinned = true;
        else if (this.suppression < SUPPRESSION.threshold * 0.4) this.pinned = false;

        const startX = this.x;
        const startY = this.y;
        this.step(dt, ctx);

        // Breaching or held in place still counts as being set, which is what
        // the marksman's steady requirement reads — and so does creeping, which
        // is the whole reason to order a careful pace.
        const travelled = Math.hypot(this.x - startX, this.y - startY);
        this.stationaryFor = travelled > 0.35 && !staysSet(this) ? 0 : this.stationaryFor + dt;
    }

    step(dt, ctx) {
        if (this.breaching) {
            this.breaching.timer -= dt;
            this.facing = turnToward(this.facing, this.breaching.angle, this.stats.turnSpeed * dt / 1000);
            if (this.breaching.timer <= 0) {
                ctx.openDoor(this.breaching.door);
                this.breaching = null;
                // The grid changed under us; re-plan the rest of the route.
                if (this.orderPoint) ctx.repath(this, this.orderPoint);
            }
            return;
        }

        this.moveAlongPath(dt, ctx);
        this.facing = turnToward(this.facing, this.desiredFacing(), (this.stats.turnSpeed * dt) / 1000);
    }

    // What this unit wants to be looking at, in priority order: its target, the
    // ground it was told to suppress, the arrival facing it was given, and
    // failing all of that, wherever it is walking.
    desiredFacing() {
        if (this.target && this.target.alive) return this.aimAngle;
        const order = this.order;
        if (order.suppressAt) return Math.atan2(order.suppressAt.y - this.y, order.suppressAt.x - this.x);
        if (!this.path && order.facing !== null) return order.facing;
        return this.travelAngle ?? this.facing;
    }

    moveAlongPath(dt, ctx) {
        if (!this.path) return;
        if (this.pathIndex >= this.path.length) {
            this.path = null;
            return;
        }

        const waypoint = this.path[this.pathIndex];
        // A unit told to stack waits beside the door instead of forcing it.
        const door = this.order.stackAt ? null : ctx.closedDoorAt(waypoint.x, waypoint.y);
        if (door) {
            const gap = Math.hypot(door.x + door.w / 2 - this.x, door.y + door.h / 2 - this.y);
            if (gap < 52) {
                this.breaching = {
                    door,
                    timer: this.stats.breachTime,
                    angle: Math.atan2(door.y + door.h / 2 - this.y, door.x + door.w / 2 - this.x),
                };
                if (ctx.onBreachStart) ctx.onBreachStart(this, door);
                return;
            }
        }

        const dx = waypoint.x - this.x;
        const dy = waypoint.y - this.y;
        const dist = Math.hypot(dx, dy);
        if (dist < 7) {
            this.pathIndex++;
            if (this.pathIndex >= this.path.length) {
                this.path = null;
                this.orderPoint = null;
            }
            return;
        }

        this.travelAngle = Math.atan2(dy, dx);
        const step = (this.stats.speed * paceScale(this) * dt) / 1000;
        const nx = this.x + (dx / dist) * step;
        const ny = this.y + (dy / dist) * step;

        // Move each axis on its own so units slide along walls instead of sticking.
        if (!ctx.blocked(nx, this.y)) this.x = nx;
        if (!ctx.blocked(this.x, ny)) this.y = ny;
    }

    // Gentle shove so squadmates spread out instead of stacking on one pixel.
    // Downed bodies are stepped over rather than pushed around.
    separate(others, ctx) {
        if (!this.alive) return;
        let pushX = 0;
        let pushY = 0;
        for (const other of others) {
            if (other === this || !other.alive) continue;
            const dx = this.x - other.x;
            const dy = this.y - other.y;
            const distSq = dx * dx + dy * dy;
            const min = this.radius + other.radius;
            if (distSq > min * min || distSq < 0.0001) continue;
            const dist = Math.sqrt(distSq);
            pushX += (dx / dist) * (min - dist) * 0.5;
            pushY += (dy / dist) * (min - dist) * 0.5;
        }
        if (pushX === 0 && pushY === 0) return;
        if (!ctx.blocked(this.x + pushX, this.y)) this.x += pushX;
        if (!ctx.blocked(this.x, this.y + pushY)) this.y += pushY;
    }
}

export function turnToward(current, target, maxStep) {
    let delta = target - current;
    delta = Math.atan2(Math.sin(delta), Math.cos(delta));
    if (Math.abs(delta) <= maxStep) return target;
    return current + Math.sign(delta) * maxStep;
}

export function doorAtPoint(doors, x, y, pad = 8) {
    for (const door of doors) {
        if (door.open) continue;
        const padded = { x: door.x - pad, y: door.y - pad, w: door.w + pad * 2, h: door.h + pad * 2 };
        if (rectContains(padded, x, y)) return door;
    }
    return null;
}
