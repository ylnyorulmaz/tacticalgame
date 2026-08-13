// Weapons, tracers and damage. Friendlies engage anything they can see without
// being told to; hostiles only shoot once their brain has flipped to ENGAGE.

import { rectContains, solidRects, sandbagArcs, pointInSandbag } from '../level.js';
import { SUPPRESSION, COVER, ORDERS } from '../config.js';
import { isSprinting } from './orders.js';

const AIM_TOLERANCE = 0.2;      // rad of error allowed before the trigger is pulled
const SUBSTEP = 8;              // px per collision substep, keeps tracers from tunnelling
const BLAST_FRIENDLY_SCALE = 0.5;
const EXPLOSION_TTL = 320;      // ms the detonation flash stays on screen

export class CombatSystem {
    constructor(level, vision) {
        this.level = level;
        this.vision = vision;
        this.projectiles = [];
        this.explosions = [];
        this.noises = [];
        // Sound events for the frame, drained by the scene. Combat stays unaware
        // of the audio engine; it just reports what happened and where.
        this.events = [];
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

            // An aimed throw outranks everything: the player asked for it by
            // hand and knows better than the acquisition rules what it is for.
            if (unit.order.throwAt) {
                this.aimedThrow(unit, now);
                continue;
            }
            // Rounds on a patch of ground need no target, only reach.
            if (unit.order.suppressAt) {
                this.suppressGround(unit, now);
                continue;
            }

            this.acquire(unit, unit.isFriendly ? hostiles : friendlies);
            if (!unit.target) continue;

            unit.aimAngle = Math.atan2(unit.target.y - unit.y, unit.target.x - unit.x);
            if (!this.mayFire(unit)) continue;
            // A grenade is worth more than a burst when the target is far
            // enough away and the squad is clear of the blast.
            if (this.mayThrow(unit, friendlies)) this.throwGrenade(unit, now, unit.target);
            else this.fire(unit, now);
        }

        this.stepProjectiles(dt, units);
        for (const blast of this.explosions) blast.ttl -= dt;
        this.explosions = this.explosions.filter((blast) => blast.ttl > 0);
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

    // Everything that stops a trigger being pulled regardless of what is being
    // shot at. Both aimed fire and ordered suppressive fire go through this.
    canShoot(unit) {
        if (unit.breaching) return false;
        if (unit.pinned) return false;                  // head down under fire
        if (unit.fireTimer > 0 || unit.burstGapTimer > 0) return false;
        if (unit.order.stance === 'hold') return false; // told to hold fire
        if (isSprinting(unit)) return false;            // weapon is down while running
        // The marksman has to plant before it can take the shot.
        if (unit.stats.steadyTime && unit.stationaryFor < unit.stats.steadyTime) return false;
        return true;
    }

    mayFire(unit) {
        if (!this.canShoot(unit)) return false;
        // Hostiles wait for their reaction time; the AI raises this flag.
        if (!unit.isFriendly && unit.ai.state !== 'engage') return false;
        let error = unit.aimAngle - unit.facing;
        error = Math.atan2(Math.sin(error), Math.cos(error));
        return Math.abs(error) <= AIM_TOLERANCE;
    }

    // Suppressive fire: rounds onto a patch of ground whether or not anybody is
    // standing there. Wider cone than aimed fire, and every round carries real
    // pressure even from weapons that normally suppress nobody — that pressure
    // is the entire reason the order exists.
    suppressGround(unit, now) {
        const point = unit.order.suppressAt;
        unit.target = null;
        unit.aimAngle = Math.atan2(point.y - unit.y, point.x - unit.x);

        if (Math.hypot(point.x - unit.x, point.y - unit.y) > unit.stats.weapon.range) return;
        if (!this.canShoot(unit)) return;
        let error = unit.aimAngle - unit.facing;
        error = Math.atan2(Math.sin(error), Math.cos(error));
        if (Math.abs(error) > AIM_TOLERANCE) return;

        this.fire(unit, now, {
            extraSpread: ORDERS.suppressSpread,
            suppression: Math.max(unit.stats.suppressionPerHit || 0, ORDERS.suppressSuppression),
        });
    }

