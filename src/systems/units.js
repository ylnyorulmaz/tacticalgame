// Unit model: stats, movement along a smoothed path, door breaching, damage and
// death. Rendering lives in render/entities.js — a unit here is plain state.

import { UNIT_CLASSES, UNIT_RADIUS } from '../config.js';
import { rectContains } from '../level.js';

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
        this.selected = false;

        this.path = null;
        this.pathIndex = 0;
        this.orderPoint = null;
        this.breaching = null;

        // Weapon state.
        this.fireTimer = 0;
        this.burstLeft = this.stats.weapon.burst;
        this.burstGapTimer = 0;
        this.target = null;
        this.muzzleFlash = 0;

        // Hostile-only brain state, harmless on friendlies.
        this.ai = {
            state: 'idle',
            routeIndex: 0,
            contactTimer: 0,
            searchTimer: 0,
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
        if (this.hp <= 0) {
            this.hp = 0;
            this.alive = false;
            this.stop();
            this.target = null;
            // The dropped weapon lands roughly where the unit was looking.
            this.dropAngle = this.facing + (Math.random() - 0.5) * 1.4;
            this.dropOffset = { x: Math.cos(this.dropAngle) * 22, y: Math.sin(this.dropAngle) * 22 };
        }
    }

    update(dt, ctx) {
        if (!this.alive) return;

        this.fireTimer = Math.max(0, this.fireTimer - dt);
        this.burstGapTimer = Math.max(0, this.burstGapTimer - dt);
        this.muzzleFlash = Math.max(0, this.muzzleFlash - dt);

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

        // Aim at whatever we are shooting at, otherwise look where we are going.
        const desired = this.target && this.target.alive ? this.aimAngle : this.travelAngle ?? this.facing;
        this.facing = turnToward(this.facing, desired, (this.stats.turnSpeed * dt) / 1000);
    }

    moveAlongPath(dt, ctx) {
        if (!this.path) return;
        if (this.pathIndex >= this.path.length) {
            this.path = null;
            return;
        }

        const waypoint = this.path[this.pathIndex];
        const door = ctx.closedDoorAt(waypoint.x, waypoint.y);
        if (door) {
            const gap = Math.hypot(door.x + door.w / 2 - this.x, door.y + door.h / 2 - this.y);
            if (gap < 52) {
                this.breaching = {
                    door,
                    timer: this.stats.breachTime,
                    angle: Math.atan2(door.y + door.h / 2 - this.y, door.x + door.w / 2 - this.x),
                };
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
        const step = (this.stats.speed * dt) / 1000;
        const nx = this.x + (dx / dist) * step;
        const ny = this.y + (dy / dist) * step;

        // Move each axis on its own so units slide along walls instead of sticking.
        if (!ctx.blocked(nx, this.y)) this.x = nx;
        if (!ctx.blocked(this.x, ny)) this.y = ny;
    }

    // Gentle shove so squadmates spread out instead of stacking on one pixel.
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
