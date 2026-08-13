// Weapons, tracers and damage. Friendlies engage anything they can see without
// being told to; hostiles only shoot once their brain has flipped to ENGAGE.

import { rectContains, solidRects, sandbagArcs, pointInSandbag } from '../level.js';

const AIM_TOLERANCE = 0.2;      // rad of error allowed before the trigger is pulled
const SUBSTEP = 8;              // px per collision substep, keeps tracers from tunnelling

export class CombatSystem {
    constructor(level, vision) {
        this.level = level;
        this.vision = vision;
        this.projectiles = [];
        this.noises = [];
        this.blockers = solidRects(level);
        this.arcs = sandbagArcs(level);
    }

    // Doors change the bullet-blocking geometry too.
    refreshBlockers() {
        this.blockers = solidRects(this.level);
    }

    update(dt, units, now) {
        const friendlies = units.filter((u) => u.alive && u.team === 'friendly');
        const hostiles = units.filter((u) => u.alive && u.team === 'hostile');

        for (const unit of units) {
            if (!unit.alive) continue;
            this.acquire(unit, unit.isFriendly ? hostiles : friendlies);
            if (unit.target) {
                unit.aimAngle = Math.atan2(unit.target.y - unit.y, unit.target.x - unit.x);
                if (this.mayFire(unit)) this.fire(unit, now);
            }
        }
        this.stepProjectiles(dt, units);
        this.noises = this.noises.filter((n) => now - n.time < 900);
    }

    acquire(unit, enemies) {
        const reach = Math.min(unit.stats.sight, unit.stats.weapon.range);
        const current = unit.target;
        if (current && current.alive && this.inReach(unit, current, reach)) return;

        let best = null;
        let bestDist = Infinity;
        for (const enemy of enemies) {
            const dist = Math.hypot(enemy.x - unit.x, enemy.y - unit.y);
            if (dist > reach || dist > bestDist) continue;
            if (!this.vision.hasLineOfSight(unit.x, unit.y, enemy.x, enemy.y)) continue;
            best = enemy;
            bestDist = dist;
        }
        unit.target = best;
    }

    inReach(unit, target, reach) {
        const dist = Math.hypot(target.x - unit.x, target.y - unit.y);
        if (dist > reach) return false;
        return this.vision.hasLineOfSight(unit.x, unit.y, target.x, target.y);
    }

    mayFire(unit) {
        if (unit.breaching) return false;
        if (unit.fireTimer > 0 || unit.burstGapTimer > 0) return false;
        // Hostiles wait for their reaction time; the AI raises this flag.
        if (!unit.isFriendly && unit.ai.state !== 'engage') return false;
        let error = unit.aimAngle - unit.facing;
        error = Math.atan2(Math.sin(error), Math.cos(error));
        return Math.abs(error) <= AIM_TOLERANCE;
    }

    fire(unit, now) {
        const weapon = unit.stats.weapon;
        const muzzleX = unit.x + Math.cos(unit.facing) * (unit.radius + 12);
        const muzzleY = unit.y + Math.sin(unit.facing) * (unit.radius + 12);
        const pellets = weapon.pellets || 1;

        for (let i = 0; i < pellets; i++) {
            const angle = unit.facing + (Math.random() - 0.5) * 2 * weapon.spread;
            this.projectiles.push({
                x: muzzleX,
                y: muzzleY,
                px: muzzleX,
                py: muzzleY,
                vx: Math.cos(angle) * weapon.bulletSpeed,
                vy: Math.sin(angle) * weapon.bulletSpeed,
                damage: weapon.damage,
                team: unit.team,
                owner: unit,
                travelled: 0,
                maxDist: weapon.range * 1.2,
            });
        }

        unit.fireTimer = weapon.cooldown;
        unit.muzzleFlash = 70;
        unit.burstLeft -= 1;
        if (unit.burstLeft <= 0) {
            unit.burstLeft = weapon.burst;
            unit.burstGapTimer = weapon.burstGap;
        }
        this.noises.push({ x: unit.x, y: unit.y, team: unit.team, time: now });
    }

    stepProjectiles(dt, units) {
        const seconds = dt / 1000;
        const alive = [];

        for (const bullet of this.projectiles) {
            const totalX = bullet.vx * seconds;
            const totalY = bullet.vy * seconds;
            const distance = Math.hypot(totalX, totalY);
            const steps = Math.max(1, Math.ceil(distance / SUBSTEP));
            bullet.px = bullet.x;
            bullet.py = bullet.y;

            let dead = false;
            for (let i = 0; i < steps && !dead; i++) {
                bullet.x += totalX / steps;
                bullet.y += totalY / steps;
                bullet.travelled += distance / steps;
                if (bullet.travelled > bullet.maxDist) { dead = true; break; }
                if (this.hitsGeometry(bullet.x, bullet.y)) { dead = true; break; }

                for (const unit of units) {
                    if (!unit.alive || unit.team === bullet.team) continue;
                    const dx = unit.x - bullet.x;
                    const dy = unit.y - bullet.y;
                    if (dx * dx + dy * dy <= unit.radius * unit.radius) {
                        unit.takeDamage(bullet.damage);
                        dead = true;
                        break;
                    }
                }
            }
            if (!dead) alive.push(bullet);
        }

        this.projectiles = alive;
    }

    hitsGeometry(x, y) {
        for (const rect of this.blockers) {
            if (rectContains(rect, x, y)) return true;
        }
        for (const arc of this.arcs) {
            if (pointInSandbag(arc, x, y)) return true;
        }
        return false;
    }
}