    // A throw the player placed by hand. It waits for the arm to be free rather
    // than being dropped, so ordering one during a reload still works.
    aimedThrow(unit, now) {
        const order = unit.order.throwAt;
        unit.target = null;
        unit.aimAngle = Math.atan2(order.y - unit.y, order.x - unit.x);

        if (unit.breaching || unit.grenadeTimer > 0 || unit.fireTimer > 0) return;
        if (unit.grenadesLeft <= 0 || !unit.stats.grenade) {
            unit.order.throwAt = null;
            return;
        }
        let error = unit.aimAngle - unit.facing;
        error = Math.atan2(Math.sin(error), Math.cos(error));
        if (Math.abs(error) > AIM_TOLERANCE) return;

        this.throwGrenade(unit, now, order);
        unit.order.throwAt = null;
    }

    // Grenades are held back at knife range, when the charge is on cooldown, or
    // whenever a squadmate is standing in the blast.
    mayThrow(unit, friendlies) {
        const grenade = unit.stats.grenade;
        if (!grenade || unit.grenadesLeft <= 0 || unit.grenadeTimer > 0) return false;

        const target = unit.target;
        const dist = Math.hypot(target.x - unit.x, target.y - unit.y);
        if (dist < grenade.minRange) return false;

        for (const mate of friendlies) {
            if (mate === unit) continue;
            if (Math.hypot(mate.x - target.x, mate.y - target.y) < grenade.radius * 0.9) return false;
        }
        return true;
    }

    // `target` is any {x, y}: the unit's current contact for an automatic throw,
    // or the spot the player picked for an aimed one.
    throwGrenade(unit, now, target) {
        const grenade = unit.stats.grenade;
        const angle = Math.atan2(target.y - unit.y, target.x - unit.x);
        const muzzleX = unit.x + Math.cos(angle) * (unit.radius + 10);
        const muzzleY = unit.y + Math.sin(angle) * (unit.radius + 10);

        this.projectiles.push({
            kind: 'grenade',
            x: muzzleX,
            y: muzzleY,
            vx: Math.cos(angle) * grenade.speed,
            vy: Math.sin(angle) * grenade.speed,
            aim: { x: target.x, y: target.y },
            radius: grenade.radius,
            damage: grenade.damage,
            team: unit.team,
            owner: unit,
            travelled: 0,
            maxDist: Math.hypot(target.x - muzzleX, target.y - muzzleY),
        });

        this.events.push({
            type: 'grenadeThrow',
            kind: 'grenade',
            x: muzzleX,
            y: muzzleY,
            angle,
            cls: unit.cls,
            unit: unit.id,
        });
        unit.recoil = 1;
        unit.muzzleFlash = 60;
        unit.grenadesLeft -= 1;
        unit.grenadeTimer = grenade.cooldown;
        unit.fireTimer = Math.max(unit.fireTimer, 700);
        this.noises.push({ x: unit.x, y: unit.y, team: unit.team, time: now });
    }

    fire(unit, now, opts = {}) {
        const weapon = unit.stats.weapon;
        const muzzleX = unit.x + Math.cos(unit.facing) * (unit.radius + 12);
        const muzzleY = unit.y + Math.sin(unit.facing) * (unit.radius + 12);
        const pellets = weapon.pellets || 1;
        // A target tucked behind a barricade is harder to hit, on top of the
        // rounds the barricade itself eats.
        const covered = unit.target ? unit.target.inCover || 0 : 0;
        const spread = weapon.spread + covered * COVER.spreadPenalty + (opts.extraSpread || 0);
        const suppression = opts.suppression ?? (unit.stats.suppressionPerHit || 0);

        for (let i = 0; i < pellets; i++) {
            const angle = unit.facing + (Math.random() - 0.5) * 2 * spread;
            this.projectiles.push({
                x: muzzleX,
                y: muzzleY,
                px: muzzleX,
                py: muzzleY,
                vx: Math.cos(angle) * weapon.bulletSpeed,
                vy: Math.sin(angle) * weapon.bulletSpeed,
                damage: weapon.damage,
                suppression,
                team: unit.team,
                owner: unit,
                travelled: 0,
                maxDist: weapon.range * 1.2,
            });
        }

        this.events.push({
            type: weapon.sound || 'carbine',
            kind: 'shot',
            x: muzzleX,
            y: muzzleY,
            angle: unit.facing,
            cls: unit.cls,
            unit: unit.id,
        });
        unit.fireTimer = weapon.cooldown;
        unit.muzzleFlash = 95;
        unit.recoil = 1;
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

                if (bullet.kind === 'grenade') {
                    // Grenades sail over heads and detonate where they land, or
                    // against the first wall they meet.
                    if (bullet.travelled >= bullet.maxDist || this.hitsGeometry(bullet.x, bullet.y)) {
                        this.detonate(bullet, units);
                        dead = true;
                    }
                    continue;
                }

                if (bullet.travelled > bullet.maxDist) { dead = true; break; }
                if (this.hitsGeometry(bullet.x, bullet.y)) {
                    this.events.push({
                        type: 'impact',
                        kind: 'impact',
                        x: bullet.x,
                        y: bullet.y,
                        angle: Math.atan2(bullet.vy, bullet.vx),
                    });
                    dead = true;
                    break;
                }

                for (const unit of units) {
                    if (!unit.alive || unit.team === bullet.team) continue;
                    const dx = unit.x - bullet.x;
                    const dy = unit.y - bullet.y;
                    const distSq = dx * dx + dy * dy;
                    if (distSq <= unit.radius * unit.radius) {
                        if (bullet.suppression) unit.addSuppression(bullet.suppression);
                        const standing = unit.alive;
                        unit.takeDamage(bullet.damage);
                        this.events.push({
                            type: standing && !unit.alive ? 'down' : 'hit',
                            kind: 'hit',
                            x: unit.x,
                            y: unit.y,
                            angle: Math.atan2(bullet.vy, bullet.vx),
                            team: unit.team,
                            victim: unit.id,
                            by: bullet.owner ? bullet.owner.stats.name : null,
                        });
                        dead = true;
                        break;
                    }
                    // A round cracking past is nearly as good as a hit for
                    // keeping someone's head down — but count each round once,
                    // not once per collision substep.
                    if (bullet.suppression && distSq <= SUPPRESSION.nearMissRadius * SUPPRESSION.nearMissRadius) {
                        if (!bullet.grazed) bullet.grazed = new Set();
                        if (!bullet.grazed.has(unit.id)) {
                            bullet.grazed.add(unit.id);
                            unit.addSuppression(bullet.suppression * 0.5);
                        }
                    }
                }
            }
            if (!dead) alive.push(bullet);
        }

        this.projectiles = alive;
    }

    // Blast damage falls off linearly to the edge of the radius, and only walls
    // between the burst and a body spare it.
    detonate(grenade, units) {
        for (const unit of units) {
            if (!unit.alive) continue;
            const dist = Math.hypot(unit.x - grenade.x, unit.y - grenade.y);
            if (dist > grenade.radius) continue;
            if (!this.vision.hasLineOfSight(grenade.x, grenade.y, unit.x, unit.y)) continue;

            const falloff = 1 - dist / grenade.radius;
            const scale = unit.team === grenade.team ? BLAST_FRIENDLY_SCALE : 1;
            const standing = unit.alive;
            unit.takeDamage(grenade.damage * falloff * scale);
            if (standing && !unit.alive) this.events.push({ type: 'down', x: unit.x, y: unit.y });
            unit.addSuppression(SUPPRESSION.threshold * falloff);
        }
        this.explosions.push({ x: grenade.x, y: grenade.y, radius: grenade.radius, ttl: EXPLOSION_TTL });
        this.events.push({
            type: 'explosion',
            kind: 'explosion',
            x: grenade.x,
            y: grenade.y,
            radius: grenade.radius,
        });
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
